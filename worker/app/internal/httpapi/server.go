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
	"strconv"
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
	// Observability (consumed by the ProfitSync /admin worker panel via a server
	// -side proxy — all bearer-authed).
	mux.Handle("GET /v1/stats", s.auth(http.HandlerFunc(s.handleStats)))
	mux.Handle("GET /v1/jobs", s.auth(http.HandlerFunc(s.handleListJobs)))
	mux.Handle("POST /v1/jobs/{id}/retry", s.auth(http.HandlerFunc(s.handleRetry)))
	mux.Handle("POST /v1/jobs/{id}/cancel", s.auth(http.HandlerFunc(s.handleCancel)))

	srv := &http.Server{
		Addr:              ":" + s.cfg.Port,
		Handler:           s.logRequests(mux),
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

// statusRecorder captures the response status + byte count for access logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// logRequests logs every HTTP request (method, path, status, size, duration).
// Health checks are logged at DEBUG to keep the stream readable; 4xx→WARN, 5xx→ERROR.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		lvl := slog.LevelInfo
		switch {
		case r.URL.Path == "/healthz":
			lvl = slog.LevelDebug
		case rec.status >= 500:
			lvl = slog.LevelError
		case rec.status >= 400:
			lvl = slog.LevelWarn
		}
		s.log.Log(r.Context(), lvl, "http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"bytes", rec.bytes,
			"dur_ms", time.Since(start).Milliseconds(),
			"remote", r.RemoteAddr,
		)
	})
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

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.st.Stats(r.Context())
	if err != nil {
		s.log.Error("stats", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "stats failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"counts": stats})
}

func (s *Server) handleListJobs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	jobs, err := s.st.ListJobs(r.Context(), q.Get("status"), q.Get("type"), limit, offset)
	if err != nil {
		s.log.Error("list jobs", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}

func (s *Server) handleRetry(w http.ResponseWriter, r *http.Request) {
	ok, err := s.st.RetryJob(r.Context(), r.PathValue("id"))
	if err != nil {
		s.log.Error("retry", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "retry failed"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found or not retryable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	ok, err := s.st.CancelJob(r.Context(), r.PathValue("id"))
	if err != nil {
		s.log.Error("cancel", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "cancel failed"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found or not cancellable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
