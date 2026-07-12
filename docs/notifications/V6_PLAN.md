# Notifications V6 — exact-time scheduling, phone-local reminders, no polling

Status: **in progress** · Started 2026-07-12 · Chain root: `feat/notif6-00-plan`
(stacked on `feat/notif5-07-android-credentials`)

## Decisions (locked with the user, 2026-07-12)

- **Personal reminders are delivered ON the phone** (`@capacitor/local-notifications`,
  exact phone time, works offline, zero server involvement). The DB keeps the
  reminder *settings* (cross-device sync + the web management UI); **delivery is
  mobile-only** — the web UI says so. The server tick no longer delivers reminders.
- **Admin scheduled/recurring broadcasts fire via EXACT-TIME one-shot worker jobs**
  (`POST /v1/jobs` with `run_at` + `dedupe_key` — already supported by the Go
  worker's queue, no Go changes, no prod worker rebuild). No more blind polling.
- **The 5-minute cron is retired.** The worker keeps ONE schedule
  (`notifications-dispatch`, downshifted `*/5 * * * *` → `0 * * * *`) as an hourly
  reconciliation sweep; the GitHub fallback downshifts 30 min → 2 h. Poll traffic
  drops ~93% (336/day → 36/day) while broadcasts get MORE precise (exact vs ≤5 min late).
- Same discipline as V5: stacked branches, gate-green, pushed, **nothing merged by
  the agent**; PRs land in order.

## Why this shape (the reasoning, kept honest)

- The 5-min poll was never a *cost* problem (288 tiny invocations/day); it was an
  elegance/precision problem. Exact-time jobs fix both.
- Exact-time enqueue re-introduces the June-outage failure class (app state and
  worker state can drift: an enqueue can fail, a worker redeploy can wipe jobs).
  The **hourly sweep is the reconciler** — it reads `next_fire_at` from the DB
  (source of truth) and delivers anything a lost job missed. Dedupe keys make
  the overlap harmless. Stale jobs (edited/cancelled broadcasts) fire an
  idempotent no-op tick — **no cancel plumbing needed**.
- Local notifications don't write bell/history rows: a reminder is a transient
  nudge, not a record — accepted trade-off. Settings CRUD (web + phone) is
  unchanged; the phone re-syncs its OS schedules from the DB on boot and after
  every reminder change.

## Branch chain

| # | Branch | Delivers | Status |
|---|--------|----------|--------|
| 00 | `feat/notif6-00-plan` | This plan | ✅ pushed |
| 01 | `feat/notif6-01-local-reminders` | Phone-local reminder delivery + web banner + tick stops delivering reminders | ✅ pushed |
| 02 | `feat/notif6-02-exact-jobs` | Exact-time broadcast jobs, hourly sweep, GH fallback downshift | ⏳ |
| 03 | `feat/notif6-03-docs` | SCHEDULER/SYSTEM model rewrite, ops notes, final verification summary | ⏳ |

## Per-branch details

### 01 — phone-local reminders
- `@capacitor/local-notifications` (lazy native chunk, same bundle discipline as FCM).
- `src/lib/native-reminders.ts`: `syncLocalReminders(reminders)` — cancel-all +
  re-schedule deterministic sync of OS alarms from the DB settings; one repeating
  OS notification per (weekday × time); stable int32 ids derived from reminder id
  + slot; `allowWhileIdle`; tap → `/transactions?new=1` via the existing deep-link
  listener pattern; Android 13+ permission piggybacks the push permission flow.
- Boot + reminder CRUD → re-sync (AppLayout effect, mirrors the FCM init).
- `RemindersCard`: on web, an info banner — "Reminders are delivered on your
  phone (get the Android app)"; CRUD stays (settings sync to the phone). i18n ×8.
- `runNotificationTick`: the reminders block is REMOVED (mobile-only decision).
  `notification_reminders` columns stay (settings store); `last_fired_at` goes
  dormant — noted here, no migration needed.

### 02 — exact-time broadcast jobs
- `api/_lib/worker-jobs.ts`: `enqueueTickAt(when, occurrenceKey)` → worker
  `POST /v1/jobs` `{type:"app.trigger", run_at, dedupe_key, payload:{path:"/api/cron/notifications"}}`
  using the existing `WORKER_BASE_URL`/`WORKER_API_TOKEN` (admin-panel creds).
  Best-effort: enqueue failure logs + falls back to the sweep. Committed
  unit tests with mocked fetch (DB-free).
- Enqueue sites: broadcast create/update wherever `next_fire_at` is (re)set
  (admin broadcasts routes) and the recurring re-arm inside `runNotificationTick`.
- Registration tooling: `scripts/register-worker-schedules.ts` + `worker/Makefile`
  + the admin panel default switch the `notifications-dispatch` cron to
  `0 * * * *`. Same schedule NAME → the existing admin auto-repair + one-click
  register keep working; **applying it in prod = one click of the existing
  "Register notification schedule" button after merge** (idempotent upsert).
- `.github/workflows/notification-tick.yml`: `*/30` → `0 */2 * * *`; dead-worker
  threshold 25 min → 150 min (worker sweeps hourly now).

### 03 — docs + verification
- SCHEDULER.md: replace the "every 5 min" model with exact-jobs + hourly sweep;
  update the health checklist thresholds. SYSTEM.md: reminders = local delivery.
- Memory + summary of user actions (merge order; prod: click "Register
  notification schedule" once so the hourly cron replaces the 5-min one).

## Verification matrix

| Branch | Proof |
|---|---|
| 01 | Emulator: OS-scheduled reminder visible in pending schedules AND a near-term one actually pops; web banner + CRUD via Playwright; gate |
| 02 | Committed unit tests (enqueue payload/dedupe/failure-path); tick reconcile still delivers with NO jobs (sweep path) via throwaway DB test; gate |
| 03 | Docs re-read + full gate on the chain tip |

## Change log

- 2026-07-12: plan written; decisions locked (mobile-only reminders, exact-time
  jobs, hourly sweep); worker `run_at`/`dedupe_key` support verified in
  `worker/app/internal/{httpapi/server.go,store/store.go}` — no Go changes needed.
- 2026-07-12 (01): phone-local reminders SHIPPED + verified end-to-end on the
  API 34 emulator: reminder created on the WEB → phone boot resync pulled the
  settings and projected them onto the OS alarm schedule (cancel-all +
  re-schedule) → **the OS fired the notification with the app's own copy** →
  tap deep-linked to /transactions?new=1 → the schedule re-armed for the next
  day. Server tick no longer delivers reminders. ⚠️ Two hard-won findings:
  (a) **Capacitor plugin objects are Proxies that forward `then` to native** —
  returning one from an async function makes the await HANG FOREVER (this had
  silently broken notif5-05's FCM listener attach too; fixed in both
  native-push.ts and native-reminders.ts by wrapping the proxy — never resolve
  a promise WITH a plugin proxy). (b) Without the "Alarms & reminders" special
  access, Android delivers via a ±7.5-min inexact window (observed ~4 min
  late) — accepted for a daily nudge (Play-policy-friendly); an exact-alarms
  opt-in via the plugin's changeExactNotificationSetting is the future knob.
  debug_network_security_config now allows 127.0.0.1/10.0.2.2 cleartext
  (emulators with broken native DNS need `adb reverse` + 127.0.0.1). Committed
  DB-free tests lock the weekday mapping (ISO→Capacitor), stable int32 ids,
  and schedule expansion. Test reminders deleted, app uninstalled, emulator
  shut down.
