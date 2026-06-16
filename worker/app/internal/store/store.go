// Package store is the worker's persistence layer over its OWN Postgres: the job
// queue and the cron schedules. It never touches the ProfitSync app database.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps a pgx connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// Job is a unit of background work.
type Job struct {
	ID          string
	Type        string
	Payload     json.RawMessage
	Status      string
	Priority    int
	RunAt       time.Time
	Attempts    int
	MaxAttempts int
	LastError   string
	DedupeKey   *string
}

// Schedule is a recurring trigger that enqueues a Job on a cron.
type Schedule struct {
	ID        string
	Name      string
	Type      string
	Cron      string
	Timezone  string
	Payload   json.RawMessage
	Enabled   bool
	NextRunAt *time.Time
}

// New opens a pooled connection to the worker DB.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// Ping is the liveness check used by /healthz.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Migrate applies the schema. `sql` is the embedded migration content; it is
// idempotent (CREATE … IF NOT EXISTS), so running it on every boot is safe.
func (s *Store) Migrate(ctx context.Context, sql string) error {
	_, err := s.pool.Exec(ctx, sql)
	return err
}

// EnqueueParams are the inputs to Enqueue.
type EnqueueParams struct {
	Type        string
	Payload     json.RawMessage
	RunAt       time.Time
	Priority    int
	MaxAttempts int
	DedupeKey   *string
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// Enqueue inserts a job. When a DedupeKey is supplied and a live (queued/running)
// job with that key already exists, the insert is a no-op and ("", false) is
// returned. A pre-check keeps the common path simple; the partial unique index is
// the race backstop (a concurrent insert surfaces as 23505 → treated as deduped).
func (s *Store) Enqueue(ctx context.Context, p EnqueueParams) (string, bool, error) {
	if p.Payload == nil {
		p.Payload = json.RawMessage(`{}`)
	}
	if p.RunAt.IsZero() {
		p.RunAt = time.Now()
	}
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = 5
	}
	if p.DedupeKey != nil {
		var exists bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM jobs WHERE dedupe_key=$1 AND status IN ('queued','running'))`,
			*p.DedupeKey,
		).Scan(&exists); err != nil {
			return "", false, fmt.Errorf("dedupe check: %w", err)
		}
		if exists {
			return "", false, nil
		}
	}
	var id string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO jobs (type, payload, run_at, priority, max_attempts, dedupe_key)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		p.Type, p.Payload, p.RunAt, p.Priority, p.MaxAttempts, p.DedupeKey,
	).Scan(&id)
	if err != nil {
		if p.DedupeKey != nil && isUniqueViolation(err) {
			return "", false, nil // concurrent insert won the dedupe race
		}
		return "", false, fmt.Errorf("enqueue: %w", err)
	}
	return id, true, nil
}

// Claim atomically locks up to `limit` ready jobs for `workerID` and marks them
// running (incrementing attempts). Uses FOR UPDATE SKIP LOCKED so multiple worker
// processes never grab the same job.
func (s *Store) Claim(ctx context.Context, workerID string, limit int) ([]Job, error) {
	rows, err := s.pool.Query(ctx,
		`UPDATE jobs SET status='running', locked_at=now(), locked_by=$1, attempts=attempts+1, updated_at=now()
		 WHERE id IN (
		   SELECT id FROM jobs
		   WHERE status='queued' AND run_at <= now()
		   ORDER BY priority DESC, run_at ASC
		   FOR UPDATE SKIP LOCKED
		   LIMIT $2
		 )
		 RETURNING id, type, payload, status, priority, run_at, attempts, max_attempts, last_error, dedupe_key`,
		workerID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("claim: %w", err)
	}
	defer rows.Close()

	var jobs []Job
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.ID, &j.Type, &j.Payload, &j.Status, &j.Priority, &j.RunAt, &j.Attempts, &j.MaxAttempts, &j.LastError, &j.DedupeKey); err != nil {
			return nil, fmt.Errorf("scan job: %w", err)
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

// Complete marks a job done with an optional result payload.
func (s *Store) Complete(ctx context.Context, id string, result json.RawMessage) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE jobs SET status='done', result=$2, last_error='', locked_at=NULL, locked_by=NULL, updated_at=now() WHERE id=$1`,
		id, result,
	)
	return err
}

// Fail records an error. If attempts < max_attempts the job is re-queued with the
// given backoff; otherwise it is marked dead.
func (s *Store) Fail(ctx context.Context, j Job, runErr error, backoff time.Duration) error {
	if j.Attempts >= j.MaxAttempts {
		_, err := s.pool.Exec(ctx,
			`UPDATE jobs SET status='dead', last_error=$2, locked_at=NULL, locked_by=NULL, updated_at=now() WHERE id=$1`,
			j.ID, runErr.Error(),
		)
		return err
	}
	_, err := s.pool.Exec(ctx,
		`UPDATE jobs SET status='queued', last_error=$2, run_at=now()+make_interval(secs => $3), locked_at=NULL, locked_by=NULL, updated_at=now() WHERE id=$1`,
		j.ID, runErr.Error(), backoff.Seconds(),
	)
	return err
}

// DueSchedules returns enabled schedules whose next_run_at has passed (or is unset).
func (s *Store) DueSchedules(ctx context.Context, now time.Time) ([]Schedule, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, type, cron, timezone, payload, enabled, next_run_at
		 FROM schedules
		 WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= $1)`,
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("due schedules: %w", err)
	}
	defer rows.Close()
	var out []Schedule
	for rows.Next() {
		var sc Schedule
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Type, &sc.Cron, &sc.Timezone, &sc.Payload, &sc.Enabled, &sc.NextRunAt); err != nil {
			return nil, fmt.Errorf("scan schedule: %w", err)
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

// AdvanceSchedule stamps last_run_at = now and sets the computed next_run_at.
func (s *Store) AdvanceSchedule(ctx context.Context, id string, next time.Time) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE schedules SET last_run_at=now(), next_run_at=$2, updated_at=now() WHERE id=$1`,
		id, next,
	)
	return err
}

// Reap rescues jobs stuck in 'running' longer than the visibility timeout (the
// worker that claimed them crashed mid-job). Past max_attempts → 'dead', else
// re-queued. Returns how many were reaped. This is the safety net that makes the
// queue crash-safe — without it a crashed worker would orphan its jobs forever.
func (s *Store) Reap(ctx context.Context, visibilityTimeout time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE jobs SET
		   status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
		   last_error = CASE WHEN attempts >= max_attempts THEN 'orphaned: worker crashed mid-job' ELSE last_error END,
		   run_at = now(), locked_at = NULL, locked_by = NULL, updated_at = now()
		 WHERE status = 'running' AND locked_at < now() - make_interval(secs => $1)`,
		visibilityTimeout.Seconds(),
	)
	if err != nil {
		return 0, fmt.Errorf("reap: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Stats returns a count of jobs per status (for the admin dashboard).
func (s *Store) Stats(ctx context.Context) (map[string]int, error) {
	rows, err := s.pool.Query(ctx, `SELECT status, count(*)::int FROM jobs GROUP BY status`)
	if err != nil {
		return nil, fmt.Errorf("stats: %w", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return nil, err
		}
		out[status] = n
	}
	return out, rows.Err()
}

// JobView is a job summary for the admin list (omits large payload/result blobs).
type JobView struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"`
	Status      string    `json:"status"`
	Priority    int       `json:"priority"`
	Attempts    int       `json:"attempts"`
	MaxAttempts int       `json:"max_attempts"`
	LastError   string    `json:"last_error"`
	RunAt       time.Time `json:"run_at"`
	LockedBy    *string   `json:"locked_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ListJobs returns recent jobs, optionally filtered by status and/or type.
func (s *Store) ListJobs(ctx context.Context, status, jobType string, limit, offset int) ([]JobView, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx,
		`SELECT id, type, status, priority, attempts, max_attempts, last_error, run_at, locked_by, created_at, updated_at
		 FROM jobs
		 WHERE ($1 = '' OR status = $1) AND ($2 = '' OR type = $2)
		 ORDER BY created_at DESC
		 LIMIT $3 OFFSET $4`,
		status, jobType, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	defer rows.Close()
	out := []JobView{}
	for rows.Next() {
		var j JobView
		if err := rows.Scan(&j.ID, &j.Type, &j.Status, &j.Priority, &j.Attempts, &j.MaxAttempts, &j.LastError, &j.RunAt, &j.LockedBy, &j.CreatedAt, &j.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// RetryJob re-queues a failed/dead/cancelled job (attempts reset). Returns false
// if no such job exists in a retryable state.
func (s *Store) RetryJob(ctx context.Context, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE jobs SET status='queued', attempts=0, run_at=now(), last_error='', locked_at=NULL, locked_by=NULL, updated_at=now()
		 WHERE id=$1 AND status IN ('failed','dead','cancelled')`,
		id,
	)
	if err != nil {
		return false, fmt.Errorf("retry job: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// CancelJob marks a still-queued job cancelled. Returns false if it isn't queued.
func (s *Store) CancelJob(ctx context.Context, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE jobs SET status='cancelled', updated_at=now() WHERE id=$1 AND status='queued'`,
		id,
	)
	if err != nil {
		return false, fmt.Errorf("cancel job: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// UpsertSchedule creates or updates a schedule by name (the natural key from the
// app). next_run_at is reset so the scheduler recomputes it on its next tick.
func (s *Store) UpsertSchedule(ctx context.Context, sc Schedule) (string, error) {
	if sc.Payload == nil {
		sc.Payload = json.RawMessage(`{}`)
	}
	if sc.Timezone == "" {
		sc.Timezone = "UTC"
	}
	var id string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO schedules (name, type, cron, timezone, payload, enabled, next_run_at)
		 VALUES ($1,$2,$3,$4,$5,$6, NULL)
		 ON CONFLICT (name) DO UPDATE SET
		   type=EXCLUDED.type, cron=EXCLUDED.cron, timezone=EXCLUDED.timezone,
		   payload=EXCLUDED.payload, enabled=EXCLUDED.enabled, next_run_at=NULL, updated_at=now()
		 RETURNING id`,
		sc.Name, sc.Type, sc.Cron, sc.Timezone, sc.Payload, sc.Enabled,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("upsert schedule: %w", err)
	}
	return id, nil
}

// ScheduleView is a schedule summary for the admin panel (so an operator can SEE
// whether the notification clock is wired). Timestamps are nullable: a freshly
// upserted schedule has no run history yet.
type ScheduleView struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Type      string     `json:"type"`
	Cron      string     `json:"cron"`
	Timezone  string     `json:"timezone"`
	Enabled   bool       `json:"enabled"`
	NextRunAt *time.Time `json:"next_run_at"`
	LastRunAt *time.Time `json:"last_run_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// ListSchedules returns all registered schedules, newest-first.
func (s *Store) ListSchedules(ctx context.Context) ([]ScheduleView, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, type, cron, timezone, enabled, next_run_at, last_run_at, updated_at
		 FROM schedules
		 ORDER BY name ASC`,
	)
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	defer rows.Close()
	out := []ScheduleView{}
	for rows.Next() {
		var sc ScheduleView
		if err := rows.Scan(&sc.ID, &sc.Name, &sc.Type, &sc.Cron, &sc.Timezone, &sc.Enabled, &sc.NextRunAt, &sc.LastRunAt, &sc.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}
