---
name: worker-service
description: Use when working on the ProfitSync background worker (the worker/ folder) — the self-hosted Go job queue + cron scheduler + S3 service that runs off-Vercel for cron, heavy compute (PDF/CSV, monthly analysis), bulk/async email, and scheduled notifications/reminders/broadcasts. Trigger on the job queue, adding a job handler or schedule, the worker's Postgres/migrations, docker-compose deploy, the /admin Worker panel, the app↔worker tokens, or the "should we use Temporal" question. Establishes the isolated-queue model and the invariants that keep it reliable.
---

# ProfitSync Background Worker

Authoritative docs: `worker/README.md` (architecture), `docs/worker/DEPLOYMENT.md`
(deploy/ops runbook), `docs/worker/ARCHITECTURE_DECISION.md` (the Temporal verdict).
This skill is the **operating guide**: mental model, invariants, where things live,
and how to change it safely.

## Mental model (internalize first)

- **Isolated service.** A single Go binary = durable **Postgres-backed queue**
  (`FOR UPDATE SKIP LOCKED`) + **cron scheduler** + **HTTP control API**, deployed
  via docker-compose on a **separate host** with its **OWN Postgres**. It **never
  connects to the ProfitSync app DB** — that's the data-isolation guarantee.
- **Two integration styles.** *Trigger-style* (`app.trigger` job): the worker calls
  a ProfitSync internal endpoint on a schedule; the APP runs the logic (used for
  due-notifications, monthly analysis). *Compute-style* (PDF/CSV/bulk-email,
  future): the worker does the heavy work itself, writes the artifact to **S3**,
  and returns the URL to the app. `Deps{ProfitSync, Storage, Logger}` are wired.
- **Two tokens.** `WORKER_API_TOKEN` = app→worker (bearer the worker checks on
  `/v1/*`). `PROFITSYNC_SERVICE_TOKEN` = worker→app (bearer the app checks on
  `/api/internal/*`). Same value on both sides; HTTPS only.
- **Not Temporal (yet).** Decided in `ARCHITECTURE_DECISION.md`: self-hosting
  Temporal is over-engineering at this scale. Upgrade path is **River** (in place,
  Go+Postgres) then **Temporal Cloud** only on ≥3 trigger conditions. Don't
  reach for Temporal without revisiting that doc.

## Invariants — do not break these

1. **Isolation:** the worker connects ONLY to its own queue Postgres. App data /
   business logic is reached via the authenticated callback (`app.trigger` →
   ProfitSync internal API) or, for compute jobs, via the app's API — never a
   direct app-DB connection.
2. **Crash-safety (reaper):** a worker crashing mid-job must not orphan work. The
   scheduler reaps jobs stuck in `running` past `WORKER_VISIBILITY_TIMEOUT` and
   requeues them (dead-letters past `max_attempts`). Keep `WORKER_VISIBILITY_TIMEOUT`
   **above** `WORKER_JOB_TIMEOUT`. Don't remove the reaper.
3. **Graceful shutdown:** `main()` WAITS for the worker pool to drain on SIGTERM
   (bounded by `WORKER_SHUTDOWN_GRACE`). Don't make Run loops fire-and-forget again.
4. **Dedup correctly:** `Enqueue` with a `dedupe_key` uses a pre-check + the partial
   unique index `(dedupe_key) WHERE status IN ('queued','running')` as the race
   backstop (catch 23505) — do NOT use `ON CONFLICT` on that partial index
   (Postgres can't infer the arbiter reliably).
5. **Handlers are idempotent + best-effort about side effects.** At-least-once
   delivery means a handler can run twice (retry/reap) — make sends/uploads
   idempotent (dedupe emails, stable S3 keys).
6. **Auth everywhere:** every `/v1/*` route is bearer-authed (constant-time
   compare); only `/healthz` is open. The app reaches the worker ONLY via the
   super-admin server-side proxy (`/api/admin/worker`) — the token never hits the
   browser.

## Where everything lives

- `worker/app/main.go` — entrypoint (migrate → scheduler + pool + HTTP, graceful drain).
- `worker/app/internal/store/` — pgx pool, queue ops (claim/complete/fail/**reap**),
  schedules, **stats/list/retry/cancel** (admin).
- `worker/app/internal/worker/` — bounded pool (timeout, retry/backoff, panic recovery).
- `worker/app/internal/scheduler/` — cron → enqueue + the reaper tick.
- `worker/app/internal/jobs/` — handler registry + handlers (`ping`, `app.trigger`).
- `worker/app/internal/httpapi/` — `/healthz`, `/v1/jobs|schedules|stats`, retry/cancel.
- `worker/app/internal/{profitsync,storage,config}/` — app client, S3 (minio-go), env.
- `worker/app/migrations/0001_init.sql` — jobs + schedules (idempotent).
- `worker/deploy/docker-compose.yml` + `worker/app/build/Dockerfile`.
- App side: `api/_routes/admin/worker.ts` (proxy) + `src/pages/admin/AdminWorkerPage.tsx`.

## Recipes

**Add a job type (compute-style):** write a `Handler` in `internal/jobs`, `Register`
it in `RegisterAll`, use `Deps.Storage` (S3) + `Deps.ProfitSync` (post the result
URL back). Make it idempotent.

**Add a recurring task:** `POST /v1/schedules { name, type:"app.trigger", cron,
timezone, payload:{ path:"/api/internal/..." } }` and add the matching
service-token-gated endpoint in the app.

**On-demand job from the app:** `POST /v1/jobs { type, payload, dedupe_key? }` via a
small server-side client (token from env), not the browser.

## Verifying changes (no local Go needed)

- **Compile check = build the image:** `docker build -f worker/app/build/Dockerfile
  worker/app` runs `go build` inside the golang container (Docker daemon must be
  running). A compile error fails the build.
- **End-to-end:** `cd worker/deploy && docker compose up -d --build`, then
  `curl /healthz`, enqueue a `ping`, check it reaches `done` via `/v1/jobs`. To test
  the reaper, insert a `running` row with an old `locked_at` + a low
  `WORKER_VISIBILITY_TIMEOUT` and watch the scheduler requeue it.
- Tear down with `docker compose down -v`; never commit `worker/deploy/.env`.

## Gotchas

- No `go.sum` committed — the Dockerfile runs `go mod tidy`. Commit `go.sum` for
  fully reproducible builds.
- `worker/` is in `.vercelignore` — it must never be part of the Vercel build.
- Timezone schedules work on any base image because `main.go` blank-imports
  `time/tzdata`.
- The app's `/admin → Worker` panel shows "not configured" until `WORKER_BASE_URL`
  + `WORKER_API_TOKEN` are set in Vercel and the app is redeployed.
- See [[worker-service]] and [[notification-system]] memory notes for the broader
  context (this worker is the scheduler for the notification V2 timed features).
