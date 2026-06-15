-- Worker's OWN database (job queue + schedules). Isolated from the ProfitSync
-- app database. Idempotent so it can run on every boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued',   -- queued | running | done | failed | dead
  priority      int  NOT NULL DEFAULT 0,           -- higher runs first
  run_at        timestamptz NOT NULL DEFAULT now(),-- earliest time to run
  attempts      int  NOT NULL DEFAULT 0,
  max_attempts  int  NOT NULL DEFAULT 5,
  last_error    text NOT NULL DEFAULT '',
  result        jsonb,
  -- Optional idempotency key: a second enqueue with the same key is ignored
  -- while the first is still pending/running.
  dedupe_key    text,
  locked_at     timestamptz,
  locked_by     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The hot dequeue path: ready, queued jobs by priority then age.
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs (status, run_at, priority);
-- Idempotency: at most one live (queued/running) job per dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_live_idx
  ON jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL,                      -- the job type to enqueue
  cron        text NOT NULL,                      -- 5/6-field cron expression
  timezone    text NOT NULL DEFAULT 'UTC',
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled     boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedules_due_idx ON schedules (enabled, next_run_at);
-- `name` is the natural key the app upserts by (ON CONFLICT (name)).
CREATE UNIQUE INDEX IF NOT EXISTS schedules_name_key ON schedules (name);
