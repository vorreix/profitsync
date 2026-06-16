# ProfitSync Worker

A small, self-hosted **background-processing service** for ProfitSync: a durable
job queue + cron scheduler + HTTP control API, written in Go and shipped as a
single container. It runs on a **separate host** from the Vercel app so long /
heavy / scheduled work never lives in short-lived serverless functions.

It is the home for:
- **Scheduled notifications** (transaction reminders, scheduled/recurring admin broadcasts)
- **Monthly financial-analysis generation**
- **Bulk + transactional email sending**
- **CSV import / export**
- **PDF quotation generation** (saved to S3-compatible storage; only the URL goes back to the app)
- …and anything else that wants a clock, a queue, retries, or heavy CPU off the request path.

## Folder structure

```
worker/
├── deploy/
│   ├── docker-compose.yml      # worker + its own Postgres
│   └── .env.example            # copy to .env, fill secrets
└── app/
    ├── go.mod
    ├── main.go                 # entrypoint: migrate → scheduler + worker pool + HTTP API
    ├── build/Dockerfile        # multi-stage build
    ├── migrations/             # the worker's OWN schema (jobs, schedules)
    └── internal/
        ├── config/             # env config
        ├── store/              # pgx pool, queue ops (SKIP LOCKED), schedules
        ├── jobs/               # handler registry + handlers
        ├── worker/             # bounded worker pool (timeout, retry/backoff, panic recovery)
        ├── scheduler/          # cron → enqueue
        ├── httpapi/            # /healthz + authed /v1/jobs, /v1/schedules
        ├── profitsync/         # authenticated callback client into the app
        └── storage/            # S3-compatible object storage
```

## Architecture & data isolation

```
                 ┌──────────────────────── ProfitSync (Vercel) ───────────────────────┐
                 │  enqueues jobs / upserts schedules  ──HTTP+bearer──►  Worker /v1/*   │
                 │  exposes /api/internal/*  ◄──HTTP+service token──  trigger-style jobs │
                 └────────────────────────────────────────────────────────────────────┘
                                              │                         │
                          (worker's OWN DB)   ▼                         ▼  (results)
                                    ┌───────────────┐           ┌───────────────┐
                                    │  Postgres      │           │  S3 storage    │
                                    │  jobs+schedules│           │ (PDF/CSV files)│
                                    └───────────────┘           └───────────────┘
```

**Isolation by design:** the worker has its **own Postgres** (just the queue +
schedules) and **never connects to the ProfitSync app database**. It reaches app
data/logic two ways:

1. **Trigger-style** (`app.trigger` job): the worker calls a ProfitSync internal
   endpoint on a schedule (bearer service token); the **app** runs the logic with
   its own DB. Used for due-notifications and monthly analysis. The worker is just
   a reliable clock + queue.
2. **Compute-style** (future `pdf.quotation`, `csv.export`, `email.bulk`): the
   worker does the heavy work itself, writes the artifact to **S3**, and posts the
   resulting URL back to ProfitSync. The `Deps` (ProfitSync client + Storage) are
   already wired — add a handler in `internal/jobs` and `Register` it.

Security: the control API requires a bearer token (`WORKER_API_TOKEN`); the
app-callback uses a separate `PROFITSYNC_SERVICE_TOKEN`; S3 creds live only here.
Put the worker behind TLS with a host nginx + certbot (see
`docs/worker/DEPLOYMENT.md` §5 + `deploy/nginx-worker.conf.example`) and restrict ingress.

## The queue

A Postgres-backed queue using `FOR UPDATE SKIP LOCKED` — reliable, transactional,
no extra infrastructure (Redis/RabbitMQ not needed at this scale). Features:
priorities, delayed `run_at`, idempotency (`dedupe_key`, partial unique index),
exponential-backoff retries, and dead-lettering after `max_attempts`.

## HTTP control API

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /healthz` | none | liveness (pings the queue DB) |
| `POST /v1/jobs` | bearer | enqueue `{ type, payload?, run_at?, priority?, dedupe_key?, max_attempts? }` |
| `POST /v1/schedules` | bearer | upsert `{ name, type, cron, timezone?, payload?, enabled? }` |
| `GET /v1/stats` | bearer | job counts per status (admin dashboard) |
| `GET /v1/jobs?status=&type=&limit=&offset=` | bearer | list recent jobs (admin) |
| `POST /v1/jobs/{id}/retry` | bearer | re-queue a failed/dead/cancelled job |
| `POST /v1/jobs/{id}/cancel` | bearer | cancel a still-queued job |

The `/v1/stats` + `/v1/jobs` + retry/cancel endpoints back the ProfitSync
**/admin** worker panel via a server-side proxy (the bearer token never reaches
the browser), so admins see queue depth, recent jobs, failures, and can
retry/cancel.

**Reliability:** a crashed worker's in-flight jobs aren't lost — the scheduler
reaps jobs stuck in `running` past `WORKER_VISIBILITY_TIMEOUT` and requeues them
(or dead-letters past `max_attempts`); on `SIGTERM` the process drains in-flight
jobs (up to `WORKER_SHUTDOWN_GRACE`) before exiting.

Example — schedule notification dispatch every 5 minutes (the app would call this
once at deploy/bootstrap):

```bash
curl -X POST "$WORKER_URL/v1/schedules" -H "Authorization: Bearer $WORKER_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "name": "notifications-dispatch",
    "type": "app.trigger",
    "cron": "*/5 * * * *",
    "timezone": "UTC",
    "payload": { "path": "/api/internal/cron/notifications" }
  }'
```

When that fires, the worker `POST`s to `https://profitsync.net/api/internal/cron/notifications`
with the service token; ProfitSync then delivers due reminders / scheduled
broadcasts using its existing notification service.

## Run it

```bash
cd worker/deploy
cp .env.example .env      # set WORKER_API_TOKEN, POSTGRES_PASSWORD, PROFITSYNC_*, S3_* …
docker compose up -d --build
curl localhost:8080/healthz   # {"status":"ok"}
```

## ProfitSync side (to wire next)

Add internal endpoints the worker triggers (protected by `PROFITSYNC_SERVICE_TOKEN`),
e.g. `POST /api/internal/cron/notifications`, and a tiny client that POSTs to the
worker's `/v1/jobs` for on-demand work (PDF/CSV/export). These live in the main
repo and are tracked in `docs/notifications/V2_ROADMAP.md`.

## Notes
- Commit `go.sum` (generated by `go mod tidy`) for fully reproducible builds; the
  scaffold resolves modules at image-build time.
- Built-in job types today: `ping` (smoke test), `app.trigger` (generic app
  callback). Compute handlers are the documented extension point.
