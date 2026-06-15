# Notification System — V2 build (reminders, broadcasts, user groups)

Completes the deferred half of the 9-item notification brief: **#6 customizable
"remind me to add transactions" reminders**, **#7 admin broadcast studio**, and
**#8 admin user groups**. Items #1–#5 and #9 already shipped (see audit below); this
plan is only the missing surface.

Design source of truth: `docs/notifications/V2_ROADMAP.md` (the original designs) and
`docs/notifications/SYSTEM.md` (the shipped v1). This doc is the **live tracker**.

## Audit — status of the 9-item brief (verified against code, 2026-06-14)

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Profile tabs update URL | ✅ shipped | `ProfilePage.tsx` (`?tab=`) |
| 2 | Budget = MoneyBag everywhere | ✅ shipped | sidebar + notification category |
| 3 | Spaces auto-save notification | ✅ shipped | `recurring-materialize.ts` (`space_autosaved`) |
| 4 | Simplified per-client triggers | ✅ shipped | `ClientNotificationForm.tsx` |
| 5 | Profile default + org override | ✅ shipped | Profile (`scope=user`) + Organizations (`scope=organization`) |
| **6** | **Reminders** | 🔨 this plan | — |
| **7** | **Admin broadcast studio** | 🔨 this plan | — |
| **8** | **Admin user groups** | 🔨 this plan | — |
| 9 | Bell + read-all + badge | ✅ shipped | `NotificationBell`, `/notifications`, read-all route |

## Working conventions

- Branch base: `feat/notif2-01-unified-bell` (the user's current branch — already
  carries the full v1 notification system + the worker). New chain prefix
  `feat/notif3-NN-*`, stacked sequentially.
- Every API relative import keeps the `.js` extension (unbundled ESM on @vercel/node).
- `serialize(row)` before `res.json`. Scope app reads/writes by `orgId`; admin reads
  by capability (`requireAdminCap`). New admin cap **`broadcast`** (grantable) gates
  the studio + groups.
- New notification types registered once in `src/lib/notifications.ts`; i18n keys added
  to **all 8 locales** (`i18n:check` gates the commit).
- Gate per branch: `i18n:check → lint → typecheck → test:ci` (+ build where chunking
  could be affected). No `--no-verify`.

## Assumptions (decided autonomously — user asked not to be prompted)

1. **Scheduler = the Go worker**, driving a **scheduler-agnostic** `POST /api/cron/notifications`
   (service-token auth). The same endpoint is drivable by an external pinger
   (GitHub Actions / cron-job.org) or a manual admin **"Run due now"** button, so timed
   delivery works *before* the worker is deployed.
2. **`important: true`** broadcasts bypass the recipient's category mute for **both** the
   bell (always written) and push (attempted for anyone who ever subscribed). OS-level
   push blocks still apply — can't be overridden. Matches the brief's "reach them even if
   turned off, at minimum the bell".
3. **Recurrence** = simple `{ freq: 'daily'|'weekly'|'monthly', interval, until? }` (matches
   the app's `recurring_rules` idiom), not RFC5545.
4. **Broadcast image** = admin-provided **image URL** (reliable for web-push `image`, no
   upload/DB bloat). Extendable to S3-via-worker later.
5. **Reminder timezone** stored on the row (browser `Intl…timeZone` at create); evaluated
   in that tz at fire time. Editing the tz is a manual user action (hint shown).
6. **Dedupe keys**: reminders `reminder:<id>:<YYYY-MM-DDTHH:mm>` (slot includes the id);
   broadcasts `broadcast:<id>:<userId>`. Idempotent against double-ticks.

## Branch chain

| # | Branch | Scope | Status |
|---|--------|-------|--------|
| 00 | `feat/notif3-00-plan` | this tracking doc | ✅ pushed |
| 01 | `feat/notif3-01-foundation` | mig 0045 (4 tables) + types + new notif types + i18n (8) + `important` flag + `broadcast` cap | ✅ pushed |
| 02 | `feat/notif3-02-scheduler-core` | `requireServiceToken` + pure `schedule-notifications.ts` (+17 vitest) + `/api/cron/notifications` + fan-out lib + `.env.example` | ✅ pushed |
| 03 | `feat/notif3-03-reminders` | reminders CRUD API + `RemindersCard` + Profile card + `?new=1` deep-link (#6) | ✅ pushed |
| 04 | `feat/notif3-04-user-groups` | groups CRUD API + `AdminUserGroupsPage` + nav + route (#8) | ✅ pushed |
| 05 | `feat/notif3-05-broadcasts` | broadcasts CRUD + send + `AdminBroadcastStudioPage` + composer + nav + route + "Run due now" (#7) | ✅ pushed |
| 06 | `feat/notif3-06-richmedia-setup` | push image/click-action + `push-sw.js` + external-link handling + worker schedule bootstrap + docs | ✅ pushed |

**Note (#6 deep-link):** reused the existing `/transactions?new=1` handler instead of
adding a parallel `?add=1` — no TransactionsPage change needed.

## Per-task notes

### 01 — foundation
- Tables (mig 0045, journal `when` > 1781438121498):
  - `notification_reminders(id, user_id, organization_id?, enabled, label, schedule jsonb {times[], weekdays[], timezone}, last_fired_at?, created_at, updated_at)` — unique `(user_id, label)`.
  - `broadcasts(id, created_by, title, body, image_url?, link?, link_type, category, importance, audience jsonb, schedule jsonb, status, next_fire_at?, sent_at?, stats jsonb, created_at, updated_at)`.
  - `user_groups(id, name, created_by, created_at)` — unique `(created_by, name)`.
  - `user_group_members(id, group_id→cascade, user_id, created_at)` — unique `(group_id, user_id)`.
- `src/lib/notifications.ts`: add types `add_transaction_reminder` (transactions) + `admin_broadcast` (system).
- `createNotification`: `important?: boolean` → force in_app + push past the cascade.
- `admin-roles.ts`: add `broadcast` to AdminCapability, super_admin caps, GRANTABLE, CAP_META.

### 02 — scheduler core
- `requireServiceToken(req,res)`: constant-time compare `Authorization: Bearer` vs `PROFITSYNC_SERVICE_TOKEN`.
- `src/lib/schedule-notifications.ts` (DEP-FREE, vitest-safe): `reminderDueSlots(reminder, now)`, `nextBroadcastFire(schedule, from)`, tz-aware weekday/time match. Pure → unit-tested without a DB.
- `POST /api/cron/notifications`: deliver due reminders + due/scheduled/recurring broadcasts; advance `last_fired_at`/`next_fire_at`; dedupe; return `{processed}`.

### 03 — reminders
- API `notifications/reminders.ts` (GET+POST), `reminders/[id].ts` (PATCH+DELETE).
- `ReminderForm.tsx` (label, enable, times[], weekday chips, tz). Profile Notifications tab "Reminders" card.
- Reminder notification `link: /transactions?add=1`; `TransactionsPage` opens AddTransactionDialog on `?add=1`.

### 04 — user groups
- API `admin/user-groups.ts` (GET+POST), `[id].ts` (PATCH+DELETE-if-unused), `[id]/members.ts` (GET+PUT).
- `UserGroupsPage.tsx` (/admin/user-groups), searchable member picker over `/api/admin/users`.

### 05 — broadcasts
- API `admin/broadcasts.ts` (GET+POST), `[id].ts` (PATCH draft/scheduled + DELETE draft), `[id]/send.ts` (POST send-now), `admin/broadcasts/run-due.ts` (POST manual tick → same lib as cron).
- `BroadcastStudioPage.tsx` + `BroadcastComposer.tsx`: title/body/image-url/link(+type)/category/importance/audience(all|push_enabled|users|group)/schedule(now|at|recurring). History list + actions.

### 06 — rich media + setup
- `PushPayload` += `image?/icon?/badge?`; `push-sw.js` renders image + click action (internal route or external URL).
- `scripts/register-worker-schedules.ts` (idempotent POST /v1/schedules when WORKER_BASE_URL set).
- Update `docs/notifications/SYSTEM.md`, `V2_ROADMAP.md` (mark shipped), `.claude/skills/notification-system/SKILL.md`.

## Change log

- 2026-06-14: Audit complete (6-reader workflow). Items 1–5, 9 verified shipped; 6–8 missing.
  Plan + branch chain authored.
- 2026-06-14: Built + pushed the full chain notif3-00..06. #6 reminders, #7 broadcast
  studio, #8 user groups complete. Each branch passed the gate (i18n → lint → typecheck →
  test:ci, + esm/boot/build on the API/UI branches). Scheduler doc: `SCHEDULER.md`.
  **Verified:** unit (318 tests incl. 17 new scheduling tests), typecheck, lint, prod
  build, ESM-extension + boot prod-parity. **Deferred:** live browser walkthrough of the
  new UIs (needs `vercel dev` + Clerk login + DB) and an end-to-end cron→push delivery
  test (needs VAPID + the worker/pinger live) — both to do on a deploy.
- 2026-06-14: Adversarial review (4-dimension workflow + per-finding verification).
  Branch `notif3-07-review-fixes` fixes the 3 confirmed real bugs: (A) recurring
  broadcasts only delivered once — the per-user dedupe key now includes the occurrence
  (cron passes the scheduled fire instant); (B) the user-group members PUT could empty a
  group on a partial write — now insert-first (onConflictDoNothing) then prune; (C)
  editing a "specific users" broadcast wiped the selection — now hydrated from the stored
  ids. Two flagged items were false positives (a Date/string type confusion disproved by
  typecheck; a missing-404 already covered by the ownership pre-check).
