// Package scheduler turns cron schedules into queued jobs. On each tick it finds
// due schedules, enqueues a job of the schedule's type, and computes the next run
// in the schedule's timezone. A brand-new schedule (next_run_at NULL) is only
// initialised (next computed) — it does not fire immediately.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/robfig/cron/v3"

	"github.com/vorreix/profitsync-worker/internal/config"
	"github.com/vorreix/profitsync-worker/internal/store"
)

// Scheduler evaluates schedules against the clock.
type Scheduler struct {
	st     *store.Store
	cfg    config.Config
	log    *slog.Logger
	parser cron.Parser
	tick   time.Duration
}

// New builds a Scheduler. It parses standard 5-field cron plus @-descriptors.
func New(st *store.Store, cfg config.Config, log *slog.Logger) *Scheduler {
	return &Scheduler{
		st:     st,
		cfg:    cfg,
		log:    log,
		parser: cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor),
		tick:   30 * time.Second,
	}
}

// Run evaluates due schedules every tick until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(s.tick)
	defer ticker.Stop()
	s.log.Info("scheduler started", "tick", s.tick.String())
	for {
		select {
		case <-ctx.Done():
			s.log.Info("scheduler stopped")
			return
		case <-ticker.C:
			if err := s.evaluate(ctx, time.Now()); err != nil && ctx.Err() == nil {
				s.log.Error("scheduler evaluate", "err", err)
			}
		}
	}
}

func (s *Scheduler) evaluate(ctx context.Context, now time.Time) error {
	// Crash-safety: rescue jobs orphaned in 'running' by a crashed worker before
	// looking at schedules. Cheap (indexed, usually 0 rows).
	if n, err := s.st.Reap(ctx, s.cfg.VisibilityTimeout); err != nil {
		s.log.Error("reap orphaned jobs", "err", err)
	} else if n > 0 {
		s.log.Warn("reaped orphaned jobs", "count", n)
	}

	due, err := s.st.DueSchedules(ctx, now)
	if err != nil {
		return err
	}
	s.log.Debug("scheduler tick", "due_schedules", len(due))
	for _, sc := range due {
		next, err := s.nextRun(sc.Cron, sc.Timezone, now)
		if err != nil {
			s.log.Error("bad cron, skipping", "schedule", sc.Name, "cron", sc.Cron, "err", err)
			continue
		}
		// Only enqueue when this is a real due tick (next_run_at was set and has
		// passed). A freshly-created schedule (NULL) is just initialised.
		if sc.NextRunAt != nil {
			id, enq, eerr := s.st.Enqueue(ctx, store.EnqueueParams{
				Type:        sc.Type,
				Payload:     sc.Payload,
				MaxAttempts: s.cfg.MaxAttempts,
				// One job per schedule per fire-slot: dedupe on the slot time.
				DedupeKey: ptr(fmt.Sprintf("sched:%s:%d", sc.ID, sc.NextRunAt.Unix())),
			})
			if eerr != nil {
				s.log.Error("enqueue from schedule", "schedule", sc.Name, "err", eerr)
			} else if enq {
				s.log.Info("schedule fired", "schedule", sc.Name, "type", sc.Type, "job", id)
			}
		}
		if err := s.st.AdvanceSchedule(ctx, sc.ID, next); err != nil {
			s.log.Error("advance schedule", "schedule", sc.Name, "err", err)
		}
	}
	return nil
}

// nextRun computes the next fire time after `now` in the schedule's timezone.
func (s *Scheduler) nextRun(spec, tz string, now time.Time) (time.Time, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	sched, err := s.parser.Parse(spec)
	if err != nil {
		return time.Time{}, err
	}
	return sched.Next(now.In(loc)).UTC(), nil
}

func ptr[T any](v T) *T { return &v }
