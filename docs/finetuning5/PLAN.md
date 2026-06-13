# Fine-tuning Wave 5 — Full-app QA pass (qa5)

**Brief:** walk every page and modal (desktop + mobile); verify business logic and data
accuracy; modals must survive outside-click close with their draft intact, remember
last-used choices (type / account / category), and always default dates to *today*
(fresh per open); after any DB mutation every visible number (wealth balances, summaries,
calendar/flow/budget aggregates) must update **in place** — no full-screen reloads.
Test → fix → re-test until clean. One stacked branch per task, each pushed.

**Method:** 13-agent read-only audit (one per page/area) → 14-agent adversarial
verification (one skeptic per finding) → hand re-derivation of every money-path claim →
live Playwright confirmation of the headline scenarios → fixes in a stacked chain, each
gated by `i18n:check → lint → typecheck → test:ci` and re-verified in the browser.

## Working conventions

- Mobile-first (~390 px first, ≥44 px touch targets); both widths verified per change.
- All DB scoping by `orgId`; `serialize()` on every API row; role + quota checks before writes.
- Wealth sign math only via `src/lib/wealth-ledger.ts` — never re-derived inline.
- Mutations update lists **in place** (optimistic or silent refetch — no skeleton flash).
- Draft policy (new, this wave): a modal closed by outside-click / Esc / Back keeps its
  draft for the next open; **Cancel** and **successful save** reset it. Sticky defaults
  (type/account/category) seed only a *fresh* form, never a kept draft. Dates seed today.
- No `--no-verify` commits; every branch passes the full gate before push.

## Branch chain (live tracker)

| # | Branch | Task | Status |
|---|--------|------|--------|
| 00 | `feat/qa5-00-plan` | This plan | ✅ pushed |
| 01 | `feat/qa5-01-calendar-scope` | Calendar API: exclude trashed + closed clients (match flow/analytics/transactions) | ✅ pushed |
| 02 | `feat/qa5-02-bulk-delete-balances` | Client bulk-delete: reverse wealth balances + co-trash transactions (mirror single delete) | ✅ pushed |
| 03 | `feat/qa5-03-saving-rearm` | Freeze-class: re-arm `saving` on open in AccountQuickAddSheet + RecurringPage | ✅ pushed |
| 04 | `feat/qa5-04-stale-dates` | Stale-date class: ClientDetailPage tx form + ClientsPage onboard date fresh per open | ✅ pushed |
| 05 | `feat/qa5-05-data-refresh` | Central mutation→refresh signal: every page's aggregates update in place after any mutation | ✅ pushed |
| 06 | `feat/qa5-06-draft-persistence` | Draft-persistence + sticky-defaults policy rolled out to every create modal | ✅ pushed |
| 07 | `feat/qa5-07-clientdetail-group-edit` | ClientDetailPage: group-aware transaction edit + silent in-place refresh | ✅ pushed |
| 08 | `feat/qa5-08-members-polish` | OrgMembersPage invite-role reset + in-place role change; ReferralPage payout-method reset | ✅ pushed |

## Verified findings (fix list)

### 01 — Calendar over-counts (data accuracy) — *confirmed by hand + verifier*
`api/_routes/calendar.ts:42-49` filters `transactions.deletedAt` but not
`clients.deletedAt` / `clients.closedAt`. Every sibling view (transactions list default,
`flow.ts:68-69`, `analytics.ts:35-37`) excludes both → the calendar shows different
totals than every other page once a client is closed or trashed.
**Fix:** add both `isNull` filters to the `and()`.

### 02 — Bulk client delete corrupts wealth accuracy (money path) — *confirmed by hand*
Single delete (`api/_routes/clients/[id].ts:92-124`) reverses each live transaction's
balance effect (`reversalsByAccount`) and co-stamps the transactions `deletedAt` so
trash-restore re-applies exactly that set. Bulk delete
(`api/_routes/clients/bulk-delete.ts:27-38`) only soft-deletes the client rows:
transactions stay live, balances stay applied, lists hide the rows (joins filter deleted
clients) → wealth totals disagree with every visible list, and restore-from-trash has
nothing to re-apply. **Fix:** per deleted client, mirror the single-delete logic
(reverse live tx balances, co-stamp tx with the same `deletedAt`).

### 03 — Saving-flag freeze class (same bug class as the fixed #184)
Dialogs stay mounted between opens; a `saving` flag left `true` (e.g. by a request
in flight when the user closed the sheet) freezes the primary button on every later open.
- `src/components/wealth/AccountQuickAddSheet.tsx` open-effect (77-94) re-arms everything
  **except** `saving` — confirmed missing `setSaving(false)`.
- `src/pages/RecurringPage.tsx` has **no** open-effect at all for the rule modal.
- ✅ Already correct (claims refuted): TransferWizard (`:84`), BudgetDialog (`:61`),
  AddTransactionDialog (`:71`).

### 04 — Stale-date class
- `src/pages/ClientDetailPage.tsx:41` — module-level `const defaultTxForm` captures the
  date at chunk load; reused at lines 66/166/413/517. Past midnight, new transactions
  default to yesterday. **Fix:** make it a function (like `tx-form-utils.ts:15`) + reseed
  date on dialog open.
- `src/pages/ClientsPage.tsx` add-client dialog — same pattern for `onboard_date`.
- ✅ Refuted elsewhere: QuickAddModal (`:64-72` effect reseeds), wealth sheets
  (`setDate(today())` in open-effects), QuotationsPage (every open path calls
  `setForm(defaultForm())` synchronously — latent only; covered by 06 anyway).

### 05 — In-place refresh gaps (the "numbers don't move" class)
The FAB quick-add bumps `DataRefreshProvider` but only Dashboard + Analytics subscribe;
`wealth:accounts-changed` is dispatched by wealth UI but **not** by transaction
mutations, and WealthPage itself never listens.
Confirmed stale-after-mutation surfaces: CalendarPage, MoneyFlowPage,
PersonalBudgetCard, BusinessBudgetCard (dashboard), WealthPage (when a tx is added via
FAB while open).
**Fix (central):** emit a `ps:data-changed` window event from `api.ts` on every
successful mutation (scope = mutated path); DataRefreshProvider listens (debounced) and
bumps `revision`; subscribe Calendar/Flow/budget cards (silent refetch); dispatch the
wealth event for balance-affecting paths so all existing account listeners update; make
WealthPage listen too. Pages that already self-manage in place keep doing so.
- ✅ Refuted: budgets pages refresh fine via `onSaved` callbacks; no fix there.

### 06 — Draft persistence + sticky defaults + reseed race (the user's #1 ask)
Live-confirmed on AddTransactionDialog: type Outgoing + €12.34 + description → outside
click → reopen → **everything wiped** (open-effect reseeds unconditionally,
`AddTransactionDialog.tsx:97-104`). Also confirmed: the reseed runs *after* three awaited
GETs, so for ~0.5-3 s the dialog shows the previous form then visibly swaps — and can
clobber what the user already started typing (race).
**Fix:** a shared draft-keeper (`src/lib/use-modal-draft.ts`): keep draft on
outside-click/Esc/Back; reset on success or explicit Cancel; seed sticky defaults +
today's date only when starting fresh; async data (accounts list) merges without
touching user-entered fields. Rolled out to: AddTransactionDialog, ClientDetailPage tx
dialog, QuickAddModal (client + quotation), QuotationsPage create, ClientsPage client
form, BudgetDialog, AccountQuickAddSheet, TransferWizard, RecurringPage rule form.
Sticky defaults (existing `last-tx.ts` pattern) extended to the recurring + wealth
quick-add forms.

### 07 — ClientDetailPage edit is split-blind (data integrity) — *confirmed by hand*
`ClientDetailPage.tsx:281-289` PATCHes a single row with `allocations[0]` even when the
row is one leg of a `group_id` split (seeded at :541/:793 with no group awareness) — can
flip the `type` of one leg, desync the group, and contradict the collapsed group row on
/transactions. TransactionsPage does it right (`:298-359`: loads legs, delete+recreate
for groups, PATCH for singles, attachments gated to single legs).
**Fix:** group-aware edit on ClientDetailPage using the same proven semantics; also make
its post-mutation `loadData()` silent (no full-page skeleton).

### 08 — Small confirmed polish
- OrgMembersPage: `inviteRole` never resets between opens; role change does a full
  `load()` instead of an in-place member update.
- ReferralPage: payout dialog resets amount/details but not `method`.

## Rejected claims (audited, verified NOT bugs — do not re-litigate)

- Wealth delete/restore sign math — correct, unit-tested (`wealth-ledger.test.ts`).
- Trash purge not reversing balances for already-trashed tx — correct (reversal happened
  at soft-delete).
- QuickAddModal stale dates — refuted (`:64-72` reseeds on entity change).
- TransferWizard / BudgetDialog frozen saving — refuted (both re-arm on open).
- Quotations create stale date — all open paths reseed synchronously (latent only).
- Budgets pages stale after save — refuted (`onSaved` refetch chain works).
- AddTransactionDialog pendingFiles leaking into next add — refuted (cleared
  synchronously in `onOpenChange` before close completes).
- Transactions summary cards ignoring the type tab — intentional (code comment); both
  totals always show.
- Type-toggle clearing category — intentional: categories are type-scoped lists.
- Mobile page-level overflow — swept all 10 app pages at 390 px: none (React Flow canvas
  pans internally by design).

## Verification log

- **Hands-on (Playwright, dev server :3000, personal free account):**
  - Add-transaction: 3 consecutive add cycles → all landed, balance math exact
    (€200 − 1 − 2 − 3 = €194) ✓; no freeze.
  - Draft wipe on outside-click reopen reproduced ✓ (the 06 bug).
  - Dashboard wealth card + KPIs update in place after FAB add ✓ (slow in dev, no reload).
  - Reopened dialog account balance eventually fresh (~2.8 s dev) with a visible stale
    flash → the 06 race.
  - Sticky type/account/category after a successful save ✓ (existing `last-tx.ts`).
  - 390 px sweep of all 10 app pages: no horizontal overflow.
- **Per-branch:** see change log below.

## Change log

- **2026-06-13** — all 8 branches landed + pushed (chain off `dev`, gate green on each):
  - `01` calendar excludes trashed/closed clients (verified: API returns correct aggregates).
  - `02` client bulk-delete reverses balances + co-trashes tx (verified end-to-end on dev DB:
    +100/−40 → bulk-delete → baseline → restore → +60 + both tx → purge neutral).
  - `03` AccountQuickAddSheet + RecurringPage re-arm `saving` on open (recurring dialog
    verified: 3 open/close cycles, Save never frozen).
  - `04` ClientDetailPage tx form + ClientsPage onboard date fresh per open.
  - `05` central `ps:data-changed` signal from `api.ts` → DataRefreshProvider revision +
    `wealth:accounts-changed`; Calendar/Flow/budget cards/WealthPage subscribed (verified
    live: FAB add updates /calendar day grid and /wealth balances in place, no reload).
  - `06` shared `useModalDraft`: dismiss keeps draft, Cancel/success clears (verified live on
    AddTransactionDialog, QuickAddModal, QuotationsPage create, AccountQuickAddSheet; sticky
    type still survives a successful save; AddTransactionDialog reseed-race fixed).
  - `07` ClientDetailPage group-aware edit (verified live: 2-leg split edited as one group,
    stayed single consistent group, balances exact, no orphans).
  - `08` OrgMembersPage invite reset + in-place role change; ReferralPage payout-method reset.
- Mobile sweep at 390 px after all changes: no horizontal overflow on any of
  transactions/wealth/recurring/calendar/quotations/budgets/dashboard.
- All Playwright test data cleaned from the e2e dev org (clients, tx, accounts, trash all clear).
- Deferred (honest): dashboard budget-card refresh wired via the same `revision` subscription
  proven on Calendar/Wealth but not separately screenshotted (needs a set budget + matching tx);
  `useModalDraft` is browser-verified, not unit-tested (would need a renderHook setup the
  DB-free unit gate doesn't currently have).
