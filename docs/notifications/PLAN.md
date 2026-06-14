# Notification System — Plan & Tracking Doc

> Single source of truth for the notification-system initiative. Durable across
> the stacked branch chain. Read this first; it records decisions, assumptions,
> and the live status of every task.

**Author:** autonomous run (Claude) · **Started:** 2026-06-14 · **Base branch:** `feature/notification_system_maqbool`

---

## 1. Goal (from the brief)

Implement a notification system that:

1. Works on **desktop + PWA** today, and is **future-proof for Android / iOS / wearables** (native apps + future channels) with no schema rewrite.
2. Lets a **user** manage their own notifications from profile settings.
3. Lets an **organization** set org-level notification policy.
4. Lets **each client** have its own notification settings.
5. Has a proper **notification history** — an easily-accessible **bell icon**.
6. Loads with **optimized, lazy loading**.

The user is unavailable mid-run: every unspecified decision is made here and recorded as an Assumption.

---

## 2. Architecture (the load-bearing decisions)

**Data is platform-agnostic; delivery is pluggable.**

- A `notifications` table holds persisted, per-recipient notifications. **Any** client (web, PWA, future native app, wearable companion) reads the same `/api/notifications`. This is what makes "works everywhere" true: the bell + history are just a view over org/user-scoped rows.
- Delivery **channels** are decoupled from the data:
  - `in_app` — always written (the bell/history). Works on every device that runs the web app. **No dependency on push.**
  - `web_push` — browser/PWA push via VAPID + the service worker. An *enhancement* layered on top.
  - future `fcm` / `apns` — Android / iOS / wearables. Adding them is a new `push_subscriptions.channel` value + a new sender. **No schema change, no API change.**
- **The in-app system is fully independent of web push.** The bell works via lightweight polling. Push is best-effort and isolated so a missing `web-push` dep / VAPID env can never break core notifications. This is why push is the LAST branch.

**Three-level preferences with a cascade.** One polymorphic `notification_preferences` table (scope = `user | organization | client`). Resolution for "deliver type T (category C) about client K in org O to user U on channel CH":

```
client(O,K)  ?? org(O)  ?? user(U)  ?? system default
```
- `muted` anywhere in the cascade → blocked (intuitive: muting at any level mutes).
- channel toggle → most-specific level that has an explicit opinion wins; else system default.
- Ownership/permissions: user prefs = the user; org prefs = owner/admin; client prefs = `canWrite` (owner/admin/editor).

**i18n channel.** A new `notifications` namespace (wealth precedent). Each branch adds English keys and runs `scripts/i18n-fill.mjs` so `i18n:check` stays green; a final pass replaces placeholders with real translations across all 8 locales.

**Dedup.** Event-sourced notifications pass a `dedupe_key`; a partial unique index `(user_id, dedupe_key)` + `onConflictDoNothing` makes webhook retries / repeated GETs idempotent.

**Optimization / lazy loading.**
- Provider fetches only a tiny `unread-count` (cheap `COUNT`) — polled ~60s + on focus, reusing the 30s GET cache.
- The dropdown fetches the recent list **only when opened**.
- `/notifications` history is a `React.lazy` route, paginated (cursor by `created_at,id`).

---

## 3. Conventions (match the codebase)

- API: handlers under `api/_routes/**`, registered in `api/index.ts` (static before dynamic at same depth). `requireAuth(req,res)` → `{userId, orgId, role, accountType}`. `serialize(row)` before `res.json`. Relative imports in the `api/` graph MUST carry `.js` extensions (prod ESM guard).
- DB: Drizzle in `src/lib/db/schema.ts`; `npm run db:generate` then bump the new journal `when` above the previous; verify the column lands in `information_schema`.
- Client: `apiGet/apiPost/apiPatch/apiPut/apiDelete` (token = 2nd arg). Mutations clear/scope cache + `emitDataChanged`. Contexts named `*-context.tsx` in `src/lib/`.
- UI: shadcn primitives (Popover, DropdownMenu, Badge, Switch, sonner toast); `lucide-react` `Bell`. Install shadcn via CLI, never edit `src/components/ui/`.
- i18n: all strings via `useTranslation()`; add to `en.json` then fill all 8 locales.
- Gate (pre-commit + CI): secret-scan → check-esm-extensions → boot-functions → i18n:check → lint → typecheck → test:ci. **Never `--no-verify`.**

---

## 4. Branch chain (live status)

| # | Branch | Scope | Status |
|---|--------|-------|--------|
| 00 | `feat/notif-00-plan` | This doc + dependency-free `src/lib/notifications.ts` (types, categories, channels, type registry, default prefs, pure cascade resolver) + vitest | ⏳ in progress |
| 01 | `feat/notif-01-schema` | `notifications`, `notification_preferences`, `push_subscriptions` tables; migration 0044; `src/lib/types.ts` | ⬜ todo |
| 02 | `feat/notif-02-api-core` | `api/_lib/notifications.ts` (createNotification, notifyOrgMembers, server cascade resolve, dedup); routes: list (paginated), unread-count, mark read, read-all, delete | ⬜ todo |
| 03 | `feat/notif-03-preferences-api` | `GET/PUT /api/notifications/preferences?scope=user|organization|client` + role checks + upsert | ⬜ todo |
| 04 | `feat/notif-04-bell-ui` | `notification-context.tsx` (lazy unread polling + focus), Bell + badge (desktop + mobile), dropdown panel (lazy list), `notifications` i18n ns | ⬜ todo |
| 05 | `feat/notif-05-history-page` | lazy `/notifications` page, pagination, filters, mark read/delete/read-all | ⬜ todo |
| 06 | `feat/notif-06-profile-settings` | reusable `<NotificationPreferencesForm>`; user scope in ProfilePage | ⬜ todo |
| 07 | `feat/notif-07-org-settings` | org scope (owner/admin) in OrganizationsPage | ⬜ todo |
| 08 | `feat/notif-08-client-settings` | client scope on ClientDetailPage | ⬜ todo |
| 09 | `feat/notif-09-web-push` | VAPID env, `push_subscriptions` register/unregister API, `public/push-sw.js` + workbox `importScripts`, subscribe UI, `web-push` sender (isolated, best-effort) | ⬜ todo |
| 10 | `feat/notif-10-event-hooks` | wire real domain events → createNotification (invitations, members, roles, payment failed/succeeded, budget exceeded, recurring posted, quotation accepted); final real i18n translations; review | ⬜ todo |

Status legend: ⬜ todo · ⏳ in progress · ✅ pushed & gate-green · ⚠️ partial/deferred (see notes).

---

## 5. Assumptions (decisions made without the user)

- **A1 — Recipient + scope.** Notifications are keyed by `user_id` (recipient) + nullable `organization_id`. The bell shows `user_id = me AND (organization_id = activeOrg OR organization_id IS NULL)`, so org-scoped *and* account-level (e.g. cross-org invitations) both surface correctly.
- **A2 — Org/client prefs are shared (org-wide), not per-user.** A user's personal prefs are per-user; org & client prefs are org-wide policy editable by privileged roles. Cascade makes the most-specific shared policy win, then the user's personal prefs, then defaults.
- **A3 — `muted` anywhere mutes.** Simplest predictable semantics.
- **A4 — Categories, not per-type, in the prefs UI.** Six categories (team, billing, budget, transactions, clients, system). Keeps the UI tractable; types map to categories in code.
- **A5 — Channels in v1: `in_app`, `web_push`.** Email exists (`api/_lib/email.ts`) but is out of scope here; the channel enum leaves room to add it.
- **A6 — Push is best-effort & optional.** No VAPID env → push silently disabled; in-app unaffected.
- **A7 — i18n: English-first with `i18n-fill` per branch, real translations in branch 10.** Keeps every branch gate-green without blocking on translation.
- **A8 — Org-level pref editing requires owner/admin; client-level requires canWrite.**

---

## 6. Verified corrections / notes

_(filled in as adversarial verification turns up anything that contradicts the brief or a scout claim)_

- Migration head confirmed **0043** (`cooing_wolfpack`) → new migration is **0044**.
- PWA strategy is **`generateSW`** (workbox) — push handlers go in a static `public/push-sw.js` pulled via workbox `importScripts`, NOT a switch to `injectManifest` (keeps the documented white-screen-safe SW pipeline intact).
- `apiPut` exists in `src/lib/api.ts` — used for the preferences PUT.

---

## 7. Change log

- 2026-06-14 — Branch 00: plan doc + shared `src/lib/notifications.ts` constants/resolver + tests.
