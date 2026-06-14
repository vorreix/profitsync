// Package jobs holds the handler registry and the built-in job handlers.
//
// Two integration styles:
//   - Trigger-style ("app.trigger"): the worker calls a ProfitSync internal
//     endpoint on a schedule; the APP runs the business logic (it owns the DB).
//     Used for due-notifications, monthly financial-analysis generation, etc.
//   - Compute-style (future: "pdf.quotation", "csv.export", "email.bulk"): the
//     worker does the heavy work itself and writes results to S3, then posts the
//     resulting URL back to ProfitSync. The Deps below (ProfitSync + Storage) are
//     already wired for these — add a handler and Register it.
package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/vorreix/profitsync-worker/internal/profitsync"
	"github.com/vorreix/profitsync-worker/internal/storage"
)

// Handler runs one job. The returned bytes are stored as the job result.
type Handler func(ctx context.Context, payload json.RawMessage) (json.RawMessage, error)

// Deps are the shared capabilities handlers can use.
type Deps struct {
	ProfitSync *profitsync.Client
	Storage    *storage.Client // nil when S3 isn't configured
	Logger     *slog.Logger
}

// Registry maps a job type to its handler.
type Registry struct {
	handlers map[string]Handler
}

// NewRegistry returns an empty registry.
func NewRegistry() *Registry { return &Registry{handlers: make(map[string]Handler)} }

// Register adds a handler for a job type.
func (r *Registry) Register(t string, h Handler) { r.handlers[t] = h }

// Get looks up a handler.
func (r *Registry) Get(t string) (Handler, bool) { h, ok := r.handlers[t]; return h, ok }

// Types lists the registered job types.
func (r *Registry) Types() []string {
	out := make([]string, 0, len(r.handlers))
	for t := range r.handlers {
		out = append(out, t)
	}
	return out
}

// RegisterAll wires the built-in handlers.
func RegisterAll(r *Registry, d Deps) {
	r.Register("ping", pingHandler)
	r.Register("app.trigger", appTriggerHandler(d))
	// Future compute-style handlers register here, e.g.:
	//   r.Register("pdf.quotation", pdfQuotationHandler(d))
	//   r.Register("csv.export", csvExportHandler(d))
	//   r.Register("email.bulk", bulkEmailHandler(d))
}

// pingHandler is a smoke-test job.
func pingHandler(_ context.Context, _ json.RawMessage) (json.RawMessage, error) {
	return json.RawMessage(`{"pong":true}`), nil
}

// appTriggerPayload describes a call into the ProfitSync internal API.
type appTriggerPayload struct {
	Path   string          `json:"path"`             // e.g. "/api/internal/cron/notifications"
	Method string          `json:"method,omitempty"` // default POST
	Body   json.RawMessage `json:"body,omitempty"`
}

// appTriggerHandler is the generic trigger: it calls a ProfitSync internal
// endpoint. Schedules use it to drive notification dispatch, monthly analysis
// generation, and any other app-owned periodic work — without bespoke handlers.
func appTriggerHandler(d Deps) Handler {
	return func(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
		var p appTriggerPayload
		if err := json.Unmarshal(payload, &p); err != nil {
			return nil, fmt.Errorf("app.trigger: bad payload: %w", err)
		}
		if p.Path == "" {
			return nil, errors.New("app.trigger: payload.path is required")
		}
		if d.ProfitSync == nil || !d.ProfitSync.Configured() {
			return nil, errors.New("app.trigger: ProfitSync client not configured")
		}
		out, err := d.ProfitSync.Call(ctx, p.Method, p.Path, p.Body)
		if err != nil {
			return nil, err
		}
		if len(out) == 0 {
			out = []byte(`{}`)
		}
		return out, nil
	}
}
