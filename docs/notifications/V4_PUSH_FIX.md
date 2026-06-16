# Notifications V4 — push delivery & scheduled-broadcast fix

Two production faults reported 2026-06-16, root-caused from code + live probes, then
fixed durably. Both were **configuration/observability gaps, not logic bugs** — the
notification code paths are correct end-to-end. The fixes make the two invisible
failure modes *visible and self-serviceable* so they can't silently recur.

## The two faults

### A. Scheduled / recurring broadcasts never fire (stuck `scheduled` forever)

**Root cause (confirmed).** The Go worker is the production cron clock. It only fires
`app.trigger → POST {PROFITSYNC_BASE_URL}/api/cron/notifications` when the
`notifications-dispatch` schedule is registered on it. That schedule is registered
**only** by `scripts/register-worker-schedules.ts`, which:
- is **not** wired into `vercel-build` (which runs only `db-migrate && build`), and
- has **no admin UI** to register it or even *see* whether it exists.

So in production nobody ever registered it → the worker ticked every 30 s with nothing
to fire → `/api/cron/notifications` was never called → due broadcasts stayed
`scheduled`. The server's worker logs corroborate exactly this: only admin polling
(`GET /v1/jobs`, `/v1/stats`), **zero `app.trigger`**, zero app callbacks.

The callback contract itself is correct: worker `client.go` sends
`Authorization: Bearer <PROFITSYNC_SERVICE_TOKEN>` to `baseURL + /api/cron/notifications`;
the app's `requireServiceToken` checks exactly that. `scripts/register-worker-schedules.ts`
registers `payload.path = "/api/cron/notifications"` — matches the route table
(`["cron","notifications"]`). (DEPLOYMENT.md/README mentioning `/api/internal/cron/...`
is stale doc drift — corrected here.)

**Immediate unblock (no deploy):** register the schedule on the running worker —
```bash
cd worker/deploy && set -a && . ./.env && set +a
curl -X POST "http://localhost:${WORKER_PORT:-8080}/v1/schedules" \
  -H "Authorization: Bearer $WORKER_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"notifications-dispatch","type":"app.trigger","cron":"*/5 * * * *","timezone":"UTC","payload":{"path":"/api/cron/notifications"}}'
```

### B. Manual "Send now" push doesn't pop up, though the bell row appears

**Root cause (class identified; exact branch only visible at runtime).** The bell row
and the push are two independent paths: `createNotification` writes the bell row (source
of truth) and *fire-and-forget* calls `sendWebPushToUser` (best-effort). The bell
working proves the row was written; it says nothing about push. `sendWebPushToUser`
returned `void` and only `console.log`'d its outcome — so the failing branch
(`VAPID not configured` / `no web_push subscriptions` / send `4xx` (key mismatch) /
delivered-but-no-handler) was **invisible** without prod function logs (which are
unreadable here; the VAPID env is Sensitive/write-only so its value can't be compared
either).

Everything in code is correct: `/push-sw.js` serves (200) and is `importScripts`'d into
the generated SW with `push` + `notificationclick` handlers; the subscribe flow + save
route are correct; delivery passes `pushDefault:true`. So the fault is a **runtime
config / device state** we must *surface*, not a code bug to blind-patch.

**Fix:** make it diagnosable on the real device — a `POST /api/notifications/test-push`
that runs the real sender for the current user and returns the structured outcome, with
a "Send a test notification" button in settings that renders the exact cause. Plus
self-heal the most common case (server lost the subscription row) by re-syncing the
browser subscription.

## Branch chain (off `worker_fix_maqbool`)

| # | Branch | Delivers | Status |
|---|---|---|---|
| 00 | `feat/notif4-00-plan` | this doc | ✅ |
| 01 | `feat/notif4-01-push-diagnostics` | `sendWebPushToUser` returns result; `POST /api/notifications/test-push`; PushToggle "Send test" + self-heal resync; i18n ×8 | ✅ pushed |
| 02 | `feat/notif4-02-worker-schedule-visibility` | worker `GET /v1/schedules`; admin worker route schedules + "Repair notification schedule" action; AdminWorkerPage schedules panel + missing-schedule banner; `make register` via curl (no node dep); doc path fix | ✅ |

## Verification plan

- **Unit:** `schedule-notifications` math unchanged; add a test for the test-push
  result mapping if pure-extractable. Gate: lint → typecheck → test:ci → build.
- **Issue A:** after deploy + worker rebuild, `/admin/worker` shows the
  `notifications-dispatch` schedule (or a "missing — Repair" banner); clicking Repair
  registers it; a past-due broadcast delivers within one cron tick; worker logs show
  `profitsync callback ok`.
- **Issue B:** in the PWA, "Send a test notification" returns one of the precise
  outcomes; a real device with the toggle on shows the OS popup. Browser-verify via the
  preview build (SW is disabled in dev).

## Honesty notes

- Issue B's *exact* runtime branch (no-subs vs 4xx vs stale-SW) is not knowable from
  this dev box; the test-push tool is the deliverable that resolves it on the user's
  device. The code fixes cover all branches with clear messaging + self-heal.
- The worker `GET /v1/schedules` needs a **worker rebuild/redeploy** to take effect
  (`docker compose up -d --build`). The "Repair" button and the curl unblock work
  against the *existing* worker (POST /v1/schedules already exists) — no rebuild needed
  to fix Issue A; the rebuild only adds the *visibility* panel.
