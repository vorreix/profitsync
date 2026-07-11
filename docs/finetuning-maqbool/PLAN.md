# Fine-tuning wave "maqbool" — notifications, admin access, DB + UI performance

**Date started:** 2026-07-11 · **Base branch:** `dev` · **Chain:** `feat/maqbool-00-plan` → `feat/maqbool-07-ui-perf`

The brief (from production observations on profitsync.net):

1. The notification bell renders a raw i18n error string as the title
   (`key 'types.add_transaction_reminder (en-US)…'`) and the dropdown layout is
   broken — list items overlap the "View all" footer.
2. Notifications are "not properly working" — scheduled/push delivery is
   unreliable (evidence: the newest reminder in prod is **Jun 30** while today is
   **Jul 11** → the scheduler tick has not fired for ~11 days). Decide
   Firebase/FCM vs hardening the existing VAPID web-push.
3. The root admin (maqboolthoufeeq.t@gmail.com) sees **no Admin entry** in the
   prod account dropdown.
4. Deep DB-query and UI-performance optimization + better animations/UX.

No user input available during the wave — decisions are recorded here.

## Working conventions

- Mobile-first (≈390 px first), ≥44 px touch targets; verify phone + desktop widths.
- All user-visible strings through i18n; `en.json` first, then propagate to all 7
  other locales (`scripts/i18n-merge.mjs` — additive-only); `npm run i18n:check` gates.
- API imports keep `.js` extensions; every query org-scoped via `requireAuth()`;
  `serialize()` before `res.json`.
- Migrations: `npm run db:generate`, then **check `drizzle/meta/_journal.json`
  `when` exceeds the previous entry** (silent-skip gotcha), apply to the dev DB and
  confirm via `information_schema`.
- Mutations update lists **in place** (no full-screen reload); silent refetch for
  reconcile only.
- Gate before every commit: secret-scan → esm-extensions → boot-functions →
  i18n:check → lint → typecheck → test:ci (husky runs it on commit; no `--no-verify`).
- Animations: transform/opacity only, `motion-reduce` respected, existing tooling
  (tw-animate-css, auto-animate, vaul) — no new animation deps.

## Verified root causes (re-derived from code, not just agent claims)

| # | Symptom | Root cause (verified) |
|---|---|---|
| 1 | Raw i18n key as title | `api/_routes/cron/notifications.ts:37` stores `i18nKey: "types.add_transaction_reminder"` — an **object** key ( `{title, body}` in every locale). `notificationTitle()` (`src/components/notifications/notification-ui.tsx:65`) calls `t(key)` → i18next returns its "returned an object instead of string" error text, which renders literally. Body renders fine because `i18nBodyKey` is absent → falls back to the English `body` column. Every other call site passes `types.<type>.title` correctly. |
| 2 | Items overlap "View all" | `NotificationBell.tsx:139` puts `max-h-[min(24rem,60vh)]` on the **ScrollArea root**; the vendored primitive's Root is `relative` with **no overflow-hidden**, and the Radix Viewport is `size-full` — % height can't resolve against a max-h auto-height parent, so the viewport lays out at natural content height and paints past the root, under the footer. |
| 3 | No Admin entry in prod | `AppLayout.tsx:287` (and MobileAppLayout) gate on `useAdmin().isAdmin` ← `/api/admin/me` ← `getResolvedAdmin()`. Prod Clerk is a separate instance (different user ids) with **no `app_admins` row**, and the already-built email bootstrap (`api/_lib/admin.ts` `rootAdminEmails()`) is dead because **`ROOT_ADMIN_EMAILS` is not set in Vercel Production** (confirmed via `vercel env ls`). No code change needed — ops + docs. |
| 4 | Notifications stopped | The tick driver (self-hosted Go worker → `POST /api/cron/notifications` every 5 min) stopped ~Jun 30 (newest reminder row). Single-driver architecture with **no heartbeat and no fallback**; V4's admin panel can show/repair the schedule but nothing detects staleness or self-heals. VAPID + worker env vars ARE set in prod. |
| 5 | DB hot spots | `transaction_attachments`/`quotation_attachments` have **no FK index** while the transactions list runs a per-row `count(*)` subquery against them (schema 311–341, `api/_routes/transactions.ts:50,90`); no `(client_id, date)` composite for the calendar/analytics date-range joins; `attachments/[id].ts:36` loads base64 `fileData` even for `?metadata=1`; `admin/blog.ts:51` selects full Markdown content for the list. |
| 6 | UI re-renders / weight | `currency-context.tsx` + `admin-context.tsx` create context values per render (20+ `useCurrency()` consumers); transaction rows unmemoized (`TransactionsPage.tsx:683–800`); **all 8 locale JSONs (~715 KB raw) bundled eagerly** (`src/lib/i18n/index.ts`); bell refetches with a spinner on every open; no enter/exit animation on lists. |

## ⚠️ Corrections to research-agent claims (do NOT implement these)

- ❌ "Add composite index `transactions(organization_id, date)`" — **`transactions`
  has no `organization_id` column**; org scoping joins through `clients`. The
  correct index is `(client_id, date)`.
- ❌ "Exclude the `data` jsonb from the notifications list endpoint" — the client
  renders `data.i18nKey`/`i18nParams`/`imageUrl` from it; excluding it would break
  the bell. `data` is small; leave it.
- ❌ "Exclude `logoData` from the wealth accounts list" — deliberate design: the
  stored base64 becomes a durable `logo_src` because hotlinked `logo_url` expires
  (comment at `api/_routes/wealth/accounts.ts:104`). Leave it.
- ⚠️ Recurring-materializer changes (bulk loads / batched balance updates) touch
  the **money path** — out of scope for this wave; not worth the risk for a
  per-org, already-short-circuited code path.
- ❌ "Exclude `content` from the admin blog LIST endpoint" — the editor populates
  its form from the **list row** (`AdminBlogPage.tsx` `openEdit` → `post.content`);
  trimming it would open every post with empty content and could WIPE the post on
  save. Safe only after refactoring the editor to fetch `/api/admin/blog/:id` —
  low-value admin-only path, skipped.

## Decision record — Firebase/FCM vs existing VAPID web-push

**Decision: keep VAPID web-push; do not migrate to FCM.** Full write-up:
`docs/notifications/PUSH_PROVIDER_DECISION.md` (branch 05). Summary: FCM web push
delivers through the exact same browser push services (Chrome→FCM, Firefox→Mozilla,
Safari→Apple) so reliability wouldn't improve; it requires its own
`firebase-messaging-sw.js`, which conflicts with the white-screen-safe single-SW
pipeline (`app-sw.js` + importScripts `push-sw.js` + reserved `/sw.js` kill switch);
and the actual prod failure was the **tick driver stopping**, which FCM does not
address. The fix is redundancy + observability (branches 04–05). FCM becomes
relevant only if native mobile apps ship; the channel model
(`push_subscriptions.channel`) already accommodates that without schema changes.

## Branch chain (live tracker)

| Branch | Task | Migration | Status |
|---|---|---|---|
| `feat/maqbool-00-plan` | This document | — | ✅ pushed |
| `feat/maqbool-01-notif-i18n` | Fix reminder i18n keys + defensive render for existing prod rows + call-site sweep + unit tests | — | ✅ pushed (unit-tested; legacy-row render verified in browser) |
| `feat/maqbool-02-bell-ux` | Bell layout fix (footer overlap) + instant cached open + design/animation polish + mobile drawer | — | ✅ pushed (Playwright-verified 1280px + 390px) |
| `feat/maqbool-03-admin-bootstrap` | ROOT_ADMIN_EMAILS docs + ops (env set in prod/dev/preview ✅; prod redeploy at wave end) | — | ✅ pushed |
| `feat/maqbool-04-scheduler-reliability` | Tick heartbeat + admin diagnostics + stale detection + auto-repair + GitHub Actions fallback pinger | 0046 | ✅ pushed (tick+heartbeat verified vs dev DB; healthy + stale panel states Playwright-verified; found & fixed the 502-drops-heartbeat bug) |
| `feat/maqbool-05-push-hardening` | push_events outcome log + `pushsubscriptionchange` SW listener + rotate endpoint + diagnostics surfacing + decision doc | 0047 | ✅ pushed (rotate endpoint curl-tested; event logging verified vs dev DB) |
| `feat/maqbool-06-db-perf` | Indexes: `transaction_attachments(tx)`, `quotation_attachments(quotation)`, `transactions(client,date)`, `org_members(org,user)` (redundant left-prefix singles dropped) + attachment routes never load base64 except on download | 0048 | ✅ pushed (indexes confirmed in pg_indexes; dev-DB EXPLAIN still seq-scans at toy size — win is at prod scale; honest note) |
| `feat/maqbool-07-ui-perf` | Context memoization + row memo + auto-animate + lazy locales + motion-reduce sweep | — | ⏳ |

> Migration numbering: `dev` head is 0045. The unmerged `feat/family-*` chain also
> claims 0046 — whichever chain merges second must renumber (journal `when` +
> filename). Recorded here so it isn't a surprise.

## Per-task details

### 01 — Notification i18n keys
**Approach:** (a) creation site → `i18nKey: "types.add_transaction_reminder.title"`,
`i18nBodyKey: "types.add_transaction_reminder.body"`; (b) add a **pure, dependency-free**
resolver in `src/lib/notifications.ts` that, given a stored `data` payload, returns
the effective title/body keys — handling legacy bare-type keys (append `.title` /
`.body`) — unit-tested in `src/lib/notifications.test.ts` (DB-free gate); (c)
`notification-ui.tsx` uses the resolver, so **existing prod rows render correctly
in every locale without a backfill**; (d) sweep every `createNotification` /
`notifyOrgMembers` call site and verify each key resolves to a string in `en.json`.
**Verify:** unit tests + Playwright (seed a legacy-shaped row via the bell? — render
check with mocked t in tests; browser check on dev data).

### 02 — Bell layout + UX
**Approach:** replace the broken ScrollArea usage with a plain
`max-h overflow-y-auto overscroll-contain` list (or viewport-constrained scroll)
inside a `flex flex-col` popover with the footer as a non-scrolling sibling; show
**cached rows instantly** on reopen (background silent refresh, no spinner after
first load); polish: item enter animation, mark-read fade, badge transition,
`motion-reduce` respected; keep popover on desktop; improve mobile fit (full-width
popover already; drawer only if it stays cheap). **Verify:** Playwright screenshots
at 1280 px and 390 px, scrolled-to-bottom shows footer never overlapped; 0 new
console errors.

### 03 — Admin bootstrap (ops + docs)
**Approach:** no code change (mechanism exists). Ops executed as part of this wave:
`printf 'maqboolthoufeeq.t@gmail.com' | vercel env add ROOT_ADMIN_EMAILS production`
then a prod redeploy (env vars apply on next deployment). Docs: CLAUDE.md env
section + this file. **Verify:** `vercel env ls` shows the var; post-redeploy,
`/api/admin/me` for that account returns 200 (user-confirmable; we cannot log into
his prod account — stated honestly).

### 04 — Scheduler reliability
**Approach:** (a) `notification_ticks` heartbeat (single-row upsert per tick:
last tick at, counts); (b) `/api/admin/notifications-diagnostics` (cap `read`) returns
heartbeat + staleness; AdminWorkerPage shows it with a red stale warning;
(c) auto-repair: when the admin panel detects a reachable worker with the
notifications schedule missing, it re-registers automatically (existing V4 repair,
now automatic); (d) **fallback driver**: `.github/workflows/notification-tick.yml`
cron (every 30 min) POSTs `/api/cron/notifications` with `CRON_FALLBACK_TOKEN`;
`requireServiceToken` accepts it as an additional token. Idempotent by design
(dedupe keys) so worker + fallback can both run. Vercel-side token set via
`vercel env add`; the GitHub repo secret `PROFITSYNC_CRON_TOKEN` **must be added by
the operator** (gh CLI unauthenticated here — the one step we cannot do; workflow
no-ops gracefully until then).

### 05 — Push hardening
**Approach:** `push_events` outcome log written by `sendWebPushToUser`
(ok/failed/pruned/no_subs/unconfigured + error code), `pushsubscriptionchange`
listener in `public/push-sw.js` (re-subscribes + POSTs the new endpoint), recent
failures surfaced in the diagnostics endpoint/panel, decision doc. Push stays
best-effort and lazily imported (never blocks in-app).

### 06 — DB performance (all EXPLAIN-verified on the dev DB before commit)
Indexes: `transaction_attachments(transaction_id)`,
`quotation_attachments(quotation_id)`, `transactions(client_id, date)` (drop the
now-redundant single-column `transactions_client_idx`),
`organization_members(organization_id, user_id)`. Over-fetch: `attachments/[id].ts`
selects metadata only unless downloading; `admin/blog.ts` list excludes `content`.
Also check `organizations.ts` scalar-subquery shape — fix only if the win is clear.

### 07 — UI performance + polish
Memoize `CurrencyProvider`/`AdminProvider` values; extract + memo `TransactionRow`;
auto-animate the transactions list (pattern already used on Dashboard/Wealth);
**lazy-load non-active locales** (keep `en` eager as fallback; dynamic-import the
active/selected locale, `addResourceBundle`, then `changeLanguage`); targeted
`motion-reduce` sweep on the surfaces we touched.

## Ops runbook (executed at wave end; honest status recorded)

1. `vercel env add ROOT_ADMIN_EMAILS production` → `maqboolthoufeeq.t@gmail.com` — [ ]
2. `vercel env add CRON_FALLBACK_TOKEN production` → generated secret — [ ]
3. GitHub repo secret `PROFITSYNC_CRON_TOKEN` = same value — **operator step** — [ ]
4. Prod redeploy (env changes take effect on next deployment) — [ ]
5. Restart/verify the Go worker on its host + confirm schedule registered from the
   admin panel (operator; panel now shows staleness + auto-repairs) — [ ]

## Change log

- 2026-07-11 — Wave started: research (6-agent workflow) + adversarial verification
  complete; plan committed on `feat/maqbool-00-plan`.
