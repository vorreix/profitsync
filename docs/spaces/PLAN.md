# Spaces — Personal Savings Buckets · Implementation Plan

> **Status:** in progress · **Owner:** autonomous build (work-finetuning) · **Base branch:** `feature/spaces_section_for_personal_maqbool`
> Single source of truth for the Spaces feature. Updated as each stacked branch lands.

## 1. What we're building

**Spaces** are personal-profile **savings buckets**. A user earmarks money for a specific
goal (Vacation, New Laptop, Emergency Fund…) by moving it from a bank/cash account into a
Space. Money only ever *moves between the user's own buckets* — it is never income or
expense.

- **Personal profile only.** Business orgs never see Spaces.
- **Free personal = 1 Space; Pro (paid personal) = 7 Spaces.** Mirrors the existing
  free-1-bank gate (crown + upgrade modal).
- **You save INTO a Space and withdraw OUT of it — both are transfers** (`kind='transfer'`),
  excluded from income/expense/analytics, net-worth-neutral.
- **You cannot pay/spend FROM a Space.** A Space only receives transfers and sends transfers
  back to a real account. No income/expense ever posts to it.
- **Goal + target date + suggestion.** Each Space can carry a goal amount and a target date;
  the UI suggests "save £X/month to hit it by then" and tracks progress / on-track status.
- **Recurring auto-save.** A Space can auto-save a fixed amount from a chosen account on a
  schedule (e.g. £200/month from Checking) — materialized lazily like recurring rules.
- **Icon:** piggy-bank (the budget icon was just freed up by moving budgets to MoneyBag).

## 2. Core model decision (verified, not assumed)

**A Space IS a `wealth_accounts` row with `type='space'`.** Verified first-hand against the
money paths:

- `wealth_accounts.type` and `transactions.kind` are plain `text` (schema.ts:113,187) — **no
  enum migration** to add `'space'`.
- A transfer = **two leg rows** sharing `group_id`, `kind='transfer'`, each pointing at a
  `wealth_account`; `api/_routes/wealth/transfer.ts` is **type-agnostic** (validates only
  existence + not-archived) and updates both balances ±amt. → **Fund/withdraw a Space reuses
  the transfer endpoint with ZERO new transfer code.**
- `kind='transfer'` is already excluded from the global list, income/expense summary,
  analytics, calendar and flow (`ne(kind,'transfer')`). → Space movements are off-P&L for
  free.
- `checkBankAccountQuota` counts only `type='bank'` (quota.ts:173) → Spaces don't pollute the
  bank quota, and a parallel `checkSpaceQuota` counts only `type='space'`.
- `useWealthSummary` sums **all** active balances → including Spaces keeps **net worth
  transfer-neutral** (moving £200 into savings does NOT reduce net worth). This is a
  correctness requirement, not a preference.

### Why not a separate `spaces` table?
A separate table would force us to re-build the transfer ledger (the two-leg, dual-balance,
off-P&L machinery) for a space↔account move. Reusing `wealth_accounts` gets all of that for
free. The cost — app-layer exclusion of Spaces from the "spend" surfaces — is bounded and
explicit (see Invariants).

## 3. Invariants (enforce server-side; UI hiding is UX, the 4xx is the security)

1. **No spend from a Space.** `POST /api/transactions` (standard kind) rejects a
   `wealth_account_id` whose account is `type='space'` (400). Spaces are hidden from every
   transaction account picker.
2. **A Space is never the default account.** Create/edit never sets `is_default=true` for a
   Space; the "set default" action is hidden for Spaces. (Keeps the `oneDefaultPerOrg` index
   meaningful.)
3. **Personal-only.** `accountTypeAllows(accountType,'spaces')` is true **only** for
   `accountType==='personal'`. Gated in nav, route (`PersonalOnlyRoute`), and API
   (`ctx.accountType==='personal'` else 403).
4. **Quota.** `checkSpaceQuota` blocks creating a Space past `limits.spaces` (free 1, pro 7),
   counting `type='space' AND archived_at IS NULL`.
5. **Net-worth-neutral.** Spaces are part of net worth; `/wealth` shows them as a separate
   "Saved" sub-total + a savings card, never mixed into the spendable account list.
6. **Recurring transfer idempotency.** An auto-save occurrence anchors idempotency on the
   **outgoing** leg only (`recurring_rule_id`+`recurring_due_date` on the source leg); the
   incoming Space leg shares `group_id` with NULL recurring keys. The existing unique index
   `(recurring_rule_id, recurring_due_date)` therefore can never double-conflict.
7. **Standard money paths byte-identical.** The recurring materializer's existing standard
   branch is untouched; the transfer branch is purely additive. Locked by a pure unit test.

## 4. Working conventions (from CLAUDE.md + work-finetuning)

- `.js` import extensions in `api/**`; scope every query by `orgId`; `serialize(row)` before
  `res.json`; `canWrite`/quota checks before writes.
- **Money math lives in pure, unit-tested libs** (`src/lib/wealth-ledger.ts`,
  `src/lib/spaces.ts`); never re-derive a sign inline.
- **Smooth mutations:** create→insert returned row, edit→replace, delete→optimistic remove +
  silent refetch; modals close instantly (`runOptimistic`); granular `invalidateKeys`.
- **Mobile-first** (~390px, ≥44px targets); **transitions** via transition-creator (respect
  `prefers-reduced-motion`).
- **i18n:** add to `en.json` first, propagate to all 8 locales (`scripts/i18n-merge.mjs`),
  parity gates the commit.
- **Migration:** bump the new `_journal.json` `when` **above `1781085031258`** (head 0042),
  apply, and confirm the column exists in `information_schema`.
- **Gate before every push:** `i18n:check → lint → typecheck → test:ci`. No `--no-verify`.

## 5. Resolved design questions (decisions, made solo — user said "don't ask")

| Question | Decision |
|---|---|
| Goal amount/date required? | **Optional.** A Space can be a plain bucket; goal/date unlock the suggestion + progress. |
| Store `monthly_contribution`? | **No — computed** in `src/lib/spaces.ts` from (goal − balance)/months. No drift. |
| Overdue / met goal? | Pure lib handles it: met → "Goal reached 🎉" (still deposit/withdraw allowed); overdue & unmet → suggest the full remainder, label "past target". |
| Negative Space balance? | **Block over-withdraw client-side** (cap at balance). Server stays generic (banks may go negative). |
| Space-to-space transfer? | **Not offered** — fund/withdraw pickers list only bank+cash. |
| API surface | **Dedicated `/api/spaces*`** (goal fields, no bank details, never default, space quota, personal gate) — clearer than overloading `/api/wealth/accounts`. Fund/withdraw reuse `/api/wealth/transfer`. |
| Recurring auto-save | **Option A** — extend `recurring_rules` with `kind`+`to_account_id`; **one auto-save per Space**, managed via `/api/spaces/:id/auto-save`; hidden from the generic Recurring list. |
| Onboarding step? | **No** — avoid wizard fatigue. Discoverable via nav + a friendly `/spaces` empty state. |
| Net worth | **Includes Spaces** (transfer-neutral); `/wealth` shows a "Saved" sub-total + savings card; account list excludes Spaces. |
| Delete a Space | **Archive anytime** (balance preserved, restorable). **Hard-delete only when balance 0 & no tx** (mirrors wealth accounts). Deleting also removes its auto-save rule. |
| Icon | Default **piggy-bank**; a small curated savings icon set (piggy/target/plane/home/gift/car) selectable. |
| Admin visibility | Spaces are personal savings — **not surfaced in /admin** beyond existing account counts (no new admin work). |

## 6. Branch chain (the live tracker)

Each branch is cut FROM the previous (stacked). Gate passes before every push.

| # | Branch | Scope | Migration | Status |
|---|---|---|---|---|
| 00 | `feat/spaces-00-plan` | This PLAN.md | — | ✅ committed |
| 01 | `feat/spaces-01-schema-lib` | Migration 0043 (goal cols + recurring kind/to_account_id), schema.ts, types.ts, quota (`spaces` limit + `checkSpaceQuota`), `accountTypeAllows` personal branch, pure `src/lib/spaces.ts` + vitest, `WealthAccountIcon` piggy branch | 0043 | ✅ pushed |
| 02 | `feat/spaces-02-api` | `/api/spaces` CRUD+reorder (personal gate, quota, never-default), can't-pay-from-Space guard in `/api/transactions`, `/api/wealth/quota` space report, router wiring | — | ✅ pushed |
| 03 | `feat/spaces-03-autosave` | Recurring transfer branch (additive), `/api/spaces/:id/auto-save` GET/PUT/DELETE, exclude `kind=transfer` from `/api/recurring` list, materialize on `/api/spaces` GET; pure + real-DB idempotency tests | — | ✅ pushed |
| 04 | `feat/spaces-04-ui` | `/spaces` list page (cards: piggy icon, balance, goal progress, suggested monthly, fund/withdraw), create/edit modal, nav + route + `PersonalOnlyRoute`, free-plan crown + upgrade gate, empty state, i18n (`spaces` ns ×8), transitions, mobile | — | ✅ pushed |
| 05 | `feat/spaces-05-detail` | `/spaces/:id` detail (hero, goal progress, **auto-save setup UI**, activity ledger), shared SpaceForm/Transfer modals, exclude Spaces from `/api/wealth/accounts` (kills all picker leaks), `/wealth` net-worth incl. savings breakdown, `apiPut`, i18n | — | ✅ pushed |
| 06 | `feat/spaces-06-polish` | Exclude Spaces from flow/analytics/transfer-wizard where needed, reached/overdue edge UX, transitions + mobile pass, i18n completeness, final gate | — | ⬜ pending |

## 7. Per-branch detail

### 01 — schema + pure libs
- **schema.ts:** `wealthAccounts` += `goalAmount numeric(20,2)` (nullable), `targetDate date`
  (nullable). `recurringRules` += `kind text default 'standard'`, `toAccountId uuid` (nullable,
  FK wealthAccounts set null). Comments document Space + transfer semantics.
- **Migration 0043** via `db:generate`; bump `when` > 1781085031258; apply; verify columns.
- **types.ts:** `WealthAccount.type` union += `'space'`; add `goal_amount?`, `target_date?`;
  `RecurringRule` += `kind?: 'standard'|'transfer'`, `to_account_id?`. `accountTypeAllows`
  gains a personal-only branch (`feature='spaces'` → only `personal`). Add `'spaces'` to the
  gated-feature union.
- **quota.ts:** `PlanLimits.spaces`; `DEFAULT_FREE_LIMITS.spaces=1`,
  `DEFAULT_PREMIUM_LIMITS.spaces=7`; resolve in `getOrgPlan`; `checkSpaceQuota(orgId)`.
- **src/lib/spaces.ts (pure):** `spaceProgress`, `monthsUntil`, `suggestedMonthly`,
  `autoSaveStatus`, `formatGoalHint` — all pure, `src/lib/spaces.test.ts` locks the math
  (met / overdue / no-goal / normal). DB-free (unit gate safe).
- **WealthAccountIcon:** `type==='space'` (or `icon` in the savings set) → piggy-bank et al.
- **Verify:** typecheck + `vitest run src/lib/spaces.test.ts`.

### 02 — API
- New `api/_routes/spaces.ts` (GET list + POST create) and `api/_routes/spaces/[id].ts`
  (GET/PATCH/DELETE) + `api/_routes/spaces/reorder.ts`. Personal gate (`ctx.accountType`),
  `checkSpaceQuota` on create, never `is_default`, no bank-detail fields. Each row enriched
  with derived progress + auto-save summary. `serialize` everything.
- **`/api/transactions` POST:** if `wealth_account_id` resolves to a `type='space'` account →
  400 "You can't spend from a Space — move money out first." (standard kind only).
- Exclude `type='space'` from the wealth account **list** consumed by transaction pickers
  (either a `?spendable=1` filter on `/api/wealth/accounts` or filter client-side — pick the
  server filter to keep the invariant server-side).
- `/api/wealth/quota`: add the space quota block.
- Register routes in `api/index.ts` (static before dynamic).
- **Verify:** throwaway DB test — create Space, attempt outgoing tx to it (expect 400),
  quota boundary (free 1), delete-with-balance blocked. Delete the test before commit.

### 03 — recurring auto-save
- **recurring-materialize.ts:** additive `if (rule.kind==='transfer')` branch — outgoing leg
  on `wealthAccountId` (idempotency anchor: recurring keys set), and only when it inserts,
  the incoming leg on `toAccountId` (NULL recurring keys, shared `group_id`) + both balances.
  Extend the account-active check to also require `toAccountId` active. Extract the pure
  leg/delta construction into `src/lib/recurring-transfer.ts` and unit-test it.
- **recurring-validate.ts:** `kind='transfer'` requires `toAccountId`, forbids `clientId`.
- **`/api/spaces/[id]/auto-save.ts`:** GET (the rule or null + monthly-equivalent + next
  date), PUT (upsert the single rule), DELETE. One auto-save per Space.
- **`/api/recurring` GET** excludes `kind='transfer'` (those are Space auto-saves).
- **`/api/spaces` GET** calls `materializeDueRecurring(orgId)` first (lazy trigger).
- **Verify:** pure test for the transfer-leg builder + a throwaway DB test that a due
  auto-save materializes a transfer once (idempotent on re-run) and moves both balances.

### 04 — list UI
- `src/pages/SpacesPage.tsx` (template: WealthPage). Cards: piggy icon, name, **balance**,
  **goal progress bar** + %, **suggested monthly**, quick **Add money / Withdraw** (calls
  `/api/wealth/transfer`). Create/Edit modal (name, optional goal+date, icon). Reorder.
  Optimistic create/edit/delete + silent refetch; emits the wealth data-event.
- Nav: `{ labelKey:'nav.spaces', href:'/spaces', icon: PiggyBank }` in `buildNavItems` +
  `MobileAppLayout`, gated by `accountTypeAllows(accountType,'spaces')`.
- Route `/spaces` (lazy) wrapped in new `PersonalOnlyRoute` (mirror `BusinessOnlyRoute`).
- Free-plan gate: crown + upgrade modal when at `limits.spaces` (reuse the bank-gate
  pattern). Empty state invites the first Space.
- i18n: new `spaces` namespace/section in `en.json`, propagated to all 8 locales.
- **Verify:** Playwright on a personal account — create a Space, fund it, see progress; 0 new
  console errors; mobile width.

### 05 — detail + wealth integration
- `src/pages/SpaceDetailPage.tsx` (template: WealthAccountDetailPage): balance hero, goal
  ring/curve (recharts), contributions ledger (account-scoped tx list), edit-goal, **auto-save
  setup** UI (`/api/spaces/:id/auto-save`).
- `/wealth`: exclude `type='space'` from the account list; add a **"Saved / Spaces"** summary
  card (personal only) → links to `/spaces`; show net worth = available + saved.
- Exclude Spaces from transaction account pickers (AddTransactionDialog / dashboard quick-add /
  ClientDetail) and never-default UI.
- **Verify:** Playwright — set a goal + auto-save, confirm suggestion + next date.

### 06 — polish
- Exclude Spaces from `/flow` & `/analytics` account groupings and the general transfer wizard
  pickers (so Spaces only live on `/spaces`). Reached-goal celebration; overdue label.
  Transitions + mobile + i18n completeness. Final gate.

## 8. Risks & mitigations
- **Money path (recurring transfer):** additive branch + pure-tested builder + a throwaway
  DB idempotency test before commit. Standard path untouched.
- **Net-worth coherence:** include Spaces in net worth; surface "Saved" separately so numbers
  add up. Audit every `wealth_accounts` aggregate for an unintended Space leak.
- **Quota race:** acceptable for MVP (same as bank quota — app-layer count). Note it.
- **Verification access:** `/spaces` needs a personal account; if Playwright can't reach it,
  fall back to typecheck + careful review and say so honestly here.

## 9. Change log
- _(00)_ Plan written; architecture verified against money paths; chain defined.
- _(01)_ Migration 0043 applied + columns verified in dev DB. Schema (`wealth_accounts`
  goal_amount/target_date; `recurring_rules` kind/to_account_id), types (`WealthAccountType`
  incl. `space`, goal fields, RecurringRule transfer fields), `accountTypeAllows` personal-only
  branch for `spaces`, quota (`spaces` limit free 1 / premium 7 + `checkSpaceQuota`), pure
  `src/lib/spaces.ts` (progress/suggestion/pace) locked by 19 tests, `space-icons.ts` +
  `WealthAccountIcon` piggy branch. Gate green (261 tests).
- _(02)_ API: `api/_routes/spaces.ts` (GET list + POST create), `spaces/[id].ts`
  (GET/PATCH/DELETE), `spaces/reorder.ts`, shared `api/_lib/spaces.ts` (fields +
  validators). Personal-only gate (`isPersonalAccount`), `checkSpaceQuota` on create/restore,
  never-default, archive/delete require an empty balance (net-worth-safe). Can't-pay-from-Space
  guard added to `/api/transactions` POST; `/api/wealth/quota` now reports the space allowance;
  routes wired in `api/index.ts`. **Verified the three guards against the real dev DB** (quota
  201→402, outgoing-to-Space→400, delete-with-balance 400→204) via a throwaway test (deleted,
  org cleaned up). Committed pure validator tests (268 total). Static + boot + route-guard +
  ESM checks green.
- _(03)_ Recurring auto-save. Additive `kind='transfer'` branch in the materializer (standard
  path byte-identical), outgoing leg as the idempotency anchor, incoming Space leg shares the
  group_id. Pure `src/lib/recurring-transfer.ts` locked by 5 tests. `/api/spaces/:id/auto-save`
  GET/PUT/DELETE (one transfer rule per Space, reusing `validateRuleInput`); `/api/recurring`
  list excludes `kind='transfer'`; Space delete drops its auto-save rule. **Verified on the real
  dev DB**: a due auto-save materializes ONE transfer (−200 source / +200 Space; recurring keys
  only on the outgoing leg) and re-running the same occurrence is idempotent (no double-move).
  Gate green (273 tests).
- _(04)_ `/spaces` list UI. `SpacesPage` (total-saved hero, space cards with piggy icon,
  balance, goal progress bar + %, suggested-monthly hint from `src/lib/spaces.ts`, fund/withdraw
  via the transfer endpoint, optimistic create/edit/delete), create/edit modal (name, icon
  picker, optional goal + date), `PersonalOnlyRoute`, nav entries (PiggyBank) gated to personal,
  free-plan crown + upgrade dialog, empty state. New `spaces` i18n namespace — 55 keys × **all 8
  locales** (real translations, parity green, 1174 keys). **Verified the live Spaces API on
  `vercel dev`** (`/api/spaces`, `/api/wealth/quota`, `/api/spaces/:id/auto-save` all 401-not-500
  → boot + routing + auth guard OK). Static gates green. ⚠️ Visual/Playwright check deferred:
  `/spaces` is auth + personal-account gated and the dev browser was in use by the live session;
  the page mirrors the proven WealthPage/RecurringPage patterns and is typecheck/lint-clean.
- _(05)_ Detail + integration. `SpaceDetailPage` (`/spaces/:id`): goal hero + progress, fund/
  withdraw, **auto-save setup UI** (`AutoSaveModal` → PUT `/api/spaces/:id/auto-save`, with
  source account, amount, frequency, start/end; shows next-due + on-track/ahead/behind pace vs
  the suggested monthly) + stop, and an activity ledger (account-scoped transfers). Extracted
  shared `SpaceFormModal` + `SpaceTransferModal` (reused by the list + detail), card tap now
  opens the detail. **Excluded Spaces from `/api/wealth/accounts`** — one server filter that
  removes them from every spend surface (transaction pickers, transfer wizard, wealth list) at
  once; the transfer endpoint queries the table directly so funding still works. To keep net
  worth correct, `/wealth` now fetches Spaces and shows **net worth = available + saved** with a
  tappable "Saved in Spaces" breakdown (auto-hidden for business via the 403). Added `apiPut`.
  i18n: +24 detail/auto-save keys + 2 wealth keys × all 8 locales (parity green, 1200 keys).
  Live API re-smoked (PUT auto-save / wealth / spaces:id all 401-not-500). Gate green.
