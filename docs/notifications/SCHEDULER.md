# Notification scheduler — how timed delivery works

Reminders (#6) and scheduled/recurring broadcasts (#7) need something to fire on a
clock. The app itself has **no cron** (recurring transactions materialize lazily on
GET). The design is deliberately **scheduler-agnostic**: one endpoint does the work,
and any ticker can drive it.

## The endpoint

`POST /api/cron/notifications` — authenticated by the **service token**
(`PROFITSYNC_SERVICE_TOKEN`), never a user session. Each call:

1. Finds **due reminders** (`reminderDueSlot` — tz-aware weekday + time match, not
   already fired for that slot) and delivers an `add_transaction_reminder`
   notification linking to `/transactions?new=1` (opens the Add Transaction dialog).
2. Finds **due broadcasts** (`status='scheduled' AND next_fire_at <= now`), fans them
   out via `deliverBroadcast`, then advances recurrence (`nextRecurringFire`) or marks
   them `sent`.
3. Returns `{ processed: { reminders, broadcasts } }`.

Every notification it creates carries a **dedupeKey** (`reminder:<id>:<slot>`,
`broadcast:<id>:<userId>`), so a double-tick or retry can never double-send. The
endpoint is therefore safe to call as often as you like.

## What drives it (run BOTH of the first two — they're redundant by design)

| Driver | Setup | Granularity | Notes |
|---|---|---|---|
| **Go worker** (primary) | `scripts/register-worker-schedules.ts` registers a `*/5 * * * *` `app.trigger` schedule that POSTs `/api/cron/notifications` with the service token | ~5 min | The production path. See `docs/worker/DEPLOYMENT.md`. |
| **GitHub Actions fallback** (keep it on) | `.github/workflows/notification-tick.yml` — every 30 min, POSTs the endpoint with the repo secret `PROFITSYNC_CRON_TOKEN` (= the app's `CRON_FALLBACK_TOKEN` env var, a second token accepted by `requireServiceToken`) | ~30 min | Survives a dead/wiped worker: in June '26 the worker stopped and reminders were silently down for ~11 days. No-ops until the secret is set. |
| **External pinger** | Point cron-job.org (etc.) at the URL with the bearer header | ~5 min | Works on Vercel Hobby, no worker needed. |
| **Vercel Cron** | `vercel.json` `crons` → the endpoint | once/day on Hobby; 5-min needs Pro | Cleanest if already on Pro. |
| **Manual** | `/admin → Broadcasts → "Run due now"** (admin, `broadcast` cap) | on demand | Drives the exact same tick — useful before the worker is deployed, or for testing. |

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

## One-look health checklist (V5)

Alerting is now active in three layers — each self-resolves once fixed:

| Signal | Where | Meaning |
|---|---|---|
| Heartbeat age | `/admin → Worker` | > 15 min stale = nothing is ticking at all |
| 🔴 red `notification-tick-fallback` run | GitHub Actions (emails you) | the tick BEFORE the fallback's was > 25 min old — the WORKER is down or lost its schedule, only the 30-min fallback is delivering. Fix: `/admin → Worker → Register notification schedule`, or restart the worker |
| ⚠️ "fallback inactive" summary | the same workflow's run summary | `PROFITSYNC_CRON_TOKEN` repo secret still unset — no redundancy behind the worker |

Deploy-time protection: `make up` / `make rebuild` / `make up-proxy` now chain
`make register` (with boot retries) and FAIL LOUD if the schedule can't be
registered — a worker redeploy can no longer silently forget its schedule
(the June 2026 outage). The cron route reports `previous_tick_at` /
`previous_tick_age_seconds` for any external monitor to consume.
