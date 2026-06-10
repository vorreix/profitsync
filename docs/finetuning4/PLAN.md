# Fine-Tuning Wave 4 (ux4) — Plan & Live Tracker

> **Status legend:** ⬜ not started · 🔵 in progress · ✅ shipped (gate passed, pushed) · ⚠️ shipped with caveats (see notes)
>
> This is the single source of truth for the 12-task ux4 brief (2026-06-10).
> Each task ships as one stacked branch off the previous; every branch passes the
> full pre-commit gate (i18n → lint → typecheck → test:ci) before push.

## Working conventions (apply to every branch)

- **Mobile-first**: design at ~390px first; ≥44px touch targets; verify both widths.
- **Instant data updates**: never reload a whole list for one mutation. Optimistic
  in-place insert/replace/remove + `invalidateKeys` scoped invalidation + `{silent}`
  reconcile refetch. No skeleton flashes after a mutation.
- **i18n**: every user-visible string through `useTranslation()`; add to `en.json`,
  propagate to all 7 other locales via `scripts/i18n-merge.mjs`; `npm run i18n:check` gates.
- **Money paths**: reuse `src/lib/wealth-ledger.ts` helpers; never re-derive signs
  inline; lock new money math with unit tests BEFORE wiring it up.
- **Migrations**: `npm run db:generate`, then bump the new `_journal.json` `when`
  above the previous entry (silent-skip gotcha), apply with
  `node -r dotenv/config scripts/db-migrate.mjs dotenv_config_path=.env.local`,
  and confirm the column exists via `information_schema.columns`.
- **API**: org-scoped queries only, `serialize()` before `res.json`, role checks
  (`canWrite`/`canDelete`) + quota checks before writes, `.js` import extensions.
- **Routes**: handlers in `api/_routes/**` dispatch through the single `api/index.ts`
  function — adding routes does NOT consume Vercel function slots.
- **Neon HTTP driver has no multi-statement transactions** — atomicity must come
  from single SQL statements (CASE updates), unique indexes + `onConflictDoNothing`,
  and idempotent writes.

## Branch chain (live tracker)

| # | Branch | Task | Migration | Status |
|---|--------|------|-----------|--------|
| 00 | `feat/ux4-00-plan` | This plan doc | — | ✅ |
| 01 | `feat/ux4-01-category-delete` | T10 category delete updates in place | — | ✅ |
| 02 | `feat/ux4-02-bank-logo-persist` | T1 bank logos persist (DB-served) | — | ✅ |
| 03 | `feat/ux4-03-bank-quota-default` | T8 crown gating + default bank | 0035 | ✅ |
| 04 | `feat/ux4-04-org-logo-avatar` | T2 org logo + profile picture | 0036 | ✅ |
| 05 | `feat/ux4-05-dodo-org-currency` | T9 checkout in org currency | 0037 | ✅ |
| 06 | `feat/ux4-06-billing-attempts` | T11 attempt logging + admin panel | 0038 | ✅ |
| 07 | `feat/ux4-07-recurring-payments` | T3 recurring payments | 0039 | ✅ |
| 08 | `feat/ux4-08-calendar` | T7 calendar visualization | — | ✅ |
| 09 | `feat/ux4-09-custom-dashboard` | T12 custom dashboard builder | 0040 | ✅ |
| 10 | `feat/ux4-10-e2e-ci` | T4 Playwright e2e + CI gate for main | — | ✅ |
| 11 | `feat/ux4-11-security-gate` | T5 security checks (pre-commit + CI) | — | ✅ |
| 12 | `feat/ux4-12-audit-fixes` | T6 deep security/perf/scale audit + fixes | 0041 | ✅ |
| 13 | `feat/ux4-13-docs-skill` | Docs + subscription-system skill update | — | ✅ |
| 14 | `feat/ux4-14-calendar-day-figures` | Calendar: figures on every day cell + Profit | — | ✅ |
| 15 | `feat/ux4-15-dashboard-edit-ux` | Dashboard edit UX: title button, scroll-safe drag, floating ✓ | — | ✅ |
| 16 | `feat/ux4-16-edit-jiggle` | Dashboard edit mode: iOS jiggle + floating dimmed drag | — | ✅ |
| 17 | `feat/ux4-17-postsave-scroll` | Fix: post-save mobile scroll blocked by the toast | — | ✅ |

## ⚠️ Corrections to research findings (re-derived by hand)

1. **T1 (bank logos):** the research agent proposed `<img src="/api/wealth/logos/:id">`.
   That would 401 — API auth is Bearer-token-only (`api/_lib/auth.ts:getUserId`),
   and `<img>` tags can't send the header. Instead the accounts GET/detail responses
   carry a `logo_src` **data URL** built from the stored base64 (`logo_data` already
   exists and is populated at create/update via `resolveLogoColumns`); mime is
   sniffed from magic bytes (no migration needed).
2. **T10 (category delete):** agent claimed the 30s GET cache returns stale data.
   False — `apiDelete` clears the whole cache *before* `refresh()` runs
   (`src/lib/api.ts:127-134`). The real resurrection bug: `ensureDefaultCategories`
   (`api/_routes/categories.ts:38-54`) re-seeds the 11 default names on **every GET**,
   so deleting a default category brings it straight back. Fix = seed only on first
   access (empty set), plus optimistic in-place removal for instant UX.
3. **T3 (recurring):** agent flagged "new routes count against the 12-function cap" —
   wrong, `_routes/**` go through the consolidated router. Also: idempotent
   materialization can't use DB transactions (Neon HTTP) → unique index on
   `(recurring_rule_id, due_date)` + `onConflictDoNothing().returning()`, and balance
   deltas applied **only** for rows actually inserted.
4. **T9 (currency):** forcing `organizations.currency` blindly can break payments —
   the existing `billingCurrency` derivation from the billing country is the fix for
   "Missing connector response" on Indian cards (country × currency must have a
   connector). Docs (fetched 2026-06): `billing_currency` is honored when Adaptive
   Currency is enabled, **ignored** when disabled, and an unsupported currency fails
   the create call. → Fallback chain + retry on Dodo error (org currency → country
   currency → omit), never hard-fail checkout because of a currency preference.
5. **T12 (dashboard):** layout must be stored **per account type** (personal orgs
   and business orgs render different card sets) — one jsonb on `user_profiles`
   shaped `{version, contexts: {personal: {order, hidden}, business: {order, hidden}}}`.

---

## 01 · T10 — Category delete updates in place

**Problem:** deleting a category appears to need a page refresh.
**Verified root cause:** two parts. (a) Default-name categories are re-seeded on
every GET (`ensureDefaultCategories`), so deleting one resurrects it on the very
next refetch — delete looks broken. (b) The page does `await refresh()` (full
refetch) instead of optimistic in-place removal, so even custom deletes feel slow.
**Approach:** seed defaults only when the org has zero categories (first access);
optimistic removal in `CategoriesPage` + `CategoryPicker` with rollback on failure;
scoped `invalidateKeys(["/api/categories"])`.
**Files:** `api/_routes/categories.ts`, `src/pages/CategoriesPage.tsx`,
`src/components/CategoryPicker.tsx`.
**Verify:** Playwright — delete a default + a custom category; both disappear
instantly and stay gone after reload.
**Status:** ✅ — browser-verified: custom ("fdklfd") + default ("Travel" expense)
deleted instantly (header count tracked 34→33→32 with no reload) and both stayed
gone after a full page reload. Also shipped: optimistic add/rename in place, and
the same treatment in CategoryPicker.

## 02 · T1 — Bank logos persist (DB-served)

**Problem:** bank logos show for a few hours in prod, then vanish.
**Verified root cause:** `WealthAccountIcon` renders the hotlinked third-party
`logo_url` (Brandfetch CDN etc.) which expires; the base64 copy in
`wealth_accounts.logo_data` is stored but **never served** (intentionally omitted
from list responses).
**Approach:** accounts GET/detail include `logo_src` = data URL from stored bytes
(mime sniffed from magic bytes in a pure, unit-tested helper); icon prefers
`logo_src` → `logo_url` → glyph; bounded lazy backfill on GET re-fetches missing
`logo_data` (≤3 rows/request) so existing prod accounts heal themselves.
**Files:** `api/_routes/wealth/accounts.ts`, `accounts/[id].ts`,
`api/_lib/bank-brand.ts`, `src/lib/logo-data.ts` (new, +test),
`src/components/WealthAccountIcon.tsx` + callers passing `logo_src`.
**Verify:** unit test for sniffing; Playwright — account card shows logo with
`src^="data:image/"`; simulate dead URL (garbage `logo_url`) and confirm the logo
still renders from stored bytes.
**Status:** ✅ — 15 unit tests on the sniff/data-URL helper; browser-verified: all
bank logos render as `data:image/webp|png` URLs; simulated prod failure (blanked
`logo_data` + dead hotlink on Intesa Sanpaolo) healed itself on the next GET
(bytes re-fetched + dead URL replaced) and rendered from stored bytes.

## 03 · T8 — Free-plan bank gating (crown) + default bank (0035)

**Problem:** (a) at the free-plan bank limit the Add-Account modal still opens and
the server 402s after submit; (b) no way to mark a default bank.
**Approach:** (a) expose `bank_quota {current, limit}` to the client; show a small
golden crown badge on every add-account entry point when at limit (WealthPage
button + empty state, AccountSelector "+ add"); clicking opens an Upgrade dialog
(benefit copy + CTA → `/subscription`) instead of the form. Replace the hardcoded
`MAX_BANKS=5` with the plan limit. (b) `is_default boolean` on `wealth_accounts` +
partial unique index (one active default per org); atomic single-statement
`SET is_default = (id = $X)` update; "Set as default" menu action + badge;
`AccountSelector` preselects default → Cash → first.
**Files:** schema + migration 0035, `api/_routes/wealth/accounts.ts` + `[id].ts`,
`src/pages/WealthPage.tsx`, `src/components/AccountSelector.tsx`, i18n.
**Verify:** Playwright on a free org with 1 bank: crown shows, upgrade dialog opens;
set-default flips badge between accounts without reload.
**Status:** ✅ — browser-verified on a free org over its limit: golden crown on Add
bank, click → upgrade dialog (with the plan's real limit interpolated), CTA →
/subscription. Set-default: badge appeared instantly on the chosen card, moving it
to Cash auto-cleared the previous holder, exactly one default after reload.
Implementation detail: default flip is clear-then-set (two statements) because a
single org-wide UPDATE can transiently violate the partial unique index. Also
replaced the hardcoded restore limit (5) with the plan quota (402 + reason).

## 04 · T2 — Org logo + user profile picture (0036)

**Problem:** orgs and users have no visual identity; placeholders everywhere.
**Approach:** `organizations.logo_data/logo_mime`, `user_profiles.avatar_data/avatar_mime`
(migration 0036). Client resizes to ≤256px webp/png via canvas before upload
(payloads stay tiny), server validates (image mime allowlist + ≤300KB + base64
sanity via the attachments pattern). PATCH org (owner/admin) / PATCH profile accept
+ clear them. Reusable `<EntityAvatar>` renders image-or-initials; wired into
OrgSwitcher (trigger + list), OrganizationsPage cards + edit dialog upload,
ProfilePage avatar section, AppLayout sidebar footer, MobileAppLayout sheets.
Org GET list + profile GET include `logo_src`/`avatar_src` data URLs.
**Verify:** Playwright — upload logo + avatar, both appear immediately (no reload)
in switcher/list/sidebar; remove restores initials.
**Status:** ✅ — browser-verified: org logo uploaded via the edit dialog (canvas
resize → webp data URL preview) appeared immediately in the org card AND the
sidebar OrgSwitcher; profile photo uploaded on /profile rendered immediately and
shows in the sidebar footer user button after reload. Avatar saves immediately on
pick (no separate save step). Naming note: columns are `avatar_data/avatar_mime`
(not profile_picture_*).

## 05 · T9 — Dodo checkout in org currency (0037)

**Problem:** hosted checkout charges by the customer's country currency; should
follow the organization's currency, with USD fallback, without breaking payments.
**Approach:** currency resolution chain in `create-subscription`:
`org.currency` if in the Dodo-supported set (curated `DODO_SUPPORTED_CURRENCIES`
list in `src/lib/currencies.ts`, from docs.dodopayments.com) → else
`currencyForCountry(billingCountry)` → else omit. If the Dodo create call fails
with a currency/connector error, **retry once** with the country-derived currency,
then once with no `billing_currency` — checkout must never fail because of a
currency preference. Snapshot the final currency on
`subscriptions.billing_currency` (migration 0037) for admin visibility.
`invoices.currency` stays authoritative for what was actually charged.
**Verify:** unit tests for the resolution chain; stub-mode + test-mode checkout
still works end-to-end; SubscriptionPage shows org-currency price hint.
**Status:** ✅ — resolution chain locked by 10 unit tests (incl. the India rule:
IN billing country ALWAYS bills INR — the connector failure happens at payment
time on the hosted page, so create-time retries can't catch it; the org
preference must never re-break it). LIVE-verified on test-mode Dodo: EUR org →
hosted checkout priced **€4.32/mo EUR**; `subscriptions.billing_currency='EUR'`
snapshot stored; dev sub restored to free afterwards. `FREE_RESET_FIELDS` +
self-serve free switch clear the snapshot. Pricing endpoint now displays the
resolved charge currency (falls back to USD base when no geo entry matches).

## 06 · T11 — Billing attempt logging + admin follow-up panel (0038)

**Problem:** failed/abandoned checkouts are invisible; no admin follow-up tooling.
**Approach:** `billing_attempts` table (0038): org/user/email snapshot, plan, cycle,
currency, status `created→redirected→completed|failed|abandoned`, Dodo ids,
`provider_error_message`, `webhook_error_details` jsonb, admin `follow_up_status`
(`none|contacted|resolved|paid_later`) + `follow_up_notes`, timestamps + indexes.
Non-fatal logger `api/_lib/billing-attempts.ts` (audit pattern — never breaks the
money path). Logging points: create-subscription (created → redirected w/
`attempt_id` in Dodo metadata; failed w/ error in catch), webhook
payment.failed/succeeded + subscription.active (linked via metadata.attempt_id →
dodo_subscription_id fallback), sync reconcile completion, stale `created/redirected`
rows older than 24h surfaced as abandoned. Admin: `/admin/billing-attempts` page +
routes (GET list w/ filters status/plan/date/search + funnel counts; PATCH follow-up
fields, admin-write gated).
**Verify:** unit test status transitions; Playwright admin page renders, filters
work, notes editable.
**Status:** ✅ — transition guard + effective-status (stale→abandoned, derived at
read time, no mutation job) locked by 8 unit tests. LIVE-verified: a real
test-mode checkout click logged created→redirected (EUR, Dodo sub id captured);
/admin/billing-attempts shows the row with funnel chips; follow-up set to
"contacted" + notes saved with an in-place row update. ⚠️ The payment.failed
webhook path can't be reproduced locally (Dodo can't reach localhost) — its
linking precedence (metadata.attempt_id → dodo sub id → org) and transition
guards are unit-covered instead. Admin UI is English-only by convention.

## 07 · T3 — Recurring payments (0039)

**Problem:** no recurring income/expense automation.
**Approach:** `recurring_rules` (0039): org, nullable `client_id` (business: own
company or any client; personal: anchor client), name, type incoming/outgoing,
amount, `frequency_unit day|week|month|year` + `interval`, `start_date`,
nullable `end_date`, nullable `wealth_account_id` (cash/bank source), `next_due_at`
cursor, `active`. `transactions.recurring_rule_id` + `recurring_due_date` + partial
unique index for idempotency. Pure date math in `src/lib/recurring.ts` (month-end
clamping, catch-up occurrence expansion, capped at 60) — unit-tested first.
Materializer `api/_lib/recurring-materialize.ts`: expand due occurrences → quota
check → insert with `onConflictDoNothing().returning()` → apply `balanceDelta`
**only for inserted rows** → advance `next_due_at` (GREATEST guard). Triggered
lazily org-wide from the transactions GET + wealth accounts GET (cheap
short-circuit when no rule is due) so balances are correct before any list renders.
UI: `/recurring` page (personal: simple list; business: Own company / Clients
sections), create/edit/pause/delete sheet, next-due preview, `Repeat` icon on
materialized transactions in lists + detail modal.
**Verify:** vitest for date math + materializer idempotency (the money path);
Playwright — create a backdated rule, transactions + balances materialize once,
icon shows; re-open app → no duplicates.
**Status:** ✅ — date math locked by 13 unit tests (month-end clamp from the
anchor, leap years, catch-up cap + cursor resume). Materializer DB-verified with
a throwaway script (deleted before commit): two CONCURRENT runs raced and split
the inserts 2+2 with exactly 4 rows total + the balance moved exactly once;
repeat run was a no-op; cleanup restored everything. Browser-verified: backdated
weekly rule (start −14d) created 3 transactions exactly once, Cash moved
−3×€500, Repeat badges in the transactions list, reload → no duplicates, UI
delete works, list shows live next-due + 3-occurrence schedule preview. Trigger
is lazy (transactions + wealth GETs) — no cron needed; quota-blocked or
archived-account rules pause with a visible warning instead of corrupting data.

## 08 · T7 — Calendar visualization

**Problem:** no calendar view of money activity.
**Approach:** `GET /api/calendar?from&to` returns per-day
`{date, incoming, outgoing, count}` aggregates (org-scoped, excludes deleted +
transfers, mirrors analytics filters). `/calendar` page with Month / Week / Day
granularity: month grid (dots/intensity per day), week strip, day list; tapping a
period opens a modal (reused transaction rows) with an "Open in Transactions"
expander deep-linking `/transactions?from=…&to=…` (TransactionsPage reads URL date
params — added). Nav entry for both desktop sidebar + mobile More menu.
Mobile-first 44px cells; reduced-motion safe.
**Verify:** Playwright — month renders sums matching seeded data; tap day → modal
lists the day's transactions; expand navigates with filters applied.
**Status:** ✅ — browser-verified at desktop + 390px: month grid with activity
dots (intensity scaled to the busiest day) + today ring; day modal listed
exactly the day's 3 transactions (matched against the DB); "Open in
Transactions" landed on /transactions?from&to pre-filtered (3 total, recomputed
summaries). Month/Week/Day tabs; week strip with per-day totals; period summary
cards tap straight into the period's transactions. Found+fixed during verify:
the transactions `?limit=` (no page) endpoint returns a bare array, not {data}.

## 09 · T12 — Custom dashboard builder (0040)

**Problem:** fixed dashboard; users can't arrange/hide/add cards.
**Approach:** card registry (`src/lib/dashboard-cards.ts`) with stable ids for the
existing sections (kpis, budget, wealth, chart, breakdown, latest…); layout state
`{version, contexts: {personal, business}}` on `user_profiles.dashboard_layout`
(0040) with localStorage fast-path; edit mode via Customize button (desktop) and
press-and-hold on a card (mobile, 500ms with move-cancel); dnd-kit reorder (already
in repo via WealthPage pattern) + hide (×) + Add-cards panel for hidden ones;
in-memory undo/redo stack; sticky Save/Cancel bar (Cancel = revert, confirmation
when dirty); respects `prefers-reduced-motion`.
**Verify:** Playwright — reorder + hide + save persists across reload; cancel
reverts; undo/redo steps correctly; press-and-hold enters edit mode on mobile width.
**Status:** ✅ — browser-verified end-to-end: Customize button → edit mode (6
handle pills + hide buttons + sticky toolbar); hid the budget card (chip
appeared in the add-back row); stepped pointer drag moved kpis below wealth;
undo restored, redo re-applied; Save persisted to the DB + localStorage and the
order survived a full reload; 500ms touch-hold on a card entered edit mode at
390px; Cancel with unsaved changes raised the discard confirmation. Layout is
stored per account type (personal/business contexts) and normalized against the
registry on read (unknown ids drop, new cards append) — 7 unit tests. Dev
user's layout restored to defaults after testing.

## 10 · T4 — E2E tests + GitHub Actions gate for main

**Problem:** no end-to-end coverage; regressions can merge to main unseen.
**Approach:** Playwright (`@playwright/test`) + `e2e/` smoke suite against a
production build served with the local API middleware (same dispatch path as
`api/index.ts`, no Vercel needed): sign-in via Clerk test email
(`+clerk_test` / code 424242), onboarding, dashboard renders, create client,
create transaction (wealth balance asserts), trash restore, calendar, recurring,
subscription page. Serial workers, retry ×2, trace/screenshot artifacts on failure.
Workflow `.github/workflows/e2e.yml`: `pull_request → main` (the merge gate) +
`workflow_dispatch` (runnable on dev or any branch) — NOT on every dev push (cost +
shared dev DB hygiene). Secrets documented in the workflow header
(CLERK keys + `E2E_DATABASE_URL` — a dedicated Neon branch, never prod). Test data
namespaced (`e2e-…`) + cleaned in teardown.
**Verify:** suite green locally twice consecutively (flake check) before push.
**Status:** ✅ — 10 tests green twice consecutively (~28s/run): programmatic
Clerk auth (the UI flow is blocked by bot protection BY DESIGN — uses
@clerk/testing tokens + password and the email_code SECOND factor with the
fixed 424242 test code; user auto-provisioned via the Backend API; onboarding
completed through the same API the wizard calls), dashboard/wealth/calendar/
recurring/subscription smoke, client + transaction creation through the real
dialogs, mobile (Pixel 7/Chromium) shell, and a cleanup spec that purges the
namespaced data. ⚠️ The GitHub Actions run itself can't be verified until the
branch reaches GitHub and the three secrets exist (E2E_VITE_CLERK_PUBLISHABLE_KEY,
E2E_CLERK_SECRET_KEY, E2E_DATABASE_URL — use a DEDICATED Neon branch). The
workflow gates PRs → main + workflow_dispatch; deliberately NOT on dev pushes.

## 11 · T5 — Security check protocols

**Problem:** no secret scanning, dependency audit, or SAST anywhere in the gate.
**Approach:** layered. Pre-commit (fast, no network): staged-diff secret scan
script (`scripts/secret-scan.mjs`, ~20 high-confidence patterns: live API keys,
webhook secrets, connection strings with credentials, PEM blocks) wired before
i18n in `.husky/pre-commit`; uses gitleaks automatically when installed. CI
(`.github/workflows/security.yml`): gitleaks-action (full scan), `npm audit
--audit-level=high --omit=dev` (non-flaky config), plus repo-specific greps
(no raw-HTML injection outside vendored ui/, every `_routes` handler calls
`requireAuth`/admin guard). `SECURITY.md` documents the model. Keep pr.yml in sync
per CLAUDE.md rule.
**Verify:** seeded fake secret blocks commit; CI workflow passes on clean tree.
**Status:** ✅ — staged fake `sk_live_…` BLOCKED the commit (verified); scanner
patterns locked by 15 unit tests (placeholders like `whsec_...` stay quiet);
route-guard sweep covers 70 handlers + confines raw-HTML to vendored ui/.
The first full-tree scan immediately caught a REAL pre-existing leak: an
accidentally committed scratch file (`Untitled-2`) containing a Clerk session
JWT — removed (short-lived token, low risk, treat as burned). The new
dependency audit also surfaced and FIXED real advisories: drizzle-orm
SQL-identifier injection (HIGH, → 0.45.2), vite dev-server path traversal,
postcss — npm audit (prod, high+) now exits 0; full unit suite + a complete
e2e run green on the bumped ORM. ⚠️ The CI workflow run itself is unverifiable
until pushed to GitHub.

## 12 · T6 — Deep security/perf/scale audit + fixes

**Approach:** multi-agent Workflow over the FINAL stacked code: lenses =
authz/tenant-isolation, injection/XSS/SSRF, webhook/billing abuse, cache coherency
(apiGet invalidation vs mutations), N+1 + missing indexes + payload weight,
serverless cold-start + connection pooling. Every finding adversarially verified
before fixing; only verified fixes land on this branch; the rest recorded in
`docs/finetuning4/AUDIT.md` with severity + rationale.
**Status:** ✅ — 6 lenses × adversarial verification (42 agents): 36 raw →
13 confirmed → 23 refuted. Fixed 8: recurring mutation org-scoping
(defense-in-depth), SVG excluded from the whole bank-logo pipeline (byte
sniffing + data-URL refusal, test-locked), webhook replay protection (±5 min
freshness, test-locked), 3 missing transactions indexes (migration 0041,
verified in pg_indexes), float-noise hardening on the balance UPDATE, ILIKE
wildcard escaping, 128KB inline-logo cap, logo-fetch timeout 4.5s→2.5s.
5 confirmed items deliberately NOT changed with recorded rationale (incl. the
"high" recurring-deletion claim — it's intended delete-is-final semantics).
212 unit tests + both security sweeps + full e2e suite green after the fixes.
Full report: docs/finetuning4/AUDIT.md.

## 13 · Docs + subscription skill

**Approach:** `docs/finetuning4/OVERVIEW.md` — plain-language explainer of
everything shipped (what, why, how to operate it, env vars, runbooks). Update
`.claude/skills/subscription-system` with: billing_currency resolution chain,
billing_attempts lifecycle + linking, admin panel, webhook event map (from live
docs), and the new e2e/security gates.
**Status:** ✅ — OVERVIEW.md written (12 feature explainers + env vars +
migrations 0035–0041 + runbooks); subscription-system skill extended (currency
chain incl. the India rule, attempts lifecycle/linking/non-fatal rules, webhook
freshness, gate notes); docs/billing/SUBSCRIPTIONS_AND_PAYMENTS.md gained a
pointer section. **Chain complete: 14/14 branches shipped.**

---

## Change log

- 2026-06-10 — research workflow (12 agents) + infra ground-truth read complete;
  corrections recorded; plan committed as chain root `feat/ux4-00-plan`.
- 2026-06-10 — 01 category delete: first-access-only seeding (kills default
  resurrection) + optimistic in-place add/rename/delete on CategoriesPage and
  CategoryPicker; browser-verified incl. reload persistence.
- 2026-06-10 — 02 bank logos: `logo_src` data URLs from stored bytes (mime
  sniffed, 15 unit tests) + bounded lazy heal on GET; browser-verified incl.
  dead-hotlink heal.
- 2026-06-10 — 03 bank quota + default: /api/wealth/quota + crown gating +
  upgrade dialog; is_default (migration 0035, partial unique index) with atomic
  clear-then-set flip; AccountSelector prefers the default. Browser-verified.
- 2026-06-10 — 04 org logo + avatar: migration 0036; EntityAvatar +
  fileToResizedDataUrl (≤256px webp) + server re-validation (magic-byte sniff,
  300KB cap); wired into OrgSwitcher, org cards/edit dialog, ProfilePage,
  both layout user menus. Browser-verified.
- 2026-06-10 — 05 dodo org currency: pure resolution chain (org → country/IN →
  omit, 10 tests) + create-time retry loop; migration 0037 snapshot column;
  pricing display aligned. LIVE test-mode checkout in EUR verified.
- 2026-06-10 — 06 billing attempts: migration 0038; non-fatal logger with
  transition guards (8 tests); logging at create/stub/webhook/sync; attempt_id
  in Dodo metadata; /admin/billing-attempts page with funnel + follow-up CRM.
  Live-verified end-to-end except webhook (unit-covered).
- 2026-06-10 — 07 recurring payments: migration 0039 (rules + tx marker cols +
  idempotency index); pure date math (13 tests) + race-proof materializer
  (DB-verified concurrently); /recurring page (personal + business), nav, tx
  badges, 58 i18n keys × 8 locales. Browser-verified end-to-end.
- 2026-06-10 — 08 calendar: /api/calendar per-day aggregates (range-capped,
  materializes recurring first); /calendar page with Month/Week/Day, drill-down
  modal + /transactions?from&to deep link (TransactionsPage now reads URL date
  params); 16 i18n keys × 8 locales. Browser-verified desktop + mobile.
- 2026-06-10 — 09 custom dashboard: migration 0040; card registry + normalized
  per-context layouts (7 tests); edit mode with dnd-kit reorder, hide/add-back,
  undo/redo, sticky save/cancel + discard confirm, mobile press-and-hold;
  18 i18n keys × 8 locales. Browser-verified end-to-end.
- 2026-06-10 — 10 e2e: Playwright suite (10 tests, green ×2) + @clerk/testing
  programmatic auth + e2e.yml PR-to-main gate (secrets documented in-file).
- 2026-06-10 — 11 security gate: staged secret scan in pre-commit (15 pattern
  tests; fake-secret block verified) + security.yml (tree scan, guard sweep,
  prod audit) + SECURITY.md. Caught + removed a real committed JWT scratch
  file; fixed drizzle-orm SQLi (HIGH) / vite / postcss advisories.
- 2026-06-11 — 12 audit: 42-agent audit+verify; 8 fixes applied (org-scoping,
  SVG exclusion, webhook replay window, indexes 0041, money-cast hardening,
  ILIKE escape, payload cap, timeout cut); 5 accepted with rationale;
  AUDIT.md written. All gates + e2e green.
- 2026-06-11 — 13 docs + skill: OVERVIEW.md (full plain-language explainer +
  runbooks), subscription-system skill extended, billing doc pointer added.
- 2026-06-11 — 14 calendar day figures (follow-up request): every active month
  cell shows revenue/expense/profit + count (desktop full breakdown, mobile
  net+count, full-value tooltip); Profit card added to the period summary
  (verified in − out matches); week rows gained the day's net. Browser-verified
  at 1280px + 390px; e2e suite green.
- 2026-06-11 — 15 dashboard edit UX (follow-up request): Customize button moved
  next to the "Dashboard" title (ghost icon, 6px gap, verified); edit-mode
  controls became a FIXED floating top-right cluster — rounded ✓ saves (spinner
  while saving), ✕ cancel, undo/redo beneath — replacing the sticky bottom bar;
  drag drop-targeting switched from a rect SNAPSHOT to live per-move reads so
  scrolling mid-drag (incl. dnd-kit edge autoscroll) keeps targeting correct —
  proven by scrolling the window 200px during a held drag and landing the card
  in the right slot; touch-action audit at 390px: zero scroll-blocking surfaces
  (only grip handles are touch-none). Browser-verified desktop + mobile.
- 2026-06-11 — 16 edit jiggle (follow-up request): iOS-home-screen wobble in
  arrange mode — `.dash-jiggle` utility in index.css (±0.3deg rotate + 1px bob,
  0.42s, compositor-only; per-card negative animation-delay so phases never
  sync; `prefers-reduced-motion` stops the wobble but keeps the state). The
  dragged card now FOLLOWS the pointer via dnd-kit's translate on the OUTER
  shell (jiggle lives on the inner wrapper — same property, different elements)
  at opacity-60 + shadow-2xl + scale-1.02, still wobbling. Verified: 6 cards
  staggered (0/−137/−274/−411ms), mid-drag transform tracked the pointer 175px,
  reduced-motion → animation none, document height delta 0 (no layout shift).
- 2026-06-11 — 17 post-save scroll fix (user-reported: "after save, dashboard
  not scrollable on mobile"). REPRODUCED with CDP touch emulation: sonner sets
  touch-action:none on toasts for swipe-dismiss, and the save toast spans ~92%
  of a phone's width exactly in the thumb's scroll zone — touches starting on
  it scrolled 0px for the toast's 4s life. Fixes: global `[data-sonner-toast]
  { touch-action: pan-y !important }` (page pans through toasts; horizontal
  swipe-dismiss intact), the layout-saved toast shortened to 2s, a 1.2s
  post-exit cool-down on hold-to-edit (a parked thumb can't bounce back into
  edit mode), and any scroll event cancels a pending hold. Verified: scroll
  through the toast 299px (was 0), immediate post-save hold does NOT re-enter,
  hold-to-edit works again after the cool-down.
  **ux4 chain complete — 18 branches, migrations 0035–0041, all pushed.**
