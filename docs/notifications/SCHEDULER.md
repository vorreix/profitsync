# Notification scheduler — how timed delivery works

**V6 model (2026-07-12):**

- **Personal reminders (#6) are delivered ON the phone** — OS-scheduled local
  notifications (`src/lib/native-reminders.ts`), exact device time, offline-capable,
  zero server clock. The DB rows are just the settings store (web manages them; the
  phone re-projects them onto its alarm schedule on boot and after every edit).
  The server tick no longer delivers reminders at all.
- **Scheduled/recurring broadcasts (#7) fire via EXACT-TIME one-shot worker jobs**:
  scheduling (or editing, or a recurring re-arm) enqueues `POST /v1/jobs` on the Go
  worker with `run_at` = the fire instant and a `tick:<id>:<occurrence>` dedupe key
  (`api/_lib/worker-jobs.ts`, best-effort). The job triggers the idempotent tick
  below — a job from an edited/cancelled schedule finds nothing due and no-ops, so
  there is NO cancel plumbing.
- **An hourly reconcile sweep** (the worker's `notifications-dispatch` cron,
  `0 * * * *`) catches anything a lost enqueue missed (worker down at schedule
  time, wiped queue). Dedupe keys make job + sweep overlap harmless.

The app itself has **no cron** (recurring transactions materialize lazily on GET),
and the tick endpoint stays deliberately **scheduler-agnostic**: any ticker can
drive it.

## The endpoint

`POST /api/cron/notifications` — authenticated by the **service token**
(`PROFITSYNC_SERVICE_TOKEN`), never a user session. Each call:

1. Finds **due broadcasts** (`status='scheduled' AND next_fire_at <= now`), fans them
   out via `deliverBroadcast`, then advances recurrence (`nextRecurringFire`, which
   also enqueues the next exact-time job) or marks them `sent`.
2. Returns `{ processed: { reminders: 0, broadcasts } }` plus
   `previous_tick_at` / `previous_tick_age_seconds` (the heartbeat BEFORE this
   tick — external monitors use its age to detect a dead worker).

Every notification it creates carries a **dedupeKey**
(`broadcast:<id>:<occurrence>:<userId>`), so a double-tick or retry can never
double-send. The endpoint is therefore safe to call as often as you like.

## What drives it (layers, most-precise first — all safe to overlap)

| Driver | Setup | Precision | Notes |
|---|---|---|---|
| **Exact-time worker jobs** (primary) | Enqueued automatically by the app when a broadcast is scheduled/edited/re-armed (`api/_lib/worker-jobs.ts`; needs `WORKER_BASE_URL` + `WORKER_API_TOKEN` on the app) | exact | One live job per (broadcast, occurrence); stale jobs no-op. |
| **Hourly reconcile sweep** | `make register` / `scripts/register-worker-schedules.ts` / the admin panel button register the `notifications-dispatch` cron (`0 * * * *`) on the worker — `make up`/`rebuild` chain it automatically | ≤1 h behind | Catches lost enqueues + wiped queues. The June '26 outage (schedule never registered, silent for ~11 days) is covered by the auto-register + the red fallback below. |
| **GitHub Actions fallback** (keep it on) | `.github/workflows/notification-tick.yml` — every 2 h at :15, POSTs the endpoint with the repo secret `PROFITSYNC_CRON_TOKEN` (= the app's `CRON_FALLBACK_TOKEN` env var, a second token accepted by `requireServiceToken`) | ≤2 h behind | Survives a fully dead worker AND **alerts**: the run goes red (GitHub emails) when the pre-tick heartbeat is >150 min old. No-ops (with a run-summary warning) until the secret is set. |
| **External pinger** | Point cron-job.org (etc.) at the URL with the bearer header | its interval | Works on Vercel Hobby, no worker needed. |
| **Manual** | `/admin → Broadcasts → "Run due now"` (admin, `broadcast` cap) | on demand | Drives the exact same tick — useful before the worker is deployed, or for testing. |

All drivers call the identical idempotent logic (`runNotificationTick`) — dedupe
keys make overlapping drivers safe, so run the worker AND the fallback together.

## Liveness (heartbeat)

`runNotificationTick` upserts a single-row heartbeat
(`notification_scheduler_state`: last tick at + counts) on **every** tick, even
zero-work ones. `/admin → Worker` shows it at the top of the page — green when the
last tick is recent, a red "scheduler looks DOWN" alert when it's older than
15 minutes. Because the heartbeat lives in the app DB, it renders even when the
worker itself is unreachable — it answers the question the June '26 outage
couldn't: *is anything actually ticking?* The same panel also **auto-re-registers**
the `notifications-dispatch` schedule if the worker is reachable but the schedule
is missing (a worker redeploy can wipe its schedule table).

## Setup checklist

1. Generate the secret: `openssl rand -hex 32`.
2. Set `PROFITSYNC_SERVICE_TOKEN` on the **app** (Vercel) — and the **same** value on
   the worker (`worker/deploy/.env`).
3. Deploy the worker (or wire an external pinger), then run
   `npx tsx scripts/register-worker-schedules.ts` (no-op if the worker isn't set).
4. Wire the fallback: generate a second secret, set it as `CRON_FALLBACK_TOKEN` on
   the app (Vercel) AND as the GitHub repo secret `PROFITSYNC_CRON_TOKEN` (Settings
   → Secrets and variables → Actions). The workflow no-ops until the secret exists.
5. Verify: hit "Run due now" in `/admin → Broadcasts`, or
   `curl -X POST $APP/api/cron/notifications -H "Authorization: Bearer $PROFITSYNC_SERVICE_TOKEN"` —
   then check `/admin → Worker` shows a fresh green heartbeat.

If `PROFITSYNC_SERVICE_TOKEN` is unset, the endpoint returns **503** and timed
delivery is simply off — in-app notifications and immediate broadcasts still work.

## One-look health checklist (V6 thresholds)

Alerting is active in three layers — each self-resolves once fixed:

| Signal | Where | Meaning |
|---|---|---|
| Heartbeat age | `/admin → Worker` | > 150 min stale = nothing is ticking at all (jobs, sweep, or fallback) |
| 🔴 red `notification-tick-fallback` run | GitHub Actions (emails you) | the tick BEFORE the fallback's was > 150 min old — the WORKER is down or lost its schedule, only the 2-hourly fallback is delivering. Fix: `/admin → Worker → Register notification schedule`, or restart the worker |
| ⚠️ "fallback inactive" summary | the same workflow's run summary | `PROFITSYNC_CRON_TOKEN` repo secret still unset — no redundancy behind the worker |

Deploy-time protection: `make up` / `make rebuild` / `make up-proxy` chain
`make register` (with boot retries) and FAIL LOUD if the schedule can't be
registered — a worker redeploy can no longer silently forget its schedule
(the June 2026 outage). The cron route reports `previous_tick_at` /
`previous_tick_age_seconds` for any external monitor to consume.

Note: phone-local reminders are OUTSIDE all of this by design — they fire from
the device's own alarm manager even with every server-side layer down.
