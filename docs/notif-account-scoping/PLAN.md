# Native fixes wave — notification scoping, settings entry, push org-context

Autonomous execution (`autonomous-task-execution` skill). Single source of truth for
this wave. The user's brief had five problems; investigation on the CURRENT `dev`
(which has advanced two days past the original diagnosis) found **two already fixed**
and **three still open**.

## Reconciled state (why some items are already done)

`dev` == `main` (0 commits apart); both contain PRs **#333/#334/#335**. The build the
user tested (native OAuth branch, `versionCode 7`) predated **#335**.

| # | User's problem | Status | Evidence |
|---|---|---|---|
| 1 | Native logout when navigating (added a tx → tapped Wealth → logged out) | ✅ **Fixed by #335** — ship a build | `5a04502` routes Clerk FAPI through `CapacitorHttp` (no `Origin` header). The old iframe transport 400'd on `Origin`+`Authorization`, so `getToken()`'s session-token refresh on navigation failed → 401 → `AppLayout` redirects to `/login`. CapacitorHttp fixes the refresh **and** captures the nonce-reload rotated token (cold-start persistence). |
| 2 | Onboarding not idempotent (go back, new name → 2nd org created) | ✅ **Fixed on dev/main** | `api/_routes/onboarding.ts` now reuses the first existing business org (`ownerUserId`, `isPersonal=false`, `orderBy createdAt asc`) instead of always creating; personal path uses idempotent `ensurePersonalOrg`. |
| 3 | Notifications from all accounts mixed in the drawer | 🔧 **Task A** | `notifications.ts` deliberately scopes by `user_id` ONLY ("personal inbox"). Contradicts the user's explicit ask. |
| 4 | In-app drawer needs a link to notification settings | 🔧 **Task B** | `NotificationBell.tsx` has no settings entry. |
| 5 | Push for org B (while in org A) must name org B + tapping opens it IN org B | 🔧 **Task C** | Push payload carries no org identity; tap just deep-links without switching org. |

Items 1 & 2 need no code from us — they reach the user when a native build ≥ `versionCode 8`
is published (item 1) and when `main` is deployed (item 2, already merged). Surfaced in the
final summary; **not** re-implemented.

## Design decision — notification scoping (resolves a deliberate prior choice)

The current code has an explicit comment defending the user-id-only "personal inbox" so a
cross-org event (e.g. a role change in a non-active org) isn't hidden. The user explicitly
wants the **opposite**: per-account separation. We reconcile both concerns with one coherent
model the user themselves described:

- **In-app drawer / bell / count**: scope to `user_id = me AND (organization_id = active_org OR organization_id IS NULL)`.
  Account-level rows (`organization_id IS NULL` — e.g. `member_removed`, admin broadcasts)
  stay visible in every org.
- **Cross-org events aren't lost**: they're surfaced via **push**, which now names the org
  and, on tap, **switches to that org** and shows the item there (Task C). When the user
  later switches to that org in-app, the item is in its drawer too.

Existing `organization_id` assignments already fit: membership-bound events (`role_changed`,
`member_invited`, `invitation_accepted`) are org-scoped; `member_removed` is already `null`
(account-level) because the recipient loses that org's scope.

## Branch chain (stacked, off `dev`)

| # | Branch | Task | Gate | cap:sync | Push / PR |
|---|---|---|---|---|---|
| A | `fix/notif-account-scope-maqbool` | Task A — scope inbox/count/read-all to active org + account-level (+ this plan doc) | ⏳ | (server-only) | ⏳ |
| B | `feat/notif-settings-button-maqbool` | Task B — settings button in the drawer → `/profile?tab=notifications` | ⏳ | ⏳ | ⏳ |
| C | `feat/notif-push-org-context-maqbool` | Task C — push org name prefix + `?no_org=` switch-on-tap consumer | ⏳ | ⏳ | ⏳ |

`cap:sync:android` + `cap:sync:ios` run once on the **tip** (C) — B and C change the web
bundle; A is API-only.

## Task A — per-account notification scoping (API)

**Files:** `api/_routes/notifications.ts` (list + unread count), `api/_routes/notifications/unread-count.ts`,
`api/_routes/notifications/read-all.ts`.

**Change:** replace `eq(notifications.userId, ctx.userId)` with
`and(eq(userId, ctx.userId), or(eq(organizationId, ctx.orgId), isNull(organizationId)))`.
`ctx.orgId` is the active org from `requireAuth` (`x-org-id` header → profile → personal).
The client already refetches the count on `activeOrg.id` change (`notification-context.tsx`).

**Risks:** over-restrictive worst case = an org-scoped item not shown while viewing a
different org (by design; recoverable by switching org or via push). Not money/auth-critical.

**Verify:** typecheck + reason through the query; unit gate is DB-free so endpoint behaviour
is verified by hand + (optionally) a throwaway DB test, deleted before commit.

## Task B — settings entry in the drawer

**Files:** `src/components/notifications/NotificationBell.tsx`, `en.json` + 7 locales.

Gear icon button in the shared `panel` header (covers mobile drawer + desktop popover);
on click close the panel and `navigate("/profile?tab=notifications")` (tab already exists,
`ProfilePage` `PROFILE_TABS` includes `notifications`). New key `notifications.settings_button`.

## Task C — push org-context (name + switch-on-tap)

**Server** (`api/_lib/notifications.ts`): for org-scoped sends, prefix the push title with the
org name (`"<Org> · <title>"`) and append `?no_org=<orgId>` to the push URL only (in-app
`link` stays clean — the drawer is already active-org scoped). Fetch the org name once in
`notifyOrgMembers`; single `createNotification` calls fetch it if not provided. No change to
`push.ts` / `push-fcm.ts` / `push-sw.js` — the URL carries the org.

**Client:** new `useNotificationOrgSwitch()` hook called in `AppLayoutInner` (inside
`OrgProvider`, before the mobile early-return so it runs on both shells). It reads `no_org`
from the URL; once orgs are loaded it strips the param and, if the target is a member org and
not active, calls `switchOrg`. Covers web SW `client.navigate`/`openWindow` (mount) and native
react-router nav (search-param effect). `native-push.ts` unchanged — its tap already
`navigate(url)`s and the URL now carries `no_org`.

## Assumptions (decided autonomously — recorded per the skill)

1. **Scope over unified inbox.** The user's explicit, repeated ask wins over the prior
   "personal inbox" comment. Cross-org visibility is preserved via push + org switch, not a
   mixed drawer.
2. **`·`-prefixed English push title.** Push titles are server-side English fallback (no
   per-locale render server-side); prefixing with the org name is the clearest "which org"
   signal on the lock screen. Applied to all org-scoped pushes (incl. personal org).
3. **URL-param switch mechanism** (`no_org`) over threading `switchOrg` into `native-push`
   — one consumer serves web + native, minimal blast radius, and native-push needs no change.
4. **Base off `dev`** (== `main`), not the stale OAuth branch.

## Change log
- _(pending)_ Task A committed.
