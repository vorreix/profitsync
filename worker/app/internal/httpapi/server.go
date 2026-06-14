// Package httpapi exposes the worker's control surface: a public health check and
// authenticated endpoints for ProfitSync to enqueue jobs and upsert schedules.
package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/vorreix/profitsync-worker/internal/config"
	"github.com/vorreix/profitsync-worker/internal/store"
)

// Server is the HTTP control surface.
type Server struct {
	st  *store.Store
	cfg config.Config
	log *slog.Logger
}

// New builds the server.
func New(st *store.Store, cfg config.Config, log *slog.Logger) *Server {
	return &Server{st: st, cfg: cfg, log: log}
}

// Run serves until ctx is cancelled, then shuts down gracefully.
func (s *Server) Run(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.Handle("POST /v1/jobs", s.auth(http.HandlerFunc(s.handleEnqueue)))
	mux.Handle("POST /v1/schedules", s.auth(http.HandlerFunc(s.handleUpsertSchedule)))

	srv := &http.Server{
		Addr:              ":" + s.cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		s.log.Info("http listening", "port", s.cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	case err := <-errCh:
		return err
	}
}

// auth enforces a bearer token (constant-time compare) on protected routes.
func (s *Server) auth(next http.Handler) http.Handler {
	want := []byte("Bearer " + s.cfg.APIToken)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if len(got) != len(want) || subtle.ConstantTimeCompare(got, want) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.st.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "down"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type enqueueRequest struct {
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload,omitempty"`
	RunAt       *time.Time      `json:"run_at,omitempty"`
	Priority    int             `json:"priority,omitempty"`
	MaxAttempts int             `json:"max_attempts,omitempty"`
	DedupeKey   *string         `json:"dedupe_key,omitempty"`
}

func (s *Server) handleEnqueue(w http.ResponseWriter, r *http.Request) {
	var req enqueueRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if req.Type == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "type is required"})
		return
	}
	params := store.EnqueueParams{
		Type:        req.Type,
		Payload:     req.Payload,
		Priority:    req.Priority,
		MaxAttempts: req.MaxAttempts,
		DedupeKey:   req.DedupeKey,
	}
	if req.RunAt != nil {
		params.RunAt = *req.RunAt
	}
	id, enqueued, err := s.st.Enqueue(r.Context(), params)
	if err != nil {
		s.log.Error("enqueue", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "enqueue failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "enqueued": enqueued})
}

type scheduleRequest struct {
	Name     string          `json:"name"`
	Type     string          `json:"type"`
	Cron     string          `json:"cron"`
	Timezone string          `json:"timezone,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	Enabled  *bool           `json:"enabled,omitempty"`
}

func (s *Server) handleUpsertSchedule(w http.ResponseWriter, r *http.Request) {
	var req scheduleRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if req.Name == "" || req.Type == "" || req.Cron == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name, type and cron are required"})
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	id, err := s.st.UpsertSchedule(r.Context(), store.Schedule{
		Name:     req.Name,
		Type:     req.Type,
		Cron:     req.Cron,
		Timezone: req.Timezone,
		Payload:  req.Payload,
		Enabled:  enabled,
	})
	if err != nil {
		s.log.Error("upsert schedule", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "upsert failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
