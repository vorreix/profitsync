# Notification System — V2 Roadmap

Concrete designs for the requested enhancements beyond the shipped v1 (bell, history,
3-level prefs, web push, event hooks). Ordered by size. Items 1–3 are small/medium; 4–6
are large and 4–5 share a **scheduler** dependency (see *Scheduling infrastructure*).

Status legend: ✅ shipped · 🟡 designed, ready to build · 🔴 designed, needs the scheduler.

---

## Scheduling infrastructure (shared by Reminders + Admin broadcasts)

Timed/recurring delivery needs something to run on a clock. The app currently has **no
cron** (recurring transactions materialize lazily on GET). Design:

- A single protected endpoint **`/api/cron/notifications?key=<CRON_SECRET>`** (in the
  consolidated router, so no extra Vercel function) that, on each tick: finds due
  **reminders** and due **scheduled/recurring broadcasts**, delivers them
  (`createNotification` + push), and advances their `last_fired_at` / next run.
- **Scheduler-agnostic** — wire ANY of these to hit it every ~5 min:
  - **Vercel Cron** (`vercel.json` `crons`) — simplest, but **Hobby is limited to once/day**;
    minute/5-min granularity needs **Pro**.
  - **External free scheduler** (GitHub Actions scheduled workflow, cron-job.org) hitting
    the URL — works on Hobby, ~5-min granularity.
- Idempotency: each fire writes a `dedupe_key` so a double-tick can't double-send.
- Timezone: store the user's tz (derive from the browser at reminder-create time,
  `Intl.DateTimeFormat().resolvedOptions().timeZone`); evaluate schedules in that tz.

> **Decision needed:** Vercel Pro (native cron) vs. an external scheduler (free, Hobby-ok).
> The endpoint design is identical either way — this only changes what pings it.

---

## 1. Spaces auto-save notification (personal) — 🟡

When a Spaces **auto-save** transfer materializes, notify the user.

- New type `space_autosaved` (category `transactions`).
- Hook: `api/_lib/recurring-materialize.ts` — when a `kind='transfer'` rule targeting a
  space produces an occurrence, `void createNotification({ userId: org owner, type:
  "space_autosaved", title, body: "Auto-saved {amount} into {space}", link: "/spaces/<id>",
  dedupeKey: "space_autosave:<txId>" })`.
- i18n: `notifications.types.space_autosaved.{title,body}` ×8 locales.
- Effort: small (mirrors the budget/recurring hooks).

## 2. Profile = personal default, org overrides (clarity) — 🟡

The model already supports this (user scope = base, org scope overrides). This is about
making it obvious:

- Profile → Notifications: subtitle "Your default notification preferences — organizations
  can override these for their own activity."
- Org settings dialog: subtitle "Overrides each member's personal defaults for this
  workspace," + a hint row showing which categories the org overrides.
- Effort: small (copy + a hint component).

## 3. Per-client notifications — simplified trigger model — 🟡

Replace the full category×channel grid (overkill per client) with a focused control:

- A **"Mute notifications for this client"** master toggle, plus a short list of
  **client-relevant triggers** the user can turn on/off:
  - *Budget overspending* → maps to category `budget`
  - *Large / negative transaction* → category `transactions`
  - *Quotation / client updates* → category `clients`
- Stored in `notification_preferences` scope=`client` by mapping each trigger to that
  category's channel toggles (so the existing cascade resolver is unchanged): trigger off
  → `categories.<cat> = { in_app:false, web_push:false }`; "mute" → `muted:true`.
- New component `ClientNotificationForm` (used by the client-detail dialog) replacing the
  generic grid for client scope; the generic grid stays for user/org scope.
- Effort: medium (UI + a small save mapping; no schema change).

## 4. "Remind me to add transactions" (custom schedules) — 🔴

User-defined reminders that nudge them to log transactions; clicking opens the Add
Transaction modal.

- **Table `notification_reminders`**: `id, user_id, organization_id (nullable),
  enabled, label, schedule (jsonb: { times:["09:00","18:00"], weekdays:[1..5], timezone }),
  last_fired_at, created_at`. (Multiple rows = multiple reminders; each row can carry
  multiple times + weekday set.)
- **API**: `/api/notifications/reminders` (GET/POST), `/reminders/:id` (PATCH/DELETE).
- **Delivery**: the cron endpoint finds reminders whose (weekday, time, tz) is due and
  whose `last_fired_at` isn't in the current slot → `createNotification({ type:
  "add_transaction_reminder", link: "/transactions?add=1", ... })` + push, then stamp
  `last_fired_at`.
- **Deep link → modal**: `AppLayout`/`TransactionsPage` reads `?add=1` on mount and opens
  `AddTransactionDialog`; the SW `notificationclick` already navigates to the link.
- **UI**: a "Reminders" card in Profile → Notifications — add/edit reminders with a time
  picker, weekday chips (Everyday / Weekdays / custom), and multiple times per reminder.
- Effort: large (table + scheduler + tz logic + UI + deep-link wiring).

## 5. Admin broadcast studio — 🔴

Admins compose and send notifications to users.

- **Table `broadcasts`**: `id, created_by, title, body, image_url, link, link_type
  (internal|external), category, importance (normal|important), audience (jsonb:
  { type: all|push_enabled|users|group, userIds?, groupId? }), schedule (jsonb:
  now|{at}|{recurring}), status (draft|scheduled|sending|sent), sent_at, stats (jsonb:
  { delivered, push_sent })`.
- **Importance override**: `createNotification` gains an `important: true` flag that
  **bypasses the in-app pref check** (always writes the bell row) and pushes even to users
  who disabled that category — OS-level blocks still apply, but it always lands in the bell.
- **Delivery**: immediate → fan out now; scheduled/recurring → handled by the cron endpoint.
  Fan-out respects audience; per-recipient push best-effort.
- **Composer UI** (`/admin/notifications`, new admin cap `notifications`): title, rich body,
  image upload (stored like other media / a URL), click action (internal route picker or
  external URL), category, importance, audience picker, and schedule (now / at / recurring).
  Web push supports `image` + `icon` + `badge`; the SW already shows `icon`/`badge` and can
  add `image`.
- **List/stats**: sent/scheduled history with basic delivery counts.
- Effort: large (table + admin UI + delivery + importance flag + SW image support).

## 6. Admin audience groups — 🔴

- **Table `user_groups`**: `id, name, created_by, created_at`; + `user_group_members
  (group_id, user_id)` (or `user_ids` jsonb for simplicity).
- **API**: `/api/admin/user-groups` (CRUD).
- **UI**: manage groups inside the broadcast studio (create/save/reuse), and pick a group
  as a broadcast audience.
- Effort: medium (CRUD + picker UI), builds on #5.

---

## Suggested build order

1. ✅ Bug fix (personal inbox), MoneyBag icon, profile tab URLs — **shipped**.
2. 🟡 Spaces auto-save (#1), profile/org clarity (#2), client trigger model (#3) — no infra.
3. 🔴 Scheduler endpoint + reminders (#4).
4. 🔴 Admin broadcast studio (#5) + audience groups (#6).

Read `docs/notifications/SYSTEM.md` for the v1 architecture these build on.
