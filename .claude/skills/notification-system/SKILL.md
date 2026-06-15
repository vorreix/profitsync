---
name: notification-system
description: Use when working on ProfitSync notifications — the bell, the /notifications history page, notification preferences (user/organization/client), reminders, admin broadcasts + saved user groups, the notification scheduler/cron, web push / VAPID / the service worker, the notifications/notification_preferences/push_subscriptions/notification_reminders/broadcasts/user_groups tables, or emitting a notification from a domain event (invitation, role change, payment, budget, etc.). Establishes the platform-agnostic-data / pluggable-channels model and the invariants that keep in-app and push correct.
---

# ProfitSync Notification System

The authoritative human explainer is **`docs/notifications/SYSTEM.md`** — read it for the
full picture and the web-push setup. This skill is the **operating guide**: the mental
model, the invariants you must not break, where everything lives, and how to verify
changes safely. Future work is designed in `docs/notifications/V2_ROADMAP.md`.

## Mental model (internalize this first)

- **Data is platform-agnostic; channels are pluggable.** A notification is a row in
  `notifications`, read by ANY client via `/api/notifications`. Delivery channels
  (`in_app`, `web_push`, future `fcm`/`apns`) are decoupled — adding a native channel is a
  new `push_subscriptions.channel` + a sender, **no schema/API change**.
- **In-app NEVER depends on push.** The bell/history are DB rows + polling. Web push is a
  best-effort enhancement; it must not be able to break or block in-app delivery.
- **The bell is a PERSONAL inbox** — all of a user's notifications across every org, not
  filtered by the active org. (Org-filtering it was the historical "empty bell" bug.)
- **Preferences cascade** client → org → user → system default; `muted` anywhere blocks;
  most-specific explicit (category, channel) opinion wins. Pure resolver:
  `resolveChannelEnabled` in `src/lib/notifications.ts`.

## Invariants — do not break these

1. **`createNotification` is the single entry point** (`api/_lib/notifications.ts`). It
   resolves the cascade, inserts the in-app row only when the category's `in_app` is on,
   and fires web push only when `web_push` is on. Event sites call it **best-effort**
   (`void createNotification(...).catch(() => {})`) so a notification can NEVER block or
   fail the originating action (a role change, a webhook, a transaction insert).
2. **In-app delivery must not depend on push.** Keep `web-push` **lazily imported**
   (`await import("web-push")` inside the sender) so it never loads at module scope — that
   keeps `boot-functions` (prod-parity) and cold starts clean. The sender no-ops without
   VAPID env and **never throws**; it prunes dead endpoints (404/410).
3. **The inbox is scoped by recipient `user_id` only** — never re-add an `organization_id`
   filter to the list / unread-count / read-all routes, or cross-org notifications vanish
   from the bell again.
4. **Dedup correctly.** Event-sourced notifications pass a stable `dedupe_key`; insertion
   is a select-then-insert against the **partial** unique index `(user_id, dedupe_key)
   WHERE dedupe_key IS NOT NULL` with a 23505 catch — do **not** use `onConflict` on that
   partial index (Postgres can't infer the arbiter reliably). `notifyOrgMembers` suffixes
   the dedupe key per recipient.
5. **Preference scope auth:** user scope = caller's own; organization scope = owner/admin
   of THAT org (validated against membership, supports an explicit `orgId`); client scope =
   `canWrite` and the client must belong to the active org. Bodies go through
   `sanitizePreferences` (drops unknown categories/channels). Upsert is explicit
   select-then-update/insert against the partial unique indexes.
6. **Standard API rules still apply:** `serialize(row)` before `res.json`, `.js` extensions
   on relative `api/` imports, register new routes in `api/index.ts` (static before
   dynamic at the same depth).

## Where everything lives

- Shared dependency-free model + resolver: `src/lib/notifications.ts` (+ `.test.ts`).
- Server service: `api/_lib/notifications.ts`; push sender: `api/_lib/push.ts`;
  budget hook: `api/_lib/notify-budget.ts`.
- Routes: `api/_routes/notifications.ts`, `notifications/{unread-count,read-all,
  preferences,push,[id]}.ts`.
- UI: `src/lib/notification-context.tsx` (badge polling), `src/components/notifications/*`,
  `src/pages/NotificationsPage.tsx`.
- SW push: `public/push-sw.js` (pulled in via workbox `importScripts` in `pwa/vite-pwa.ts`,
  kept out of precache).
- Schema: `src/lib/db/schema.ts`; migrations `drizzle/0044_*` (v1), `0045_*` (V2 tables).

## V2 surfaces (reminders #6, broadcasts #7, user groups #8)

- **Reminders** (`notification_reminders`): per-user "add transactions" schedules
  (times/weekdays/tz). UI `src/components/notifications/RemindersCard.tsx` (in Profile →
  Notifications). API `api/_routes/notifications/reminders{,/[id]}.ts`. The cron fires an
  `add_transaction_reminder` linking to `/transactions?new=1`.
- **Broadcasts** (`broadcasts`): admin-composed fan-out. Studio
  `src/pages/admin/AdminBroadcastStudioPage.tsx`; API `api/_routes/admin/broadcasts*`;
  delivery `api/_lib/broadcast-deliver.ts` (audience resolve + chunked fan-out + per-user
  dedupe); shape validation `api/_lib/broadcast-validate.ts`. `important: true` on
  `createNotification` **bypasses the cascade** (always bells, attempts push).
- **User groups** (`user_groups` + `user_group_members`): reusable audiences. Page
  `src/pages/admin/AdminUserGroupsPage.tsx`; API `api/_routes/admin/user-groups*`.
- **Scheduler** (`docs/notifications/SCHEDULER.md`): the worker-driven, scheduler-agnostic
  `POST /api/cron/notifications` (`requireServiceToken`) runs `runNotificationTick` —
  delivers due reminders + scheduled/recurring broadcasts. Pure tz/recurrence math lives
  in `src/lib/schedule-notifications.ts` (+ `.test.ts`, DB-free). Also drivable by an
  external pinger, Vercel Cron, or the admin **"Run due now"** button. See [[worker-service]].
- **Admin gating:** the studio + groups require the **`broadcast`** capability (grantable;
  in `src/lib/admin-roles.ts` + `GRANTABLE_ADMIN_CAPS`). The whole `/admin` console is
  English-only (no i18n) — keep new admin UI English. Reminders (user-facing) ARE i18n'd.

## Adding a notification (recipe)

1. Add the `type` to `NOTIFICATION_TYPES` (→ its category) in `src/lib/notifications.ts`.
2. Add `notifications.types.<type>.{title,body}` to `en.json`; fill + translate all 8
   locales. **`scripts/i18n-merge.mjs` is additive-only** — it won't overwrite keys that
   already exist (e.g. after `i18n-fill`); set existing nested values directly to apply
   real translations, then `npm run i18n:check`.
3. At the event site, `void createNotification({...}).catch(() => {})` (or
   `notifyOrgMembers`), passing `data.i18nKey`/`i18nBodyKey`/`i18nParams` + a `link` and a
   `dedupeKey` if the event can repeat.

## Verifying changes (DB-free unit gate)

- Pure resolver/sanitizer: extend `src/lib/notifications.test.ts` (runs in the committed
  gate; no DB).
- DB/route behaviour: write a **throwaway** `*.test.ts` and run
  `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local`,
  then delete it before committing (never commit a DB-touching test).
- UI: drive the bell/history/settings in a real browser (Playwright); the bell badge +
  dropdown + mark-all-read are the key flows. Radix tabs/triggers may need a real pointer
  sequence to activate under automation.

## Gotchas

- **Web push needs prod config + per-device opt-in.** `VITE_VAPID_PUBLIC_KEY` must be set
  at BUILD time or the "Enable push" toggle is hidden; each device must opt in (no
  auto-subscribe); iOS only supports it for an installed PWA (16.4+). See SYSTEM.md §6.
- **Budget = MoneyBag** icon everywhere (sidebar, cards, notifications). Piggy bank is a
  **Spaces** icon, not budget.
- The SW push handler must not touch caching/skipWaiting/navigation — keep the
  white-screen-safe pipeline intact (see [[pwa-white-screen-deploy]] in memory).
