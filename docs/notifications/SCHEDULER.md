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

## What drives it (pick one)

| Driver | Setup | Granularity | Notes |
|---|---|---|---|
| **Go worker** (recommended) | `scripts/register-worker-schedules.ts` registers a `*/5 * * * *` `app.trigger` schedule that POSTs `/api/cron/notifications` with the service token | ~5 min | The production path. See `docs/worker/DEPLOYMENT.md`. |
| **External pinger** | Point GitHub Actions `schedule:` or cron-job.org at the URL with the bearer header | ~5 min | Works on Vercel Hobby, no worker needed. |
| **Vercel Cron** | `vercel.json` `crons` → the endpoint | once/day on Hobby; 5-min needs Pro | Cleanest if already on Pro. |
| **Manual** | `/admin → Broadcasts → "Run due now"** (admin, `broadcast` cap) | on demand | Drives the exact same tick — useful before the worker is deployed, or for testing. |

All four call the identical idempotent logic (`runNotificationTick`). Switching
drivers changes nothing about correctness.

## Setup checklist

1. Generate the secret: `openssl rand -hex 32`.
2. Set `PROFITSYNC_SERVICE_TOKEN` on the **app** (Vercel) — and the **same** value on
   the worker (`worker/deploy/.env`).
3. Deploy the worker (or wire an external pinger), then run
   `npx tsx scripts/register-worker-schedules.ts` (no-op if the worker isn't set).
4. Verify: hit "Run due now" in `/admin → Broadcasts`, or
   `curl -X POST $APP/api/cron/notifications -H "Authorization: Bearer $PROFITSYNC_SERVICE_TOKEN"`.

If `PROFITSYNC_SERVICE_TOKEN` is unset, the endpoint returns **503** and timed
delivery is simply off — in-app notifications and immediate broadcasts still work.
