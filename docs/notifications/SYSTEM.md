# ProfitSync Notification System

The complete human explainer for how notifications work — read this to understand the
model, set up web push, debug delivery, and add new notifications. The companion
**skill** (`.claude/skills/notification-system/`) is the operating guide for changing it.

---

## 1. Philosophy: platform-agnostic data + pluggable channels

Two ideas carry the whole design:

1. **Data is platform-agnostic.** Every notification is a row in the `notifications` table.
   The bell and the history page are just a *view* over those rows via `/api/notifications`.
   Any client — the web app, the installed PWA, a future native iOS/Android app, a
   wearable companion — reads the **same** API. This is why "works everywhere" is true:
   the inbox is server data, not a browser feature.

2. **Delivery channels are decoupled from the data.** A notification can be *delivered*
   on one or more channels:
   - **`in_app`** — always written to the DB → shows in the bell + history. Works on
     every device that runs the app. **Has no dependency on push.**
   - **`web_push`** — browser/PWA push via the Web Push standard + VAPID. An *enhancement*
     layered on top.
   - **`mobile_push`** (V5) — the native-app push toggle. ONE user-facing preference
     channel covering the device transports: `push_subscriptions.channel='fcm'` rows sent
     via FCM HTTP v1 (`api/_lib/push-fcm.ts`; FCM wraps APNs when the iOS shell lands).
     Setup + client wiring: `docs/native/ANDROID.md` → *Push notifications (FCM)*.
     No-ops entirely without the `FCM_SERVICE_ACCOUNT_JSON` env.

**The in-app system is completely independent of web push.** The bell works via lightweight
polling. Push is best-effort and isolated — a missing `web-push` dep, missing VAPID env, or
a failed send can never break the in-app notification.

---

## 2. The flow, end to end

```
EVENT (e.g. role change, payment failed, budget exceeded)
  │  api/_lib/notifications.ts → createNotification() / notifyOrgMembers()
  │     1. resolve the recipient's preference cascade (client → org → user → default)
  │     2. if in_app enabled for the category → INSERT a notifications row
  │     3. if web_push enabled for the category → sendWebPushToUser() (best-effort)
  │     4. if mobile_push enabled for the category → sendFcmToUser() (best-effort)
  ▼
IN-APP                                WEB PUSH (optional)
  bell polls /unread-count (60s)        api/_lib/push.ts (lazy-loads `web-push`)
  dropdown lazy-loads /notifications       → encrypts payload (RFC 8291)
  /notifications page = full history       → signs a VAPID JWT
                                           → POSTs to the browser's push endpoint
                                              (FCM / Mozilla / APNs — chosen by the browser)
                                           → device wakes the SW (public/push-sw.js)
                                           → showNotification(); click → focus/opens link
```

**No Firebase project, no GCM key, no third-party push SaaS.** Web Push with VAPID talks
to the browser vendor's own push service directly; the only external code is the `web-push`
npm library, which runs on *our* server.

---

## 3. Data model (`src/lib/db/schema.ts`, migration 0044)

| Table | Purpose | Key columns |
|---|---|---|
| `notifications` | one row per delivered in-app notification | `user_id` (recipient), `organization_id` (nullable = account-level), `type`, `category`, `title`, `body`, `data` (jsonb: `i18nKey`/`i18nBodyKey`/`i18nParams`/link payload), `link`, `actor_user_id`, `client_id`, `dedupe_key`, `read_at` |
| `notification_preferences` | polymorphic per-scope prefs | `scope` (`user`/`organization`/`client`), `user_id`, `organization_id`, `client_id`, `preferences` (jsonb) |
| `push_subscriptions` | delivery endpoints | `user_id`, `channel` (`web_push` today; `fcm`/`apns` future), `endpoint`, `p256dh`, `auth`, `platform`, `user_agent` |

- **Dedup:** event-sourced notifications pass a `dedupe_key`; a partial unique index
  `(user_id, dedupe_key)` + a select-then-insert (with a 23505 catch) make webhook retries
  and repeated lazy GETs idempotent.
- **Indexes:** `(user_id, organization_id, created_at)` for the inbox, `(user_id, read_at)`
  for the unread count.

### Shared, dependency-free model — `src/lib/notifications.ts`
Imported by the API, the frontend **and** vitest (no DB/React/Node imports). Holds:
`NOTIFICATION_CATEGORIES`, `NOTIFICATION_CHANNELS`, the `NOTIFICATION_TYPES` registry
(type → category + i18n key), `defaultChannelEnabled`, `resolveChannelEnabled` (the pure
cascade resolver), and `sanitizePreferences`.

---

## 4. Categories, types & the preference cascade

**Categories** (preferences are set per-category, not per-type): `team`, `billing`,
`budget`, `transactions`, `clients`, `system`. Each concrete `type` maps to one category.

**Channels:** `in_app`, `web_push`.

**System defaults:** everything `in_app` on; `web_push` on for the high-signal categories
(`team`, `billing`, `budget`), off for the rest.

**The cascade.** A preference row exists per scope target. To decide whether to deliver
type T (category C) about client K in org O to user U on channel CH:

```
client(O,K)  ?? org(O)  ?? user(U)  ?? system default
```

- `muted` anywhere in the cascade → blocked.
- otherwise the **most-specific level that has an explicit opinion** for (C, CH) wins.
- a scope with no row is simply skipped.

Ownership: **user** prefs = that user (the base, set in Profile → Notifications);
**organization** prefs = owner/admin (org-wide policy); **client** prefs = `canWrite`.

---

## 5. The bell & history (the personal inbox)

- The bell (`src/components/notifications/NotificationBell.tsx`) shows the unread badge and
  a dropdown that **lazily** fetches the recent list only when opened.
- The badge count comes from `NotificationProvider` (`src/lib/notification-context.tsx`),
  which polls **only** the cheap `/unread-count` (boot + every 60s + on focus + on org
  switch) — never the full list.
- The bell is a **PERSONAL inbox**: it shows ALL of the recipient's notifications across
  **every org they belong to**, plus account-level (org-less) ones — it is *not* filtered
  by the org currently being viewed. (Filtering by active org was the original
  "nothing in the bell" bug — a role change in another org was hidden.)
- The full history lives at **`/notifications`** (lazy route): All / Unread filter,
  cursor pagination ("Load more"), per-item click-through + delete, and **Mark all as read**.

---

## 6. Web Push setup (this is what makes phone push work)

Push is **optional**. If it isn't configured, the in-app bell still works everywhere and
the "Enable push notifications" toggle is simply hidden.

### Step 1 — generate VAPID keys
```bash
npx web-push generate-vapid-keys
```

### Step 2 — set the env vars (production: Vercel)
| Var | Value | Notes |
|---|---|---|
| `VAPID_PUBLIC_KEY` | the public key | server |
| `VAPID_PRIVATE_KEY` | the private key | **server-only, secret** |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.com` | contact for push services |
| `VITE_VAPID_PUBLIC_KEY` | **same** as `VAPID_PUBLIC_KEY` | browser bundle |

```bash
vercel env add VAPID_PUBLIC_KEY production
vercel env add VAPID_PRIVATE_KEY production
vercel env add VAPID_SUBJECT production
vercel env add VITE_VAPID_PUBLIC_KEY production
```
⚠️ **`VITE_VAPID_PUBLIC_KEY` is read at BUILD time** (baked into the browser bundle), so it
must exist *before the production build runs* — set it, then redeploy.

### Step 3 — each device must opt in
Web push **never auto-subscribes**. On every device/browser the user must:
**Profile → Notifications → Enable push notifications → allow the browser prompt.**
On iOS this works only for an **installed PWA on iOS 16.4+**.

### Why a push might not arrive (troubleshooting checklist)
1. `VITE_VAPID_PUBLIC_KEY` missing at build → the "Enable push" toggle never renders → no
   subscription. (Most common.)
2. The recipient never toggled push on **on that specific device**.
3. The recipient's category preference has `web_push` off (or `muted`).
4. The notification's category resolves to suppressed for that user.
5. The subscription expired (the sender prunes `404`/`410` automatically).
6. The OS/browser has notifications blocked for the site.

> The **in-app bell** is the source of truth and does not depend on any of the above —
> if a notification was created, it appears in the bell regardless of push.

---

## 7. Wired event sources

`createNotification` / `notifyOrgMembers` are called from:

| Type | Where | Recipient |
|---|---|---|
| `invitation_accepted` | `api/_routes/invitations/[token].ts` | the inviter |
| `role_changed` | `api/_routes/organizations/[id]/members.ts` (PATCH) | the member |
| `member_removed` | `members.ts` (DELETE) | the removed member (account-level) |
| `payment_failed` | `api/billing/webhook.ts` | org owners/admins (deduped on payment id) |
| `budget_exceeded` | `api/_lib/notify-budget.ts` (from transactions POST) | editing members, once per budget window |

---

## 8. Adding a new notification

```ts
import { createNotification, notifyOrgMembers } from "../_lib/notifications.js"

// one recipient
await createNotification({
  userId,                       // recipient (Clerk userId)
  organizationId,               // or null for account-level
  type: "quotation_accepted",   // add to NOTIFICATION_TYPES if new
  title: "Quotation accepted",  // English fallback
  body: "...",
  data: { i18nKey: "types.quotation_accepted.title", i18nBodyKey: "...", i18nParams: { ... } },
  link: "/quotations",          // bell click navigates here
  dedupeKey: `quote_accepted:${id}`, // optional idempotency
})

// fan out to an org's members (per-recipient cascade + dedupe)
await notifyOrgMembers(orgId, { type, title, body, data, link }, { roles: ["owner","admin"] })
```

Checklist for a new `type`:
1. Add it to `NOTIFICATION_TYPES` in `src/lib/notifications.ts` (→ its category).
2. Add `notifications.types.<type>.{title,body}` to `en.json`, then translate all 8 locales
   (see *i18n* below).
3. Call `createNotification`/`notifyOrgMembers` at the event site, **best-effort**
   (`void ...catch(() => {})`) so it never blocks/fails the originating action.
4. Relative imports in `api/` keep the **`.js`** extension (prod ESM guard).

---

## 9. i18n

A `notifications` namespace (registered in `PAGE_NAMESPACES`). The bell/history/settings
render `data.i18nKey` in the recipient's language, falling back to the stored English
title/body. `time.*` keys produce compact relative times. To add keys: put them in
`en.json`, run `node scripts/i18n-fill.mjs` to keep the gate green, then apply real
translations (set the nested values per locale; **note: `scripts/i18n-merge.mjs` is
additive-only and will NOT overwrite keys already filled** — set existing keys directly).

---

## 10. Files map

| Concern | File(s) |
|---|---|
| Shared model + resolver | `src/lib/notifications.ts` (+ `.test.ts`) |
| Server service | `api/_lib/notifications.ts` |
| Web push sender | `api/_lib/push.ts` (lazy-loads `web-push`) |
| Budget-exceeded hook | `api/_lib/notify-budget.ts` |
| API routes | `api/_routes/notifications.ts`, `notifications/{unread-count,read-all,preferences,push,[id]}.ts` |
| Provider (badge polling) | `src/lib/notification-context.tsx` |
| Bell + items + display | `src/components/notifications/{NotificationBell,NotificationItem,notification-ui,NotificationPreferencesForm,PushToggle}.tsx` |
| History page | `src/pages/NotificationsPage.tsx` |
| Service worker push | `public/push-sw.js` (workbox `importScripts` in `pwa/vite-pwa.ts`) |
| Schema / migration | `src/lib/db/schema.ts`, `drizzle/0044_*.sql` |

---

## 11. Roadmap

Planned/extended features (transaction reminders, admin broadcast studio, user groups,
per-client trigger model, spaces auto-save alerts) are designed in
**`docs/notifications/V2_ROADMAP.md`**.
