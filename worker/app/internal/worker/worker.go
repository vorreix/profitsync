// Package worker is the job-processing pool: it polls the queue, runs handlers
// with a per-job timeout and panic recovery, and completes/retries/dead-letters.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/vorreix/profitsync-worker/internal/config"
	"github.com/vorreix/profitsync-worker/internal/jobs"
	"github.com/vorreix/profitsync-worker/internal/store"
)

// Worker drains the queue using a bounded pool.
type Worker struct {
	st  *store.Store
	reg *jobs.Registry
	cfg config.Config
	log *slog.Logger
	id  string
}

// New builds a Worker. id identifies this process in the queue's locked_by.
func New(st *store.Store, reg *jobs.Registry, cfg config.Config, log *slog.Logger, id string) *Worker {
	return &Worker{st: st, reg: reg, cfg: cfg, log: log, id: id}
}

// Run polls and processes until ctx is cancelled, then drains in-flight jobs.
func (w *Worker) Run(ctx context.Context) {
	sem := make(chan struct{}, w.cfg.Concurrency)
	var wg sync.WaitGroup
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	w.log.Info("worker pool started", "concurrency", w.cfg.Concurrency)
	for {
		select {
		case <-ctx.Done():
			wg.Wait()
			w.log.Info("worker pool drained")
			return
		case <-ticker.C:
			free := cap(sem) - len(sem)
			if free <= 0 {
				continue
			}
			claimed, err := w.st.Claim(ctx, w.id, free)
			if err != nil {
				if ctx.Err() == nil {
					w.log.Error("claim jobs", "err", err)
				}
				continue
			}
			if len(claimed) > 0 {
				w.log.Debug("claimed jobs", "count", len(claimed))
			}
			for _, j := range claimed {
				sem <- struct{}{}
				wg.Add(1)
				go func(j store.Job) {
					defer wg.Done()
					defer func() { <-sem }()
					w.process(ctx, j)
				}(j)
			}
		}
	}
}

func (w *Worker) process(ctx context.Context, j store.Job) {
	h, ok := w.reg.Get(j.Type)
	if !ok {
		_ = w.st.Fail(ctx, j, fmt.Errorf("no handler registered for type %q", j.Type), w.backoff(j))
		return
	}
	jobCtx, cancel := context.WithTimeout(ctx, w.cfg.JobTimeout)
	defer cancel()

	w.log.Debug("job start", "id", j.ID, "type", j.Type, "attempt", j.Attempts)
	start := time.Now()
	result, err := run(jobCtx, h, j.Payload)
	if err != nil {
		w.log.Warn("job failed", "id", j.ID, "type", j.Type, "attempt", j.Attempts, "err", err)
		if ferr := w.st.Fail(context.WithoutCancel(ctx), j, err, w.backoff(j)); ferr != nil {
			w.log.Error("mark failed", "id", j.ID, "err", ferr)
		}
		return
	}
	if cerr := w.st.Complete(context.WithoutCancel(ctx), j.ID, result); cerr != nil {
		w.log.Error("mark complete", "id", j.ID, "err", cerr)
		return
	}
	w.log.Info("job done", "id", j.ID, "type", j.Type, "attempt", j.Attempts, "dur_ms", time.Since(start).Milliseconds())
}

// run executes a handler, converting a panic into an error.
func run(ctx context.Context, h jobs.Handler, payload json.RawMessage) (result json.RawMessage, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("handler panic: %v", r)
		}
	}()
	return h(ctx, payload)
}

// backoff is exponential with a cap: ~10s, 20s, 40s … up to 1h.
func (w *Worker) backoff(j store.Job) time.Duration {
	const base = 10 * time.Second
	const max = time.Hour
	d := base
	for i := 1; i < j.Attempts; i++ {
		d *= 2
		if d >= max {
			return max
		}
	}
	return d
}
