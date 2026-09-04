# ProfitSync — Smart Hybrid Budgeting System

> **Status:** design pass · **rev 4** (financial-model, correctness & projection reviews applied) · **Implements:** nothing yet
> **Base:** `dev` @ `5e57fd36` · **Date:** 2026-09-02 · **Awaiting:** review (Fazil) + multicurrency contract (Maqbool)
> **Scope recommendation:** personal-first, one shared engine, business client caps preserved as a separate concept (§23)
>
> **rev 2 resolved ten financial-model blockers.** Materially changed: `Safe to spend`
> (§8.5), one-time commitments (§8.6), virtual sinking funds (§8.9), the period funding
> base (§8.4), section separation (§8.7), provisional refunds (§8.8), API versioning
> (§11.1), audited restatement (§8.11), the onboarding criterion (§21.1), and the reversal
> of D-3 on stale reads (§8.10). Model grew from 7 to **10 tables**.
>
> **rev 3 resolves four correctness blockers**, all inside the existing tables: plan-wide
> flexible headroom is **netted before flooring** (§8.5.1); **overdue** obligations stay
> reserved until explicitly resolved (§8.6.1); the funding base is **reconstructed at the
> true period boundary** so income cannot be double-counted (§8.4); and a virtual
> contribution is never claimed **funded** without confirmation or an explicit `auto_fund`
> opt-in (§8.9.1).
>
> **rev 4 corrects the occurrence projection window.** rev 3 claimed overdue obligations
> carry forward but projected only from `p.start`, so prior-period occurrences were never
> generated. The window now reaches back per commitment kind: a **one-time** obligation
> **never ages out**; only **recurring** commitments are bounded (365 days / 12 unresolved).
> "Counted exactly once" is now structural (§8.6, §8.6.1, D-17). See the change log.
>
> Single source of truth for Budget v2. On completion of Phase 1 this supersedes
> [`docs/budget/BUDGETS.md`](../budget/BUDGETS.md) and [`docs/budget-history/SPEC.md`](../budget-history/SPEC.md).
>
> **No application code, schema or migration has been written.** Every claim about the
> current system was verified by reading the repository, with `file:line` citations.

---

## 1. Executive summary

### 1.1 What we are replacing

Budget v1 is a **single spending ceiling**. A `budgets` row stores an `amount` and a
`period`; spend is `SUM(amount)` over `type='outgoing' AND kind='standard'` transactions
since the period start. That is the entire feature. There are no categories, no income
side, no rollover, no savings, no commitments, no pending state, and no separation
between "budget remaining" and "money you actually have".

One structural flaw underlies all the others, and no amount of patching fixes it:
**v1 answers the wrong question.** It says *"€340 left of your €1,000 target"* while
saying nothing about the €780 of rent and utilities due in nine days. The number it
displays is not spendable, and the user has no way to tell.

### 1.2 What we are building

A **Smart Hybrid** model on one engine with progressive disclosure. The object graph is
always the full model; a beginner simply has one envelope in it. Four load-bearing
decisions:

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Plan → Period → Envelope**, with periods *materialized*, *closable* and **restatable** | A closed period gets a frozen snapshot, and later changes to old transactions produce an **audited new version** rather than a silent rewrite or a permanent dual figure (defect #8, §8.11). |
| **D2** | **Savings reuse Spaces' *math*, not Spaces' *storage*** | A sinking fund is a `savings` envelope with a `funding_mode`: **`virtual`** (a reservation; no money moves; unlimited on every plan) or **`space_backed`** (real transfers into a Space). `src/lib/spaces.ts`'s goal/pace math is reused unchanged for both. A contribution is **reserved automatically but never called *funded* without confirmation** (§8.9, §8.9.1). |
| **D3** | **Commitments are first-class**, covering recurring **and one-time** obligations | `recurring_rules` cannot express "€400 to the dentist on 15 Oct, once". `budget_commitments` owns the definition and delegates *recurring schedules* to `recurring_rules` + `occurrencesDue`. Expectations are **projected occurrences** that never touch a bank balance, and an unpaid one stays outstanding after its due date (§8.6, §8.6.1). |
| **D4** | **Sections are computed separately**; utilisation is the **flexible section alone** | Income, bills, debt and savings are not commensurable with discretionary spending. Fixes debt misclassification (#3) and mixed-cadence aggregation (#4), and makes every figure attributable (§8.7). |
| **D5** | **`Safe to spend` is bounded by both cash and plan** | `min(cash after reservations, remaining flexible headroom)`, with an explicit `binding` reason and explicit handling of plans that set no ceiling (§8.5). |

Reusing the recurring **schedule** engine and the Spaces **goal math** — while owning the
storage where those primitives only partially fit — is why this is a ~7-week feature rather
than a ~6-month one.

### 1.3 The four numbers

The headline of the redesign: **"budget remaining" and "cash available" are different
numbers and will never again be conflated** — and `Safe to spend` respects *both*.

```
Available now    = Σ current_balance of the plan's included, non-archived bank+cash accounts
                   (Spaces are structurally excluded — that is what makes them savings)

Reserved         = unpaid commitment + debt occurrences with due_date before the horizon
                   ⚠ The PROJECTION WINDOW itself reaches back before the period start —
                     a filter alone cannot recover an occurrence that was never generated.
                     An OVERDUE obligation stays reserved until settled, cancelled, skipped
                     or rescheduled; time resolves nothing. A ONE-TIME obligation never ages
                     out; only RECURRING carry is bounded (365d / 12). Counted exactly once.
                 + VIRTUAL sinking-fund balances (CONFIRMED contributions only — the cash is
                     still in the bank, so it must be held back)
                 + contributions due before the horizon
                     (virtual: planned-but-unconfirmed · Space: untransferred)
                 + explicitly protected savings not yet funded
                   ⚠ a Space-backed fund's BALANCE is NOT reserved — it is already
                     outside Available now, and reserving it would subtract it twice

Safe to spend    = ceiling_defined
                     ? min( Available now − Reserved,
                            max(0, Σ flexible planned − Σ spent_net − Σ pending) )
                     : Available now − Reserved            // no ceiling set → cash-bound only
                   ⚠ the plan bound is NETTED ACROSS ENVELOPES, THEN floored once. Summing
                     max(0, remaining) per envelope would ignore an overspend in one
                     envelope: Groceries 300/400 + Dining 200/0 is 100 of capacity, not 200.
                   with binding ∈ { cash | plan | both | cash_only } returned to explain WHICH
                   limit applied. Unallocated is NEVER folded in — it is an opt-in top-up.

Forecast balance = Available now + expected remaining income − all remaining planned outflow
```

`Safe to spend` goes at the top of the screen. It is the only one of the four that answers
*"can I buy this?"* — and it now answers correctly in both failure directions: a user with
€5,000 in the bank who has spent out an €900 ceiling sees €20, not €5,000; a user with an
untouched ceiling but €120 of cash after bills sees €120, not €900.

The vocabulary already exists in the product: `WealthPage.tsx:412-425` renders a net-worth
hero that splits into an `availableLabel` figure (active bank+cash) and a `savedInSpaces`
figure. Budget v2 promotes that distinction from one page to the core model.

A fifth concept, deliberately not a headline number, makes the plan side stable: each period
carries a **funding base** — the period's capacity, **reconstructed at its true boundary** so
that income already sitting in `Available now` is never counted a second time. Spending never
changes it; only income after the anchor and explicit audited adjustments do (§8.4).

### 1.4 Verified defect disposition

All 15 reported defects reproduced. Three further defects were found that the brief did
not list (#16–#18). Full analysis in §2.4, disposition in §2.5.

- **10 are real bugs fixed by the new foundation** — #1 `is_system` leakage, #2 refunds, #3 debt, #4 mixed cadence, #5 UTC, #8 historical rewriting, #9 audit gaps, #15 the 100% boundary, #16 trashed-client budgets, #17 divergent derivation.
- **2 are live bugs to fix *before* v2 starts** — #6, #7 (alerting). Cheap, independently shippable.
- **3 become obsolete** — #11 template prefill, #12 lifetime retroactivity, #14 duplicated thresholds. The concepts disappear.
- **1 is a real performance defect needing deliberate design** — #13.
- **1 is blocked on multicurrency** — #10. Must not be guessed at (§12).

### 1.5 Honest dependency list

Three concepts the brief treats as available **do not exist in this repository**. Each was
checked exhaustively, not assumed.

| Concept | Status | Consequence |
|---|---|---|
| **Pending / cleared transactions** | **Absent.** `transactions` has no `status`, `pending`, `cleared`, `posted_at` or `is_forecast` column ([`schema.ts:222-280`](../../src/lib/db/schema.ts)); its only state flags are `kind`, `is_system`, `deleted_at`. A repo-wide search for pending/cleared/scheduled/planned/upcoming hits only billing, broadcast and notification code. The sole "future money" representation is `recurring_rules.next_due_at` plus a **client-side, never-persisted** 3-occurrence preview ([`RecurringPage.tsx:249-262`](../../src/pages/RecurringPage.tsx)). No aggregate anywhere reads `recurring_rules`. | v2 Phase 1 introduces its **own** expectation model — `budget_commitments` + projected occurrences (§8.6) — which covers recurring **and one-time** known obligations without touching the wealth ledger. What remains genuinely blocked is a **posted-but-unsettled** transaction (a cheque in flight, an unsettled card authorisation): that is a `transactions.status` change and a **prerequisite for credit cards** (§9.6). |
| **Credit cards / liability accounts** | **Absent.** `wealth_accounts.type` is `bank \| cash \| space` only ([`schema.ts:155`](../../src/lib/db/schema.ts)). No credit limit, statement date, due date, `is_liability` or `sign` column. The only "card" is a **cosmetic icon value** ([`icon-select.tsx:14`](../../src/components/wealth/icon-select.tsx)) with zero semantics. Negative balances are possible but merely incidental — the UI flags them red ([`Dashboard.tsx:540-547`](../../src/pages/Dashboard.tsx)) and the transfer wizard warns without blocking ([`TransferWizard.tsx:92,171`](../../src/components/wealth/TransferWizard.tsx)). | Credit-card semantics are specified in §9.5 as **blocked**, with the exact contract required. Attempting them now would double-count spend (purchase *and* bill payment). |
| **Multicurrency / FX** | **Not in this repository.** No branch (`git branch -r` has no currency/fx branch), **no open PR at all**, and no `exchange_rate` / `fx_rate` / `base_currency` / `reporting_currency` / `rate_source` identifier anywhere in `src`, `api`, `worker`, `drizzle`, `scripts` or `docs`. Currency is one per-org display string ([`schema.ts:14`](../../src/lib/db/schema.ts)) consumed via `useCurrency()`; all existing currency logic is **billing-only** ([`billing-currency.ts`](../../src/lib/billing-currency.ts), [`currencies.ts`](../../src/lib/currencies.ts)). | §12 defines the **contract Budget v2 needs** as questions for Maqbool, not an implementation. v2 must be built currency-*ready* and single-currency-*correct*. |

Two further partial dependencies:

- **Debt** — v2 gives debt payments their own section and stops them polluting flexible spending, but **principal / interest / fee splitting requires a debt-account model that does not exist** and is explicitly deferred (§9.7).
- **Expense↔refund settlement** — full and partial cross-period reimbursement needs an explicit link between two transactions. Phase 1 ships **provisional, disclosed, correctable** netting (§8.8); the `transaction_settlements` contract is specified in §10.11 for Phase 2, and its ownership is **decision D-12** (it is arguably a transactions-domain table that budgeting merely consumes).

> **A note on the multicurrency finding.** The brief states Maqbool is currently
> implementing multicurrency. That work is **not visible from this repository** — it is
> either local to his machine or not yet started. I have therefore written §12 as a
> contract and a question list rather than an integration, and I have deliberately *not*
> added any currency column to the proposed model beyond a single forward-compatible
> field (§10.7). This is the item most likely to invalidate part of this spec, and it
> must be resolved before Phase 2 begins.

---

## 2. Current-state findings

Every statement was verified by reading the cited file.

### 2.1 Storage

**`budgets`** — [`schema.ts:840-862`](../../src/lib/db/schema.ts), migration [`0033_perpetual_randall.sql`](../../drizzle/0033_perpetual_randall.sql).

| Column | Type | Note |
|---|---|---|
| `organization_id` | uuid NOT NULL | FK → `organizations`, cascade |
| `client_id` | uuid NULL | FK → `clients`, cascade. **Overloaded — see below** |
| `period` | text NOT NULL default `'monthly'` | Plain text, **no DB constraint** |
| `amount` | numeric(20,2) NOT NULL default `'0'` | |
| `created_by` / `updated_by` / `created_at` / `updated_at` | | |

Partial unique indexes `budgets_org_client_unique` (one per client) and
`budgets_org_default_unique` (one NULL-client row per org).

**`client_id IS NULL` means two different things**, keyed off `organizations.account_type`:

- **personal org** → *the* personal budget; spend = the whole workspace's outgoing
- **business org** → a **default template** for clients, with *no spend number at all*

This overload is the worst thing about the v1 schema. It forces `spent` to be
`number | null` throughout the stack ([`types.ts:303`](../../src/lib/types.ts)) and puts a
card on `/budgets` that looks like a budget but tracks nothing.

**`budget_history`** — [`schema.ts:869-880`](../../src/lib/db/schema.ts), migration
[`0034_parched_zuras.sql`](../../drizzle/0034_parched_zuras.sql). Append-only, keyed by
`(organization_id, client_id)` rather than FK to `budgets.id`, because "remove" *deletes*
the budget row and history must outlive it. Stores `amount` + `period` **after** the
change plus `action ∈ {set, raise, lower, period_change, remove}`.

**Neither table has a currency column.**

### 2.2 Calculation

Two functions in [`api/_lib/budget-spend.ts`](../../api/_lib/budget-spend.ts).

`outgoingByClient(orgId, now)` (`:13-48`) — one grouped query producing all four window
sums via `SUM(...) FILTER (WHERE date >= …)`:

```sql
WHERE clients.organization_id = $org
  AND clients.deleted_at      IS NULL
  AND transactions.deleted_at IS NULL
  AND transactions.type = 'outgoing'
  AND transactions.kind = 'standard'
GROUP BY transactions.client_id
```

`spendForWindows(orgId, clientId, windows)` (`:57-94`) — the same predicates bounded to
`[first.start, last.endExclusive)`, but it **fetches raw rows and buckets them in JS**
(`:85-92`) instead of aggregating in SQL.

Window math — [`src/lib/budget.ts:29-48`](../../src/lib/budget.ts), **entirely UTC**
(`getUTCFullYear` / `getUTCMonth` / `getUTCDate` / `getUTCDay`):

| Period | Lower bound |
|---|---|
| `daily` | today |
| `weekly` | **Monday** of this week (hardcoded) |
| `monthly` | the 1st |
| `lifetime` | `null` — no lower bound, all time |

Thresholds — `budgetState` (`:55-65`): `< 80%` ok, `>= 80%` warn, `> 100%` over.
**Exactly 100% is `warn`.** A zero budget with any spend yields `state='over'`,
`ratio = Infinity` (`:62`).

History/series — [`src/lib/budget-history.ts`](../../src/lib/budget-history.ts), a
deliberately **import-free** module (`:1-3`) so the unbundled Vercel functions, the Vite
client and Vitest consume it identically: `periodBoundaries` (`:42`), `budgetAmountAt`
(`:84`, the target in effect at a window's close), `buildSeries` (`:96`), `adherence`
(`:112`), `evolution` (`:129`), `detectCreep` (`:142`, flagged at
`raiseCount >= 2 && pct >= 20`). Lookback is fixed per cadence —
[`detail.ts:19`](../../api/_routes/budgets/detail.ts): `{lifetime:0, monthly:6, weekly:8, daily:14}`.

### 2.3 Surfaces

| Surface | File |
|---|---|
| `GET` / `POST` upsert (amount 0 = delete) | [`api/_routes/budgets.ts`](../../api/_routes/budgets.ts) |
| List + aggregate + creep | [`budgets/overview.ts`](../../api/_routes/budgets/overview.ts) |
| Timeline + series + adherence | [`budgets/detail.ts`](../../api/_routes/budgets/detail.ts) |
| Alerting | [`api/_lib/notify-budget.ts`](../../api/_lib/notify-budget.ts) |
| `/budgets` list · `/budgets/:key` detail | [`BudgetsPage.tsx`](../../src/pages/BudgetsPage.tsx) · [`BudgetDetailPage.tsx`](../../src/pages/BudgetDetailPage.tsx) |
| Progress bar · set/edit dialog | [`BudgetIndicator.tsx`](../../src/components/budget/BudgetIndicator.tsx) · [`BudgetDialog.tsx`](../../src/components/budget/BudgetDialog.tsx) |
| Dashboard cards | [`PersonalBudgetCard.tsx`](../../src/components/budget/PersonalBudgetCard.tsx) · [`BusinessBudgetCard.tsx`](../../src/components/budget/BusinessBudgetCard.tsx) |
| Client cards | [`client-views.tsx:69`](../../src/components/clients/client-views.tsx) |
| Live "after this expense" hint | [`tx-form.tsx:268-273`](../../src/components/transactions/tx-form.tsx) |
| Onboarding | [`MoneyWizard.tsx:165`](../../src/components/onboarding/MoneyWizard.tsx) |
| Route registration | [`api/index.ts:252-254`](../../api/index.ts) |

**There is no budget hook and no client-side service layer.** Six-plus components each
call `apiGet("/api/budgets")` in their own `useEffect` and build their own `Map`/`.find()`.
Coherence rests entirely on `apiGet`'s 30 s cache plus a blanket `clearApiCache()` on any
mutation.

**i18n surface** is small: `budget.*` (23 keys) + `budgetsPage.*` (27 keys) = **50 keys**
across 8 locales.

**Tests** — [`budget.test.ts`](../../src/lib/budget.test.ts) (13 cases),
[`budget-history.test.ts`](../../src/lib/budget-history.test.ts) (13),
[`notify-budget.test.ts`](../../api/_lib/notify-budget.test.ts) (4). **All pure-function.**
Zero coverage of `budget-spend.ts` (the actual SQL), the three routes, the notification
send path, or any component. No e2e budget spec.

### 2.4 Confirmed defects

| # | Defect | Verified at | Severity |
|---|---|---|---|
| 1 | **`is_system` rows consume budget.** A downward balance adjustment inserts `type='outgoing'`, `kind='standard'` (the default), `is_system=true` against the org's default client. `budget-spend.ts` filters `type` and `kind` but **not `is_system`** — so *zeroing an account registers as spending*. | insert [`wealth/accounts/[id].ts:122-141`](../../api/_routes/wealth/accounts/[id].ts); missing filter [`budget-spend.ts:27-34`](../../api/_lib/budget-spend.ts); intent proven by [`quota.ts:268-272`](../../api/_lib/quota.ts) which *does* filter `isSystem=false` | **High** |
| 2 | **Refunds never restore budget.** Spend is `SUM` over `type='outgoing'` only, so a €100 expense refunded €100 leaves €100 consumed. Budget spend is **gross outflow, never net**. | [`budget-spend.ts:32`](../../api/_lib/budget-spend.ts) | **High** |
| 3 | **Debt repayments are ordinary flexible spend.** No section concept exists; a loan payment is an `outgoing` row like any other. | schema — nothing beyond `kind ∈ {standard, transfer}` | **High** |
| 4 | **Mixed-cadence aggregate.** `overview.ts:82-83` sums `amount` and `spent` across all tracked budgets regardless of period, so a daily budget's spend is added to a monthly one's. `total_spent / total_budget` and the "on track" count are dimensionally meaningless. | [`overview.ts:80-87`](../../api/_routes/budgets/overview.ts) | **Medium** |
| 5 | **Hard-UTC boundaries.** `periodStart` is all `getUTC*`; dates are stamped `new Date().toISOString().split("T")[0]`. For UTC+13/−11 users "today" and "this month" can be off by a day. Week start is hardcoded Monday, not locale-aware. **No user or org timezone is stored anywhere** (`organizations` `:4-29` and `user_profiles` `:473-508` have no tz column). | [`budget.ts:29-48`](../../src/lib/budget.ts), [`recurring.ts:107-110`](../../src/lib/recurring.ts), [`transactions.ts:376`](../../api/_routes/transactions.ts) | **Medium** |
| 6 | **Alerts fire from exactly one call site** — single-transaction `POST` create. **Not** on edit (raising an amount past the cap is silent), split-group create, recurring materialization, or system adjustments. | only caller [`transactions.ts:407`](../../api/_routes/transactions.ts); absent from `transactions/[id].ts`, `transactions/group.ts`, `recurring-materialize.ts` | **High** |
| 7 | **Personal budgets can never alert.** `notifyIfBudgetExceeded` queries `eq(budgets.clientId, clientId)`, so the org-level (`client_id IS NULL`) budget is unreachable and a personal workspace's only budget never fires. | [`notify-budget.ts:27-31`](../../api/_lib/notify-budget.ts) | **High** |
| 8 | **Historical rewriting.** Closed periods are recomputed from live transactions on every read, and `PATCH /api/transactions/:id` can change `date`, `amount`, `type`, `category` and `wealth_account_id` — so editing an old row **retroactively rewrites a closed month**. Restoring from Trash re-counts it. | [`transactions/[id].ts:84-122`](../../api/_routes/transactions/[id].ts), [`detail.ts:69-73`](../../api/_routes/budgets/detail.ts) | **High** |
| 9 | **Best-effort audit.** `recordHistory` swallows insert failures by design, so the trail can gap silently. `budgetChangeAction` also returns on the first match, so a simultaneous raise **and** period change logs as `raise` only. | [`budgets.ts:80-83`](../../api/_routes/budgets.ts), [`budget-history.ts:23-29`](../../src/lib/budget-history.ts) | **Medium** |
| 10 | **Currency relabelling.** `PATCH /api/organizations/:id` writes a new `currency` with **no conversion and no snapshot**, so a €500 budget becomes a $500 budget and every historical `budget_history` amount is retroactively relabelled. | [`organizations/[id].ts:72-75`](../../api/_routes/organizations/[id].ts) | **Medium** — blocked, §12 |
| 11 | **Business default is a UI prefill, not an inherited default.** Read only into the dialog's `prefill` prop; no server-side inheritance. A client with no `budgets` row has no budget — not the default. | [`BudgetDialog.tsx:62-63`](../../src/components/budget/BudgetDialog.tsx), [`BusinessBudgetCard.tsx:110`](../../src/components/budget/BusinessBudgetCard.tsx) | **Low** |
| 12 | **Lifetime budgets apply retroactively** to every transaction ever recorded, including those predating the budget, and get no chart (`LOOKBACK.lifetime = 0`). | [`budget.ts:44-46`](../../src/lib/budget.ts), [`detail.ts:19`](../../api/_routes/budgets/detail.ts) | **Low** |
| 13 | **Full-history scans + client fan-out.** The `lifetime` column has *no lower bound*, so `outgoingByClient` **cannot use a date index** — every `GET /api/budgets` and `/overview` full-scans the org's entire transaction history even when no lifetime budget exists, and it runs on nearly every page load. `overview.ts` additionally loads the org's **entire** `budget_history` unfiltered. `spendForWindows` aggregates in JS. Six-plus components fetch independently. | [`budget-spend.ts:23`](../../api/_lib/budget-spend.ts), [`overview.ts:26`](../../api/_routes/budgets/overview.ts), [`budget-spend.ts:79-92`](../../api/_lib/budget-spend.ts) | **High at scale** |
| 14 | **Threshold logic triplicated** — `budgetState`, `seriesState`, `budgetAlertTier`, each with its own `0.8`; `BUDGET_WARN_RATIO` declared twice. | [`budget.ts:53`](../../src/lib/budget.ts), [`budget-history.ts:10`](../../src/lib/budget-history.ts), [`notify-budget.ts:12`](../../api/_lib/notify-budget.ts) | **Low** |
| 15 | **Exactly 100% reports as warning.** `spent > safeAmount ? "over" : ratio >= 0.8 ? "warn"`. Spending precisely the budget shows amber "nearing", never "fully used". A committed test locks this. | [`budget.ts:63`](../../src/lib/budget.ts), [`notify-budget.test.ts:15`](../../api/_lib/notify-budget.test.ts) | **Low** |

**Three further defects found, not in the brief:**

| # | Defect | Verified at | Severity |
|---|---|---|---|
| 16 | **Trashed-client budgets vanish and reappear.** `overview.ts:78` drops budgets whose client isn't in `nameById`, and the client query excludes soft-deleted rows — so trashing a client silently hides its budget and restoring brings it back. Hard-deleting cascades the budget **and its entire history** away. | [`overview.ts:25,78`](../../api/_routes/budgets/overview.ts) | **Medium** |
| 17 | **Two divergent derivations of the same number.** The detail page's "current" indicator reads `series[last].spent`; `/overview` computes live current-period spend. They can disagree. | [`BudgetDetailPage.tsx:114`](../../src/pages/BudgetDetailPage.tsx) | **Low** |
| 18 | **`is_system` also pollutes analytics/calendar/flow.** Those routes exclude only `kind <> 'transfer'` and never filter `is_system`, so opening balances and balance adjustments flow into reported income/expense. Budget v1 is stricter (`kind = 'standard'`) yet still misses `is_system`. Fixing #1 in the budget engine alone leaves analytics inconsistent with budgets. | [`analytics.ts:33-42`](../../api/_routes/analytics.ts), [`calendar.ts:43-53`](../../api/_routes/calendar.ts), [`flow.ts:89-97`](../../api/_routes/flow.ts) | **Medium** |

### 2.5 Defect disposition

| Class | Defects |
|---|---|
| **Required before release** (live bugs; ship independently of v2) | #1, #6, #7 |
| **Required for the new foundation** (the v2 model is wrong without them) | #2, #3, #4, #5, #8, #9, #13, #15, #16, #17 |
| **Dependent on another feature** | #10 (multicurrency, §12) |
| **Cross-cutting, decide explicitly** | #18 — either fix analytics too, or accept and *document* that analytics and budgets use different inclusion rules |
| **Safe to defer** | — |
| **Obsolete under the redesign** | #11 (real inherited defaults replace prefill, §10.3), #12 (`lifetime` removed as a plan cadence, §5.3), #14 (one `budget-math.ts`, §8.1) |

> **Recommendation.** Fix #1, #6 and #7 in a small separately-reviewable PR against `dev`
> *before* Budget v2 work starts. They are live correctness bugs, each a few lines, and
> shipping them early de-risks the migration by making v1's numbers trustworthy at the
> moment we snapshot them (§13.3). #18 should be decided in the same PR.
### 2.6 Assets we can build on

The investigation found substantially more reusable machinery than the brief assumed.
This is the basis of decisions **D2** and **D3**.

#### Spaces — a savings / sinking-fund primitive that already ships

[`docs/spaces/PLAN.md`](../spaces/PLAN.md) plus the code confirm:

- A Space **is** a `wealth_accounts` row with `type='space'` ([`schema.ts:155`](../../src/lib/db/schema.ts)), carrying optional `goal_amount` + `target_date` (`:177-181`, migration [`0043_cooing_wolfpack.sql:3-4`](../../drizzle/0043_cooing_wolfpack.sql)).
- The monthly-contribution suggestion is **derived, never stored** — [`src/lib/spaces.ts`](../../src/lib/spaces.ts): `spaceProgress`, `suggestedMonthly`, `spaceGoalStatus` (a discriminated `none | reached | overdue | on_pace`), `monthlyEquivalent`, `autoSavePace`. Pure and unit-tested.
- Funding and withdrawal are **transfers** (`kind='transfer'`), already excluded from income/expense, analytics, calendar, flow — and from budget spend.
- **`GET /api/wealth/accounts` already excludes `type='space'`** ([`accounts.ts:131`](../../api/_routes/wealth/accounts.ts) — `ne(type,'space')`). *The Available-vs-Reserved separation is already enforced at the query layer.*
- **Spending from a Space is already blocked** server-side ([`transactions.ts:351`](../../api/_routes/transactions.ts)).
- One **recurring auto-save** per Space — a `kind='transfer'` recurring rule ([`spaces/[id]/auto-save.ts`](../../api/_routes/spaces/[id]/auto-save.ts)), with `monthly_equivalent` returned for pace comparison.
- Quota-gated: free personal = 1 Space, paid = 7 ([`quota.ts:61,76`](../../api/_lib/quota.ts), `checkSpaceQuota` `:244-263`).
- **Personal-only** — `accountTypeAllows(accountType,'spaces')` is true only for `personal` ([`types.ts:354-367`](../../src/lib/types.ts)); routes 403 otherwise.
- A Space **cannot be archived or deleted while non-empty** ([`spaces/[id].ts:75-78,97-100`](../../api/_routes/spaces/[id].ts)) — a real integrity guarantee we inherit.

> **What we take from this, and what we don't** (revised in rev 2). The *math* is reusable
> as-is: `src/lib/spaces.ts` is pure functions over `(balance, goal, targetDate)` and never
> assumed a Space. Budget v2 reuses it unchanged for every sinking fund.
>
> The *storage* only partially fits. Spaces are **quota-limited** (free personal = 1) and
> **personal-only**, so requiring every sinking fund to be a Space would mean a free user
> cannot have both a car-insurance fund and a holiday fund — and it would force real money
> movement for what is often just an intention to hold money back. So a fund is a
> `savings` **envelope** with a `funding_mode`: **`virtual`** (a reservation, unlimited on
> every plan, no money moves) or **`space_backed`** (real transfers into a Space). §8.9.

Two gaps to carry forward:

- **You cannot spend directly from a Space**, so Space-backed fund *expenditure* needs a guided two-step flow (Space → bank, then spend), specified in §9.8. Virtual funds need an analogous withdrawal-then-spend flow.
- **A Space-backed fund's balance is already outside `Available now`** (the accounts query excludes Spaces), whereas a **virtual** fund's balance is still sitting in a real account. The two must therefore be *reserved differently* — the single most error-prone rule in the spec (§8.5).

#### `recurring_rules` — a commitments primitive

[`schema.ts:291-325`](../../src/lib/db/schema.ts) carries `amount`,
`frequency_unit ∈ {day,week,month,year}`, `frequency_interval`, `start_date`, `end_date`,
**`next_due_at`** (the cursor), **`active`** (the pause flag) and `last_error`. Index
`recurring_rules_due_idx (organization_id, active, next_due_at)`.

Occurrences materialize lazily on GETs via
[`recurring-materialize.ts`](../../api/_lib/recurring-materialize.ts), idempotent on the
unique index `(recurring_rule_id, recurring_due_date)` (`schema.ts:264`). Occurrence dates
are always computed as `occurrenceAt(anchor, freq, n)` from the anchor — never stepped from
the previous occurrence — so month-end clamping cannot drift
([`recurring.ts:32-49`](../../src/lib/recurring.ts)).

> **What we take from this** (revised in rev 2). `occurrencesDue()` and the anchor-based
> date math are reused **unchanged** — that is where `recurring_rules` genuinely fits.
> But a rule cannot express a **one-time** obligation, and materializing an unpaid
> expectation as a real transaction is exactly what must *not* happen. So
> `budget_commitments` owns the definition (`one_time` | `recurring`) and delegates only the
> *schedule* to `recurring_rules`. Expectations become **projected occurrences** that never
> write to a balance (§8.6, §10.5).

Three behaviours that directly affect budgeting and must be handled (§9.6, §20):

1. **Materialization is caller-driven, not scheduled.** Eight GET routes call it; **`analytics.ts` and `budgets.ts` do not.** So a due occurrence is missing from *posted* spend until some other page is visited. Budget v2 resolves this rather than accepting skew: expectations come from projected occurrences (which never need materialization), and posted spend is reconciled by an explicit idempotent `POST /api/budgets/v2/sync` that budget reads request via a `sync_required` flag — see §8.10 and the reversal of decision D-3 (§20.1).
2. **Resuming a long-paused rule immediately backfills every missed occurrence** ([`recurring/[id].ts:27-39`](../../api/_routes/recurring/[id].ts)) — capped at `MAX_OCCURRENCES_PER_RUN = 60` per request but continuing across requests. This can retroactively blow several closed budget periods at once.
3. **Editing a rule never touches already-materialized rows**, and schedule edits re-anchor forward-only (`:55-65`). Deleting a rule **keeps** its transactions with a dangling `recurring_rule_id` — note the schema comment at `:248-249` says "nulled if the rule is deleted", which **is not what the code does**.

#### Categories — usable, with one sharp edge

[`schema.ts:119-132`](../../src/lib/db/schema.ts): org-scoped `(organization_id, type, name)`
unique, `type ∈ {incoming, outgoing, client, quotation}`, plus `color`. **No** icon,
ordering, soft-delete, parent or `is_system` column. `MAX_CATEGORIES_PER_ORG = 300`,
`MAX_NAME_LENGTH = 60` ([`categories.ts:8-9`](../../api/_routes/categories.ts)). Defaults:
11 names seeded for **both** directions = 22 rows, and re-seeded **only when the org has
zero categories** so a delete sticks (`:38-51`).

**The sharp edge:** `transactions.category` is **free text, not a foreign key**
(`schema.ts:241`, documented `:115-118`). Consequences that a category-budget engine must
confront head-on:

- A transaction can carry a category that no longer exists (delete is orphan-safe).
- Nothing validates the string on write; the picker deliberately allows free text ([`CategoryPicker.tsx:46-48`](../../src/components/CategoryPicker.tsx)), and the AI quick-add writes it too.
- **Case handling is inconsistent.** Creation collision checks are case-*insensitive* (`categories.ts:98`), but the rename cascade and every aggregate match case-*sensitively* — so `rent` is not renamed with `Rent`, and analytics buckets them separately ([`analytics.ts:66`](../../api/_routes/analytics.ts), [`flow.ts:304`](../../api/_routes/flow.ts)).

§8.3 specifies how envelope→category matching handles this **without** a risky data
migration of historical `category` text (case-insensitive matching plus a functional index).

#### Aggregation precedent

[`analytics.ts`](../../api/_routes/analytics.ts) is the closest existing calculation
engine: one handler, whitelisted `granularity`, a shared WHERE built once and reused by
four `Promise.all` queries, and two reusable SQL fragments:

```sql
income  = coalesce(sum(case when type = 'incoming' then amount::numeric else 0 end), 0)
expense = coalesce(sum(case when type = 'outgoing' then amount::numeric else 0 end), 0)
```

Org scoping is achieved **only through the `clients` join** — there is no
`organization_id` on `transactions`. Note `calendar.ts:36` returns `date::text` explicitly
to keep it a raw `YYYY-MM-DD` string with no timezone shift; that is the pattern to copy.

#### Timezone precedent

**No user or org timezone is stored.** `organizations` (`:4-29`) and `user_profiles`
(`:473-508`) have no tz column. The **only** persisted timezone in the product is
`notification_reminders.schedule` — a jsonb `{ times, weekdays, timezone }` (`:1001-1017`)
— and the only real tz logic is
[`src/lib/schedule-notifications.ts`](../../src/lib/schedule-notifications.ts):
`weekdayInTz`, `timeInTz`, `dateInTz` via `Intl.DateTimeFormat`, and **`safeTimezone(tz)`
which validates an IANA string in a try/catch and falls back to `"UTC"`** (`:54-62`).

> That is exactly the primitive Budget v2 needs for defect #5, and it is already written
> and in production. We reuse `safeTimezone` rather than inventing tz handling.

#### Other constraints worth stating up front

- `AccountType = "personal" | "business"` only ([`types.ts:342`](../../src/lib/types.ts)). **`family` is NOT in `dev`** — it exists solely on unmerged `feat/family-*` branches. Do not design for it.
- Splits are **N sibling leg rows sharing `group_id`, with no parent row** ([`group.ts:126-141`](../../api/_routes/transactions/group.ts)) — summing legs is correct exactly once.
- `MAX_MONEY = 9_999_999_999_999.99` + `amountExceedsLimit` are the shared money guards ([`money.ts`](../../src/lib/money.ts)).
- **The driver is `drizzle-orm/neon-http`** ([`db/index.ts:2`](../../src/lib/db/index.ts)). It supports **`db.batch()`** (non-interactive, one round trip, atomic) but **not** interactive `db.transaction(async tx => …)`. **No route uses batching today.** This directly constrains the audit strategy (§10.9).
- **No endpoint returns a total or available balance.** Every total is computed in the browser from the account list ([`useWealthSummary`](../../src/lib/wealth.ts) `:110-116`; `WealthPage.tsx:238-241` computes `total`, `savedTotal`, `netWorth`). Budget v2 needs this server-side (§8.4).
- **Archived accounts silently remove money from every total** — the balance is never zeroed on archive, and client-side totals filter `!archived_at`. An archived account with €500 in it just disappears.
- Two **non-atomic** balance writes exist ([`wealth/accounts/[id].ts:143-161`](../../api/_routes/wealth/accounts/[id].ts) read-modify-write; concurrent adjustments can lose one). Budget v2 does not write balances, but its reads inherit any drift.
- No query library at all — no react-query/swr/zustand. Client caching is the hand-rolled [`src/lib/api.ts`](../../src/lib/api.ts). **It already has targeted invalidation:** `invalidateKeys(prefixes)` (`:58-64`), preferred over `clearApiCache()`, plus a `cacheGeneration` guard so a late in-flight GET cannot repopulate stale data (`:118`), and a `runOptimistic` helper ([`src/lib/optimistic.ts:19-38`](../../src/lib/optimistic.ts)).
- `dashboard-layout.ts` **already registers `"budget"`** as a card id (`:8`), and `normalizeCtx` appends registry cards missing from a stored order (`:24-46`) — so replacing the card is layout-safe for existing users.
- The i18n gate is strict: a key added to `en.json` must land in all 7 other locales, non-empty, with identical `{{placeholders}}`, in the same commit ([`scripts/check-i18n.mjs:102-119`](../../scripts/check-i18n.mjs)). Only `_one`/`_other` plural forms exist anywhere.
- Defect #7 is **already documented as a known gap** in [`docs/notifications/PLAN.md:96`](../notifications/PLAN.md) — "Personal/org-default budget alerts — only client-specific budgets alert today".

---

## 3. Product principles

These are decision rules, not aspirations. Where a later section is ambiguous, resolve it
against these in order.

| # | Principle | What it forbids |
|---|---|---|
| **P1** | **Advisory, never obstructive.** The budget informs; it never blocks recording a transaction. | A validation error, disabled Save, or confirmation gate that prevents an over-budget entry. |
| **P2** | **One engine, progressive surface.** There is exactly one model. "Simple" is a plan with one envelope, not a different code path. | A `mode` column, a "simple/advanced" toggle, or two calculation paths. |
| **P3** | **Never conflate budget with cash.** Every screen that shows a spendable number shows *Safe to spend*, not *budget remaining*. | "€340 left" as a headline when €780 of bills is unpaid. |
| **P4** | **The user's money is never moved without explicit confirmation.** Reallocation, rollover application and auto-fill are proposals until confirmed, and every one writes an audit row. | Silently rebalancing envelopes; auto-applying a suggestion. |
| **P5** | **History is immutable once closed.** A closed period's reported numbers never change because of a later edit to an old transaction. | Recomputing closed periods live. |
| **P6** | **Every number is attributable.** Any figure on screen can be drilled to the transactions or allocations that produced it. | An aggregate that mixes cadences or units, or a total with no drill-through. |
| **P7** | **Explain, don't judge.** Copy states the fact and the options. | "You overspent again", streak-shaming, red as the default state, moralising nudges. |
| **P8** | **Suggestions are evidence-backed, optional and dismissible.** Each carries what it was derived from and how confident it is. | An unexplained recommendation; a suggestion that writes to the plan. |
| **P9** | **Works with no plan, sparse history, irregular income and zero configuration.** Budgeting from *current available money* is a first-class mode, not a fallback. | Requiring expected income; empty states that only say "no data". |
| **P10** | **Currency-ready, single-currency-correct.** Build the seams multicurrency needs; do not implement FX. | Inventing a rate table, a base currency, or a conversion policy ahead of §12. |
| **P11** | **Reuse the money primitives.** Spaces for savings, `recurring_rules` for commitments, `transactions` for actuals. | A parallel savings ledger, a second scheduler, a shadow copy of transaction amounts. |
| **P12** | **Mobile-first and localisable from the first commit.** ≥44 px targets, ≥16 px inputs, safe-area insets, no horizontal page scroll, RTL-correct, every string keyed. | English strings in JSX; a desktop-only layout; a number formatted without the org currency. |

### 3.1 The one-minute test

A beginner must reach a useful budget in **under 60 seconds and four decisions**:

1. Planning period (default: calendar month — one tap to accept)
2. Expected income, **or** "My income varies" (one tap)
3. One overall spending target (one number, pre-filled with a suggestion when history allows)
4. Finish

Everything else — categories, commitments, savings, sinking funds, debt, rollover, custom
cycles, forecasting, inclusion rules — is **added later, from the plan itself**, never asked
for up front. This is the acceptance criterion in §21.1 and the design constraint that
outranks feature completeness.

---

## 4. User personas and budgeting styles

Six personas, each mapped to the configuration it exercises and the failure mode it would
hit in v1. These drive the test matrix in §16.

| Persona | Situation | Plan shape | v1 failure it hits |
|---|---|---|---|
| **A. Aisha — salaried, EUR, simple** | €3,200/mo salary on the 27th. Wants "am I overspending?" | Monthly plan, expected income set, **one** overall envelope. No categories. | None fatal — but "€340 left" ignores €1,150 of rent+utilities due on the 1st. |
| **B. Bruno — salaried, wants control** | Same as A but tracks Groceries, Dining, Fuel, plus rent and a €62.50/mo car-insurance sinking fund. | Monthly plan, 3 flexible envelopes, 2 commitments, 1 **virtual** sinking fund, goal €750 / target date. Rollover: carry surplus only, on Groceries. | No categories exist; no sinking funds; the insurance saving looks like spending. |
| **C. Chiara — freelance, irregular income** | Income arrives in lumps, 0–3 invoices a month. Cannot forecast income. | **Available-money mode**: no expected income. Plan budgets from `Available now`. Payday-agnostic; monthly cadence. | v1 forces a fixed target with no notion of "what I actually have"; nothing degrades gracefully. |
| **D. Dev — EUR earner, INR obligations** | Lives in the EU, sends money to family and pays an INR loan. | Monthly plan in EUR, one commitment denominated in INR. | **Blocked on §12.** v1 has no per-transaction currency; changing org currency silently relabels history (#10). |
| **E. Elena — credit-card user** | Pays for most things on a card, settles the statement monthly. | **Blocked on §9.5.** Needs a liability account + pending/cleared. Phase 1 gives her a documented, honest limitation. | v1 (and Phase 1) would double-count: the purchase *and* the bill payment. |
| **F. Farid — reimbursed by employer** | Fronts €400 of travel, reclaims it 6 weeks later. | Monthly plan; travel envelope with a **reimbursable** marker; reimbursement lands next period. | v1 counts €400 as spend and never restores it (#2); the refund arrives in a different period. |
| **G. Giulia — small business, 12 clients** | Wants per-client spend caps, not household envelopes. | **Not an envelope plan.** Keeps client caps as a separate concept (§23). | v1's business "default template" tracks nothing (#11); mixed-cadence aggregate is meaningless (#4). |

### 4.1 Budgeting styles the model must support

| Style | Mechanism |
|---|---|
| **Ceiling** (one overall target) | A plan with a single `flexible` envelope and no income requirement. This is the beginner default and the v1-migration target. |
| **Category envelopes** | Multiple `flexible` envelopes, each matching a category set. Optional overall target on top (§8.6 defines precedence). |
| **Zero-based / fully allocated** | Income − all allocations = `Unallocated` driven to 0. Surfaced as a progress affordance, **never enforced**. |
| **Pay-cycle** | `payday` cadence anchored to an income date or an explicit day-of-month; periods run payday→payday. |
| **Available-money** (irregular income) | `income_mode = 'available'`. The plan's capacity is `Available now`, not expected income. Forecast degrades to "current balance minus reserved". |
| **Reserve-first** | Commitments, debt and savings are allocated before flexible envelopes; `Safe to spend` reflects it automatically. |
| **Rolling / rollover** | Per-envelope `carry ∈ {none, surplus, deficit, both}`. |

Two styles are deliberately **out of scope** and should be declined if asked for, because
they conflict with P1/P2: strict envelope enforcement (blocking a spend), and
double-entry-style ledger budgeting (a second ledger alongside `transactions`).

---

## 5. Proposed information architecture

### 5.1 Object graph

```
organization
 └── budget_plan                      (0..1 active per org; pausable; not deleted)
      ├── plan settings               cadence · anchor · timezone · week_start · income_mode
      │                               included accounts · currency (forward-compat)
      │
      ├── budget_envelope  (0..n)     the durable line item, spans periods
      │    ├── section                income | commitment | flexible | savings | debt
      │    ├── target rule            amount + cadence, normalised to the plan period
      │    ├── match rule             category set  (flexible / income only)
      │    ├── funding_mode           virtual | space_backed        (savings only)
      │    │    └── wealth_account_id → Space                       (space_backed only)
      │    ├── goal_amount, target_date                             (savings only)
      │    ├── carry policy           none | surplus | deficit | both
      │    └── priority               essential | important | optional  (advisory only)
      │
      ├── budget_commitment (0..n)    a known obligation  → attaches to a commitment/debt envelope
      │    ├── kind                   one_time  (due_date + amount)
      │    │                        | recurring (delegates its schedule to recurring_rules)
      │    └── occurrences            PROJECTED in memory; only DEVIATIONS are stored:
      │         └── budget_occurrence   settled (→ transaction) | cancelled | skipped
      │                                 ⚠ never writes to wealth_accounts.current_balance
      │
      ├── budget_fund_entry (0..n)    the ledger behind a VIRTUAL fund's balance
      │                               contribution | withdrawal | adjustment
      │
      └── budget_period    (1..n)     materialized instance of the cadence
           ├── status                 open | closed
           ├── funding_base           SNAPSHOT of capacity at open — spending never changes it
           ├── budget_allocation      per-envelope planned amount FOR THIS PERIOD
           │                          (materialized at open; editable; carries rollover_in)
           └── snapshot (1..n)        VERSIONED frozen report; v1 is the original close,
                                      later versions are audited RESTATEMENTS
```

**Why a plan is `0..1` per org, not per user.** Every financial row in ProfitSync is
org-scoped, never user-scoped (`CLAUDE.md` key conventions; `requireAuth` returns
`orgId`). A per-user plan inside a shared org would need user-scoped transactions, which
do not exist. A personal workspace is already a one-member org, so "my plan" and "the
org's plan" coincide for the persona that matters.

**Why sections are a fixed enum, not user-defined.** The four numbers (§1.3) are defined
by section semantics: `commitment` and `debt` feed *Reserved*, `savings` feeds *Reserved*
via a Space, `flexible` feeds *Safe to spend*, `income` feeds *Forecast*. A user-defined
section would have no defined effect on any of them. **Users get unlimited
*envelopes* and free naming; sections stay fixed.** This is the single most important
scope cut in the design, and it is what keeps the calculation rules in §8 total.

### 5.2 Navigation

`/budgets` is retained as the entry point — existing bookmarks, the sidebar entry, the
mobile More sheet (`MobileAppLayout.tsx:103`) and the dashboard card all point there.

| Route | Screen | Notes |
|---|---|---|
| `/budgets` | **Budget overview** — the four numbers + section cards | Replaces the v1 list. Empty state → onboarding. |
| `/budgets/plan` | **Monthly plan** — full allocation editor | New. The "power" surface. |
| `/budgets/envelope/:id` | **Envelope detail** — history, trend, transactions | Replaces `/budgets/:key`. |
| `/budgets/periods` | **Period history** — closed periods list | New. |
| `/budgets/periods/:periodId` | **Historical period view** — read-only snapshot | New. |
| `/budgets/settings` | **Plan settings** — cadence, timezone, accounts, inclusion rules | New. Advanced only. |
| `/budgets/:key` | *legacy* → client-side resolver | §13.6 preserves old links. |

The API is versioned separately from the routes: `/api/budgets` keeps returning the **v1
shape indefinitely** so store-pinned native bundles never break, and the v2 surface lives at
`/api/budgets/v2` (§11.1).

Deliberately **not** new top-level nav: **Space-backed** funds remain visible on `/spaces`
and recurring schedules remain editable on `/recurring`. Budget v2 owns the *budget* objects
(commitments, virtual funds) and *references* the wealth objects with deep links and inline
summaries. Duplicating them would create two places to edit one object — the exact
mistake v1 made with the "default template".

### 5.3 What is removed

| v1 concept | Fate |
|---|---|
| `period = 'lifetime'` | **Removed as a plan cadence.** It is not a budget; it is a lifetime total, and it caused defect #12 and the unindexable full scan in #13. Migrated per §13.4. |
| `period = 'daily'` | **Removed as a plan cadence**, retained as an *envelope target cadence* (a €20/day coffee target normalizes to the monthly period). Nobody plans income and rent daily. |
| Business "default template" (`client_id IS NULL` on a business org) | **Removed.** Replaced by a real inherited default (§10.3) — fixes #11. |
| The cross-budget aggregate | **Removed.** Replaced by the four numbers, which are dimensionally sound — fixes #4. |
| `spent: number \| null` | **Removed.** Every envelope has a real number; the template that had none is gone. |
| `creep` as a headline badge | **Retained but demoted** to envelope detail. It reads as judgemental on a list (P7) and is a weak heuristic on sparse history. |

### 5.4 Progressive disclosure map

Where each setting lives. Anything not in column 1 must never appear during first setup.

| Initial setup (≤4 decisions) | Normal editing (plan + envelope screens) | Advanced settings (`/budgets/settings`, collapsed) |
|---|---|---|
| Planning period (monthly default) | Add/rename/remove an envelope | Custom cadence: weekly · payday · custom range |
| Expected income **or** "income varies" | Set an envelope amount + its cadence | Plan timezone + week-start |
| One overall spending target | Add a commitment — **recurring or one-time** | Included accounts for `Available now` |
| Finish | Add a savings allocation | Per-envelope rollover policy |
| | Create a sinking fund (**virtual** by default) | Convert a fund to **Space-backed** (real transfers) |
| | Add a debt payment | Priority tiers (essential/important/optional) |
| | Reallocate between envelopes | Category/transaction inclusion & exclusion rules |
| | Confirm or reject a provisional refund | Reimbursable-expense handling |
| | Adjust the period's funding base | Copy-previous-period vs start-fresh default |
| | Pause the plan · close / start a period | Forecast horizon |
---

## 6. Screen-by-screen UX specification

### 6.0 Conventions that apply to every screen

**Visual language** — inherited unchanged: shadcn/ui new-york, Tailwind v4 CSS variables,
`Card`/`CardContent`, `rounded-xl`/`rounded-2xl`, `border` + `bg-card`, `text-muted-foreground`
for secondary text, `tabular-nums` on every figure, `size-4`/`size-5` lucide icons,
`MoneyBag` as the budget icon (`src/components/icons/MoneyBag.tsx` — the piggy-bank was
reassigned to Spaces, [`docs/spaces/PLAN.md:24`](../spaces/PLAN.md)).

**State colours** — semantic, and *never* the default. `ok` = `emerald-500`,
`warn` = `amber-500`, `over` = `red-500`, `none` = `muted-foreground/40`. A healthy plan is
emerald or neutral; red appears only when a number is genuinely negative or exceeded.
Reuse the exact `BAR`/`TEXT`/`HEALTH_DOT` maps already in
[`BudgetIndicator.tsx:13-22`](../../src/components/budget/BudgetIndicator.tsx) and
[`BudgetsPage.tsx:39`](../../src/pages/BudgetsPage.tsx).

**Motion** — `motion-safe:` prefixes only; `transition-[width] duration-300` on bars;
`page-enter` on route roots; `useAutoAnimate` for list add/remove; recharts animation gated
on `prefers-reduced-motion` exactly as [`BudgetDetailPage.tsx:60`](../../src/pages/BudgetDetailPage.tsx) does.

**Mobile constraints** (non-negotiable, they run in the Capacitor WebView): ≥44 px touch
targets, ≥16 px inputs, `safe-pb`/safe-area insets, wide tables in `overflow-x-auto`, and
**the page body never scrolls horizontally** — headers `flex-wrap` rather than overflow.

**Every state is specified.** Each screen below must implement four: `loading` (skeleton
matching the final layout — never a spinner in place of content), `empty`, `partial`
(some data missing/degraded, e.g. no history for suggestions), `error`.

**The `loaded` flag pattern is mandatory.** Gate every empty state on an explicit
`loaded` boolean so a background refresh never flashes "no budget" → real data. This bug
was already fixed once in v1 ([`PersonalBudgetCard.tsx:35-37`](../../src/components/budget/PersonalBudgetCard.tsx)) and must not be reintroduced.

**Microcopy rules** (P7): state the fact, then the options. No second person accusations,
no exclamation marks, no streak-shaming. Every string is an i18n key (§15).

---

### 6.1 First budget onboarding — `/budgets` (empty) → wizard

| | |
|---|---|
| **Purpose** | Get a beginner to a useful plan in **four decisions**, with a *measured* median under 60 s (§3.1, §21.1). |
| **Hierarchy** | One question per screen. Big question, one input, one primary button. Progress dots. |
| **Primary action** | `Continue` → `Create my budget` on the last step. |
| **Secondary** | `Skip for now` (dismissible, returns to the empty state), `Back`. |
| **Visible by default** | Step 1 period (3 chips: *This month* / *Every week* / *My pay cycle*, monthly preselected). Step 2 income (one amount field + a prominent `My income varies` link). Step 3 one spending target (amount field, pre-filled from a suggestion when ≥2 months of history). Step 4 summary. |
| **Progressively disclosed** | Nothing. Categories, commitments, savings, sinking funds, debt, rollover, timezone, accounts, priorities are **absent** from this flow. |
| **Microcopy** | Step 1: "How do you want to plan?" · Step 2: "Roughly how much comes in?" / helper "You can change this any time, or skip it." / link "My income varies" · Step 3: "How much do you want to keep spending under?" / when suggested: "Based on your last 3 months you spent about {{amount}} a month." · Step 4: "You're set. Add categories, bills and savings whenever you like." |
| **Validation** | Amounts: `> 0`, finite, `amountExceedsLimit` → "Amount is too large". Income may be empty **only** if `My income varies` was chosen. Target is required. Both inputs `inputMode="decimal"` with the currency symbol prefixed (reuse [`BudgetDialog.tsx:106-117`](../../src/components/budget/BudgetDialog.tsx)). |
| **Edge cases** | No history → step 3 shows no suggestion, just the field. `viewer` role → the whole flow is unreachable; show the read-only empty state instead. Free plan → no gating (budgets are unlimited, §18.3). A plan already exists → route to `/budgets`, never re-run the wizard. Mid-period creation → full targets with an `is_partial` chip (**decision D-7**, §20.1); the period's funding base is snapshotted at open (§8.4). |

Reuse the [`MoneyWizard.tsx`](../../src/components/onboarding/MoneyWizard.tsx) shell — it is
already a one-question-per-screen wizard that POSTs to `/api/budgets`, and it already
carries the accent/step chrome.

### 6.2 Empty state — `/budgets` with no plan

| | |
|---|---|
| **Purpose** | Explain the value in one line and offer exactly one action. |
| **Hierarchy** | `MoneyBag` glyph → headline → one-line explainer → primary button. |
| **Primary action** | `Create a budget` → §6.1. |
| **Visible** | Nothing else. No feature list, no marketing. |
| **Microcopy** | "No budget yet" / "Set a spending target and ProfitSync will show you what's safe to spend." |
| **Edge cases** | `viewer` role → the button is hidden, copy becomes "No budget has been set for this workspace." A **paused** plan is *not* empty — see §6.13. |

Structurally identical to the current dashed-border empty state
([`BudgetsPage.tsx:92-102`](../../src/pages/BudgetsPage.tsx)); only the copy and target change.

### 6.3 Budget overview — `/budgets`

The most important screen in the feature.

| | |
|---|---|
| **Purpose** | Answer "can I spend?" in under two seconds, then let the user drill anywhere. |
| **Hierarchy** | **1.** *Safe to spend* — the largest number, with a **one-line `binding` reason** directly under it. **2.** A context strip: `Available now` · `Reserved` · `days left`. **3.** Section cards in fixed order, each with its **own** vocabulary (§8.7) — Commitments (settled/outstanding) → Flexible (spent/planned) → Savings (funded/balance) → Debt (paid/outstanding) → Unallocated. **4.** Alerts/suggestions, at most two, dismissible. |
| **Primary action** | Tap a section card → its envelopes. |
| **Secondary** | `Plan` (→ §6.4), period switcher, `Add` (envelope/commitment/savings), overflow menu (`Settings`, `Pause`, `History`). |
| **Visible by default** | The four numbers, per-section subtotals in each section's own units, and envelope counts. **Overdue obligations get their own row** above the sections — "{{count}} overdue · {{amount}} still reserved" — because a forgotten bill is the single most consequential thing on the screen (§8.6.1). Savings shows "{{count}} contribution awaiting confirmation" when any is `planned` (§8.9.1). **Only `Safe to spend` and `Available now` are headline figures**; `Reserved` and `Forecast` sit in the strip with an `info` affordance. A progress bar appears **only** on the flexible section — a bar implies “X of Y used”, which is meaningless for income, savings or an unpaid bill. |
| **Progressively disclosed** | `Forecast balance` (tap the strip → §6.18). Per-envelope rows (tap a section, or expand inline on desktop). Creep, adherence and trend live in envelope detail only. |
| **Microcopy** | Headline "Safe to spend" + `info` → §6.19. **The `binding` line is the most important string in the product:** `plan` → "Limited by your plan — {{amount}} of cash is uncommitted"; `cash` → "Limited by your available cash — your plan still allows {{amount}}"; `both` → "Your plan and your cash agree"; `cash_only` → "You haven't set a spending target, so this is the cash you have after bills." Strip: "{{amount}} available · {{amount}} reserved · {{count}} days left". When negative: "Committed spending exceeds what's available" (not "You're broke"). In `available` mode the strip reads "Based on what you have now". |
| **Validation** | None (read-only surface). |
| **Edge cases** | **Negative safe-to-spend** → amber, not red, plus `See what's reserved`; red is only for an *exceeded* envelope. **`safe_to_spend = 0` with cash in the bank** → this is the `plan` binding and must read as a deliberate limit, not an error: "Your plan is fully used for this period." **No ceiling set** (`cash_only`) → an inline `Set a spending target` affordance. **No commitments** → the Commitments card is hidden (not shown at €0). **Unallocated = 0** → a thin neutral row, not an alert. **Mid-period creation** → a "partial period" chip. **Boundary crossed while the tab is open** → the switcher shows the new period and offers `Review last period` (§6.14); never silently swap data. **`sync_required`** → an "updating…" state on the affected figures while the one-shot sync runs (§8.10) — never a stale number presented as final. **An overspent envelope alongside a surplus one** → the plan-wide figure reflects the *net* (§8.5.1); the overview must never show a headroom larger than `Σ planned − Σ spent`. **A `recurring` commitment flagged `needs_attention`** → a distinct row: "{{count}} older unpaid payments aren't being reserved — review this commitment." (One-time obligations never age out, so this state cannot arise for them.) **`viewer`** → write affordances hidden. |

**The dashboard card** (`dashboard-layout.ts` id `budget`, already registered) becomes a
compact version: `Safe to spend` + one bar + `{{n}} of {{m}} envelopes on track`, tapping
through to `/budgets`. It must return `null` (and thus self-hide, `Dashboard.tsx:1276`) when
no plan exists, rather than rendering an empty prompt on the dashboard.

### 6.4 Monthly-plan view — `/budgets/plan`

| | |
|---|---|
| **Purpose** | See and adjust the whole allocation for the current period in one place. |
| **Hierarchy** | A sticky header showing the planning equation as a live bar: `Funding capacity − Commitments − Flexible − Savings − Debt = Unallocated`. Below it, editable sections. The first term is the period's **funding base + adjustments** (+ income received, in available mode) — **never** a live `Available now`, so it cannot drift as the user spends (§8.4). |
| **Primary action** | Inline amount edit; `Save` appears only when dirty. |
| **Secondary** | `Add envelope` per section, `Copy last period`, `Start fresh`, `Suggest amounts`, `Reallocate`, **`Adjust funding`** (§8.4). |
| **Visible by default** | Section groups with each envelope's `Planned` amount and an editable field. |
| **Progressively disclosed** | Per-envelope cadence, rollover policy, priority, match rules — all behind each row's `⋯` → `Advanced`. |
| **Microcopy** | Live consequence line under the equation, per P4: "Increasing Dining by {{amount}} will reduce your unallocated money from {{before}} to {{after}}." When allocations exceed capacity: "Your allocations are {{amount}} more than this period's funding." — informational, **never blocking**. `Adjust funding` explains itself: "This changes what the period has to work with. Spending never changes it." |
| **Validation** | Each amount `>= 0`, finite, `amountExceedsLimit`. Allocations **may** exceed income (P1) — warn, don't block. Editing a **closed** period is refused server-side and the fields are read-only. |
| **Edge cases** | `income_mode='available'` → the first term is labelled "Money you had when this period started, plus income since", with base and adjustments itemised on tap. Zero envelopes → the single overall envelope plus an `Add a category` prompt. Concurrent edit → 409; show "Someone else changed this plan. Reload to see the latest." and re-fetch (§10.10). A **closed** period → all fields read-only, with a link to its restatement history if any (§6.17). |

### 6.5 Category / section cards

| | |
|---|---|
| **Purpose** | Communicate one envelope's position at a glance. |
| **Visible by default (normal level)** | Exactly four figures: **Planned · Spent · Pending · Remaining**, plus a state-coloured bar. `Spent` shows **net**. `Pending` is omitted when 0, so a beginner's flexible card shows three. |
| **Progressively disclosed (expanded)** | **Gross spend and refunds, split out** · Forecast · Rollover in/out · Included transactions (count → drill) · Historical trend sparkline · Average spend · Suggested amount · Alerts · Adjustment history. |
| **Primary action** | Tap → envelope detail (§6.6). |
| **Secondary** | Long-press / `⋯` → `Edit amount`, `Reallocate`, `Exclude a transaction`, `Pause envelope`. |
| **Microcopy** | "{{spent}} of {{planned}}" (reuse `budget.spentOf`), then "{{amount}} left" / "{{amount}} over". Rollover chip: "+{{amount}} carried in". Pending chip: "{{amount}} pending". **Provisional refund disclosure** (§8.8): "Includes {{amount}} treated as a refund" with `Confirm` / `Not a refund` — one tap each, never a silent net. Reimbursable envelope: "{{amount}} spent · {{amount}} expected back". |
| **Edge cases** | `planned = 0` with spend → state `over`, copy "No amount planned". Negative remaining → red bar clamped at 100 % width, and **the card keeps showing its own signed figure (−€100)** even though plan-wide headroom is netted (§8.5.1) — the card's job is to show this envelope's truth. **Refunds exceed spend** → `spent_net` negative; show "{{amount}} net refunded" and a 0-width bar, never a negative-width bar. **An overdue occurrence** → an amber "Overdue since {{date}}" chip with `Mark paid` / `Skip` / `Reschedule`; the amount stays in Pending. **A savings card with `contribution_status='planned'`** → "{{amount}} reserved · not yet confirmed" plus `Confirm`; it must **not** say funded. A commitment or Space link removed → chip "Link removed" + `Relink`; the envelope keeps its history. **Savings cards never show a spent/planned bar** — they show funded vs goal progress instead (§8.7). |

### 6.6 Budget detail (envelope) — `/budgets/envelope/:id`

| | |
|---|---|
| **Purpose** | Explain one envelope's behaviour over time and let the user act on it. |
| **Hierarchy** | Current-period indicator → alerts → spend-vs-planned chart → adherence stats → included transactions → change timeline. |
| **Primary action** | `Edit amount`. |
| **Secondary** | `Reallocate`, `Change rollover`, `Set priority`, `Inclusion rules`, `Pause`. |
| **Visible by default** | The four figures, the chart (last 6 periods), and the transactions list. |
| **Progressively disclosed** | Adherence rate / streak / avg-vs-planned, creep callout, evolution %, and the full adjustment timeline — all below the fold, collapsed on mobile. |
| **Microcopy** | Keep `budgetsPage.spendVsBudget`, `onBudget`, `streak`, `avgVsBudget`, `sinceFirstSet`. Creep is demoted to a neutral line here: "Raised {{count}} times (+{{pct}}%) since first set." — drop the "watch for budget creep" scolding (P7). |
| **Validation** | As §6.4. |
| **Edge cases** | Fewer than 2 closed periods → hide the chart and adherence, show "Not enough history yet." Lifetime-migrated envelope → §13.4 banner. A closed period selected → everything is read-only and served from the snapshot. |

Reuse the existing recharts `ComposedChart` (bars coloured per-point by state + a dashed
budget `Line`) exactly as [`BudgetDetailPage.tsx:135-145`](../../src/pages/BudgetDetailPage.tsx);
it already satisfies the requirement and respects reduced motion.

### 6.7 Create / edit a category budget

| | |
|---|---|
| **Purpose** | Add or change one flexible envelope. |
| **Hierarchy** | Name → amount → (collapsed) advanced. |
| **Primary action** | `Save`. |
| **Secondary** | `Remove` (destructive, visually separated — keep the current footer treatment at [`BudgetDialog.tsx:131-149`](../../src/components/budget/BudgetDialog.tsx)). |
| **Visible by default** | Envelope name (with category autocomplete from `/api/categories`), amount with currency prefix, and the period cadence defaulting to the plan's. |
| **Progressively disclosed** | `Advanced` disclosure: which categories feed it (multi-select), cadence override, rollover policy (4 radio options), priority (3 chips), "exclude transactions tagged …". |
| **Microcopy** | Category matcher helper: "Spending in these categories counts toward this envelope." Rollover options: "Don't carry anything" / "Carry what's left over" / "Carry an overspend" / "Carry both". |
| **Validation** | Name required, ≤60 chars (matches `MAX_NAME_LENGTH`). Amount `> 0` to save, `0` = remove. **A category may feed at most one flexible envelope** — on collision, show "{{category}} already counts toward {{envelope}}" and offer `Move it here`. |
| **Edge cases** | Creating an envelope for a category with existing spend this period → immediately shows that spend (with a note "Includes {{amount}} already spent this period"), never silently starts at 0. Free-text/legacy category casing → §8.3's case-insensitive matcher means `rent` and `Rent` both match; the picker shows the canonical name. |

### 6.8 Add a commitment

| | |
|---|---|
| **Purpose** | Record a bill that must be paid, so it lands in `Reserved`. |
| **Hierarchy** | What → how much → when → which account. |
| **Primary action** | `Add commitment` — creating a `budget_commitments` row that is either **one-time** (a due date + amount) or **recurring** (delegating its schedule to a `recurring_rules` row). |
| **Secondary** | `Link an existing recurring payment` (picker over `/api/recurring`). |
| **Visible by default** | Name, amount, then a two-chip choice — **`Repeats` / `Just once`** — which is the whole of blocker #2 in the UI. `Just once`: a single due date. `Repeats`: frequency (`month` default) + interval + next due date. Then the source account. |
| **Progressively disclosed** | End date, category, priority, "this is a debt payment" (switches the section to `debt`). |
| **Microcopy** | "Bills you can't skip. We'll hold this money back from what's safe to spend." Consequence line: "Adding this reduces safe to spend by {{amount}} until it's paid." And the reassurance that matters: **"This doesn't move any money — your account balance is unchanged until you actually pay it."** |
| **Validation** | Reuse [`recurring-validate.ts`](../../api/_lib/recurring-validate.ts) verbatim — name ≤120, amount `> 0`, interval 1–365, ISO dates, `end_date >= start_date`. Account must be active and non-Space. |
| **Edge cases** | **Recurring only:** a back-dated `start_date` immediately materializes catch-up transactions and moves real balances ([`recurring.ts:87-89`](../../api/_routes/recurring.ts)) — warn explicitly, "This will record {{count}} past payments", reusing `recurring.backdatedHint`. **A one-time commitment never does this** — a past due date simply shows as overdue and unpaid, which is the honest behaviour. Linking a rule already linked → refuse, with a link to that envelope. A commitment may attach only to a `commitment`/`debt` envelope (§8.3.3). Free plan at its transaction quota → the materializer records `last_error`; surface it as a chip, not a silent failure. Each occurrence row offers **`Mark paid`**, **`Skip this one`** and **`Cancel`** (§9.2). |

### 6.9 Add a savings allocation

| | |
|---|---|
| **Purpose** | Protect money by routing it to a Space. |
| **Hierarchy** | Which Space (or `New Space`) → how much per period → optional auto-save. |
| **Primary action** | `Add savings`. |
| **Visible** | Amount per period, and a `Where should it sit?` choice defaulting to **`Hold it back` (virtual)**, with `Move it to a Space` as the alternative. The Space picker appears only for the second option. |
| **Progressively disclosed** | Auto-save source account + schedule (reuses the existing auto-save PUT), and pace feedback (`ahead`/`on_track`/`behind` from `autoSavePace`). |
| **Microcopy** | "Money you're setting aside. It won't show as safe to spend." Virtual: "The money stays in your account — we just won't count it as spendable." Space-backed: "The money actually moves into {{space}}." Auto-save: "Move {{amount}} from {{account}} every {{period}}." |
| **Validation** | Amount `> 0`. For Space-backed: the Space must belong to the org and be active, and the auto-save source must be an active bank/cash account, never a Space (already enforced at [`auto-save.ts:81`](../../api/_routes/spaces/[id]/auto-save.ts)). |
| **Edge cases** | **Virtual savings need no quota and no Space**, so a free user is never blocked here. Choosing `Move it to a Space` while at the Spaces limit → the existing crown/upgrade dialog, **with virtual offered as the no-cost alternative** rather than a dead end. Space-backed is unavailable on business orgs (Spaces are personal-only); virtual would work there, but the Savings section stays out of scope for business in Phase 1–4 by choice (§23). |

### 6.10 Create a sinking fund

A sinking fund is a **`savings` envelope** with a goal, a target date and a **funding mode** —
`virtual` by default (a reservation; no money moves; unlimited on every plan) or
`space_backed` (real transfers into a Space). §8.9.

| | |
|---|---|
| **Purpose** | Accumulate for a known future expense. |
| **Hierarchy** | Name → total needed → by when → suggested monthly (computed) → automate. |
| **Primary action** | `Create fund`. |
| **Visible** | Name, `goal_amount`, `target_date`, and a **live derived** "Set aside {{amount}}/month to reach it" line from `suggestedMonthly()` — identical for both funding modes. |
| **Progressively disclosed** | The funding-mode switch (`Hold it back` ⇄ `Move it to a Space`); **`Confirm automatically each period`** (`auto_fund`, default **off**, §8.9.1); auto-save source + frequency (Space-backed only); "start from an amount I already have". |
| **Microcopy** | Worked example from the brief: "€750 by next March = **€62.50/month**." Overdue: "The date has passed — €{{remaining}} still needed." Reached: "Fully funded." Mode explainers, the crux of blocker #3: virtual → "The money stays where it is. We just stop counting it as safe to spend."; Space-backed → "The money moves into a Space, out of your spendable balance." **Contribution states must be worded exactly** (§8.9.1): `planned` → "{{amount}} reserved this period · not yet confirmed"; `confirmed` → "{{amount}} set aside"; `missed` → "Not confirmed last period, so it wasn't set aside". `auto_fund` label: "Confirm my contribution automatically when each period closes." |
| **Validation** | `parseGoal` / `parseTargetDate` from [`api/_lib/spaces.ts:30-43`](../../api/_lib/spaces.ts) — reuse, don't reimplement. `target_date` in the future for the pace calculation; a past date is allowed and yields `overdue`. Converting virtual → Space-backed requires Spaces quota headroom; the reverse never does. |
| **Edge cases** | Target date ≤ today → the suggestion is the whole remainder (already the library's behaviour). Goal reached → suggestion 0 and no further contributions are reserved. **Free plan** → unlimited virtual funds; only Space-backing is quota-gated. **Spending the fund** → §9.8's guided flow: `Use this fund` performs a withdrawal entry (virtual) or a Space→account transfer (Space-backed) and then pre-fills the expense, in one confirmation. Doing only the expense would overdraw an account the user believed was funded, so the guided path is mandatory. **Converting modes** → one confirmation, one transfer, one audited event. |

### 6.11 Overspending resolution

Triggered from an over-budget envelope, never automatically.

| | |
|---|---|
| **Purpose** | Turn an overspend into a decision, without judgement. |
| **Hierarchy** | The fact → three options, in ascending disruption → the consequence of each. |
| **Primary action** | None preselected. The user picks. |
| **Options** | **1.** Cover from another envelope (picker showing only envelopes with a surplus). **2.** Use unallocated money (shown with its balance; disabled with an explanation when 0). **3.** Leave it over budget. |
| **The distinction that must be in the copy** | Option 1 **moves room, it does not create it** — `Σ planned` is unchanged, so `Safe to spend` does not move (§8.5.2). Option 2 **does** increase capacity. Saying so prevents "cover it from Dining" being misread as "I can spend more now". |
| **Microcopy** | Verbatim from the brief: "Groceries is €24 over budget. You can cover it from Dining, use Unallocated money, or leave it over budget." Each option shows its own consequence: option 1 → "Dining would drop from €80 to €56. Your safe-to-spend stays the same." · option 2 → "Your unallocated money drops from €120 to €96, and safe-to-spend rises by €24." |
| **Validation** | Source must have ≥ the amount; partial covers allowed (a slider/field, defaulting to the full overspend). |
| **Edge cases** | No envelope has a surplus and unallocated is 0 → only option 3, with copy "Nothing else has spare room this period. You can lower a target or leave this over." Multiple simultaneous overspends → one entry point per envelope; never a bulk auto-fix. **Option 3 is a first-class, non-penalised choice** and must not nag afterwards. |

### 6.12 Reallocation flow

| | |
|---|---|
| **Purpose** | Move planned money between envelopes with an audit trail (P4). |
| **Hierarchy** | From → amount → To → consequence → confirm. |
| **Primary action** | `Move money`. |
| **Visible** | Both envelopes with before/after figures. |
| **Microcopy** | "Move {{amount}} from {{from}} to {{to}}?" then "{{from}}: {{beforeA}} → {{afterA}} · {{to}}: {{beforeB}} → {{afterB}}". |
| **Validation** | Amount `> 0`, `<= source remaining` (or source's planned, per **decision D-8** in §20 — whether a reallocation may create a source overspend). Both envelopes must be in the **same open period**. |
| **Edge cases** | Reallocating into a `commitment` envelope whose amount is derived from a recurring rule → refuse: "This amount comes from a scheduled payment. Change the payment instead." (with a deep link). Reallocating in a **closed** period → refused server-side. Every accepted reallocation writes two `budget_events` rows plus one paired `budget_adjustment` (§10.9), and appears in both envelopes' timelines. |
| **Explicitly forbidden** | Any automatic reallocation, including "smart auto-balance". Proposals only. |

### 6.13 Paused budget

| | |
|---|---|
| **Purpose** | Stop tracking without losing history. |
| **Hierarchy** | A persistent banner at the top of `/budgets`, then the plan rendered read-only at reduced emphasis (70 % opacity, matching the paused-rules treatment at [`RecurringPage.tsx:381-385`](../../src/pages/RecurringPage.tsx)). |
| **Primary action** | `Resume budget`. |
| **Secondary** | `View history`, `Delete plan` (owner/admin only, with an explicit "history is kept" promise). |
| **Microcopy** | "Budget paused on {{date}}. Nothing is being tracked and no alerts will be sent. Your history is kept." |
| **Edge cases** | **While paused: no periods are opened, no alerts fire, no snapshots are written.** On resume, the user is asked whether to open a fresh period from today or backfill the periods that elapsed — **never** silently backfill (that is the recurring-rule trap in §2.6). Paused ≠ empty: the empty state must not appear. |

### 6.14 Period close / review

| | |
|---|---|
| **Purpose** | Give the period a definite end, and make the snapshot a moment the user sees. |
| **Hierarchy** | Headline outcome → per-envelope result list → rollover decisions → `Start next period`. |
| **Primary action** | `Start {{month}}`. **Unconfirmed savings contributions do not block it** — closing marks them `missed`, which the screen states plainly before the user proceeds. |
| **Secondary** | `Adjust rollovers`, `Review later` (dismiss; the period still closes). |
| **Visible** | Per envelope: planned vs actual with a state chip, in **that section's** vocabulary (§8.7). Plus the period's funding base and capacity, the flexible surplus/deficit (signed), and what each envelope will carry. **A `Savings contributions` block lists every fund with a `planned` contribution and a `Confirm` / `Skip` control, plus `Confirm all`** — this is the one screen where §8.9.1's confirmation normally happens. |
| **Microcopy** | Neutral summary scoped to spending: "You planned {{planned}} of flexible spending and spent {{spent}}." Bills, savings and debt are summarised separately ("All {{count}} bills paid", "{{amount}} confirmed to savings"). If contributions were missed: "{{amount}} was reserved for savings but not confirmed, so it wasn't set aside." — factual, not a reprimand. Then per envelope: "Groceries: {{amount}} left → carried to next period" / "Dining: {{amount}} over → not carried". No grade, no emoji, no streak celebration beyond a factual "{{count}} of {{total}} within plan". |
| **Validation** | Rollover amounts are editable but bounded by the actual surplus/deficit. |
| **Edge cases** | **The close must be idempotent** — a second close is a no-op returning the existing snapshot version (§10.14), and virtual-fund credits cannot double-apply. A period that elapsed while the user was away closes during `sync` (§8.10) and this review is shown retrospectively. Several elapsed periods close oldest-first, showing only the most recent review plus "{{count}} earlier periods were closed". A period that is later **restated** shows a chip here too, linking to §6.17. `viewer` cannot close. |

### 6.15 Start next period

| | |
|---|---|
| **Purpose** | Choose how the next period's allocations are seeded. |
| **Primary action** | `Copy last period` (default). |
| **Secondary** | `Start fresh` (all envelopes at 0), `Use suggestions` (from history). |
| **Microcopy** | "How should {{month}} start?" · "Copy last period — same targets as {{lastMonth}}" · "Start fresh — set every amount yourself" · "Use suggestions — based on your last 3 months". |
| **Edge cases** | First-ever period → this screen is skipped. Commitment envelopes are **always** re-derived from their recurring rule, never copied, so a changed bill amount is picked up. Sinking-fund contributions are re-derived from `suggestedMonthly`. |

### 6.16 Custom planning-cycle setup — `/budgets/settings`

| | |
|---|---|
| **Purpose** | Match the plan to how the user is actually paid. |
| **Hierarchy** | Cadence choice → anchor → preview of the next three periods. |
| **Primary action** | `Save cycle`. |
| **Visible** | Four options: *Calendar month* · *Weekly* · *Pay cycle* · *Custom range*, plus a live preview ("1 Oct – 31 Oct", "27 Sep – 26 Oct", …). |
| **Progressively disclosed** | Week-start day; pay-cycle anchor (day-of-month, last-working-day, or "when income lands in {{account}}"); timezone (defaults from the browser, `safeTimezone`-validated). |
| **Microcopy** | "When does your money reset?" Change warning: "Changing this affects future periods only. Closed periods keep their original dates." |
| **Validation** | Custom range 1–400 days (mirrors `MAX_RANGE_DAYS` in [`calendar.ts:9`](../../api/_routes/calendar.ts)). Day-of-month 1–31 with an explicit short-month rule ("the 31st becomes the last day in shorter months" — the clamping already implemented in [`recurring.ts:42-48`](../../src/lib/recurring.ts)). |
| **Edge cases** | Changing cadence mid-period → **the current period keeps its boundaries**; the change applies from the next period (this is what makes §8.10 deterministic). A DST transition inside a period must not shift a boundary (§8.2, tested in §16.7). |

### 6.17 Historical period view — `/budgets/periods/:periodId`

| | |
|---|---|
| **Purpose** | Show the operative record for a closed period — corrected if it has been restated, with the original always one tap away (P5, §8.11). |
| **Hierarchy** | Period dates + a `Closed` chip (and a `Restated` chip when `version > 1`) → the figures as at close → per-section and per-envelope detail → the adjustments made during it. |
| **Primary action** | None. Read-only. |
| **Secondary** | `View original` (when restated), `Version history`, `Export` (deferred), `Compare to current`. |
| **Microcopy** | Unrestated: "Closed on {{date}}." Restated: **"Restated on {{date}} because a transaction in this period was edited. · View original"** — one chip, one operative set of figures. The version-history view lists each version with its reason, actor, date and what changed ("Groceries: €372.10 → €352.10"). This is the resolution of defect #8: the *original* is preserved and auditable, while the number on screen is the corrected one. |
| **Edge cases** | A pre-migration period has no snapshot → banner "History before {{date}} is reconstructed from transactions and may change if old transactions are edited" (§13.5). Many restatements → the chip reads "Restated {{count}} times · view history" rather than listing them inline. A restatement caused by a **settlement** arriving late says so specifically: "Restated because a refund for this period arrived on {{date}}." A restatement never rewrites an already-applied rollover — the correction appears as a funding adjustment in the later period, and the chip links to it (§8.12). |

### 6.18 Forecast explanation

A drawer (`vaul`) on mobile, a popover on desktop.

| | |
|---|---|
| **Purpose** | Make the forecast auditable so it is trusted. |
| **Content** | A signed waterfall: `Available now` → `+ expected income` → `− unpaid commitments` → `− planned debt` → `− planned savings` → `− remaining flexible` = `Forecast balance`, each line tappable to its source. |
| **Microcopy** | "By {{date}} you're on track to have {{amount}}." Then "This assumes your {{count}} scheduled payments go out on time and {{income}} arrives." Irregular-income mode: "You haven't set expected income, so this only counts money you already have." |
| **Edge cases** | No commitments and no income → the forecast equals `Available now`; say so plainly rather than showing an empty waterfall. Confidence must be **stated, never numeric** — no fake percentages (P8). |

### 6.19 Safe-to-spend explanation

| | |
|---|---|
| **Purpose** | The single most important explainer in the product — it must teach that **two** limits apply. |
| **Content** | Two stacked calculations, then the binding one highlighted: **(a)** `Available now` − `Reserved` = *cash after reservations*, with `Reserved` expanded into its contributors (unpaid bills — **including overdue ones** · debt · virtual fund balances · unconfirmed contributions · protected savings), each tappable; **(b)** `Σ planned − Σ spent − Σ pending`, floored at 0, = *plan headroom* — shown as one netted subtraction, **not** a list of per-envelope leftovers, so an overspend visibly reduces it (§8.5.1). Then: "Safe to spend is the lower of the two: {{amount}}." |
| **Microcopy** | "You have {{available}} across {{count}} accounts. {{reserved}} is already needed for bills, debt payments and savings before {{date}}, leaving {{cash}}. Your plan allows another {{headroom}} of spending this period. Safe to spend is the lower of the two: **{{safe}}**." Then, as appropriate: "Money in Spaces isn't counted here — it's already set aside." and "Money held back for your funds stays in your account but isn't counted as spendable." |
| **Edge cases** | **No ceiling set** (`cash_only`) → the (b) half is replaced by "You haven't set a spending target, so only your cash limits this" plus `Set a target`. **Nothing reserved** → "Nothing is reserved right now." **Reserved > available** → "Bills due before {{date}} come to {{amount}} more than you have available" plus `See what's due` — factual, amber, no alarm styling. **Headroom is 0 but cash is plentiful** → "Your plan is fully used for this period. You have {{cash}} uncommitted if you decide to change the plan" plus the explicit `Use unallocated money` / `Raise a target` actions — never an automatic top-up. |

### 6.20 Mobile layout

- Single column, `p-3` (vs `sm:p-6`), section cards full-width.
- **`Safe to spend` is the entire first viewport** — headline figure, the context strip, and nothing else above the fold.
- Section cards collapse to a header row (name · subtotal · bar) that expands in place with `useAutoAnimate`; envelope rows are 56 px tall.
- Every editor is a **`vaul` drawer**, not a centre dialog — matching `AccountQuickAddSheet` and the existing transfer wizard.
- The plan equation on `/budgets/plan` becomes a sticky bottom bar showing only `Unallocated`, expanding on tap.
- Reachability: primary actions in the lower 60 % of the screen; the period switcher is a bottom sheet.
- `/budgets` is reached from the **More** sheet (already wired, `MobileAppLayout.tsx:103`); consider promoting it to a primary tab for personal accounts — **decision D-9** (§20).
- Numbers must not truncate: reuse [`FitText`](../../src/components/FitText.tsx) for the headline, as the wealth hero does.

### 6.21 Desktop layout

- Two columns from `lg`: left (7/12) the four numbers + section cards; right (5/12) a sticky rail with the plan equation, alerts and suggestions.
- `/budgets/plan` is a single wide table: envelope · planned · spent · pending · remaining · rollover · `⋯`, in `overflow-x-auto`.
- Envelope detail is a two-column split: chart + stats left, transactions + timeline right.
- Inline editing on the plan table (click a figure → input, Enter commits, Esc reverts) with the dirty `Save` bar pinned to the bottom of the rail.

### 6.22 Accessibility

Requirements, all testable (§16.14):

- **Never colour alone.** Every state carries a text label or icon as well as a hue — the current `BudgetIndicator` already pairs the bar with "€X left / over"; keep that invariant for every new bar, chip and dot.
- Contrast ≥ 4.5:1 for text and ≥ 3:1 for the bar against `bg-card`, in **both** themes. The amber-500 on light `bg-card` combination must be verified, not assumed.
- Progress bars: `role="progressbar"` with `aria-valuenow/min/max` and an `aria-label` naming the envelope. The v1 indicator has only an `aria-label` on the wrapper — insufficient.
- The headline is a live region: `aria-live="polite"` on `Safe to spend` so an in-place refresh is announced once (debounced, not per keystroke).
- Full keyboard path for reallocation and period close; visible `focus-visible:ring-2 focus-visible:ring-ring` on every interactive card (the existing cards already do this via `role="button" tabIndex={0}` + Enter/Space handlers — reuse that exact pattern).
- Charts need a non-visual equivalent: a `<table class="sr-only">` of period/planned/spent, since recharts output is not screen-reader legible.
- Drawers/dialogs: focus trap, `Esc` to close, focus restored to the trigger, `aria-labelledby` wired to the title.
- Respect `prefers-reduced-motion` for bar transitions, chart animation and the `page-enter` route transition.
- Announce state changes as text: "Groceries, €24 over budget" — not "Groceries, red".

### 6.23 Loading, empty, partial and error states

| State | Requirement |
|---|---|
| **Loading** | Skeletons shaped like the final content (`h-24 rounded-2xl` hero + three `h-28 rounded-xl` cards, exactly as [`BudgetsPage.tsx:86-90`](../../src/pages/BudgetsPage.tsx)). Never a bare spinner where a number will appear. Refetches **never** re-show the skeleton (`Dashboard.tsx:923-924` pattern). |
| **Empty** | §6.2. Distinct from paused (§6.13) and from "no history yet" (a *partial* state). |
| **Partial** | Explicit and named, not silent: **no history** → suggestions and charts hidden with "Not enough history yet"; **no accounts** → `Available now` unavailable, with "Add an account to see what's safe to spend" (deep link to `/wealth`); **recurring materialization skew** → if any linked rule carries `last_error`, show "One scheduled payment couldn't be recorded" with a link; **snapshot missing** (pre-migration) → §6.17's banner. |
| **Error** | Per-section inline errors that keep the rest of the screen usable — a failed `/budgets/suggestions` must never blank the overview. Retry affordance. Errors use `apiErrorMessage(err, fallback)` ([`api.ts:145-160`](../../src/lib/api.ts)) so a quota/JSON body renders its `reason`. `402` with `upgradeHint` opens the existing upgrade dialog. Never a raw `Error.message` (the client throws the response body as the message, so unhandled it would print JSON). |

---

## 7. Financial glossary

Canonical definitions. These strings are the basis of the i18n keys and must be used
consistently in UI, code identifiers and this document.

| Term | Definition | Computed |
|---|---|---|
| **Plan** | The org's budgeting configuration: cadence, anchor, timezone, income mode, included accounts, and its envelopes. At most one active per org. | stored |
| **Period** | One materialized instance of the plan's cadence, `[start, end_exclusive)` in the plan's timezone. `open` or `closed`. | stored |
| **Funding base** | The period's capacity, anchored so income cannot be double-counted: **reconstructed at the true period boundary** (preferred), or captured as an explicit **snapshot instant** when the plan began mid-period. **Spending never changes it.** | cached + audited (§8.4.1) |
| **Funding base anchor date** | The plan-local **calendar date** the base is anchored to. Compared only against `transactions.date`. | stored |
| **Funding base as-of** | The capture **instant**, snapshot mode only. Compared only against `transactions.created_at`. | stored |
| **Income accretion** | Income that qualifies to increase capacity: dated on/after the anchor date (reconstructed mode) or created after the as-of instant (snapshot mode). Never income already inside the base. | derived |
| **Funding adjustment** | An explicit, audited change to a period's capacity (a bonus, a corrected expectation). May be negative. | stored as an event |
| **Funding capacity** | `funding_base + adjustments` (+ income received, in available mode). The denominator of the planning equation. | derived |
| **Envelope** | A durable line item in the plan (what other products call a category budget). Belongs to exactly one section. Spans periods. | stored |
| **Section** | The fixed classification that determines an envelope's effect on the four numbers: `income`, `commitment`, `flexible`, `savings`, `debt`. **Section totals are never summed together for utilisation.** | enum |
| **Allocation** | The planned amount for one envelope in one period. | stored per period |
| **Planned** | An envelope's allocation for the period, **including** rollover in. | derived |
| **Spent (gross)** | Sum of matched outgoing transactions in the period. | derived |
| **Refund (provisional)** | A category-matched inflow with no settlement link, **presumed** to be a refund and disclosed as such. Confirmable or rejectable in one tap. | derived |
| **Refund (confirmed)** | An inflow explicitly linked to an expense via `transaction_settlements` (Phase 2). | stored link |
| **Spent (net)** | `spent_gross − refunds`. May be negative when refunds exceed spend. | derived |
| **Commitment** | A known obligation: **`one_time`** (a due date + amount) or **`recurring`** (delegating its schedule to a `recurring_rules` row). | stored |
| **Occurrence** | One expected instance of a commitment on a date. A **budget-owned expectation, not a transaction — it never moves a bank balance.** States: `expected` (projected, unstored) · `settled` · `cancelled` · `skipped` · `rescheduled`. | projected; deviations stored |
| **Overdue** | A **derived presentation condition**, not a state: `state = 'expected' AND due_date < today`. An overdue occurrence stays in `Pending` and `Reserved` — **only an explicit decision resolves it**, never the passage of time (§8.6.1). | derived |
| **Settlement (occurrence)** | The link from an occurrence to the posted transaction that paid it. Makes `Spent` and `Pending` mutually exclusive by construction. | stored |
| **Pending** | Sum of `expected` occurrence amounts due within the period and on/after today. | derived |
| **Remaining (envelope)** | `Planned − Spent (net) − Pending`. **Signed** — negative when the envelope is over. Shown on the card. | derived |
| **Flexible headroom (plan)** | `max(0, Σ planned − Σ spent_net − Σ pending)` — **netted across envelopes, then floored once**, so one envelope's overspend consumes another's surplus. Never `Σ max(0, remaining)` (§8.5.1). | derived |
| **Rollover** | Surplus or deficit carried from the previous period, per the envelope's carry policy. | stored at close |
| **Sinking fund** | A `savings` envelope with a goal and target date, in one of two **funding modes**. | stored |
| **Funding mode — `virtual`** | The money stays in the bank account and is **reserved** rather than moved. Unlimited on every plan. Its **balance is part of `Available now` and must be reserved.** | stored |
| **Contribution — `planned`** | This period's intended contribution. **Reserved automatically** (it is the plan) but **not** claimed as set aside. | stored per period |
| **Contribution — `confirmed`** | The user confirmed it, or `auto_fund` is on. The **only** state that may be called *funded*, and the only one that writes a fund entry. | stored |
| **Contribution — `missed`** | The period closed with it still merely planned and `auto_fund` off. Not funded; the goal pace falls behind. | stored |
| **`auto_fund`** | Per-fund, opt-in, default **off**: confirm this fund's contribution automatically at period close. Enabling it is audited. | stored |
| **Funding mode — `space_backed`** | The money is physically transferred into a Space. Its **balance is already outside `Available now` and must NOT be reserved again** — only its due, untransferred contributions are. | stored |
| **Fund entry** | One **confirmed** contribution, withdrawal or signed adjustment in a virtual fund's ledger. Its balance is the signed sum. A merely planned contribution writes none. | stored |
| **Available now** | `Σ current_balance` of the plan's included, non-archived `bank`/`cash` accounts. **Excludes Spaces.** Point-in-time, not period-scoped. | derived |
| **Reserved** | Money already required before the horizon: unpaid commitment and debt occurrences (**including overdue ones, from any earlier period**) + confirmed virtual fund balances + planned-unconfirmed contributions + protected savings not yet funded. | derived |
| **Cash after reservations** | `Available now − Reserved`. One of the two bounds on `Safe to spend`. | derived |
| **Flexible headroom** | `Σ flexible (planned − spent_net − pending)`. The other bound. | derived |
| **Safe to spend** | `min(cash after reservations, flexible headroom)` — or just the cash bound when no ceiling is defined. The headline number. May be negative (a cash shortfall); the plan bound itself is floored at 0. | derived |
| **Binding** | Which limit produced `Safe to spend`: `cash` · `plan` · `both` · `cash_only`. Returned so the UI can explain *why*. | derived |
| **Ceiling defined** | Whether any flexible envelope has a positive planned amount. `false` ⇒ cash-bound only, stated explicitly. | derived |
| **Forecast balance** | `Available now + expected remaining income − all remaining planned outflow`, at the period end. | derived |
| **Unallocated** | `Funding capacity − Σ allocations`. A buffer, **never** folded into `Safe to spend`; offered only as an explicit opt-in top-up. | derived |
| **Total outflow** | `flexible.spent_net + commitment.settled + debt.paid + savings.funded_cash`. A **cash** figure, never a utilisation denominator. | derived |
| **Utilisation** | `state(flexible.spent_net + pending, flexible.planned)` — the **flexible section alone**. | derived |
| **Horizon** | The date `Reserved` looks ahead to: the earlier of the period end and the next expected income date. | derived |
| **Income mode** | `expected` (a stated income figure drives the plan) or `available` (the plan is driven by cash at period open). | stored |
| **Priority** | `essential` / `important` / `optional`. Advisory ordering only; **no** effect on any of the four numbers. | stored |
| **Snapshot** | The frozen report of a closed period. **Versioned**: `version 1` is the original close. | stored at close |
| **Restatement** | A new snapshot version created when a closed period's underlying transactions change. The latest version is the operative record; **the original is preserved forever** and is disclosed in the UI. | stored |
| **Included / excluded** | Whether a transaction or category counts toward the plan. Exclusion is explicit and audited, and also carries "not a refund". | stored rule |
| **Reimbursable** | An envelope flag marking outflows the user expects back. Display-only; the expense still counts as spend. | stored |
| **Sync** | The idempotent reconciliation step (`POST /api/budgets/v2/sync`): materialize due recurring rows, settle occurrences, close/open periods, restate drifted periods. **Budget reads never do this themselves.** | operation |

Terms deliberately **not** used, to avoid ambiguity: *"budget"* alone (always qualified — plan,
envelope, or allocation); *"balance"* alone (always `Available now`, `current_balance`,
`Forecast balance`, or a named fund balance); *"spent"* alone on a savings or commitment
section (they use *funded* and *settled*); and *"total"* alone (always `funding capacity`,
`total outflow`, or a named section total).
---

## 8. Complete calculation rules

> **Revision note (2026-09-02, financial-model review).** §8 was substantially rewritten.
> `Safe to spend` is now a bounded intersection of cash and plan headroom (§8.5); plan
> utilisation is computed on the flexible section alone (§8.7); a stable **period funding
> base** replaces the drifting available-mode formula (§8.4); `Pending` derives from
> **expected occurrences** rather than by counting recurring rules (§8.6); refund netting is
> **provisional and disclosed** (§8.8); closed periods use **audited restatement** rather
> than permanent snapshot-vs-live divergence (§8.11).
>
> **Revision note (rev 3, correctness review).** Four further fixes: plan-wide flexible
> headroom is **netted before flooring**, so an overspend in one envelope reduces total
> capacity (§8.5.1); **overdue** expected occurrences stay in `Pending` and `Reserved` until
> explicitly resolved (§8.6.1); the funding base is **reconstructed at the true period
> boundary** with an accretion boundary that cannot double-count income (§8.4); and a virtual
> fund contribution is never claimed **funded** without confirmation or an explicit auto-fund
> opt-in (§8.9.1).

### 8.0 Storage classification

| Value | Classification | Recomputed after a historical edit? |
|---|---|---|
| Allocation (`planned_amount`) | **stored** per period | No — an intent, not a measurement |
| **Period funding base** | **reconstructed at the period boundary**, cached on the period row, self-correcting and audited on change | **Yes, by recomputation + audit** — never by silent mutation (§8.4) |
| Funding adjustments | **stored** as audited events | No |
| Rollover in/out | **stored** at period close | No |
| Fund balance (virtual) | **stored** as a ledger of **confirmed** entries only | No |
| Virtual contribution status | **stored** per `(envelope, period)`: `planned \| confirmed \| missed \| skipped` | No |
| Fund balance (Space-backed) | **derived** from the Space's `current_balance` | n/a |
| Occurrence state (settled/cancelled/skipped) | **stored**; plain `expected` is **projected in memory** | n/a |
| Spent (open period) | **derived live** | Yes, immediately |
| Spent (closed period) | **snapshotted**, with **audited restatement** on drift | Via a new snapshot version, never by mutation (§8.11) |
| Pending | **derived live** from projected occurrences | n/a |
| Available now | **derived live** from `wealth_accounts.current_balance` | n/a |
| Reserved · Safe to spend · Forecast | **derived live** | n/a |
| Section totals · utilisation | **derived live** (open) / snapshotted (closed) | As spent |
| Suggestions | **derived live**, never stored | Yes |

**The load-bearing rule:** an **open** period is derived live so it is always correct; a
**closed** period is read from its current snapshot version so it is always stable *and*
always correct, because drift produces a new audited version rather than a silent rewrite
or a confusing dual figure.

### 8.1 One shared math module

All threshold, window and normalisation logic lives in one pure, import-free module,
`src/lib/budget-math.ts`, replacing the triplicated logic of defect #14. Imported by the API
(with a `.js` extension), the client and Vitest. No DB or React imports.

```
WARN_RATIO = 0.8

state(spent, planned):
  if planned <= 0:    return spent > 0 ? "over" : "none"
  r = spent / planned
  if r >  1.0:        return "over"
  if r == 1.0:        return "full"     // NEW — exactly spent (fixes #15)
  if r >= WARN_RATIO: return "warn"
  return "ok"
```

`full` is a fifth state — neutral-to-amber, "fully used", distinct from both "nearing" and
"over". Alert tiers reuse this function (§14.3) so a notification and a bar can never
disagree.

### 8.2 Period boundaries — timezone-correct (fixes #5)

Periods are computed in the **plan's IANA timezone**, validated by the existing
`safeTimezone()` ([`schedule-notifications.ts:54-62`](../../src/lib/schedule-notifications.ts) —
falls back to `"UTC"`), already in production for reminders.

```
todayInPlanTz(tz) -> 'YYYY-MM-DD'
  = Intl.DateTimeFormat('en-CA', { timeZone: safeTimezone(tz),
      year:'numeric', month:'2-digit', day:'2-digit' }).format(now)

periodFor(plan, todayLocal) -> { start, endExclusive }        // both 'YYYY-MM-DD'
  monthly : first of todayLocal's month → first of next month
  weekly  : most recent plan.week_start_day <= todayLocal → +7d
  payday  : most recent anchor occurrence <= todayLocal → next anchor occurrence
            // anchor = day_of_month, clamped to month length exactly as recurring.ts:42-48
  custom  : plan.custom_start → + plan.custom_days
```

**Why this is DST-safe:** every boundary is a **calendar date string**, never an instant;
`transactions.date` is a bare Postgres `date`, and comparisons are
`date >= start AND date < endExclusive` on strings. No `Date` arithmetic crosses a DST
edge, so a period cannot gain or lose an hour. This mirrors the deliberate choice at
[`recurring.ts:1-8`](../../src/lib/recurring.ts) and the `date::text` cast at
[`calendar.ts:36`](../../api/_routes/calendar.ts). **The only timezone-sensitive value is
"what is today"**, now resolved in the plan's tz rather than UTC.

### 8.3 Inclusion and envelope matching

```
includedInPlan(tx, plan):
  tx.deleted_at IS NULL                      // trashed never counts
  AND tx.kind = 'standard'                   // transfers never count
  AND tx.is_system = false                   // FIXES #1
  AND tx.wealth_account_id IN plan.included_account_ids
  AND NOT excluded(tx)                       // explicit audited opt-out
```

**8.3.1 Category matching.** `transactions.category` is free text with inconsistent casing
(§2.6), and we must not migrate historical text. Matching is therefore **case-insensitive
and trimmed of surrounding spaces** at the boundary — U+0020 only, exactly what Postgres
`btrim(text)` strips (tab, LF, CR and unicode whitespace are part of the name), so the JS
mirror and the functional index can never disagree:

```
envelopeFor(tx, envelopes):
  key = lower(btrim(coalesce(tx.category, '')))
  return envelopes.find(e => e.section IN ('flexible','income')
                          && e.match_keys.includes(key))
      ?? envelopes.find(e => e.is_catch_all && e.section='flexible')
      ?? null                                // unmatched → plan level only
```

In SQL: `lower(btrim(category)) = ANY($keys)`, requiring the functional index in §17.2.
`match_keys` is stored pre-lowered so index and app agree.

**8.3.2 One category, one envelope.** Enforced on write: a category key may feed at most one
`flexible` envelope per plan, so `Σ envelope spend ≤ plan spend` with no double counting.

**8.3.3 Commitments attach only to `commitment` or `debt` envelopes.** Enforced on write.
This makes the reserved/headroom split in §8.5 provably free of double counting: an
occurrence contributes to `Reserved` (via its commitment/debt envelope) **or** to a flexible
envelope's `pending`, never both. Flexible `pending` is consequently 0 in Phase 1 and the
term is retained for a future manually-scheduled discretionary payment.

### 8.4 Period funding base — stable capacity without double-counting income

**The problems being fixed.** (rev 2) `unallocated = availableNow − Σ allocations` drifted
downward as the user spent, so it could not serve as the period's funding capacity. (rev 3)
Snapshotting `availableNow` at *open* and then adding **all** of the period's income
double-counts any income that had already landed before the snapshot — which is the normal
case whenever a period opens lazily, several days late.

**The fix.** Two sources, one precise accretion boundary, and never both counting the same
euro.

```
// ---- Source A (PREFERRED): reconstruct the balance at the true period boundary ----
// Roll the current balance back over everything that has moved it since period.start.
balanceMovedSince(plan, fromDate) =
  Σ over transactions t on the plan's INCLUDED accounts with t.date >= fromDate
    AND ( t.deleted_at IS NULL OR t.is_system = true )      // ← see the subtlety below
    of ( t.type = 'incoming' ? +t.amount : −t.amount )

fundingBaseReconstructed(plan, p) = availableNow(plan) − balanceMovedSince(plan, p.start)
  → funding_base_source      = 'reconstructed_at_boundary'
  → funding_base_anchor_date = p.start
  → funding_base_as_of       = NULL          (a calendar boundary, not an instant)

// ---- Source B (FALLBACK): an explicit snapshot instant ----
// Used ONLY when reconstruction would describe a period the plan did not govern —
// i.e. a plan created mid-period (§8.4.2 case 1).
fundingBaseSnapshot(plan) = availableNow(plan) at the moment of capture
  → funding_base_source      = 'snapshot_at_open'
  → funding_base_anchor_date = todayInPlanTz(plan.timezone)
  → funding_base_as_of       = now()          (a real instant, stored)

// ---- Source C: expected-income mode is unchanged ----
fundingBaseExpected(plan) = plan.expected_income
  → funding_base_source = 'expected_income'
```

> **The subtlety in `balanceMovedSince`.** The rollback set is *"every transaction whose
> balance effect is currently applied"*, which is **not** the same as "not deleted". A
> soft-deleted ordinary row has already had its effect reversed
> ([`wealth-ledger.ts:47-49`](../../src/lib/wealth-ledger.ts) `reversesOnTrash`), so it must
> be **excluded**; a soft-deleted **system** row keeps its effect through Trash, so it must
> be **included**. Getting this backwards silently shifts every funding base. Asserted in
> §16.2.

**Accretion — the boundary that prevents double counting.**

```
incomeAccreted(p) =
  'expected_income'          : 0
      // income does not accrete; capacity IS the stated expectation. Income actually
      // received is reported in the income section and compared against it (§8.7).

  'reconstructed_at_boundary': Σ income transactions with date >= p.funding_base_anchor_date
      // the base was rolled back to BEFORE any of this period's income, so all of it
      // accretes exactly once.

  'snapshot_at_open'         : Σ income transactions with created_at > p.funding_base_as_of
      // the snapshot captured a real balance at an instant. Anything that moved the
      // balance AFTER that instant accretes — and nothing that was already inside it can.
      // NOTE: the discriminator is `created_at`, NOT `date`, because current_balance moves
      // when a row is INSERTED, whatever date it carries. A backdated income entered after
      // the snapshot was not in that balance, so it must accrete.

fundingAdjustments(p) = Σ budget_events.amount WHERE period_id = p AND action = 'funding_adjusted'

fundingCapacity(p) = funding_base(p) + incomeAccreted(p) + fundingAdjustments(p)

unallocated(p) = fundingCapacity(p) − Σ_e allocation(e, p)      // over ALL sections
```

**Spending appears in none of these formulas.** That remains the core property: spending
consumes an allocation, it does not reduce the period's capacity.

#### 8.4.1 Caching, drift and audit

`funding_base` is **cached on the period row** so every read is cheap and stable, and
`funding_base_computed_at` records when. On each `POST /api/budgets/v2/sync`, a
`reconstructed_at_boundary` base is **recomputed**; if it differs from the cached value the
row is updated **and** a `funding_base_recomputed` event is written with
`{ was, now, reason }`. So the base is stable by default, self-correcting when history
changes, and every change is attributable. A `snapshot_at_open` base is **never**
recomputed — it is a captured fact — and corrections to it are ordinary audited
`funding_adjusted` events.

For a **closed** period the base is frozen in the snapshot; later drift produces a
restatement (§8.11), not a mutation.

#### 8.4.2 Required behaviours

| Case | Base | Accretion | Result |
|---|---|---|---|
| **1. Plan created mid-period, after salary arrived** | `snapshot_at_open` at creation; `is_partial = true` | only income with `created_at >` the snapshot | Capacity = what the user actually has now, plus income arriving from now on. Reconstruction is deliberately **not** used: rolling back to a boundary before the plan existed would describe a period the plan never governed, and would inflate capacity by spending the plan never saw. |
| **2. Plan created mid-period, before salary** | `snapshot_at_open` at creation | the salary (`created_at >` snapshot) accretes once | Correct — capacity grows when the money lands. |
| **3. Period opened exactly at its boundary** | `reconstructed_at_boundary`; reconstruction and a snapshot coincide (nothing has moved yet) | all income dated in the period | Correct. |
| **4. Period opened lazily, several days late** | `reconstructed_at_boundary` — rolled back to `p.start` | all income dated in the period, **including income that arrived before the period was opened** | **No double count.** This is precisely the case rev 2 got wrong. |
| **5. Backdated income entered after the snapshot** | reconstruction: recomputed base *excludes* it (it is subtracted by the rollback) | it accretes by `date` | Net effect correct and self-consistent; the recomputation is audited. Snapshot mode: it accretes by `created_at`, and the snapshot never contained it. Correct in both modes. |
| **6. An income transaction later edited or trashed** | reconstruction: base recomputed on next `sync` | accretion is a live `SUM`, so it drops or changes automatically | Self-correcting in both modes; if the cached base moved, the change is audited. |
| **7. Timezone boundaries** | `funding_base_anchor_date` is a **plan-local calendar date** compared against `transactions.date` (also a bare date) | `funding_base_as_of` is a **real instant** compared only against `created_at` (also an instant) | Date strings are never compared to instants, and instants are never compared to dates. §8.2's DST-safety property is preserved. |

The two modes are distinguishable in the API (`funding_base_source`) and in the UI, which
itemises base + accreted income + adjustments on tap — so a user can always see *why*
capacity is what it is.

### 8.5 The four numbers, with `Safe to spend` bounded (**blocker #1**)

```
availableNow(plan):                                  // derived live
  SELECT coalesce(sum(current_balance::numeric), 0)
  FROM wealth_accounts
  WHERE organization_id = :org
    AND archived_at IS NULL
    AND type IN ('bank','cash')                      // Spaces excluded BY CONSTRUCTION
    AND id = ANY(:plan.included_account_ids)
```

This is the first server-side available-balance endpoint in the product; today the figure
exists only in the browser (§2.6).

```
horizon(plan, period, today):
  nextIncome = earliest expected income date > today
  return min(period.endExclusive, nextIncome ?? period.endExclusive)
```

**Reserved** — note carefully which fund balances are reserved and which are not:

```
reserved(plan, p, today) =
    commitmentsOutstanding    // EXPECTED occurrences, section='commitment', due_date < horizon
  + debtOutstanding           // EXPECTED occurrences, section='debt',       due_date < horizon
                              //   ↑ taken from the SAME occurrences(e, p, today) set as
                              //     Pending (§8.6), whose projection window already reaches
                              //     back past p.start. NO lower bound at `today`: an OVERDUE
                              //     obligation stays reserved until explicitly resolved, and
                              //     is counted exactly once (§8.6.1).
  + virtualFundBalances       // Σ fundBalance(e) for funding_mode='virtual'
                              //   ↑ CONFIRMED entries only (§8.9.1) — cash still in the bank
  + virtualContributionsUnconfirmed  // planned-not-confirmed virtual contributions, due < horizon
  + spaceContributionsDue     // space_backed contributions due < horizon, NOT yet transferred
  + protectedSavingsDue       // savings w/o goal: max(0, planned − funded), due < horizon
```

> **The asymmetry that must not be got wrong.** A **virtual** fund's accumulated balance
> **is** reserved, because that money is still sitting in a real bank account and would
> otherwise be counted as spendable. A **Space-backed** fund's accumulated balance is
> **not** reserved, because Spaces are already excluded from `availableNow` — reserving it
> again would subtract the same money twice. Only its *unfunded, due* contributions are
> reserved. Asserted directly in §16.1.

> **Two reservation terms per virtual fund, never overlapping.** A virtual contribution is
> reserved either as part of `virtualFundBalances` (once **confirmed**, §8.9.1) or as part of
> `virtualContributionsUnconfirmed` (while still merely planned) — never both. Confirmation
> moves the amount from the second term to the first and leaves `Reserved` unchanged, which
> is the property that makes confirmation safe to defer.

**Safe to spend** is the bounded intersection of cash and plan:

```
cashAfterReservations(p) = availableNow(plan) − reserved(plan, p, today)

// NET FIRST, THEN FLOOR — see §8.5.1. Summing max(0, ·) per envelope would ignore
// overspending in one envelope when computing plan-wide capacity.
flexibleHeadroom(p) = max(0, flexible(p).planned
                             − flexible(p).spent_net
                             − flexible(p).pending)

ceilingDefined(p) = EXISTS a flexible envelope with planned(e,p) > 0

safeToSpend(p) =
  if NOT ceilingDefined(p):  cashAfterReservations(p)        // no ceiling → cash-bound only
  else:                      min(cashAfterReservations(p), flexibleHeadroom(p))

binding(p) =
  if NOT ceilingDefined(p):                    'cash_only'
  elif cashAfterReservations < flexibleHeadroom: 'cash'
  elif flexibleHeadroom < cashAfterReservations: 'plan'
  else:                                          'both'
```

#### 8.5.1 Why headroom is netted before flooring

Per-envelope remaining and plan-wide headroom answer different questions and must be
computed differently.

| | Formula | Sign | Why |
|---|---|---|---|
| **Envelope remaining** | `planned − spent_net − pending`, **signed** | may be negative | The card must show that Groceries is €100 over. Clamping here would hide the overspend. |
| **Plan-wide headroom** | `max(0, Σ planned − Σ spent_net − Σ pending)`, **netted then floored once** | ≥ 0 | Capacity is a property of the whole plan. An overspend in one envelope really does consume capacity that another envelope's surplus would otherwise have provided. |

The worked example from the review:

```
Groceries : planned 300, spent 400  → remaining −100   (shown as −100 on its card)
Dining    : planned 200, spent   0  → remaining +200   (shown as +200 on its card)

WRONG (rev 2):  Σ max(0, remaining)            = 0 + 200 = 200
RIGHT (rev 3):  max(0, Σ planned − Σ spent)    = max(0, 500 − 400) = 100
```

`flexible(p).remaining` is reported **signed** (here +100, and negative when the whole plan
is over), while `flexible_headroom` is the floored value used in the `min()`. Both are in the
payload so the UI never has to re-derive either.

**Unmatched flexible spend counts.** `flexible(p).spent_net` includes spend that matched no
envelope (absorbed by the catch-all when one exists, and reported as `unmatched` when not),
so recording an uncategorised expense genuinely consumes the ceiling rather than escaping it.

#### 8.5.2 How reallocation affects these values

This is the clarifying consequence of netting, and it must be stated in the UI copy:

| Action | `Σ planned` | Plan headroom | Envelope remaining |
|---|---|---|---|
| **Reallocate** Dining → Groceries (§6.12) | **unchanged** | **unchanged** | Groceries improves, Dining falls by the same amount |
| **Cover from unallocated** (§6.11 option 2) | **increases** | **increases** by that amount | Groceries improves; nothing else falls |
| **Leave it over** (§6.11 option 3) | unchanged | unchanged | Groceries stays negative |
| **Raise a target** from unallocated | increases | increases | that envelope improves |
| **A refund lands** in an envelope | unchanged | **increases** (spend_net falls) | that envelope improves |

> **Reallocation cannot create capacity.** Moving planned money between flexible envelopes
> leaves `Σ planned` invariant, so `Safe to spend` does not move. Only new funding
> (unallocated, or a refund) increases what may be spent. §6.11's copy says this explicitly,
> so "cover it from Dining" is never mistaken for "I can now spend more".

Rules that make `Safe to spend` behave sensibly:

- **No flooring of the result.** `min()` produces the right sign naturally: negative cash yields a negative `Safe to spend` (a genuine cash problem); a spent-out ceiling with cash in the bank yields exactly `0` (a genuine plan limit). Both are real and must be shown.
- **`binding` is returned to the client** so the UI can say *why* — "Limited by your plan" vs "Limited by your available cash". This is the single most useful piece of explanatory data in the feature (§6.19).
- **Plans with no spending ceiling are handled explicitly**, not accidentally: `ceilingDefined = false` short-circuits to the cash bound and `binding = 'cash_only'`, and the UI states "You haven't set a spending target, so this is just the cash you have after bills." A beginner who accepted the wizard's default *does* have a ceiling (the catch-all envelope); a user who deleted every envelope, or set them all to 0, does not.
- **A wholly over-spent plan yields headroom 0, not a negative headroom.** `max(0, ·)` is deliberate: permission to spend cannot be negative. The overspend itself is reported as a signed `flexible.remaining`, and `binding = 'plan'` with copy "Your plan is fully used" — so the fact is visible without corrupting the `min()`.
- **Unallocated is never added.** It is a buffer, not headroom (P3). It is returned separately as `unallocated_available = max(0, unallocated(p))` and offered as an explicit opt-in top-up in the overspend flow (§6.11) — never folded into the headline.

```
forecastBalance(plan, p, today):
  expectedRemainingIncome = Σ income envelopes' unreceived expected amounts in [today, p.end)
  plannedOutflow = reserved(plan, p, today)
                 + Σ flexible: max(0, planned − spentNet − pending)
  return availableNow(plan) + expectedRemainingIncome − plannedOutflow
```

In `income_mode='available'`, `expectedRemainingIncome = 0` and the forecast is labelled as
counting only money already held (§6.18).

### 8.6 Pending, from expected occurrences (**blockers #2, #10**)

`Pending` no longer counts recurring rules and subtracts posted rows. It reads a first-class
**occurrence** model that covers both recurring and one-time obligations and never pretends
a bank balance has moved.

```
// An OCCURRENCE is a budget-owned expectation. It is NOT a transaction and it NEVER
// affects wealth_accounts.current_balance. Its states:
//   expected    — projected, not yet paid          → counts in Pending and Reserved
//                  (OVERDUE if due_date < today — still expected, still reserved: §8.6.1)
//   settled     — matched to a posted transaction  → counts in Spent, NOT Pending/Reserved
//   cancelled   — will not happen                  → counts in neither
//   skipped     — deliberately not paid this cycle → counts in neither
//   rescheduled — moved to a new due_date          → the original date is consumed; an
//                                                     expected occurrence appears at the new one

// ---- The projection WINDOW must itself reach back before p.start (§8.6.1) ----
// A lower bound of p.start would never GENERATE a prior-period occurrence, and no
// downstream filter can recover what was never projected. The window is therefore
// per-commitment, and its lower bound depends on the commitment's KIND.

RECURRING_OVERDUE_LOOKBACK_DAYS      = 365      // recurring only — see D-17
MAX_UNRESOLVED_RECURRING_OCCURRENCES = 12       // recurring only — see D-17

carryLowerBound(c, p, today):
  if c.kind = 'one_time':
      return c.due_date        // ALWAYS in range. A one-time obligation NEVER ages out:
                               // it projects exactly ONE occurrence, ever, so an unbounded
                               // reach costs O(1) per commitment.
  else:
      return max(c.first_due_date, today − RECURRING_OVERDUE_LOOKBACK_DAYS)
                               // recurring only: an abandoned monthly rule would otherwise
                               // project 12 unpaid occurrences a year, forever.

projectRaw(c, from, until) -> [{ due_date, amount }]
  one_time  : [{ c.due_date, c.amount }] if from <= c.due_date < until
  recurring : occurrencesDue(rule.anchor, rule.freq, from, until) × rule.amount
              // REUSES src/lib/recurring.ts:76-100 — anchor-based, no month-end drift

occurrences(e, p, today):
  out = []
  for each commitment c of envelope e WHERE c.status = 'active':
      lower = carryLowerBound(c, p, today)                 // ← may be MUCH earlier than p.start
      raw   = projectRaw(c, lower, p.end_exclusive)         // ← spans EARLIER periods
      dev   = SELECT * FROM budget_occurrences
              WHERE commitment_id = c.id
                AND due_date >= lower AND due_date < p.end_exclusive

      for o in raw:
          d = dev[o.due_date]
          if d IS NULL:                  state = 'expected'        // default, unstored
          elif d.status = 'rescheduled': continue                  // original consumed
          else:                          state = d.status          // settled|cancelled|skipped
          out.push({ ...o, state, carried: o.due_date < p.start,
                     settled_transaction_id: d?.settled_transaction_id })

      // A reschedule target becomes a fresh expected occurrence, exactly once.
      for d in dev WHERE d.status = 'rescheduled'
                     AND lower <= d.rescheduled_to < p.end_exclusive
                     AND dev[d.rescheduled_to] IS NULL:            // not itself resolved
          out.push({ commitment_id: c.id, due_date: d.rescheduled_to, amount: c.amount,
                     state: 'expected', carried: d.rescheduled_to < p.start,
                     rescheduled_from: d.due_date })

      // Recurring safety cap (D-17) — applied ONLY to recurring commitments.
      if c.kind = 'recurring':
          unresolved = out for c where state = 'expected'
          if count(unresolved) > MAX_UNRESOLVED_RECURRING_OCCURRENCES:
              drop the OLDEST, keeping the most recent MAX_…
              set c.needs_attention = true
              report excluded_count on the commitment for disclosure (§6.3)

  return dedupeByKey(out, key = (commitment_id, due_date))
         // Belt as well as braces: the occurrence IDENTITY is (commitment_id, due_date),
         // so set semantics on that key make a duplicate structurally impossible.

pending(e, p, today) = Σ amount of occurrences(e, p, today) where state = 'expected'
                       // No date filter is needed here: the projection window IS the bound,
                       // and it already spans [carryLowerBound, p.end_exclusive).
```

#### 8.6.1 Overdue occurrences stay outstanding

**The problem being fixed.** rev 2 bounded `Pending` by `due_date >= max(today, p.start)`
and `Reserved` by `due_date >= today`. An unpaid fine due on the 5th therefore **vanished
from both on the 6th** — the budget quietly forgot an obligation that still has to be paid,
which is the worst possible direction for a `Safe to spend` figure to err in.

**The fix.** `expected` is the *state*; **overdue is a derived presentation condition over
it**, not a state of its own:

```
overdue(o, today) = (o.state = 'expected' AND o.due_date < today)
```

An `expected` occurrence remains in **both** `Pending` and `Reserved` until it is explicitly
`settled`, `cancelled`, `skipped` or `rescheduled`. The passage of time resolves nothing —
only a decision does. There is therefore no lower bound at `today` in either formula.

**Carry across period boundaries — fix the projection RANGE, not a downstream filter.**

This is the correction rev 3 got wrong. It is not enough to widen a filter: if the
projection window starts at `p.start`, a prior-period occurrence is **never generated**, and
`WHERE due_date >= overdueFloor` cannot recover a row that does not exist. **The window
itself must reach back**, per `carryLowerBound` above.

The lower bound differs by kind, and the asymmetry is deliberate:

| Kind | Carry lower bound | Ages out? | Why |
|---|---|---|---|
| **`one_time`** | the commitment's own `due_date` — **always in range** | **Never** | A one-time commitment projects **exactly one** occurrence, ever. Reaching back indefinitely costs O(1) per commitment, and the obligation is real: an unpaid fine, tax bill, university fee or personal repayment does not expire because a year passed. |
| **`recurring`** | `max(c.first_due_date, today − 365d)`, and at most **12** unresolved occurrences | Yes, bounded | An abandoned monthly rule would otherwise project 12 unpaid occurrences a year forever, reserving years of duplicate obligations the user never intended. |

- `Reserved` counts every `expected` occurrence in the projected set with `due_date < horizon` — **including** occurrences whose due date fell in a **previous** period. Carried occurrences have `due_date < p.start ≤ today < horizon`, so they always qualify.
- **Counted exactly once**, guaranteed three ways:
  1. **Identity.** An occurrence is `(commitment_id, due_date)`, and the projection returns a set keyed on it. The "current" (`due_date >= p.start`) and "carried" (`due_date < p.start`) subsets are disjoint by construction.
  2. **One open period.** `budget_periods` carries `UNIQUE (plan_id) WHERE status = 'open'` (§10.3), so exactly one period can contribute to live `Pending`/`Reserved`. Every earlier period is `closed` and serves a frozen `pending_at_close` from its snapshot — a *historical report*, never a live claim on money.
  3. **Reschedule consumes its original.** The stored row at the old date resolves it, and the target is emitted only if it is not itself resolved. A reschedule target that collides with an existing projected due date for the same commitment is **rejected at write time** (§10.6), which is what stops a reschedule from creating a second reservation.
- When a **recurring** commitment hits the cap, `needs_attention` is set, the older occurrences are excluded from `Reserved`, and the UI discloses it explicitly: "{{count}} older unpaid payments aren't being reserved — review this commitment." **This requires review; it is never a silent drop.** One-time commitments have no cap and no such state.
- Only `active` commitments project. Pausing is a deliberate act and stops reservation; `completed`/`cancelled` likewise.
- In practice, carried occurrences are rare for **recurring** commitments (the materializer posts their transactions, so they settle automatically) and are the *normal* case for **one-time** commitments and for recurring rules blocked by an archived account or a quota (`last_error`).

**Rescheduling.** `rescheduled` stores `rescheduled_to`; projection then skips the original
date and emits an `expected` occurrence at the new one. This is how a user says "the dentist
moved me to the 22nd" without either losing the obligation or double-counting it.

Three properties the occurrence model buys:

1. **One-time commitments work** (blocker #2). "€400 to the dentist on 15 Oct, once" is a `budget_commitments` row with `kind='one_time'`, `due_date`, `amount`. No recurring rule is invented, and nothing is misrepresented as a schedule.
2. **No double counting, by state rather than by arithmetic.** The previous draft subtracted a `posted` count from a projected count — correct only if materialization had run. Now an occurrence is `settled` *because* a transaction was matched to it, so `Spent` and `Pending` are mutually exclusive by construction — and this holds for overdue occurrences too, whatever period they originated in.
3. **Reads need no writes** (blocker #10, §8.10). Projection is pure and in-memory; only deviations are stored.

**Settlement matching.** An occurrence becomes `settled` when a posted transaction is
matched to it:

- **recurring**: exact match on `(recurring_rule_id, recurring_due_date)` — the key the materializer already writes and already has a unique index on.
- **one-time**: matched explicitly by the user, or proposed by a heuristic (same envelope, amount within 1 %, date within ±7 days) that is **suggested, never auto-applied** (P4/P8).

Settlement is written on the transaction-mutation path and in the sync endpoint (§8.10) —
**never** in a budget GET.

### 8.7 Per-section totals — no cross-section utilisation (**blocker #5**)

**The problem being fixed.** The previous draft computed
`plannedTotal = Σ_e allocation(e,p)` over every section and
`planStatus = state(spentTotal, plannedTotal)`. That divides a sum of income, flexible
spending, bills, debt and savings by another such sum. Those are not commensurable: income
is not a spending target, and funding a savings envelope is not "using up" a budget.

**The fix.** Each section has its own shape, its own arithmetic, and its own vocabulary.
Plan utilisation is computed **on the flexible section alone**.

```
income(p)     = { expected:    plan.expected_income (or null in available mode),
                  received:    incomeReceived(p),
                  outstanding: max(0, expected − received) }

flexible(p)   = { planned:  Σ planned(e,p),
                  spent_gross, refunds, spent_net,          // §8.8; INCLUDES unmatched spend
                  pending: Σ pending(e,p),
                  remaining: planned − spent_net − pending, // SIGNED — may be negative
                  headroom:  max(0, planned − spent_net − pending),  // floored ONCE (§8.5.1)
                  utilisation: state(spent_net + pending, planned) }

commitment(p) = { planned:     Σ planned(e,p),
                  settled:     Σ settled occurrence amounts,
                  outstanding: Σ expected occurrence amounts }

debt(p)       = { planned, paid, outstanding }               // same shape as commitment

savings(p)    = { planned:      Σ planned(e,p),           // the intent
                  reserved:     Σ planned-not-confirmed,   // held back, NOT claimed as funded
                  funded:       Σ CONFIRMED this period,   // virtual: confirmed entries only
                                                           // Space:   actual transfers
                  missed:       Σ closed unconfirmed,      // §8.9.1
                  outstanding:  max(0, planned − funded − missed),
                  balance:      Σ fundBalance(e) }          // informational, not a period figure

// PLAN UTILISATION — flexible ONLY.
planUtilisation(p) = flexible(p).utilisation
planStatus(p)      = planUtilisation(p)
```

A single cash figure is still useful and is allowed — but it is explicitly a **cash** figure,
carries a cash label, and is **never a utilisation denominator**:

```
totalOutflow(p) = flexible.spent_net
                + commitment.settled
                + debt.paid
                + savings.funded_cash        // Space transfers ONLY; virtual credits move no cash
```

`savings.funded_cash` excluding virtual credits is the second place the virtual/Space
distinction matters (§8.5 was the first): a virtual fund credit is a reservation, not an
outflow, and counting it as money out would overstate spending.

**Four distinct savings figures, deliberately.** `planned` is an intention, `reserved` is
money held back, `funded` is a **confirmed** claim that the money was set aside, and `missed`
records that a period closed without it. Collapsing these into one "funded" number is exactly
the error §8.9.1 fixes.

The API therefore returns `sections` as a **keyed object with per-section shapes**, not a
uniform array of `{planned, spent}` (§11.2). There is no `totals.planned` /
`totals.spent` pair anywhere in the payload.

### 8.8 Envelope figures and provisional refunds (**blocker #6**)

**The problem being fixed.** The previous draft netted any category-matched `incoming`
transaction against envelope spend and presented the result as fact. That is a *heuristic*:
a category-matched inflow might be a genuine refund, but it might equally be cashback, a
resale, a misclassified transfer, or a data-entry error. Presenting a guess as a settled
figure is exactly the kind of silent reinterpretation this spec forbids elsewhere.

**The fix.** Netting still happens — it is far better than v1's gross-only behaviour — but it
is **provisional, disclosed, separately reported, and correctable**.

```
spentGross(e, p) = Σ outgoing matched amounts

refundsConfirmed(e, p)   = Σ inflows linked to an expense via transaction_settlements   // Phase 2
refundsProvisional(e, p) = Σ category-matched inflows with NO settlement link
                             AND not rejected by the user                              // Phase 1
refundsRejected(e, p)    = Σ inflows the user marked "not a refund"  → excluded entirely

refunds(e, p)  = refundsConfirmed(e, p) + refundsProvisional(e, p)
spentNet(e, p) = spentGross(e, p) − refunds(e, p)

planned(e, p)   = allocation(e, p) + rolloverIn(e, p)
remaining(e, p) = planned(e, p) − spentNet(e, p) − pending(e, p)
```

- The API returns `spent_gross`, `refunds_confirmed`, `refunds_provisional` and `spent_net` **separately**, so the UI can show "€372 spent · €100 treated as a refund" and offer a one-tap **Confirm** / **Not a refund** (§6.5).
- Rejecting writes a `budget_exclusions` row plus a `tx_included`/`tx_excluded` event — audited, reversible.
- Income envelopes are never `flexible` match targets, so salary can never net against grocery spending. That safety property is unchanged.
- `spentNet` may be **negative** when refunds exceed gross spend in a period. The true signed value is kept in data and API; only the *bar width* is clamped to `[0,100]%`.

**8.8.1 The settlement relationship required for full and partial cross-period settlement.**

Provisional netting cannot express "this €400 travel expense in March was reimbursed €250 in
May and €150 in June". That needs an explicit link, which is a **Phase 2 dependency**
(§10.11 defines the table):

```
transaction_settlements(
  expense_transaction_id,      -- the original outflow
  settlement_transaction_id,   -- the inflow
  amount,                      -- PARTIAL settlements ⇒ many rows per expense
  kind ∈ { refund, reimbursement, chargeback }
)
  UNIQUE (expense_transaction_id, settlement_transaction_id)
  CHECK  (amount > 0)
  INVARIANT: Σ amount per expense ≤ expense.amount        -- enforced on write
```

Two reporting views, both defined, neither mutating history:

| View | Rule | Used for |
|---|---|---|
| **Cash view** (default) | A settlement reduces spend **in the period its own transaction date falls in** | Budget periods, `Safe to spend`, everything operational |
| **Attributed view** (report only) | A settlement is attributed back to the **original expense's** period, yielding that expense's true net cost | "What did this trip actually cost me", envelope detail's economic line |

The cash view is authoritative because it matches when the money actually moved. The
attributed view is computed from links on demand and is **clearly labelled**. A settlement
arriving after its expense's period has closed does **not** rewrite that period; it creates a
**restatement candidate** (§8.11), which is the correct, audited way to revise a closed
record.

Settlement status per expense is derivable and worth surfacing:
`unsettled | partially_settled | fully_settled`, with
`outstanding = expense.amount − Σ settlements`.

### 8.9 Sinking funds — virtual and Space-backed (**blocker #3**)

**The problem being fixed.** Requiring every sinking fund to be a Space made funds
quota-limited (free personal = 1 Space) and personal-only, so a free user could not have a
car-insurance fund *and* a holiday fund. It also forced real money movement for what is
often just an intention to hold money back.

**The fix.** A sinking fund is a **budget-owned savings envelope** with a `funding_mode`:

| | `virtual` (default) | `space_backed` |
|---|---|---|
| Where the money sits | In the bank account, held back by reservation | Physically moved into a Space |
| Contribution | A `budget_fund_entries` row. **No transaction, no transfer, no balance change** | A real `kind='transfer'` transaction pair (existing machinery) |
| Balance | `Σ contributions − Σ withdrawals ± adjustments` from the entry ledger | The Space's `current_balance` (authoritative) |
| In `availableNow` | **Yes** — the cash is still there | **No** — Spaces are excluded by the accounts query |
| In `reserved` | **Balance + due contributions** | **Due, untransferred contributions only** |
| Quota | **Unlimited on every plan** — it is a row, not an account | Consumes the Spaces quota (free 1 / paid 7) |
| Available on business orgs | **Yes** (no Spaces dependency) | No (Spaces are personal-only) |
| Spending from it | Withdrawal entry + a normal expense (§9.9) | Space→account transfer, then a normal expense |

```
fundBalance(e) =
  e.funding_mode = 'virtual'
    ? (SELECT coalesce(sum(CASE kind WHEN 'contribution' THEN amount
                                     WHEN 'withdrawal'   THEN -amount
                                     ELSE amount END), 0)                 // adjustment is signed
       FROM budget_fund_entries WHERE envelope_id = e.id)
       // ↑ entries exist ONLY for CONFIRMED contributions (§8.9.1). A merely planned
       //   contribution is reserved but writes no entry and does not raise the balance.
    : (SELECT current_balance FROM wealth_accounts WHERE id = e.wealth_account_id)

fundProgress(e)        = spaceProgress(fundBalance(e), e.goal_amount)        // REUSE src/lib/spaces.ts
fundSuggestedMonthly(e)= suggestedMonthly(fundBalance(e), e.goal_amount,
                                          e.target_date, todayInPlanTz(plan.timezone))
```

`src/lib/spaces.ts` (`spaceProgress`, `suggestedMonthly`, `spaceGoalStatus`,
`monthlyEquivalent`, `autoSavePace`) is reused **unchanged** for both modes — it is pure
math over `(balance, goal, targetDate)` and never assumed a Space. This is reuse where it
genuinely fits, while the *storage* no longer forces a Space.

#### 8.9.1 Planned · reserved · confirmed · missed (**rev 3**)

**The conflict being resolved.** P4 forbids changing a money status without confirmation, yet
rev 2 auto-credited a virtual fund at period close. Automatically *reserving* a planned
contribution is legitimate — it is what the plan says, and it only ever makes `Safe to spend`
more conservative. Automatically asserting that the money **was set aside** is not: nobody
did anything, and the fund's balance is a money-like figure the user will trust.

**The fix — four states per `(fund envelope, period)`**, stored on `budget_allocations`
(§10.4) as `contribution_status`:

| State | Meaning | Reserved? | In `fundBalance`? | Writes a `budget_fund_entries` row? |
|---|---|---|---|---|
| **`planned`** | The allocation exists. Set automatically when the period opens. | **Yes** — as `virtualContributionsUnconfirmed` | No | No |
| **`confirmed`** | The user confirmed it, **or** the envelope has `auto_fund = true` (an explicit, opt-in preference). | **Yes** — now as part of `virtualFundBalances` | **Yes** | **Yes**, `source ∈ {confirmed, auto_fund}` |
| **`missed`** | The period closed with the contribution still merely `planned` and `auto_fund` off. | No (the period is over) | No | No |
| **`skipped`** | The user deliberately declined it for this period. | No | No | No |

Consequences, stated precisely:

- **Period close never auto-credits.** It sets `planned → missed` for anything unconfirmed, and `planned → confirmed` **only** when `auto_fund = true`. Both transitions write a `budget_events` row (`fund_contributed` or `fund_missed`).
- **Confirmation is `Reserved`-neutral.** The amount simply moves from `virtualContributionsUnconfirmed` into `virtualFundBalances` (§8.5). So the user's `Safe to spend` does not jump when they confirm — which is what makes it safe to leave a contribution unconfirmed for days.
- **Nothing is ever labelled "funded" without a decision.** UI copy for `planned` is "Set aside this period — {{amount}} reserved, not yet confirmed"; only `confirmed` may say "funded".
- **`auto_fund` is opt-in per fund**, default `false`, and turning it on is itself an audited event (`fund_auto_enabled`). Its label states the consequence: "Confirm my contribution automatically when each period closes."
- **A missed contribution is not silently forgiven.** The goal pace recomputes (`autoSavePace` → `behind`) and `suggestedMonthly` rises, so the fund tells the truth about being behind.
- **Space-backed funds:** an executed auto-save **transfer** is `confirmed` by construction — real money actually moved, so there is nothing to confirm. A Space contribution *without* an auto-save requires a manual transfer and therefore follows the same `planned → confirmed | missed` flow as a virtual fund.

**Crediting a confirmed virtual contribution** is idempotent on
`(envelope_id, period_id, source)`, and writes an audited entry. It moves no money and
touches no account balance.

**Converting between modes** is supported and audited: `virtual → space_backed` creates the
Space (subject to quota) and performs one real transfer for the accumulated balance;
`space_backed → virtual` transfers the balance back to a chosen account and records an
opening entry. Both write `budget_events` and require confirmation.

### 8.10 Period lifecycle, and no knowingly-stale screen (**blocker #10**)

**The reversal.** Decision D-3 previously accepted that budget figures could be stale until
some unrelated page happened to call `materializeDueRecurring`. That is not acceptable for a
money screen, and it is now reversed. The resolution has two independent halves.

**Half 1 — expectations never depend on materialization.** `Pending` and `Reserved` come
from **projected occurrences** (§8.6), computed from commitment definitions and recurring
rules directly. They are correct the instant a rule or one-time commitment exists,
regardless of whether any transaction has been materialized. This removes the majority of
the staleness surface by construction.

**Half 2 — posted spend is reconciled by an explicit, idempotent write endpoint, and reads
are pure.** Budget GETs remain strictly read-only (a GET must not move money), but they
**detect and report** staleness rather than silently serving it:

```
// In every budget GET — a cheap, read-only probe.
materializationPending(orgId, today) =
  EXISTS (SELECT 1 FROM recurring_rules
          WHERE organization_id = :org AND active AND next_due_at <= :today LIMIT 1)
  OR EXISTS (an expected occurrence whose due_date < today and has no settlement)
```

The response carries `sync_required: true`. `BudgetProvider` then calls, once:

```
POST /api/budgets/sync            // idempotent, safe to repeat, cheap when there is nothing to do
  1. materializeDueRecurring(orgId)          // existing, race-proof via its unique index
  2. reconcileOccurrenceSettlements(orgId)   // match posted rows → occurrences, set 'settled'
  3. ensurePeriods(plan, today)              // close elapsed periods, open the current one
  4. return the freshly computed payload
```

The user sees a brief "updating…" state, never a wrong number. Three call paths keep it
honest:

1. **Client-driven** — on mount when `sync_required`, and after any budget mutation.
2. **Boundary job** — the existing exact-time one-shot primitive `enqueueNotificationTickAt(runAt, occurrenceKey)` ([`worker-jobs.ts:82`](../../api/_lib/worker-jobs.ts)) schedules an `app.trigger` at each period boundary, so periods close and reviews fire even if nobody opens the app. Best-effort by design.
3. **Existing paths** — the transactions, wealth, recurring, calendar and flow GETs already materialize, so in practice the probe usually finds nothing to do.

**Trade-off, stated plainly:** on the rare stale path this costs one extra round trip before
the correct figures render. The alternative — a GET that writes transactions and moves
wealth balances — is worse: it makes a read non-idempotent, surprises every caller, and
would let a page refresh create money movements. The extra round trip is the right price.

```
ensurePeriods(plan, today):                          // called only from /sync, never a GET
  if plan.status <> 'active': return                 // paused: open nothing (§6.13)
  cur = periodFor(plan, today)
  for p in open periods where p.end_exclusive <= today, oldest first:
      closePeriod(p)                                 // idempotent (§10.14)
  if no period with start = cur.start:
      openPeriod(cur, seed = plan.next_period_seed)  // sets funding_base (§8.4)
  cap MAX_PERIODS_PER_RUN = 24, resumable            // mirrors MAX_OCCURRENCES_PER_RUN = 60
```

### 8.11 Closed-period reporting: audited restatement (**blocker #8**)

**The problem being fixed.** The previous draft displayed a closed period's snapshot **and**
a live recomputation side by side whenever they diverged, permanently. That is confusing
(which number is real?), it never resolves, and it grows worse with every historical edit.

**The fix.** Adopt the accounting practice this actually is: **restatement**. The original
snapshot is preserved forever; a corrected version becomes the normal displayed record; every
revision is audited and explainable.

```
budget_period_snapshots is VERSIONED:
  version         1, 2, 3, …                     -- 1 is the original close
  is_current      exactly one true per period    -- the operative record
  supersedes_id   the version this replaces
  restated_reason why (enum + free text)
  restated_by     actor, NULL = system
  drift           { field: [was, now] }          -- the diff from the previous version

report(p):
  if p.status = 'closed':
      return snapshot WHERE period = p AND is_current       -- always correct, always stable
  return recompute(p)                                        -- open period: live
```

**Restatement policy**

1. **Detection.** When a transaction inside a closed period is edited, trashed, restored or backdated into it, `/api/budgets/sync` recomputes that period and compares against `is_current`.
2. **Threshold.** Drift of **0 (exact)** in any envelope's `spent_net`, or in any section total, triggers a restatement. There is no tolerance band: a money figure is either the current truth or it is restated.
3. **Application.** The restatement is created automatically by `sync` — the displayed record is therefore always correct — but it is *never* an in-place mutation. A **new version** is inserted, the previous version keeps `is_current = false`, and a `period_restated` event records the actor that caused it, the reason and the diff.
4. **Preservation.** Version 1 is immutable and never deleted. Every intermediate version is retained.
5. **Disclosure.** §6.17 shows the current figures as *the* record with a chip: "Restated {{date}} · view original". No permanent dual display.
6. **Cause attribution.** The `drift` payload names which envelopes changed, and the event links the triggering transaction where known, so "why did March change?" is answerable.
7. **Closed periods remain un-editable by hand.** A restatement is only ever a consequence of underlying transaction data changing — never a direct edit of a closed period (§10.12).

This satisfies P5 in the form that actually helps: the *original* record is preserved and
auditable, while the number a user sees is the corrected one.

### 8.12 Rollover

Computed once, at period close, and stored — never derived on read, which would make it
drift as old transactions change.

```
atClose(e, p):
  surplus = remaining(e, p)                        // may be negative
  carry = switch e.carry_policy
            'none'    -> 0
            'surplus' -> max(0, surplus)
            'deficit' -> min(0, surplus)
            'both'    -> surplus
  if e.carry_cap IS NOT NULL: carry = clamp(carry, −e.carry_cap, e.carry_cap)
  write snapshot.envelopes[e] = { planned, spent_gross, refunds, spent_net,
                                  pending_at_close, remaining: surplus, carry }
  write next_period.allocations[e].rollover_in = carry
```

- `commitment`, `debt` and `savings` envelopes default to `carry_policy='none'` — carrying an unpaid bill would double-reserve it next period, and its commitment already recurs.
- A **savings** envelope's unconfirmed contribution becomes `missed` at close (§8.9.1) rather than rolling over. Carrying it forward would quietly double next period's reservation for a contribution the user never made.
- Rollover is idempotent on `(envelope_id, period_id)`, so a repeated close cannot compound it (§10.14).
- A restatement (§8.11) **does not** retroactively change an already-applied rollover; the correction surfaces as a funding adjustment in the affected later period, with an event explaining it. Silently re-carrying money into a period the user has already spent from would be worse than an explicit adjustment.

### 8.13 Suggested allocations

Pure, explainable, never written without confirmation (P8).

```
suggestFlexible(e, history):                       // history = closed snapshots (current versions)
  obs = last 3 closed periods' spent_net for e, excluding periods with < 60% coverage
  if len(obs) = 0: return { amount: null, basis: 'no_history' }
  if len(obs) = 1: return { amount: obs[0], basis: 'single_period', confidence: 'low' }
  return { amount: round2(median(obs)), basis: 'median_of_3',
           observations: obs, confidence: len(obs) >= 3 ? 'normal' : 'low' }

suggestSinkingFund(e)      = fundSuggestedMonthly(e)              // §8.9, both modes
detectCommitments(orgId)   = active outgoing recurring rules not yet linked to a commitment
warnAllocationsExceedFunding(p) = Σ allocations > fundingCapacity(p) ? { delta } : null
warnPlanExceedsLiquidity(p)     = Σ allocations > availableNow() + expectedRemainingIncome(p)
detectUnusualSpend(e, p)   = spent_net > 1.5 × median(last 3) && elapsed < 60% of period
```

`median-of-3` rather than a mean: one holiday month must not permanently raise a grocery
suggestion. Every suggestion returns `basis` and `observations` so the UI renders evidence,
and `confidence` is a **label** (`low`/`normal`), never a percentage (P8). Suggestions are
derived live and never stored; dismissals are stored per
`(plan, suggestion_kind, target_id)`.

Note `warnAllocationsExceedFunding` now compares against `fundingCapacity` (§8.4) rather
than raw expected income, so it behaves correctly in available mode.

### 8.14 Multicurrency conversion — placeholder only

Deliberately unimplemented (P10). One seam:

```
amountInPlanCurrency(tx, plan):
  // PHASE 1: identity. Every amount is already in the org currency by construction.
  return tx.amount
  // PHASE 2+ (requires §12): convert(tx.amount, tx.currency, plan.currency, rateAt(tx.date))
```

Every formula above calls `amountInPlanCurrency` rather than `t.amount` directly, so the
conversion policy lands in exactly one function. No rate table, base currency or conversion
policy is proposed here.

---

## 9. Transaction classification matrix

Legend: **Bal** = account balance · **Gross/Net** = envelope spent gross/net · **Pend** = pending ·
**Rem** = remaining · **Res** = reserved · **STS** = safe to spend · **Fcst** = forecast ·
**Hist** = historical reporting. `↑`/`↓` = increases/decreases · `—` = none · `≈` = no net effect.

### 9.1 Money movements

| Case | Bal | Gross | Net | Pend | Rem | Res | STS | Fcst | Hist |
|---|---|---|---|---|---|---|---|---|---|
| **Standard expense** | ↓ | ↑ | ↑ | — | ↓ | — | ↓ (cash **and** plan headroom) | ↓ | period of `date` |
| **Standard income** (income envelope) | ↑ | — | — | — | — | — | ↑ | ↑ | income section; **increases `fundingCapacity` in available mode only** |
| **Account-to-account transfer** | ≈ | — | — | — | — | — | ≈ | ≈ | excluded |
| **Cash withdrawal** (as transfer) | ≈ | — | — | — | — | — | ≈ | ≈ | excluded |
| **Cash withdrawal** (as expense) | ↓ | ↑ | ↑ | — | ↓ | — | ↓ | ↓ | counts as spend |
| **Opening balance** (`is_system`) | ↑ | **—** | **—** | — | — | — | ↑ | ↑ | excluded *(fixes #1)* |
| **Balance adjustment / reset** (`is_system`) | ↕ | **—** | **—** | — | — | — | ↕ | ↕ | excluded *(fixes #1)* |
| **Split transaction** (N legs) | ↓ per leg | ↑ **once** | ↑ once | — | ↓ | — | ↓ | ↓ | legs summed once |
| **Trashed transaction** | reversed unless `is_system` | ↓ | ↓ | — | ↑ | — | ↑ | ↑ | open: changes · **closed: triggers a restatement** |
| **Restored transaction** | re-applied | ↑ | ↑ | — | ↓ | — | ↓ | ↓ | as above |
| **Backdated transaction** | ↓ now | ↑ in `date`'s period | ↑ | — | ↓ there | — | ↓ | ↓ | if that period is closed → **restatement** (§8.11) |
| **Edited historical transaction** | delta re-applied | recomputed | recomputed | — | ↕ | — | ↕ | ↕ | closed period → **restatement**, original preserved |

### 9.2 Commitments (recurring and one-time)

| Case | Bal | Gross | Pend | Res | STS | Fcst | Hist |
|---|---|---|---|---|---|---|---|
| **Recurring commitment created** | **—** | — | ↑ | ↑ | ↓ | ↓ | nothing posted |
| **One-time commitment created** (e.g. €400 on 15 Oct) | **—** | — | ↑ | ↑ (if due before horizon) | ↓ | ↓ | nothing posted |
| **Occurrence settles** (matched to a posted tx) | ↓ | ↑ | **↓ to 0** | ↓ | ↓ **once** | ↓ | period of the transaction's `date` |
| **Occurrence cancelled** | — | — | ↓ to 0 | ↓ | ↑ | ↑ | nothing posted |
| **Occurrence skipped** this cycle | — | — | ↓ to 0 | ↓ | ↑ | ↑ | recorded as skipped, audited |
| **Commitment amount edited** | — | — | ↕ future only | ↕ | ↕ | ↕ | already-settled occurrences unchanged |
| **Commitment paused / deleted** | — | — | ↓ to 0 | ↓ | ↑ | ↑ | settled history retained |
| **Commitment due date passes unpaid → OVERDUE** | — | — | **stays** | **stays** | **stays ↓** | ↓ | Still `expected`. **Time resolves nothing** (§8.6.1); `budget_commitment_unpaid` alert (§14.4) |
| **Overdue occurrence crosses a period boundary** | — | — | appears in the **new** open period | **stays** | stays ↓ | ↓ | Counted **once** — the earlier period is closed and serves a frozen `pending_at_close` |
| **Occurrence rescheduled** | — | — | moves to the new date | ↕ (per horizon) | ↕ | ↕ | Original date consumed; audited |
| **One-time occurrence unpaid for >365 days** | — | — | **stays** | **stays** | stays ↓ | ↓ | **Never ages out.** One occurrence, ever — O(1) to project (D-17) |
| **Recurring commitment exceeds `MAX_UNRESOLVED_RECURRING_OCCURRENCES` (12) or reaches past 365 days** | — | — | capped at the 12 most recent | **older ones leave `Reserved`** | ↑ | ↑ | `needs_attention` set, **review required**, excluded count **disclosed**. Recurring **only** (D-17) |

> **The invariant behind this whole table:** an occurrence is an **expectation**, not a
> transaction. It never writes to `wealth_accounts.current_balance`. It reduces
> `Safe to spend` and `Forecast` — which is exactly what "money I know is going out" should
> do — while `Available now` continues to report the true bank position. This is how a
> future commitment influences decisions without pretending the bank balance already moved.

### 9.3 Savings and sinking funds

| Case | Bal | Res | STS | Fcst | Notes |
|---|---|---|---|---|---|
| **Virtual fund created** | — | — | — | — | A row. No money moves. Unlimited on all plans |
| **Virtual contribution planned** (period opens) | **—** | **↑** | **↓** | ≈ | Reserved automatically — it is the plan. **Not** called funded |
| **Virtual contribution confirmed** | **—** | **≈** | **≈** | ≈ | Moves between reservation terms; `fundBalance` ↑. **`Reserved` and `Safe to spend` do not move** |
| **Virtual contribution missed** (period closed unconfirmed) | — | ↓ | ↑ | ≈ | Not funded, recorded as missed; goal pace → `behind` |
| **Virtual contribution skipped** by the user | — | ↓ | ↑ | ≈ | Audited decision |
| **Virtual fund withdrawal** (to spend it) | — | ↓ | ↑ | ≈ | Then a normal expense records the spend (§9.9) |
| **Space-backed fund created** | — | — | — | — | Consumes the Spaces quota |
| **Space contribution due, not yet transferred** | — | ↑ | ↓ | ≈ | Only the *due* amount is reserved |
| **Space contribution transferred** (bank→Space) | ↓ available, ↑ Space; net worth ≈ | **↓** | **↓ and stays down** | ≈ | The reservation is now funded — **the balance is not re-reserved** (§8.5) |
| **Space→bank withdrawal** | ↑ available | ↑ (fund now unfunded) | ≈ | ≈ | Precedes a fund spend |
| **Fund goal reached** | — | ↓ (no further contributions due) | ↑ | ≈ | `suggestedMonthly` returns 0 |

### 9.4 Refunds, reimbursements and settlement

| Case | Gross | Refunds | Net | STS | Hist |
|---|---|---|---|---|---|
| **Refund, same category, same period** | — | ↑ **provisional** | ↓ | ↑ | period of the refund's `date` |
| **Provisional refund confirmed** by the user | — | moves to *confirmed* | unchanged | — | audited |
| **Provisional refund rejected** ("not a refund") | — | ↓ to 0 | ↑ back | ↓ | exclusion + event |
| **Refund in a later, open period** | — | ↑ in **that** period | ↓ there | ↑ | cash view; attributed view credits the original |
| **Refund after its period closed** | — | ↑ in the arrival period | ↓ there | ↑ | **restatement candidate** for the original period, never a silent rewrite |
| **Full reimbursement** | — | ↑ to the full amount | ↓ ~0 | ↑ | arrival period (cash view) |
| **Partial reimbursement** (€250 of €400) | — | ↑ 250 | ↓ 250 | ↑ | `partially_settled`, `outstanding = 150` |
| **Second partial** (€150 later) | — | ↑ 150 | ↓ 150 | ↑ | `fully_settled`; two settlement rows |
| **Employer-reimbursable expense** | ↑ | — until it arrives | ↑ | ↓ | counted as spend; expected inflow shown in `Forecast`; cross-period asymmetry disclosed |

### 9.5 Credit cards — **BLOCKED**

**A dependency, not a design choice.** There is no liability account type, no credit limit,
no statement cycle and no pending/cleared state (§1.5). Attempting this in Phase 1 would
**double-count** every purchase — once when the card is charged, again when the statement is
paid.

Phase 1 behaviour and the limitation to disclose:

- A card modelled as a `bank` account with a negative balance is arithmetically survivable: purchases are `outgoing` (counted as spend, correctly) and the statement payment is a **transfer** (correctly not spend).
- The failure is `availableNow`: a negative card balance would **subtract** from available money as though the whole debt were due today, corrupting `Safe to spend`.
- Therefore card accounts are **excluded from `included_account_ids` by default**, and the UI states why.

Contract required to unblock: `wealth_accounts.type='credit'` + `is_liability` ·
`credit_limit`, `statement_day`, `payment_due_day` · `transactions.status ∈ {pending, cleared}`
+ `posted_at` · the rule that a statement payment is a transfer, never spend · a definition
of "available credit" distinct from "available money" so `Safe to spend` never includes
borrowable money.

### 9.6 Manual pending transactions — **PARTIALLY BLOCKED**

The occurrence model (§8.6) covers **known obligations**: recurring bills *and* one-time
planned commitments. That is a large share of the real need and no longer depends on
`recurring_rules` alone.

Still unsupported: a **posted-but-unsettled** transaction — a cheque in flight, an
unsettled card authorisation, a bank transfer in transit. These differ from an occurrence
because the money is *already committed at the bank* but not yet reflected in the balance.

Contract required: `transactions.status`, `posted_at`, a `pending → cleared | cancelled`
state machine, and the rule that a pending row does **not** move `current_balance` until
cleared. Note that today *every* transaction moves the balance immediately, so this is a
change to the wealth ledger and must be designed with its owners, not inside Budget v2.

### 9.7 Loan principal / interest / fees — **BLOCKED**

Phase 1 treats a loan payment as one amount in a `debt` envelope, which at least stops it
polluting flexible spending (#3). Splitting it requires a debt-account model that does not
exist: principal outstanding, rate, schedule, and per-payment `principal`/`interest`/`fee`
components. Interest is an expense; principal is a balance-sheet movement that reduces cash
and liability equally and is **not** spending. §21 requires this to be stated in the UI, not
approximated.

### 9.8 Sinking-fund expenditure

**Virtual fund** — two audited steps, no transfer:

1. **Withdrawal entry** against the fund (`budget_fund_entries`, `kind='withdrawal'`): the fund balance drops, `Reserved` drops, `Available now` is unchanged (the cash never left).
2. **Expense** from the bank account: `Available now` drops, spend is recorded once.

**Space-backed fund** — you cannot spend from a Space
([`transactions.ts:351`](../../api/_routes/transactions.ts)), so:

1. **Transfer** Space → bank account (`kind='transfer'`, not spend): `Available now` ↑, the fund empties.
2. **Expense** from that account: `Available now` ↓, spend recorded once.

Both are wrapped in one guided `Use this fund` action with a single confirmation (§6.10),
linked by `group_id` where transactions are involved. This **must** be guided: a user who
performs only step 2 will overdraw an account they believed was funded.

### 9.9 Foreign-currency transactions and FX — **BLOCKED**

No per-transaction currency exists (§1.5). Phase 1 assumes every amount is in the org
currency, and **changing the org currency relabels history without converting it** (defect
#10 remains). Budget v2 does not paper over this: it snapshots the currency on the plan and
on every closed period so history is at least self-describing, detects divergence, and
converts nothing. FX gain/loss has no representation and is out of scope until §12 is
settled.

### 9.10 Summary of blocked and partial cases

| Case | Status | Blocked on | Phase-1 behaviour |
|---|---|---|---|
| One-time commitments | ✅ **now supported** | — | `budget_commitments.kind='one_time'` |
| Multiple sinking funds on a free plan | ✅ **now supported** | — | virtual funds, unlimited |
| Credit-card purchase / bill payment | ❌ blocked | liability accounts + pending | Exclude card accounts; disclose |
| Posted-but-unsettled transactions | ⚠️ partial | `transactions.status` | Known obligations via occurrences; in-flight items unsupported |
| Loan principal / interest / fee split | ❌ blocked | debt-account model | Whole payment in the `debt` section |
| Confirmed refund/reimbursement links | ⚠️ Phase 2 | `transaction_settlements` (§10.11) | Provisional netting, disclosed and correctable |
| Foreign-currency transactions, FX | ❌ blocked | §12 multicurrency | Single-currency assumption, made explicit |

Every one is listed in §20 with an owner. None is faked.
---

## 10. Proposed domain / data model

> **Revision note (2026-09-02, financial-model review).** Three tables added
> (`budget_commitments`, `budget_occurrences`, `budget_fund_entries`) and one Phase-2
> dependency specified (`transaction_settlements`). `budget_periods` gains a stored
> **funding base**; `budget_period_snapshots` is now **versioned** for restatement;
> `budget_envelopes` gains `funding_mode` and loses its direct `recurring_rule_id`.
> **rev 3 (correctness review):** `budget_periods` gains `funding_base_source` /
> `funding_base_anchor_date` / `funding_base_as_of` / `funding_base_computed_at` (§8.4);
> `budget_allocations` gains `contribution_status` + confirmation columns (§8.9.1);
> `budget_envelopes` gains `auto_fund`; `budget_occurrences` gains the `rescheduled` state
> and `rescheduled_to`; `budget_commitments` gains `needs_attention` (§8.6.1). **Every rev-3
> fix landed in an existing table — the count is unchanged.**
>
> **Total: 10 tables in Phase 1, plus 1 in Phase 2.** Each addition is justified below —
> the previous 7-table model was smaller but could not represent a one-time commitment, a
> virtual sinking fund, a stable funding capacity, or a restatement.

### 10.0 What we deliberately do NOT create

| Considered | Verdict | Why |
|---|---|---|
| `sinking_funds` as its own table | **No** | A fund is a `savings` envelope + a `funding_mode`. Its *balance* needs a ledger (`budget_fund_entries`), but the fund itself is an envelope. |
| `planned_transactions` | **No** | Covered by `budget_commitments` + projected occurrences. A *posted-but-unsettled* transaction is a wealth-ledger concept (§9.6), not a budget table. |
| `budget_sections` | **No** | Sections are a fixed enum with defined effects on the four numbers (§5.1). A user-defined section would have no defined effect. |
| `budget_rollovers` | **No** | One number per `(envelope, period)`: `budget_allocations.rollover_in`, written at close, plus the snapshot. A table would be a third copy. |
| `allocation_rules` | **No** | Cadence normalisation is a pure function of `(amount, cadence, period)`. |
| `budget_funding_adjustments` | **No** | An adjustment is one `budget_events` row with `action='funding_adjusted'`; the total is one indexed `SUM`. Events stay the single source of truth for adjustments. |
| A row per **`expected`** occurrence | **No** | Expectations are projected in memory; only *deviations* (settled / cancelled / skipped / rescheduled) are stored. Keeps reads pure (§8.10) and the table small. **`overdue` is likewise derived, never stored** — storing it would need a daily sweep and would let time change an obligation's state (§8.6.1). |
| A `mode` / `is_advanced` column | **No** | Violates P2. |
| Denormalised `spent` anywhere | **No** | Except the closed-period snapshot, which is a *report*, not a cache. |

Migrations start at **0059** (current head is `0058_sour_venom`; `CLAUDE.md`'s "0052" is
stale and should be corrected).

### 10.1 `budget_plans`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid NOT NULL → `organizations` cascade | |
| `status` | text NOT NULL default `'active'` | `active \| paused \| archived` |
| `cadence` | text NOT NULL default `'monthly'` | `monthly \| weekly \| payday \| custom` — **no `lifetime`, no `daily`** |
| `anchor_day` | integer NULL | 1–31 for `payday`, clamped to month length |
| `week_start_day` | integer NOT NULL default `1` | 1=Mon … 7=Sun (fixes the hardcoded Monday) |
| `custom_days`, `custom_start` | integer / date NULL | for `custom` |
| `timezone` | text NOT NULL default `'UTC'` | IANA; `safeTimezone()`-validated on read **and** write |
| `income_mode` | text NOT NULL default `'expected'` | `expected \| available` |
| `expected_income` | numeric(20,2) NULL | NULL in available mode |
| `included_account_ids` | jsonb NOT NULL default `[]` | empty = all active `bank`+`cash`; card/liability accounts excluded by default (§9.5) |
| `excluded_category_keys` | jsonb NOT NULL default `[]` | pre-lowered |
| `currency` | text NOT NULL | **snapshot** of the org currency at creation — the §12 forward-compat seam |
| `next_period_seed` | text NOT NULL default `'copy'` | `copy \| fresh \| suggest` |
| `paused_at`, `created_by`, `updated_by`, `created_at`, `updated_at` | | |

- `UNIQUE (organization_id) WHERE status <> 'archived'` — one live plan per org, the same partial-unique idiom as `budgets_org_default_unique`.
- Real DB `CHECK`s on `cadence`, `income_mode`, `next_period_seed`, `anchor_day BETWEEN 1 AND 31`, `custom_days BETWEEN 1 AND 400`, `week_start_day BETWEEN 1 AND 7`.

### 10.2 `budget_envelopes`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` | uuid NOT NULL → `budget_plans` cascade | |
| `organization_id` | uuid NOT NULL | denormalised so no query needs the `clients` join to scope |
| `section` | text NOT NULL + CHECK | `income \| commitment \| flexible \| savings \| debt` |
| `name` | text NOT NULL | ≤60 chars |
| `target_amount` | numeric(20,2) NOT NULL default `'0'` | as authored |
| `target_cadence` | text NOT NULL default `'period'` | `period \| month \| week \| day`, normalised per §8.7 |
| `match_keys` | jsonb NOT NULL default `[]` | pre-lowered category keys (`flexible`/`income` only) |
| `is_catch_all` | boolean NOT NULL default `false` | ≤1 per plan; the beginner's single overall envelope |
| **`funding_mode`** | text NULL + CHECK | **NEW** — `virtual \| space_backed`, `savings` only (§8.9) |
| `wealth_account_id` | uuid NULL → `wealth_accounts` **set null** | the Space, `funding_mode='space_backed'` only |
| **`auto_fund`** | boolean NOT NULL default `false` | **rev 3** — opt-in: confirm this fund's contribution automatically at period close (§8.9.1). Enabling it is an audited event |
| **`goal_amount`** | numeric(20,2) NULL | **NEW** — fund goal, both modes |
| **`target_date`** | date NULL | **NEW** — fund target, both modes |
| `carry_policy` | text NOT NULL default `'none'` + CHECK | `none \| surplus \| deficit \| both` |
| `carry_cap` | numeric(20,2) NULL | |
| `priority` | text NOT NULL default `'important'` + CHECK | `essential \| important \| optional` — advisory only |
| `reimbursable` | boolean NOT NULL default `false` | display-only (§9.4) |
| `status` | text NOT NULL default `'active'` | `active \| paused \| removed` — **soft**, history survives |
| `position` | integer NOT NULL default `0` | |
| `created_by`, `updated_by`, `created_at`, `updated_at` | | |

**Removed vs the previous draft:** `recurring_rule_id`. Commitments now attach *to* an
envelope (§10.8), because "Utilities" may have three bills while "Rent" has one — a
one-to-many that a column on the envelope cannot express.

Constraints:

- `UNIQUE (plan_id, lower(name)) WHERE status <> 'removed'`.
- `UNIQUE (plan_id) WHERE is_catch_all AND status = 'active'`.
- `CHECK (funding_mode IS NULL OR section = 'savings')`.
- `CHECK (auto_fund = false OR section = 'savings')` — auto-fund is meaningless elsewhere.
- `CHECK (funding_mode <> 'space_backed' OR wealth_account_id IS NOT NULL)`.
- `INDEX (plan_id, section, status)`, `INDEX (organization_id)`, GIN on `match_keys`.
- App-level: a category key appears in at most one `flexible` envelope per plan (§8.3.2).

### 10.3 `budget_periods`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` | uuid NOT NULL cascade · `organization_id` uuid NOT NULL | |
| `start`, `end_exclusive` | date NOT NULL | plan-local calendar dates; `CHECK (end_exclusive > start)` |
| `status` | text NOT NULL default `'open'` + CHECK | `open \| closed` |
| **`funding_base`** | numeric(20,2) NOT NULL | **NEW** — the period's capacity base. **Cached**, recomputed and audited on drift for `reconstructed_at_boundary`; a captured fact for `snapshot_at_open` (§8.4.1) |
| **`funding_base_source`** | text NOT NULL + CHECK | **NEW** — `expected_income \| reconstructed_at_boundary \| snapshot_at_open`. Determines the accretion rule (§8.4) |
| **`funding_base_anchor_date`** | date NOT NULL | **rev 3** — the plan-local **calendar date** the base is anchored to (`p.start` when reconstructed, the creation date when snapshotted). Compared only against `transactions.date` |
| **`funding_base_as_of`** | timestamp NULL | **rev 3** — the capture **instant**, `snapshot_at_open` only. Compared only against `transactions.created_at`. NULL for the other two sources |
| **`funding_base_computed_at`** | timestamp NOT NULL | **rev 3** — when the cached base was last computed |
| `is_partial` | boolean NOT NULL default `false` | plan started mid-period |
| `closed_at` timestamp NULL · `closed_by` text NULL | | `'system'` for a lazy close |
| `created_at` | | |

- `UNIQUE (plan_id, start)` — the idempotency key for `openPeriod`.
- **`UNIQUE (plan_id) WHERE status = 'open'`** — **rev 4.** At most one open period per plan. This is what makes "an overdue occurrence is counted exactly once in live `Reserved`" a *structural* guarantee rather than an arithmetic hope: only one period can contribute a live figure, and every earlier period serves a frozen `pending_at_close` from its snapshot (§8.6.1).
- `INDEX (plan_id, status, start)`.
- `CHECK ((funding_base_source = 'snapshot_at_open') = (funding_base_as_of IS NOT NULL))` — the instant exists **iff** the source is a snapshot, so the accretion rule can never be ambiguous.

`funding_base` is the fix for blocker #4: capacity is a fact about the period, not a live read
that decays as the user spends. The three `funding_base_*` companions are the rev-3 fix for
income double-counting: they make the accretion boundary explicit and type-correct — a
calendar date is only ever compared to `transactions.date`, and an instant only ever to
`transactions.created_at` (§8.4.2 case 7).

### 10.4 `budget_allocations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK · `period_id` uuid NOT NULL cascade · `envelope_id` uuid NOT NULL cascade · `organization_id` uuid NOT NULL | |
| `planned_amount` | numeric(20,2) NOT NULL default `'0'` | **period-normalised** (§8.7) |
| `authored_amount` / `authored_cadence` | numeric / text | so "€20/day" is still displayable |
| `rollover_in` | numeric(20,2) NOT NULL default `'0'` | written when the **previous** period closes |
| `source` | text NOT NULL default `'copy'` | `copy \| fresh \| suggest \| manual \| derived` |
| **`contribution_status`** | text NULL + CHECK | **rev 3** — `planned \| confirmed \| missed \| skipped`, **savings envelopes only** (§8.9.1). NULL elsewhere |
| **`contribution_confirmed_at`** | timestamp NULL · **`contribution_confirmed_by`** text NULL | **rev 3** — who confirmed, and when. `NULL` actor with a `confirmed` status = `auto_fund` |
| `created_at`, `updated_at`, `updated_by` | | |

- `UNIQUE (period_id, envelope_id)` — idempotency for materialization *and* rollover.
- `INDEX (organization_id, period_id)`.
- `INDEX (organization_id, contribution_status) WHERE contribution_status = 'planned'` — serves the "contributions awaiting confirmation" query on the overview and at period close.
- **This is where the four savings states live** (§8.9.1). Putting them on the allocation is the natural fit: a contribution is *per envelope, per period*, exactly like the allocation it belongs to — so no new table was needed.

### 10.5 `budget_commitments` — **NEW** (blocker #2)

A known obligation. Two kinds, one table, so `Reserved` and `Pending` have a single source.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` uuid NOT NULL cascade · `organization_id` uuid NOT NULL | | |
| `envelope_id` | uuid NOT NULL → `budget_envelopes` cascade | must be `section IN ('commitment','debt')` (§8.3.3) |
| `kind` | text NOT NULL + CHECK | **`one_time` \| `recurring`** |
| `name` | text NOT NULL | ≤120, matching `recurring-validate.ts` |
| `amount` | numeric(20,2) NOT NULL | for `recurring`, the fallback when the rule is unreadable |
| `due_date` | date NULL | **`one_time` only** — required then |
| `recurring_rule_id` | uuid NULL | **`recurring` only** — required then. **No FK**, mirroring `transactions.recurring_rule_id`, so a deleted rule leaves budget history intact |
| `status` | text NOT NULL default `'active'` + CHECK | `active \| paused \| completed \| cancelled` |
| **`needs_attention`** | boolean NOT NULL default `false` | **rev 3** — **`kind='recurring'` only.** Set when unresolved occurrences exceed `MAX_UNRESOLVED_RECURRING_OCCURRENCES` (12) or reach back past `RECURRING_OVERDUE_LOOKBACK_DAYS` (365). Older occurrences then stop being reserved, the UI discloses the excluded count, and the commitment requires review. **A `one_time` commitment never sets this and never ages out** (D-17, §8.6.1) |
| `created_by`, `updated_by`, `created_at`, `updated_at` | | |

- `CHECK ((kind='one_time' AND due_date IS NOT NULL AND recurring_rule_id IS NULL) OR (kind='recurring' AND recurring_rule_id IS NOT NULL))` — the discriminant is enforced in the database, not just in code.
- `CHECK (needs_attention = false OR kind = 'recurring')` — **rev 4.** The safety cap is a recurring-only concept, so the flag cannot be set on a one-time commitment even by a buggy writer.
- **`first_due_date`** date NOT NULL — for `one_time` it equals `due_date`; for `recurring` it is the rule's `start_date`, **denormalised** so `carryLowerBound` (§8.6) never needs to join `recurring_rules` to bound its projection window.
- `UNIQUE (plan_id, recurring_rule_id) WHERE recurring_rule_id IS NOT NULL` — one commitment per rule.
- `INDEX (organization_id, envelope_id, status)`, `INDEX (plan_id, due_date)`, **`INDEX (plan_id, status, kind)`** — the projection loads active commitments per plan and branches on kind.

**Why not extend `recurring_rules`?** Because a one-time obligation is not a schedule.
Forcing it into a rule with `frequency_interval` and a `next_due_at` cursor would (a) make it
materialize a real transaction on the recurring path, which is precisely what must *not*
happen for an unpaid expectation, and (b) put a budget concept in a table three other
features aggregate. This is the clearest case in the spec of **correctness over reusing a
primitive that only partially fits**. Recurring commitments still delegate their schedule to
`recurring_rules` and reuse `occurrencesDue`, so nothing is duplicated where it *does* fit.

### 10.6 `budget_occurrences` — **NEW** (blockers #2, #10)

**Deviations and settlements only.** A plain `expected` occurrence is projected in memory
(§8.6) and is never stored — which is what keeps budget reads pure and this table small.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `commitment_id` | uuid NOT NULL → `budget_commitments` cascade | |
| `organization_id` | uuid NOT NULL | |
| `due_date` | date NOT NULL | the projected occurrence this row overrides |
| `status` | text NOT NULL + CHECK | **`settled` \| `cancelled` \| `skipped` \| `rescheduled`** — never `expected` (that is the unstored default) |
| **`rescheduled_to`** | date NULL | **rev 3** — required when `status = 'rescheduled'`; projection consumes the original date and emits an `expected` occurrence at this one (§8.6.1) |
| `settled_transaction_id` | uuid NULL | **no FK** — a purged transaction must not erase the settlement record |
| `settled_amount` | numeric(20,2) NULL | may differ from the expectation (a bill came in higher) |
| `settled_at` | timestamp NULL · `actor_user_id` text NULL | `NULL` actor = matched by the system |
| `note` | text NOT NULL default `''` | why it was skipped/cancelled |
| `created_at` | | |

- `UNIQUE (commitment_id, due_date)` — the idempotency key for settlement reconciliation.
- `INDEX (organization_id, due_date)`, `INDEX (settled_transaction_id)`.
- `CHECK ((status = 'rescheduled') = (rescheduled_to IS NOT NULL))`.
- `CHECK (rescheduled_to IS NULL OR rescheduled_to <> due_date)` — a reschedule must actually move.
- **App-level, enforced on write (rev 4):** a `rescheduled_to` date must **not collide with another projected occurrence of the same commitment**, and must not already have a stored deviation row. Without this a reschedule onto a natural recurring date would create a second reservation for one obligation — the one way the identity key alone would not save us (§8.6.1).

**Query guidance.** The projection window is `[carryLowerBound(c, p, today), p.end_exclusive)`
and, for a one-time commitment, reaches back **indefinitely**. Deviations are therefore
loaded per commitment over that window:

```sql
SELECT * FROM budget_occurrences
WHERE commitment_id = $1
  AND due_date >= $2        -- carryLowerBound: c.due_date (one_time)
  AND due_date <  $3        --                 or max(first_due_date, today−365d) (recurring)
```

served by the existing `UNIQUE (commitment_id, due_date)`. This is a **bounded index range
scan per commitment**, not a scan of the table, so an unbounded reach for one-time
commitments costs nothing: there is at most one row to find.

> **Overdue is not a stored status.** `overdue` is derived as
> `state = 'expected' AND due_date < today` (§8.6.1). Storing it would require a daily sweep
> to keep rows accurate and would let an obligation silently change state through the mere
> passage of time — the exact bug rev 3 fixes.

**The core invariant, restated because it is the point of the table:** an occurrence row
**never** affects `wealth_accounts.current_balance`. Only transactions move money. An
occurrence changes `Pending`, `Reserved`, `Safe to spend` and `Forecast` — never
`Available now`.

### 10.7 `budget_fund_entries` — **NEW** (blocker #3)

The ledger behind a **virtual** sinking fund's balance. Not used by Space-backed funds,
whose balance is the Space's `current_balance`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `envelope_id` | uuid NOT NULL → `budget_envelopes` cascade | must be `section='savings'`, `funding_mode='virtual'` |
| `organization_id` | uuid NOT NULL · `period_id` uuid NULL | `period_id` NULL for a manual entry outside a period |
| `kind` | text NOT NULL + CHECK | `contribution \| withdrawal \| adjustment` |
| `amount` | numeric(20,2) NOT NULL | positive for contribution/withdrawal; **signed** for adjustment |
| `source` | text NOT NULL + CHECK | **`confirmed` \| `auto_fund` \| `manual` \| `conversion`** — rev 3 replaces `period_close`, because a close alone no longer creates an entry (§8.9.1) |
| `transaction_id` | uuid NULL | set when a withdrawal is paired with a real expense (§9.8) |
| `note` | text NOT NULL default `''` · `actor_user_id` text NULL · `created_at` | |

- `UNIQUE (envelope_id, period_id) WHERE source IN ('confirmed','auto_fund')` — a period can credit a fund **at most once**, whether confirmed by hand or by `auto_fund`, so neither a repeated close nor a double-tapped Confirm can double-credit.
- `INDEX (organization_id, envelope_id, created_at)`.
- `CHECK (kind = 'adjustment' OR amount > 0)`.

**Why a ledger rather than a stored balance column:** a fund balance is money-like. A single
mutable number would drift under concurrent writes and could not answer "where did this
€437.50 come from". `SUM` over an indexed ledger is exact, auditable and reconstructible —
the same reasoning that keeps `spent` derived rather than cached.

**Entries exist only for confirmed contributions** (§8.9.1). A `planned` contribution is
reserved but unwritten, so the fund balance can never overstate what the user actually
committed. This is what keeps `fundBalance` an honest number rather than an optimistic one.

### 10.8 `budget_period_snapshots` — now **versioned** (blocker #8)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK · `period_id` uuid NOT NULL cascade · `organization_id` uuid NOT NULL | |
| **`version`** | integer NOT NULL | **NEW** — `1` is the original close |
| **`is_current`** | boolean NOT NULL default `true` | **NEW** — the operative record |
| **`supersedes_id`** | uuid NULL → self | **NEW** — the version this replaces |
| **`restated_reason`** | text NULL + CHECK | **NEW** — `transaction_edited \| transaction_deleted \| transaction_restored \| backdated_transaction \| settlement_received \| manual` |
| **`restated_by`** | text NULL | **NEW** — actor; `NULL` = system |
| **`drift`** | jsonb NOT NULL default `{}` | **NEW** — `{ field: [was, now] }` diff vs the superseded version |
| **`caused_by_transaction_id`** | uuid NULL | **NEW** — the trigger, where known |
| `currency` | text NOT NULL | plan currency **at close** — history immune to a later org-currency change |
| `payload` | jsonb NOT NULL | the frozen report |
| `engine_version` | integer NOT NULL | so a formula change is attributable |
| `created_at` | | |

- `UNIQUE (period_id, version)`.
- `UNIQUE (period_id) WHERE is_current` — exactly one operative record per period.
- **Version 1 is never deleted or mutated**, nor is any intermediate version (§10.13).

`payload` shape:

```jsonc
{
  "period":  { "start": "2026-09-01", "end_exclusive": "2026-10-01", "timezone": "Europe/Rome",
               "funding_base": 3200.00, "funding_base_source": "expected_income",
               "funding_adjustments": 0.00, "funding_capacity": 3200.00 },
  "income":     { "expected": 3200.00, "received": 3200.00, "outstanding": 0.00 },
  "flexible":   { "planned": 900.00, "spent_gross": 812.40, "refunds_confirmed": 0.00,
                  "refunds_provisional": 100.00, "spent_net": 712.40, "pending": 0.00,
                  "remaining": 187.60, "utilisation": "ok" },
  "commitment": { "planned": 1150.00, "settled": 1150.00, "outstanding": 0.00 },
  "debt":       { "planned": 0.00, "paid": 0.00, "outstanding": 0.00 },
  "savings":    { "planned": 200.00, "funded": 200.00, "funded_cash": 137.50,
                  "outstanding": 0.00, "balance": 437.50 },
  "unallocated": 950.00,
  "total_outflow": 1999.90,
  "envelopes": [
    { "envelope_id": "…", "name": "Groceries", "section": "flexible",
      "planned": 400.00, "rollover_in": 25.00, "spent_gross": 372.10,
      "refunds_confirmed": 0.00, "refunds_provisional": 0.00, "spent_net": 372.10,
      "pending_at_close": 0.00, "remaining": 52.90, "carry": 52.90, "state": "ok" }
  ],
  "adjustments": 2,
  "tx_count": 87
}
```

`name` and `section` are stored inside the payload deliberately: renaming or removing an
envelope must not change what a closed period says.

### 10.9 `budget_events`

Append-only audit. Replaces `budget_history`, and fixes defect #9 by being a **required**
write rather than a best-effort one.

Columns as previously specified — `organization_id`, `plan_id`, `period_id`, `envelope_id`
(**no FK**, so an event outlives a hard-deleted envelope), `related_envelope_id`, `action`,
`amount`, `previous_amount`, `detail` jsonb, `actor_user_id`, `created_at` — with the action
vocabulary extended for the corrections in this revision:

`plan_created · plan_paused · plan_resumed · plan_settings_changed · envelope_added ·
envelope_renamed · amount_changed · cadence_changed · carry_changed · priority_changed ·
envelope_removed · reallocate · rollover_applied · period_opened · period_closed ·
**funding_adjusted** · **period_restated** · **commitment_added** · **commitment_edited** ·
**commitment_cancelled** · **occurrence_settled** · **occurrence_skipped** ·
**occurrence_unsettled** · **fund_contributed** · **fund_withdrawn** ·
**fund_mode_converted** · **refund_confirmed** · **refund_rejected** · tx_excluded ·
tx_included · suggestion_dismissed`

- `INDEX (organization_id, envelope_id, created_at)` · `INDEX (organization_id, period_id, created_at)`.
- **`INDEX (period_id, action) WHERE action = 'funding_adjusted'`** — serves the `SUM` in §8.4.
- One event **per changed field**, batched together — fixing defect #9's second half (a simultaneous raise + cadence change previously logged as `raise` only).
- Never pruned.

### 10.10 `budget_exclusions`

`(id, organization_id, plan_id, transaction_id → transactions cascade, reason, excluded_by,
created_at)`, `UNIQUE (plan_id, transaction_id)`.

Now serves two purposes: excluding an outflow from the plan, and **rejecting a provisional
refund** (`reason='not_a_refund'`, §8.8). Both write a paired `budget_events` row.

A table rather than a column on `transactions`, because Budget v2 must not own a column on
the shared transactions table, and an exclusion needs an actor and a reason.

### 10.11 `transaction_settlements` — **Phase 2 dependency** (blocker #6)

Not built in Phase 1. Specified here so the contract is agreed before anything depends on
it, and because it is the only honest route to full and partial cross-period settlement.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK · `organization_id` uuid NOT NULL cascade | |
| `expense_transaction_id` | uuid NOT NULL → `transactions` cascade | the original outflow |
| `settlement_transaction_id` | uuid NOT NULL → `transactions` cascade | the inflow |
| `amount` | numeric(20,2) NOT NULL | `CHECK (amount > 0)` — **partial** settlements are many rows per expense |
| `kind` | text NOT NULL + CHECK | `refund \| reimbursement \| chargeback` |
| `created_by`, `created_at` | | |

- `UNIQUE (expense_transaction_id, settlement_transaction_id)`.
- `INDEX (organization_id, expense_transaction_id)` · `INDEX (settlement_transaction_id)`.
- **Enforced on write:** `Σ amount` per expense ≤ the expense's amount.

**Ownership note:** this table references `transactions` but adds no column to it, so it
stays consistent with §22.4. It is arguably a *transactions* feature rather than a budget
one — that ownership question is **decision D-12** (§20.1).

### 10.12 Historical edits and edit scope

| Change | Scope | Mechanism |
|---|---|---|
| **This period only** | one `budget_allocations` row | `PATCH /api/budgets/v2/allocations/:id`; the envelope's `target_amount` untouched |
| **Current and future** | envelope + current allocation | `PATCH …/envelopes/:id` with `apply:'current_and_future'`; future periods aren't materialized yet, so they inherit |
| **A closed period, by hand** | **never permitted** | 409. A closed period changes only by restatement, and only as a consequence of underlying transaction data changing |
| **A transaction inside a closed period** | triggers **restatement** | A new snapshot version; the original is preserved (§8.11) |

### 10.13 Audit strategy under the neon-http constraint

The driver has **no interactive transactions**; only `db.batch()` (§2.6). Therefore:

- Every mutation that must be atomic with its audit event is one **`db.batch([...])`**, all statements known upfront. This is the codebase's first use of batching and warrants a comment explaining why, as other money-path invariants do.
- **Audit writes are not best-effort.** If the batch fails, the mutation fails and the API returns 500 — the deliberate reversal of `recordHistory`'s `.catch()` (defect #9). Trade-off recorded as **decision D-6**.
- A close must read spend before writing, so its sequence is: compute → `batch([insert snapshot v1, update period status, insert event, insert next-period allocations, insert fund contributions])`. The unique constraints in §10.14 make a retry safe.
- A **restatement** is likewise one batch: `[insert snapshot vN+1, update vN set is_current=false, insert period_restated event]`. The partial unique index on `is_current` means a concurrent double restatement fails rather than producing two operative records.

### 10.14 Idempotency requirements

| Operation | Key | On repeat |
|---|---|---|
| `openPeriod(plan, start)` | `UNIQUE (plan_id, start)` | no-op |
| Materialize allocations | `UNIQUE (period_id, envelope_id)` | no-op |
| `closePeriod(period)` | `UNIQUE (period_id) WHERE is_current` | returns the existing snapshot |
| Apply rollover | `rollover_in` written once per `(period, envelope)` | never compounds |
| **Credit a virtual fund** (confirm or `auto_fund`) | `UNIQUE (envelope_id, period_id) WHERE source IN ('confirmed','auto_fund')` | never double-credits |
| **Recompute a funding base** | compare-then-write, one event per actual change | no event when nothing changed |
| **Reschedule an occurrence** | `UNIQUE (commitment_id, due_date)` | no-op |
| **Settle an occurrence** | `UNIQUE (commitment_id, due_date)` | no-op |
| **Restate a period** | `UNIQUE (period_id, version)` + the `is_current` partial unique | one operative record |
| `POST /api/budgets/sync` | all of the above | safe to call repeatedly; cheap when nothing is due |
| Reallocation | client `request_id` in `budget_events.detail` | duplicate suppressed |
| Budget alert | `dedupeKey = tier:plan:envelope:period_start` | one per tier per envelope per period |

### 10.15 Soft delete, restore and retention

| Object | Delete | Restore | Retention |
|---|---|---|---|
| Plan | `status='archived'`; never row-deleted while snapshots exist | un-archive | indefinite |
| Envelope | `status='removed'`; allocations, funds and snapshots keep history | `status='active'` | indefinite |
| **Commitment** | `status='cancelled'`; settled occurrences retained | reactivate | indefinite |
| **Occurrence / fund entry** | never deleted (a correction is a new signed entry) | n/a | indefinite |
| Period / snapshot (**all versions**) | never deleted | n/a | indefinite |
| Events | never deleted | n/a | indefinite |
| Exclusion | row-deleted; a `tx_included` event records it | n/a | n/a |
| **Org deletion** | everything cascades via `organization_id` | n/a | matches the existing teardown |

**Trash integration.** Budget v2 owns no trashable entity, so `/api/trash` is untouched. A
*transaction* moving through Trash changes an open period's figures (via `revision`,
§11.6) and, if its period is closed, produces a **restatement**. If that transaction had
settled an occurrence, the settlement is reversed to `expected` and an
`occurrence_unsettled` event is written — otherwise a trashed bill payment would leave the
bill looking paid.

**Fixing #16.** A soft-deleted client no longer hides an envelope, because envelopes are not
client-scoped.

---

## 11. API and frontend architecture

> **Revision note (2026-09-02).** The previously proposed breaking change to
> `GET /api/budgets` is withdrawn. v1 keeps its shape at its path **indefinitely**; the new
> surface lives under `/api/budgets/v2`. A `POST /api/budgets/sync` endpoint is added
> (blocker #10).

### 11.1 Versioning — never break a pinned native client (**blocker #7**)

**The problem being fixed.** The previous draft had `GET /api/budgets` return a new shape for
orgs with a plan, guarded by a server-side flag. That is unsafe: the Android and iOS apps
are Capacitor shells around a **store-pinned bundle** (`docs/native/README.md`), the service
worker is disabled in the shell, and **the store is the only native update path**. A user on
an older build would keep calling `/api/budgets` and receive a shape their bundle cannot
parse — a hard break for an installed app we cannot push an update to.

**The fix — additive versioning by path.**

| Path | Shape | Lifetime |
|---|---|---|
| `GET/POST /api/budgets` | **v1 shape, forever** — a compatibility adapter over the v2 model | Until telemetry shows <1 % of active installs on a pre-v2 bundle **and** ≥180 days have passed |
| `GET /api/budgets/overview`, `/detail` | v1 shapes, adapters | Same |
| **`/api/budgets/v2/**`** | The v2 surface | New |

Path-based versioning over header negotiation: the router already dispatches on segments
([`src/lib/api-router.ts`](../../src/lib/api-router.ts)), it is trivially cacheable, it needs
no header plumbing through `apiGet`, and it is greppable. `/api/budgets/v2` must be
registered **before** any dynamic sibling at that depth (the repo's critical routing rule).

**The v1 read adapter** projects v2 → v1 deterministically:

```
GET /api/budgets  (v1 shape)
  budgets: [ for a personal plan → ONE row:
               { id: plan.id, organization_id, client_id: null,
                 period:  cadence → 'monthly' | 'weekly'
                          ('payday' and 'custom' → 'monthly', the nearest v1 value),
                 amount:  flexible(p).planned,        // the plan's spending ceiling
                 spent:   flexible(p).spent_net } ,
             for business client caps → unchanged v1 rows ]
  account_type: ctx.accountType
```

- Only the **flexible** section is projected, because that is the only section v1's single `(amount, spent)` pair can mean. Commitments, savings and debt are invisible to v1 clients — a loss of detail, never a wrong number.
- `payday`/`custom` cadences report `'monthly'`. An extra `degraded: true` key is added; old clients ignore unknown keys harmlessly, and it lets the web app detect that it is on the adapter.
- A **paused** plan projects `budgets: []` — v1's "no budget", which is the honest degradation.
- A `lifetime` migrated plan (§13.4) also projects `[]` until the user chooses.

**The v1 write adapter** keeps old clients functional: `POST /api/budgets` with
`{ client_id: null, period, amount }` sets the catch-all flexible envelope's amount for the
current period and maps `period` onto the plan cadence (`daily` → `monthly` cadence with
`target_cadence='day'`). `amount: 0` **pauses** the plan rather than deleting it, because
deleting a v2 plan from a v1 client would silently destroy envelopes, commitments and funds
the old client cannot see. Both paths write `budget_events` with
`detail.via = 'v1_adapter'` so adapter traffic is measurable — which is what makes the
sunset decision evidence-based rather than a guess.

**Adapter tests are mandatory** (§16.4): a v1 client must be able to read and write a plan
created in v2 without error, for every cadence and every plan status.

### 11.2 Route table

All handlers live under `api/_routes/budgets/**` and register in
[`api/index.ts`](../../api/index.ts). **No new Vercel function** — everything rides the
existing catch-all, so the 12-function cap is untouched.

| Method + path | Purpose |
|---|---|
| `GET /api/budgets/v2` | **The one aggregate read.** Plan + period + sections + the four numbers + alerts. Read-only. |
| **`POST /api/budgets/v2/sync`** | **Idempotent reconciliation** (blocker #10): materialize due recurring rows, settle occurrences, close/open periods, restate drifted closed periods, return the fresh payload |
| `POST /api/budgets/v2` · `PATCH` · `DELETE` | Create plan · settings/pause/resume · archive |
| `GET /api/budgets/v2/period` · `POST …/period/close` · `POST …/period/open` | One period · close+snapshot · open with a seed |
| `POST /api/budgets/v2/period/funding-adjustment` | **NEW** — an audited change to funding capacity (§8.4) |
| `GET /api/budgets/v2/periods` | Closed-period list (paginated) |
| `GET /api/budgets/v2/periods/:id/versions` | **NEW** — snapshot versions for a restated period (§8.11) |
| `GET /api/budgets/v2/envelopes` · `POST` · `PATCH /:id` · `DELETE /:id` | Envelope CRUD |
| `PATCH /api/budgets/v2/allocations/:id` | This-period-only amount |
| `POST /api/budgets/v2/reallocate` | Audited move |
| **`GET/POST /api/budgets/v2/commitments`** · **`PATCH/DELETE /:id`** | **NEW** — recurring **and one-time** commitments |
| **`POST /api/budgets/v2/occurrences/:key/settle`** · `/skip` · `/cancel` · **`/reschedule`** · `/unsettle` | **NEW** — occurrence state; `key = commitmentId:dueDate`. `reschedule` takes a new date (§8.6.1) |
| **`POST /api/budgets/v2/funds/:id/entries`** | **NEW** — virtual fund withdrawal / adjustment |
| **`POST /api/budgets/v2/funds/:id/contribution/confirm`** · `/skip` | **rev 3** — resolve this period's planned contribution (§8.9.1) |
| **`PATCH /api/budgets/v2/funds/:id/auto-fund`** | **rev 3** — opt in/out of automatic confirmation |
| **`POST /api/budgets/v2/funds/:id/convert`** | **NEW** — virtual ↔ Space-backed |
| **`POST /api/budgets/v2/refunds/:txId/confirm`** · `/reject` | **NEW** — provisional refund resolution (§8.8) |
| `GET /api/budgets/v2/envelopes/:id/transactions` | Drill-through (paginated) |
| `POST /api/budgets/v2/exclusions` · `DELETE /:id` | Exclude / re-include |
| `GET /api/budgets/v2/available` | Server-side `Available now` + `Reserved` breakdown |
| `GET /api/budgets/v2/suggestions` · `POST …/dismiss` | Explainable suggestions |

### 11.3 The `GET /api/budgets/v2` payload

Note the shape changes forced by §8.7: **no `totals.planned` / `totals.spent` pair**, and
`sections` is a keyed object with per-section shapes rather than a uniform array.

```jsonc
{
  "plan": { "id": "…", "status": "active", "cadence": "monthly", "timezone": "Europe/Rome",
            "income_mode": "expected", "expected_income": 3200.00, "currency": "EUR",
            "updated_at": "2026-09-01T08:00:00Z" },
  "period": { "id": "…", "start": "2026-09-01", "end_exclusive": "2026-10-01",
              "status": "open", "is_partial": false, "days_left": 12,
              "funding_base": 3200.00, "funding_base_source": "expected_income",
              "funding_base_anchor_date": "2026-09-01", "funding_base_as_of": null,
              "income_accreted": 0.00, "funding_adjustments": 0.00,
              "funding_capacity": 3200.00 },
  "money": {
    "available_now": 1840.22,
    "reserved": 980.00,
    "reserved_breakdown": { "commitments_outstanding": 780.00, "commitments_overdue": 0.00,
                            "debt_outstanding": 0.00,
                            "virtual_fund_balances": 137.50,
                            "virtual_contributions_unconfirmed": 0.00,
                            "space_contributions_due": 62.50, "protected_savings_due": 0.00 },
    "cash_after_reservations": 860.22,
    "flexible_headroom": 187.60,          // max(0, Σ planned − Σ spent_net − Σ pending) — §8.5.1
    "ceiling_defined": true,
    "safe_to_spend": 187.60,
    "binding": "plan",                       // cash | plan | both | cash_only
    "unallocated": 950.00,
    "unallocated_available": 950.00,          // opt-in top-up, NEVER folded into safe_to_spend
    "forecast_balance": 1420.00
  },
  "sections": {
    "income":     { "expected": 3200.00, "received": 3200.00, "outstanding": 0.00 },
    "flexible":   { "planned": 900.00, "spent_gross": 812.40, "refunds_confirmed": 0.00,
                    "refunds_provisional": 100.00, "spent_net": 712.40, "pending": 0.00,
                    "remaining": 187.60,        // SIGNED — negative when the plan is over
                    "headroom": 187.60,         // floored once; the value used in the min()
                    "unmatched_spent_net": 0.00,
                    "utilisation": "ok",
                    "envelopes": [ /* each carries its OWN signed remaining */ ] },
    "commitment": { "planned": 1150.00, "settled": 1150.00, "outstanding": 0.00,
                    "envelopes": [ /* … */ ] },
    "debt":       { "planned": 0.00, "paid": 0.00, "outstanding": 0.00, "envelopes": [] },
    "savings":    { "planned": 200.00, "reserved": 62.50, "funded": 137.50,
                    "funded_cash": 137.50, "missed": 0.00, "outstanding": 62.50,
                    "balance": 437.50,
                    "awaiting_confirmation": 1,
                    "envelopes": [ { "id": "…", "name": "Car insurance",
                                     "funding_mode": "virtual", "auto_fund": false,
                                     "balance": 437.50,
                                     "contribution_status": "planned",   // §8.9.1
                                     "goal_amount": 750.00, "target_date": "2027-03-01",
                                     "suggested_monthly": 62.50, "progress_pct": 58.3,
                                     "pace": "on_track" } ] }
  },
  "plan_status": "ok",                        // === sections.flexible.utilisation (§8.7)
  "total_outflow": 1999.90,                   // a CASH figure, never a denominator
  "occurrences_upcoming": [ { "commitment_id": "…", "name": "Rent", "due_date": "2026-09-28",
                              "amount": 780.00, "state": "expected", "overdue": false,
                              "kind": "recurring" } ],
  "occurrences_overdue":  [ { "commitment_id": "…", "name": "Parking fine",
                              "due_date": "2026-08-14", "amount": 60.00,
                              "state": "expected", "overdue": true, "days_overdue": 19,
                              "kind": "one_time", "from_previous_period": true } ],
  "sync_required": false,                     // blocker #10 — the staleness probe
  "alerts": [ /* … */ ],
  "suggestions": [ /* … */ ],
  "capabilities": { "can_write": true, "can_close": true, "account_type": "personal" },
  "limitations": ["credit_cards_unsupported", "loan_split_unsupported"]
}
```

`serialize()` is applied to every row (repo convention), so all keys are snake_case.
`capabilities` is server-resolved, mirroring `/api/admin/me`'s `caps` pattern.
`limitations` is machine-readable so §21's honesty requirement is UI-enforceable.
`plan.updated_at` is the optimistic-concurrency token.

### 11.4 Calculation-engine boundary

| Layer | File | Contains | Tested by |
|---|---|---|---|
| **Pure math** | `src/lib/budget-math.ts` | thresholds, `state()`, period boundaries, normalisation, funding capacity, `safeToSpend`/`binding`, rollover, occurrence projection, suggestion math. **Zero imports** | committed unit tests, DB-free |
| **DB engine** | `api/_lib/budget-engine.ts` | the SQL: spent gross/net, available, reserved, occurrence state, fund balances, snapshot read/write/restate, `ensurePeriods`, `sync` | committed **e2e** (D-10) |
| **Adapters** | `api/_lib/budget-v1-adapter.ts` | v2 → v1 projection, v1 → v2 writes (§11.1) | committed unit tests over fixtures + route tests |
| **Routes** | `api/_routes/budgets/**` | auth, validation, serialization, status codes | route tests |

**Rule: no SQL in the routes, and no arithmetic in the engine that isn't delegated to the
pure layer.** Every formula in §8 lives in layer 1 and is unit-tested; layer 2 fetches and
hands off. `occurrencesDue` and the `src/lib/spaces.ts` fund math are imported into layer 1
unchanged.

### 11.5 Frontend state

One provider, one hook — replacing v1's six-component fan-out.

```
src/lib/budget-context.tsx
  BudgetProvider   — mounted inside AppLayout, alongside CurrencyProvider
  useBudget()      — { data, loading, loaded, syncing, error, refresh, sync, mutate helpers }
```

- **One `apiGet("/api/budgets/v2")`** per org per 30 s, shared by the overview, dashboard card, envelope cards and the transaction-form hint.
- **Blocker-#10 self-healing:** if `data.sync_required`, the provider calls `POST /api/budgets/v2/sync` **once** and swaps in the returned payload, exposing `syncing` so the UI can show "updating…" rather than a stale figure. Guarded against loops by a per-mount attempt counter (max 1 automatic sync per mount).
- Refetch on the existing `revision` signal from `useDataRefresh()` (250 ms-debounced, driven by `emitDataChanged`).
- **Targeted invalidation:** mutations pass `invalidate: ["/api/budgets"]` — which prefix-matches both `/api/budgets` and `/api/budgets/v2` in `invalidateKeys` ([`api.ts:58-64`](../../src/lib/api.ts)) — so the rest of the app stays warm.
- **Optimistic edits** via `runOptimistic` ([`optimistic.ts:19-38`](../../src/lib/optimistic.ts)) for amount changes, reallocation, refund confirm/reject and occurrence skip.
- The `loaded` flag lives in the context, so no consumer can reintroduce the empty-state flash.
- No query library introduced (there is none in the repo).

### 11.6 Cache-invalidation contract

Budget figures depend on transactions, wealth accounts, recurring rules and categories, all
mutated elsewhere. `emitDataChanged` already fires on every mutation and additionally
`wealth:accounts-changed` for paths matching
`/^\/api\/(transactions|wealth|trash|recurring|clients)\b/`
([`data-events.ts:22`](../../src/lib/data-events.ts)) — **exactly** the set that moves budget
numbers. `BudgetProvider` subscribing to `revision` is therefore sufficient with no new
plumbing.

Two obligations this revision adds:

1. A transaction mutation must trigger **occurrence settlement reconciliation**. The cheapest correct place is `POST /api/budgets/v2/sync`, called by the provider on the next `revision` tick — so a bill paid on the transactions page shows as settled the moment the budget screen is next read, with no stale window that survives a render.
2. A **test must assert** that every transaction / wealth / recurring / trash mutation invalidates the budget cache key. This is easy to regress silently.

### 11.7 Routing and code-splitting

- Four lazily-loaded pages following the existing convention: `BudgetOverviewPage`, `BudgetPlanPage`, `BudgetEnvelopePage`, `BudgetPeriodPage`.
- **Chunking:** the envelope page uses recharts, so it must stay in a lazily-loaded route chunk and must not be imported by anything landing in `vendor`. The `manualChunks` invariant is that `charts` is a one-way leaf; a `vendor ↔ charts` cycle white-screens every page. Verify `grep -o 'charts-[^"]*\.js' dist/assets/vendor-*.js` is empty and rely on the e2e `prod-build` project.
- `dashboard-layout.ts` needs **no migration** — `budget` is already a registered card id and `normalizeCtx` appends new ids for existing users.
---

## 12. Multicurrency integration contract

### 12.1 What is actually in the repository

Stated precisely, because the brief's premise and the repository disagree:

- **No multicurrency branch exists.** `git branch -r` contains no currency/fx/exchange branch; the newest non-`dev` remote branches are `fix/native-oauth-single-button-maqbool` (2026-07-12) and the `feat/family-*` / `feat/notif4-*` chains (2026-06).
- **No open PR exists at all** (`gh pr list --state open` → empty).
- **No FX identifier exists anywhere.** A search for `exchange_rate|fx_rate|conversion_rate|base_currency|reporting_currency|rate_source|forex` across `src`, `api`, `worker`, `docs`, `drizzle` and `scripts` returns **zero matches**.
- Currency today is **one string per org** (`organizations.currency`, [`schema.ts:14`](../../src/lib/db/schema.ts)), surfaced by `CurrencyProvider` → `useCurrency()` and used purely as a **display formatter** (`formatMoney(amount, currency)`, hardcoded `en-US` locale, [`wealth.ts:96-104`](../../src/lib/wealth.ts)).
- All other currency logic is **billing-only**: `resolveBillingCurrency` ([`billing-currency.ts`](../../src/lib/billing-currency.ts)), `COUNTRY_TO_CURRENCY` ([`currencies.ts`](../../src/lib/currencies.ts)), `invoices.currency`, `subscriptions.billing_currency`. None of it touches the ledger.
- Neither `transactions`, nor `wealth_accounts`, nor `recurring_rules`, nor `budgets` has a currency column.

**Conclusion:** Maqbool's work is either local to his machine or not yet started. I have
therefore written this section as a **contract and a decision list**, not an integration,
and I have added no currency machinery to §10 beyond one forward-compatible snapshot field.

### 12.2 The safest integration boundary

**Recommendation: Budget v2 depends on exactly one function and one column, and nothing else.**

```
// The ONLY seam. Budget v2 calls this and never reasons about currency itself.
amountInPlanCurrency(tx, plan): number
```

Phase 1 implements it as the identity function (§8.14). When multicurrency lands, its owner
reimplements that one function; every formula in §8 already routes through it.

Plus one column, already in §10.1: `budget_plans.currency`, a **snapshot** of the org
currency at plan creation, and `budget_period_snapshots.currency` (§10.8), a snapshot at
close — carried onto **every** restatement version, so a restated period keeps the currency
it was originally reported in. These
two fields alone fix the historical half of defect #10 — a closed period keeps the currency
it was reported in, regardless of what the org later switches to — **without** Budget v2
implementing any conversion.

This boundary is deliberately minimal so that:

1. Budget v2 can ship **before** multicurrency without blocking it.
2. Multicurrency can land **after** without reopening the budget engine.
3. Neither feature invents a model the other has to live with.

### 12.3 Decisions that must be agreed with Maqbool before Phase 2

Each has a recommendation, but **the decision is his** (it is his model).

| # | Question | Budget v2's need | Recommendation |
|---|---|---|---|
| **M1** | Is currency stored **per transaction**, per account, or both? | Budget v2 must know where to read a transaction's currency. | Per **transaction** (`transactions.currency` + `transactions.amount` in that currency), because a foreign purchase on a domestic card is a per-transaction fact. |
| **M2** | Is there a **base / reporting currency**, and where does it live? | The plan must aggregate in one unit. | Yes — `organizations.base_currency`, immutable after the first transaction. `budget_plans.currency` mirrors it. |
| **M3** | Do amounts store **original + converted**, or original only? | Recomputing conversions on every read is expensive (§17). | Store **both**: `amount` (original), `currency`, `base_amount`, `rate`, `rate_at`. The budget engine reads `base_amount` and never converts at read time. |
| **M4** | What is the **rate source** and is it recorded per transaction? | Auditability; two reads must never disagree. | A provider + `rate_at` timestamp stored **on the transaction row**. Not a shared rate table consulted at read time. |
| **M5** | **Transaction-date rate or current rate** for budget consumption? | This changes every historical figure. | **Transaction-date rate, frozen at write.** A budget is a record of what was spent, not a live revaluation. |
| **M6** | Do **historical reports stay stable** when rates move? | P5 depends on it. | Yes — implied by M3+M5. Snapshots additionally freeze the reported figures, so budget history is stable even if the policy later changes. |
| **M7** | **Rounding**: where, and to how many places? | `Σ envelopes` must equal the plan total to the cent. | Round **once**, at conversion, to the currency's minor units; store `base_amount` at `numeric(20,2)`. Never round mid-aggregation. Note zero-decimal currencies (JPY, KRW) break a blanket 2-dp assumption — `formatMoney` currently hardcodes 2. |
| **M8** | **Cross-currency transfers** — how are the two legs related? | Transfers must stay budget-neutral even when the legs differ in base terms. | Both legs carry their own currency + `base_amount`; any residual is an explicit **FX difference** row, never silently absorbed. Budget v2 excludes all three from spend. |
| **M9** | **Display currency** — can a user view in a currency other than base? | Affects `formatMoney` call sites and `Available now`. | Base only in v1. A display-currency toggle is a separate, later feature. |
| **M10** | What happens to **existing single-currency data** at migration? | Defect #10 must not be made worse. | Backfill `currency = organizations.currency`, `base_amount = amount`, `rate = 1`. **Never re-interpret an existing amount.** |
| **M11** | Is `organizations.currency` **frozen** once transactions exist? | Today it is freely `PATCH`-able with no conversion — that *is* defect #10. | **Yes, freeze it.** Introduce `base_currency` (immutable) and demote `currency` to a display preference. This is the actual fix for #10 and it belongs in the multicurrency work, not in Budget v2. |
| **M12** | Do `wealth_accounts` get a currency (a EUR account and an INR account)? | `Available now` sums balances; mixing units silently would be a real money bug. | Yes, per-account currency, and `Available now` must convert or refuse to mix. **Until then, Budget v2's `availableNow` is only correct for single-currency orgs.** |

### 12.4 Interim protections Budget v2 ships in Phase 1

Because #10 remains unfixed until multicurrency lands, Budget v2 takes three cheap,
non-invasive precautions:

1. **Snapshot the currency** on the plan and on every closed-period version (§10.1, §10.8). Closed history becomes currency-stable immediately.
2. **Detect divergence, don't convert.** If `budget_plans.currency <> organizations.currency`, `GET /api/budgets` returns a `currency_changed` entry in `limitations` and the UI shows: "This workspace's currency changed from {{old}} to {{new}}. Past figures are shown in the currency they were recorded in." No conversion, no relabelling.
3. **Never write a currency conversion.** Budget v2 introduces no rate, no FX row, no conversion function body. §8.14's identity stub is the whole implementation.

### 12.5 Coordination protocol

- Budget v2 Phase 1 (§19) is **independent** of multicurrency and must not wait for it.
- Before Phase 2 starts, M1–M12 need answers. A one-page reply from Maqbool on those twelve rows is enough; no meeting is required.
- If multicurrency lands **first**, Budget v2's only change is the body of `amountInPlanCurrency` plus reading `base_amount` in the engine's SQL — a contained change by construction.
- **Neither side should touch the other's tables.** Budget v2 adds no column to `transactions`, `wealth_accounts` or `organizations`. Multicurrency should add none to the ten `budget_*` tables.

---

## 13. Migration strategy

### 13.1 Principle

**Do not silently reinterpret user data.** Every v1 budget carries a meaning the user chose;
the migration must either preserve it exactly or leave it visibly untouched and ask. Where
v1's semantics have no v2 equivalent (`lifetime`), we keep the data and mark it rather than
guess.

### 13.2 Inventory to migrate

From the live schema: `budgets` (≤1 org-level + 1 per client per org) and `budget_history`
(append-only, keyed by `(organization_id, client_id)`).

| v1 row | v2 target |
|---|---|
| Personal org, `client_id IS NULL` | A `budget_plans` row + **one `is_catch_all` flexible envelope** with that amount. The plan's first period gets `funding_base` per §8.4 |
| Business org, `client_id IS NULL` (the "default template") | **Not** a plan. Preserved as a client-cap default (§23), or dropped with an event if unused |
| Business org, `client_id = X` | A **client spend cap**, not an envelope (§23) |
| `period = 'monthly'` | `cadence='monthly'` |
| `period = 'weekly'` | `cadence='weekly'` |
| `period = 'daily'` | `cadence='monthly'` + envelope `target_cadence='day'` (the €20/day intent is preserved and normalised, §8.6) |
| `period = 'lifetime'` | §13.4 — **not auto-converted** |
| `budget_history` rows | `budget_events` rows, `action` mapped 1:1 (`set`→`amount_changed` with `previous_amount=NULL`, `raise`/`lower`→`amount_changed`, `period_change`→`cadence_changed`, `remove`→`envelope_removed`) |

### 13.3 Migration steps

Two migrations plus one backfill script, matching the repo's conventions (`npm run db:generate`,
`drizzle/`, and the `_journal.json` `when` gotcha in `CLAUDE.md` — **bump the new entry's
`when` above the previous one and then verify the columns exist in `information_schema`**).

1. **`0059_budget_v2_tables.sql`** — create the ten tables, constraints and indexes. Purely additive; v1 keeps running.
2. **`scripts/migrate-budgets-v2.ts`** — idempotent, org-by-org, resumable, `--dry-run` first:
   - For each org with a v1 budget, create a `budget_plans` row (`timezone='UTC'` to **exactly preserve** v1 semantics — see §13.8), `income_mode='available'` (v1 had no income concept, so claiming `expected` would invent data), `currency = organizations.currency`.
   - Set the first period's funding base with `funding_base_source='snapshot_at_open'`, `funding_base_as_of = now()`, `funding_base_anchor_date = today` (§8.4). **Snapshot, not reconstruction**, and for the same reason as decision D-18: reconstructing to a boundary before the plan existed would describe a period v2 never governed. Income accretes strictly by `created_at > funding_base_as_of`, so nothing already inside the migrated balance can be counted twice.
   - Mark that first period `is_partial = true` unless the migration happens to run exactly on a period boundary.
   - Create **no** commitments, **no** funds and **no** occurrences. v1 had no such data, and inventing any would breach §13.10.
   - Write snapshot `version = 1` for any period the script closes, so restatement has a baseline (§8.11).
   - Create the catch-all envelope from the org-level row (personal) or the client caps (business, §23).
   - **Open the current period only.** Do not backfill historical periods — see §13.5.
   - Copy `budget_history` → `budget_events` preserving `created_at` and `changed_by`.
   - Write one `plan_created` event with `detail.migrated_from = 'v1'`.
3. **`00NN_drop_budget_v1.sql`** — **only after** the flag is fully rolled out and a full billing cycle has passed. Drops nothing until then; §13.9.

Ordering matters: run step 2 **after** the #1/#6/#7 bug-fix PR (§2.5), so the numbers being
snapshotted are correct.

### 13.4 `lifetime` budgets — do not guess

A `lifetime` budget means "total ever spent against a cap", which has no v2 period. Auto-converting
it to monthly would silently change its meaning (a €10,000 lifetime cap becoming a €10,000
*monthly* budget is a serious misrepresentation).

**Handling:** migrate the row to a **paused** plan with a banner:

> "Your lifetime budget of {{amount}} doesn't map to the new monthly plans. Choose a
> monthly target to continue, or keep it as a record." → `Set a monthly target` · `Keep as a record`

Nothing is tracked until the user chooses. The v1 amount and history remain readable. This
also disposes of defect #12 without a data decision made on the user's behalf.

### 13.5 Historical periods — reconstructed, and labelled as such

We do **not** fabricate snapshots for periods that predate v2, because we cannot know what
was reported at the time (v1 never stored it, and old transactions may since have been
edited — that is defect #8).

- Periods before the migration date have **no snapshot** and are computed live on demand.
- Every such view carries: "History before {{date}} is reconstructed from transactions and may change if old transactions are edited."
- From the migration date forward, every closed period gets a real snapshot and is immutable.

This is strictly more honest than v1 (which silently recomputed everything, always) and
requires no data invention.

### 13.6 URLs, bookmarks and existing surfaces

| Existing surface | Handling |
|---|---|
| `/budgets` | Same route, new screen. No redirect needed. |
| `/budgets/:key` (client id or `default`) | Client-side resolver: `default` → the catch-all envelope; a client id → its envelope (personal) or the client-cap page (business); unknown → `/budgets` with a toast. **No 404 for an existing bookmark.** |
| `GET /api/budgets` (v1 shape) | **No longer a breaking change.** The path keeps its v1 shape **indefinitely**, served by an adapter over the v2 engine (§11.1). Store-pinned native bundles keep working with no store update. Sunset criteria are **decision D-14**. |
| `/api/budgets/overview`, `/api/budgets/detail` | v1-shape adapters over the new engine, retired on the same D-14 criteria as `/api/budgets`. |
| Dashboard card | `budget` card id unchanged; the component is swapped. No layout migration (§11.6). |
| `tx-form` budget hint | Re-points at `useBudget()`; the copy keys `budget.remainingAfter` / `budget.overAfter` are **kept**. |
| Onboarding `MoneyWizard` | Its budget step writes the new plan. Keep the same step position so onboarding analytics stay comparable. |
| Client cards / `ClientsPage` `budgetFor` | Business only — unchanged under §23. |
| Notifications | §14.5 — existing `budget_warning` / `budget_exceeded` types and their i18n keys are **retained**. |

### 13.7 Users with no budget

The largest cohort. They get **nothing**: no plan, no migration row, no prompt beyond the
existing empty state. Budget v2 must not create a plan for anyone who never had one — an
auto-created plan would produce meaningless alerts and a "budget" the user never set.

### 13.8 Users whose budget amount equals their salary

A known v1 anti-pattern: with no income concept, some users entered their **income** as
their spending target. Auto-classifying that as `expected_income` would be a guess.

**Handling:** the migration never infers. But when a plan's catch-all target is within 5 %
of the org's median monthly income (computed from `incoming` transactions over the last 3
months), the overview shows a **one-time, dismissible** prompt:

> "Is {{amount}} what you earn, or what you want to spend?" → `That's my income` · `That's my spending target` · `Dismiss`

Choosing "my income" sets `income_mode='expected'`, `expected_income`, and leaves the
spending target empty for the user to set. This converts a silent data-meaning problem into
one explicit question, asked once.

### 13.9 Feature flag, rollback and coexistence

- **Flag:** `budget_v2`, resolved **server-side per org**. Simplest viable mechanism: presence of a `budget_plans` row — no new infrastructure, inherently per-org. Because §11.1 removed the breaking change, the flag now governs only which *UI* an org sees, not whether an old client can parse the response — a much smaller risk surface.
- **Rollout:** internal org → opt-in beta → new signups → migrate existing users in batches → default on.
- **Coexistence:** v1 tables are **read-only but intact** for the whole window. `GET /api/budgets` returns the v1 shape whether or not a plan exists — from the v1 tables when there is no plan, from the adapter when there is. Old data remains readable at every moment, and **the v1 API paths outlive the v1 tables**.
- **Rollback:** if a plan is archived, the org falls back to the v1 handler and its v1 rows are still there. Because migration is *additive* — it never mutates or deletes a `budgets` or `budget_history` row — rollback is "stop reading the new tables", with no data restoration step.
- **Point of no return:** dropping the v1 tables (step 3). Gate it on: flag at 100 % for ≥30 days, zero v1-handler traffic in logs, and a verified backup.

### 13.10 What the migration must never do

1. Convert a `lifetime` budget to a periodic one (§13.4).
2. Infer `expected_income` from any figure (§13.8).
3. Create a plan for a user with no v1 budget (§13.7).
4. Fabricate historical snapshots (§13.5).
5. Convert, relabel or re-denominate any amount (§12.4).
6. Mutate or delete a `budgets` / `budget_history` row during the flag window (§13.9).
7. Turn a business client cap into a household envelope (§23).

---

## 14. Notification strategy

### 14.1 What already exists

Budget notifications are **already a first-class category** — this is a fix-and-extend job,
not a new integration:

- `budget` is one of six `NOTIFICATION_CATEGORIES` ([`src/lib/notifications.ts:13-20`](../../src/lib/notifications.ts)), with `budget_warning` and `budget_exceeded` registered types (`:49-50`).
- **`budget` is in `DEFAULT_PUSH_ON`** (`:82`) — budget notifications default to push-**on**, web and mobile.
- i18n keys exist: `notifications.types.budget_warning.{title,body}` and `budget_exceeded.{title,body}`.
- The preference cascade is **client > organization > user**, with `muted` at **any** level winning outright (`resolveChannelEnabled`, `:116-130`).
- Preferences are **per-category, never per-type** — `sanitizePreferences` drops anything else, so a per-type opt-out cannot be stored.
- **There is no email channel**: `NOTIFICATION_CHANNELS = ["in_app","web_push","mobile_push"]`.
- Dedupe is a partial unique index on `(user_id, dedupe_key)`, and `notifyOrgMembers` **suffixes the key per recipient** (`api/_lib/notifications.ts:236`).

### 14.2 Fixing the two live defects

**#6 — alerts fire from one call site.** Replace the single hook with one evaluator called
from **every** path that changes spend:

| Path | File | Today |
|---|---|---|
| Create (single) | `api/_routes/transactions.ts:407` | ✅ present |
| **Create (split group)** | `api/_routes/transactions/group.ts` | ❌ missing |
| **Edit** | `api/_routes/transactions/[id].ts` | ❌ missing |
| **Delete / restore** | `transactions/[id].ts`, `trash/restore.ts` | ❌ missing — should *clear* a standing alert state, not fire |
| **Recurring materialization** | `api/_lib/recurring-materialize.ts` | ❌ missing |
| **Occurrence settlement** | `POST /api/budgets/v2/sync` | new — a settled bill can push a debt/commitment envelope over |
| **Transfer** | `wealth/transfer.ts` | correctly none (transfers never affect spend) |
| **System adjustment** | `wealth/accounts/[id].ts` | correctly none (fixes #1) |

Signature: `evaluateBudgetAlerts(orgId, { envelopeIds?, actorUserId })`, fire-and-forget
(`void … .catch(() => {})`) so it can never fail a money write — the existing discipline.

Because alerts are now evaluated per **envelope** and per **section**, an alert can also fire
when `Reserved` crosses `Available now` (§14.4) — a condition v1 could not even express.

**#7 — personal/org budgets never alert.** The v1 query is
`eq(budgets.clientId, clientId)`, which cannot match the `client_id IS NULL` row. In v2 the
concept is gone: alerts are evaluated **per envelope**, and a personal plan's catch-all
envelope is an envelope like any other. Already a documented known gap
([`docs/notifications/PLAN.md:96`](../notifications/PLAN.md)).

### 14.3 Tiers and dedupe

Reuse `state()` from §8.1 so the notification and the bar can never disagree — this is the
concrete payoff of fixing #14.

| Tier | Condition | Type |
|---|---|---|
| `warn` | `spent >= 0.8 × planned` and `< planned` | `budget_warning` |
| `full` | `spent == planned` | `budget_warning` (copy variant) |
| `over` | `spent > planned` | `budget_exceeded` |

`dedupeKey = "{tier}:{plan_id}:{envelope_id}:{period_start}"` → at most one warning and one
exceeded per envelope per period, per recipient (the fan-out suffixes the user id). Matches
the existing pattern exactly.

Two rev-3 additions with their own dedupe keys, both chosen so a *persistent* condition
cannot become a recurring nag:

- `budget_commitment_unpaid` → `"unpaid:{commitment_id}:{due_date}"`. **One notification per occurrence, ever** — keyed on the occurrence, not on the day, so a bill that stays overdue for three weeks produces one notification rather than twenty-one. The standing condition is surfaced *in the UI* (§6.3's overdue row), which is the right channel for something that persists.
- `budget_contribution_awaiting` → `"contrib:{plan_id}:{period_start}"`. One per period close, listing the count.

**Alerts must respect the overdue rule.** An envelope whose spend is unchanged but whose
`Reserved` rose because an occurrence went overdue must **not** re-fire `budget_exceeded` —
the tier is computed from `spent_net + pending` against `planned` (§8.1), and the dedupe key
already covers the period, so no new alert is produced.

### 14.4 New notifications, and the restraint applied

Only three are justified. **Every additional alert is a tax on trust** (P7), and `budget` is
push-on by default, so a chatty budget feature would train users to mute the whole category.

| Type | When | Category | Default |
|---|---|---|---|
| `budget_period_closed` | A period closes with a summary (§6.14) | `budget` | in-app **on**, push **off** |
| `budget_period_restated` | A closed period was restated because old transactions changed (§8.11) | `budget` | in-app **on**, push **off** — it is informational, never urgent |
| `budget_reserved_exceeds_available` | `Reserved > Available now` — the genuinely urgent one: bills due before the horizon (**overdue ones included**) exceed the money on hand | `budget` | on (both) |
| `budget_commitment_unpaid` | A commitment's due date passes with no matching transaction — it is now **overdue** and **remains reserved** until explicitly resolved (§8.6.1) | `budget` | in-app on, push off |
| `budget_contribution_awaiting` | A period closed with savings contributions still unconfirmed (§8.9.1) | `budget` | in-app **on**, push **off** — a prompt, not an alarm |

Explicitly **rejected**: per-transaction "you're at 62 %" nudges, daily digests, streak
notifications, "you overspent again" reminders, any suggestion delivered as a push, and —
importantly — a notification for every provisional refund. A provisional refund is disclosed
**in place** on the envelope card (§6.5); pushing it would make an ordinary refund feel like
a problem.

Each new type needs a `NOTIFICATION_TYPES` entry plus
`notifications.types.<type>.{title,body}` in **all 8 locales** (the i18n gate enforces it).
Note `system_announcement` is registered with **no** i18n entry today — do not repeat that.

### 14.5 Migration of existing notification behaviour

- `budget_warning` / `budget_exceeded` types and their i18n keys are **retained** — no user-visible churn, no preference reset.
- Existing `budget`-category preferences keep applying, including mutes.
- The `i18nParams` shape changes from `{ name, period }` (client name) to `{ name, period }` (envelope name) — **same keys, same copy**, so no locale edits are needed for the existing two types.
- Push payloads stay English-only (a pre-existing limitation of the push path).
- Recipients: keep `roles: ["owner","admin","editor"]` — everyone who can act, excluding `viewer`.

### 14.6 Scheduling — no new infrastructure

There is **no periodic per-org financial computation anywhere** in the product today, and
Budget v2 does not add one. Specifically:

- **Period close** happens in the idempotent `POST /api/budgets/v2/sync` (§8.10), which the client calls when a read reports `sync_required`. Reads themselves stay pure.
- For the "nobody opened the app" case, reuse the existing **exact-time one-shot** primitive `enqueueNotificationTickAt(runAt, occurrenceKey)` ([`worker-jobs.ts:82`](../../api/_lib/worker-jobs.ts)) to fire an `app.trigger` at the period boundary. It is best-effort by design, which is the right posture: lazy close is the guarantee, the job is the nicety.
- **No new Go job handler**, no new cron schedule, no `vercel.json` cron (the project has none). The single registered schedule (`notifications-dispatch`, hourly) is untouched.
---

## 15. Accessibility and localisation

Accessibility requirements are specified per-screen in §6.22; this section covers what is
structural rather than per-screen, plus localisation.

### 15.1 Localisation scope and cost

This is the largest non-engineering cost in the project and must be planned, not discovered.

- v1's surface is **50 keys** (`budget.*` 23 + `budgetsPage.*` 27).
- v2 needs an estimated **300–400 keys**: 23 screens/dialogs, five section labels **each with its own vocabulary** (§8.7), six states, four rollover policies, three priorities, four cadences, the four numbers plus their explainers, **the four `binding` strings** (§6.3), **two funding-mode explainers**, **provisional-refund and restatement copy**, ~45 microcopy and consequence strings, ~25 validation messages, ~15 empty/partial/error states, and 6 notification types × 2.
- **× 8 locales** (`en, it, de, hi, ml, ta, te, ar`) = roughly **2,400–3,200 translated strings**.
- The gate is hard: `scripts/check-i18n.mjs` fails the commit if any locale is missing a key, has an empty value, or drops a `{{placeholder}}` — so **English keys cannot land before their translations**. Budget the translation work per phase, not at the end.
- Use `scripts/i18n-merge.mjs` for bulk backfill: input is `{ "<lang>": { "<dotted.key>": "<value>" } }`, additive, order-preserving, 2-space indent.

**Recommendation: register `budget` as a page namespace.** `PAGE_NAMESPACES`
([`i18n/index.ts:14-18`](../../src/lib/i18n/index.ts)) already contains `wealth`, `spaces`,
`notifications`, `transactions` — every comparably-sized feature. Adding `budget` gives
`useTranslation("budget")` + short keys, and it keeps ~400 keys out of the eagerly-shipped
default bundle for the 7 non-English locales (only `en` ships eagerly; the rest are dynamic
imports). Keep the existing `budget.*` / `budgetsPage.*` keys where they are to avoid
churning translations that already exist.

### 15.2 Formatting and RTL

| Concern | Requirement |
|---|---|
| **Money** | Always `formatMoney(amount, currency)` — never a raw number, never a hardcoded symbol. Note it hardcodes the `en-US` locale, so grouping separators do not follow the UI language. Fixing that is out of scope but should be **recorded as a known inconsistency**, and any *new* formatter must not make it worse. |
| **Zero-decimal currencies** | `formatMoney` forces `minimumFractionDigits: 2`, which is wrong for JPY/KRW/VND. Budget v2 inherits this; flagged in §20 (**D-11**) and coupled to M7. |
| **Dates** | `toLocaleDateString(i18n.language, …)` as `BudgetDetailPage.tsx:77-79` already does. Period labels must render the plan's calendar dates, parsed as `new Date(start + "T00:00:00Z")` to avoid a local-parse off-by-one. |
| **Percentages** | Rounded integers, `Math.round`, never a raw float. |
| **Plurals** | Only `_one` / `_other` exist anywhere in the codebase; do not introduce `_few`/`_many` without adding them to **all** locales (the gate treats extras as warnings but missing en keys as failures). |
| **RTL (`ar`)** | Progress bars must fill from the inline start — use logical properties or `rtl:` variants, not `left`. Chart axes and the waterfall in §6.18 need explicit RTL handling; recharts is not RTL-aware. Directional icons (`ChevronRight`, arrows) need `rtl:rotate-180`, the pattern already used at `Dashboard.tsx:1144`. Test `ar` explicitly (§16.14). |
| **Long translations** | German and Tamil labels run 40–60 % longer than English. Section headers, the four number labels and chips must wrap or truncate gracefully — no fixed-width figure containers. Use `FitText` for the headline. |
| **Landing/blog** | Uses a **separate** i18n instance (`src/landing/i18n/`) not covered by the parity gate. Budget v2 must not touch it. |

### 15.3 Structural accessibility

- **The four numbers are a definition list**, not a grid of divs: `<dl>` with `<dt>` labels and `<dd>` figures, so the label↔value relationship is programmatic.
- **`aria-live="polite"` on `Safe to spend` only.** One live region, debounced. Announcing every envelope on refresh would be unusable.
- **Charts require an `sr-only` table** equivalent (period / planned / spent) — recharts output is not screen-reader legible.
- **`binding` must be text, never inferred from styling.** The reason `Safe to spend` is limited is announced as part of the figure's accessible name, so a screen-reader user gets "Safe to spend, €187.60, limited by your plan" in one read.
- **A restatement chip must be announced**, not conveyed by a subtle visual marker: `aria-label="Restated on {{date}}, view original"`.
- **Progress semantics:** `role="progressbar"` + `aria-valuenow/min/max` + an `aria-label` naming the envelope, on every bar. v1 has only a wrapper `aria-label`.
- **Focus management:** drawers and dialogs trap focus, close on `Esc`, restore focus to the trigger, and wire `aria-labelledby`. The reallocation and period-close flows must be completable by keyboard alone.
- **Never colour alone** — every state carries text or an icon (§6.22).
- **Reduced motion** honoured for bars, charts and route transitions.

---

## 16. Testing strategy

The current budget suite is **30 pure-function tests and nothing else** — no coverage of the
SQL, the routes, the notification path or any component. That gap is how eight of the
fifteen defects survived. The matrix below is deliberately weighted toward the layers that
were previously untested.

**Repo constraint:** the committed unit gate is **DB-free**
(`vite.config.ts` hands the worker a placeholder `DATABASE_URL`; a committed test must never
open a connection). DB-touching tests are throwaway, run as
`node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local`
and deleted before commit — **except** the e2e suite, which has its own Neon branch
(`E2E_DATABASE_URL`) and *can* hold committed DB tests.

**Consequence, stated plainly:** the DB engine (§11.3 layer 2) cannot be covered by
committed unit tests. It must be covered by **committed e2e specs** in `e2e/` instead —
otherwise the SQL stays permanently untested, which is exactly the v1 situation. This is
**decision D-10** in §20.

### 16.1 Pure calculation tests (committed, DB-free) — the core

Target: `src/lib/budget-math.ts`. These are the highest-value tests in the project.

| Group | Cases |
|---|---|
| Thresholds | `< 80%` → ok · `= 80%` → warn · `= 100%` → **`full`** (locks #15) · `> 100%` → over · `planned = 0, spent > 0` → over · `planned = 0, spent = 0` → none |
| Period boundaries | monthly / weekly (each `week_start_day` 1–7) / payday (anchor 1, 15, 28, **31 in Feb, Apr, Dec**) / custom · start inclusive, end exclusive · **plan tz vs UTC divergence** for `Pacific/Kiritimati` (UTC+14) and `Pacific/Midway` (UTC−11) |
| DST | A period containing a spring-forward and a fall-back boundary in `Europe/Rome` and `America/New_York` keeps identical `start`/`end_exclusive` date strings and identical day counts |
| Cadence normalisation | €20/day → a 28/30/31-day period · €50/week → monthly · idempotent when cadence = period · rounding to the cent |
| Signed net spend | outgoing adds · matched incoming subtracts · refund > spend → **negative** spend preserved in data, bar clamped to 0 |
| Rollover | all four policies × surplus/deficit · `carry_cap` clamp · `none` on commitment/debt/savings · never compounds on repeat |
| Reserved | A **settled** occurrence contributes 0 (the double-count guard) · a **virtual** fund's balance IS reserved · a **Space-backed** fund's balance is **NOT** (§8.5) — the same €500 must never be reserved twice |
| Pending | Projected occurrences by state · a `settled` occurrence is spend **and not** pending in the same read · `cancelled`/`skipped` → 0 · paused commitment → 0 · **one-time** commitment in/out of window · one-time with a past due date → still `expected`, never auto-settled |
| **Safe to spend** | `min(cash, headroom)` · `ceiling_defined=false` → cash-bound and `binding='cash_only'` · €5,000 cash + spent-out €900 ceiling → **20, `binding='plan'`** · untouched €900 ceiling + €120 cash → **120, `binding='cash'`** · equal bounds → `both` · negative cash propagates unfloored · `unallocated` never added |
| **Headroom netting (rev 3)** | The review's example: Groceries 300/400 and Dining 200/0 → **headroom 100**, not 200 · each card still reports **−100** and **+200** · a wholly over-spent plan → headroom **0** (never negative) while `flexible.remaining` stays **signed negative** · unmatched flexible spend consumes headroom · property test: `headroom = max(0, Σplanned − Σspent_net − Σpending)` for random envelope sets, and **never** `Σ max(0, ·)` |
| **Reallocation invariance (rev 3)** | A reallocation leaves `Σ planned` and therefore `safe_to_spend` **unchanged**, while both envelopes' signed remainings move · covering from unallocated **raises** headroom by exactly that amount · a refund raises headroom by exactly its amount |
| **Overdue occurrences (rev 3)** | An unpaid occurrence stays `expected`, in `Pending` **and** `Reserved`, on the day after `due_date` · and 30 days after · and **after a period boundary** · `settled`/`cancelled`/`skipped` remove it; the passage of time does not |
| **Projection window reaches back (rev 4)** | **The regression test for the rev-3 bug:** with `p.start = 2026-09-01` and a one-time commitment due `2026-08-14`, `occurrences(e, p, today)` **actually contains** that occurrence — asserted on the projected set, not merely on a filter · `carried = true` on it · a projection lower-bounded at `p.start` fails this test |
| **One-time never ages out (rev 4)** | A one-time commitment unpaid for **400 days** is still projected, still `expected`, still in `Reserved` · at 800 days too · `needs_attention` is **never** set on a one-time commitment · `carryLowerBound(one_time) = c.due_date` regardless of `today` |
| **Recurring is bounded (rev 4)** | An abandoned monthly rule with 30 unresolved occurrences projects at most `MAX_UNRESOLVED_RECURRING_OCCURRENCES = 12`, keeping the **most recent** · occurrences older than `RECURRING_OVERDUE_LOOKBACK_DAYS = 365` are outside the window · `needs_attention` is set and `excluded_count` is reported · the bound applies **only** to `kind='recurring'` |
| **Counted exactly once (rev 4)** | The projected set is deduped on `(commitment_id, due_date)` · current and carried subsets are disjoint · a carried occurrence appears once in `Reserved` even though a closed period's snapshot also records it in `pending_at_close` · a reschedule onto an existing projected date is **rejected** rather than producing two reservations |
| **Resolution removes the reservation (rev 4)** | For a carried occurrence, each of `settle`, `cancel`, `skip` and `reschedule` removes the **original** reservation; `reschedule` re-adds exactly one at the new date (and none if the target is outside the window) |
| **Funding base (rev 3)** | All seven §8.4.2 cases · **case 4 is the regression test**: a period opened 5 days late with salary on day 2 yields capacity **once**, not twice · `balanceMovedSince` includes soft-deleted **system** rows and excludes soft-deleted ordinary rows · reconstruction is self-consistent under a backdated income (base falls, accretion rises, capacity unchanged) · `snapshot_at_open` accretes strictly by `created_at`, never by `date` · a date is never compared to an instant |
| **Contribution states (rev 3)** | `planned` reserves but writes **no** fund entry and leaves `fundBalance` unchanged · confirming is **`Reserved`-neutral** and `safe_to_spend`-neutral · a close with `auto_fund=false` yields `missed`, not `funded` · with `auto_fund=true` yields `confirmed` + one entry · confirming twice credits once · a `missed` contribution shifts `pace` to `behind` and raises `suggestedMonthly` |
| Forecast | waterfall arithmetic · `income_mode='available'` → income term 0 |
| Suggestions | median-of-3 · single period → `low` confidence · no history → null · partial-period exclusion · median robust to one outlier |
| **Funding base** | Spending never changes `funding_base`/`capacity`/`unallocated` (property test over random expense sequences) · available-mode base equals `available_now` at open and does not track it after · income accretes capacity in available mode but not expected mode · adjustments are signed and audited |
| **Section separation** | No formula sums planned or spent across sections · `plan_status ≡ flexible.utilisation` · funding a savings envelope does not move utilisation · `total_outflow` excludes virtual credits |
| **Refunds** | gross/provisional/confirmed/net all reported · reject restores gross · income never nets a flexible envelope · net may be negative |
| Unallocated | both income modes · negative allowed |
| Envelope matching | case-insensitive (`Rent`/`rent`/` RENT `) · unmatched → catch-all · `is_system` excluded · transfers excluded |
| `Σ envelopes = plan total` | property test over random envelope/transaction sets — no double counting, no drift |

### 16.2 Database / query integration (throwaway + e2e)

| Case | Asserts |
|---|---|
| `is_system` exclusion | An opening balance and a downward balance adjustment produce **zero** envelope spend (**locks #1**) |
| **Occurrences never move money** | Creating recurring and one-time commitments leaves every `wealth_accounts.current_balance` byte-identical (**locks blocker #2**) |
| **Overdue survives a close** | An unpaid one-time commitment due in period N is still reserved in period N+1, N+2, and appears in exactly one open period's `pending` (**locks blocker #2 rev 3**) |
| **Prior-period occurrence is projected** | After closing period N, a `GET /api/budgets/v2` for period N+1 returns the N-dated occurrence in `occurrences_overdue` with `from_previous_period: true`, and `reserved_breakdown.commitments_overdue` includes its amount **once** (**locks the rev-4 projection bug**) |
| **One open period** | `UNIQUE (plan_id) WHERE status='open'` rejects a second open period, so no two periods can both contribute a live `Reserved` |
| **Reschedule collision rejected** | Rescheduling onto a date that already has a projected occurrence for the same commitment returns 409 and creates no second reservation |
| **Funding base rollback** | `balanceMovedSince` reproduces the true boundary balance across a mixed set of income, expense, transfer, system and trashed rows (**locks blocker #3 rev 3**) |
| **No income double count** | Period opened late with prior income: `funding_capacity` equals the boundary balance plus that income **once** |
| **Confirmation writes nothing early** | A `planned` contribution creates no `budget_fund_entries` row; closing without confirming still creates none |
| **Virtual funds never move money** | A contribution changes no balance, raises `reserved`, lowers `safe_to_spend` |
| **Space fund not double-reserved** | Funding €500 into a Space lowers `available_now` by 500 and `reserved` by 500; the balance is never re-reserved (**locks the §8.5 asymmetry**) |
| **Sync idempotency** | Two `POST /sync` calls in a row → one materialization, one rollover, one fund credit, one restatement |
| **Reads are pure** | A budget GET issues no `INSERT`/`UPDATE` and changes no balance; it reports `sync_required` instead (**locks blocker #10**) |
| **Restatement** | Close → edit an old tx → `sync` → `version 2` is current, `version 1` byte-identical, one `is_current` row, `period_restated` event with a diff |
| **v1 adapter** | A v1-shaped GET/POST round-trips against a v2 plan for every cadence × plan status (**locks blocker #7**) |
| Transfer exclusion | Both legs excluded; a bank→Space transfer lowers `available_now` and lowers `reserved` |
| Split groups | N legs counted once in total |
| Soft delete | Trashed tx removed from an open period; restore re-adds |
| `available_now` | Sums only non-archived `bank`+`cash`; an archived account's balance disappears (documenting the pre-existing behaviour) |
| Case-insensitive category match | Uses the functional index (assert via `EXPLAIN`, §17.2) |
| Org scoping | Every query is org-scoped; a second org's transactions never leak |
| Snapshot preservation | Version 1 is never mutated or deleted across an arbitrary sequence of historical edits |

### 16.3 Migration tests (throwaway, against a seeded copy)

| Case | Asserts |
|---|---|
| Personal `client_id IS NULL` | → plan + catch-all envelope, amount preserved exactly |
| Business client budgets | → client caps, **not** envelopes (§23) |
| `daily` / `weekly` | → correct cadence + `target_cadence`, normalised amount matches the authored intent |
| `lifetime` | → **paused** plan, nothing tracked, banner state present (**locks §13.4**) |
| `budget_history` | → `budget_events` with `created_at`/actor preserved; count matches |
| No v1 budget | → **no plan created** (locks §13.7) |
| Idempotency | Running the script twice changes nothing |
| Non-destructive | `budgets` / `budget_history` rows byte-identical afterwards |
| `--dry-run` | Writes nothing |
| Rollback | Archiving the plan restores v1 behaviour with v1 data intact |

### 16.4 Route / API tests

Status codes and shapes: 401 unauthenticated · 403 `viewer` write · 403 cross-org · 409 closed-period
write · 409 stale `expected_updated_at` · 400 invalid cadence/amount/timezone · 402 never (budgets
aren't quota-gated) · `serialize()` snake_case on every row · `capabilities` and `limitations`
present · a suggestions failure does not fail `GET /api/budgets`.

### 16.5 Component tests

The four-figure card (Planned/Spent/Pending/Remaining, `Pending` hidden at 0) · state colours +
text label pairing · the `loaded` flag prevents an empty-state flash on refresh · reallocation
consequence copy computes before/after correctly · overspend picker excludes zero-surplus donors ·
`viewer` sees no write affordances · negative `safe_to_spend` renders amber not red.

### 16.6 End-to-end flows (`e2e/`, committed)

1. **Onboarding in four decisions** — assert the flow presents exactly four decisions and completes; the *timed* median-under-60 s target is measured in moderated usability testing and in production telemetry, not asserted by an e2e run (§21.1).
2. Add a category envelope → record an expense → the card updates in place (no full-screen reload).
3. Overspend → cover from another envelope → both envelopes and the audit timeline reflect it.
4. Close a period → snapshot written → start the next with `copy` → rollover applied once.
5. Edit a transaction inside a **closed** period → the historical view still shows the snapshot **and** flags divergence.
6. Sinking fund: create Space + goal → auto-save → `Use this fund` two-step spend → `available_now` net-unchanged, spend recorded once.
7. Pause → nothing tracked, no alerts → resume → the backfill prompt appears (never silent).
8. **`prod-build` project** — the budget pages must render in the real bundle (guards the `manualChunks` cycle).

### 16.7 Timezone and DST

Run the calculation suite under `TZ=Pacific/Kiritimati`, `TZ=Pacific/Midway`,
`TZ=Asia/Kolkata` (UTC+5:30) and `TZ=Europe/Rome`, plus plan timezones that differ from the
process timezone. Assert: a transaction recorded at 23:30 local on the last day of the month
lands in **that** month; a spring-forward day is still one day; `safeTimezone('Not/AZone')`
falls back to UTC without throwing.

### 16.8 Scenario tests from the personas

Each of §4's personas becomes a committed fixture asserting the four numbers:

| Persona | Key assertion |
|---|---|
| **A — salaried EUR** | With €1,150 of bills due before the horizon, `safe_to_spend` is €1,150 below `available_now` |
| **B — categories + sinking fund** | €62.50 is reserved, not spent, and **not labelled funded until confirmed**; the fund is **virtual** and needs no Spaces quota; Groceries carries surplus only; `safe_to_spend` reflects whichever of cash/headroom binds |
| **H — overdue obligations (rev 3/4)** | An unpaid €60 parking fine, a €900 tax bill, a €1,200 university fee and a €200 personal repayment — all **one-time**, each past its due date, each originating in a *different earlier period*, one of them **>365 days old** — are all still projected and reserved, together reducing `safe_to_spend` by €2,360 across three period boundaries, each counted exactly once. Then settling the fine, skipping the repayment and rescheduling the fee leaves only the tax bill and the rescheduled fee reserved |
| **I — overspent + surplus (rev 3)** | Groceries 300/400 with Dining 200/0 → plan headroom **100**; reallocating €100 Dining→Groceries leaves `safe_to_spend` unchanged |
| **B′ — free plan, three funds** | A free user creates **three** virtual sinking funds with no quota error (**locks blocker #3**) |
| **C′ — one-time commitment** | A €400 one-time commitment appears in `Pending` and `Reserved`, moves no balance, and settles once when paid |
| **C — irregular income** | `income_mode='available'`; forecast counts only held money; no NaN, no "expected income" copy |
| **D — EUR + INR** | **Documented as blocked**; the test asserts the `limitations` payload contains the currency caveat |
| **E — credit card** | Card account excluded from `included_account_ids`; `limitations` contains `credit_cards_unsupported` |
| **F — reimbursement** | €400 counts as spend in March; the May inflow nets May, **not** March; it is reported as `refunds_provisional` with confirm/reject available; a €250 + €150 partial pair yields `partially_settled` then `fully_settled` under the §10.11 contract; a settlement after close produces a **restatement**, not a silent rewrite |
| **G — small business** | No envelope plan; client caps behave as today; **no** household concepts appear in the UI |

### 16.9 Permission and role tests

`owner`/`admin` full · `editor` may write but **not** close a period or delete the plan
(§18.2 — note v1 lets an editor delete a budget via `amount = 0`; v2 tightens this) ·
`viewer` read-only, all mutations 403 · cross-org access 403 · personal-only surfaces
(savings/Spaces) 403 on business orgs.

### 16.10 Notification tests

Tier boundaries reuse `state()` so the bar and the alert agree · dedupe: one warning + one
exceeded per envelope per period per recipient · alerts fire from **all** spend-changing
paths (§14.2) — a test per path, since this is exactly how #6 happened · a personal
catch-all envelope **does** alert (locks #7) · category mute at user/org/client each
suppresses · `important` bypass **not** used for budget alerts · a paused plan emits nothing.

### 16.11 Performance tests

Seed 100k transactions across 24 months and 40 envelopes in one org, then assert:

- `GET /api/budgets/v2` (open period) — **p95 < 400 ms**, and `EXPLAIN` shows an index scan on `(client_id, date)` with **no** full-table scan (the direct regression test for #13).
- The staleness probe is a single `EXISTS` and adds **< 5 ms**.
- `POST /sync` with nothing due is a no-op in **< 50 ms**; with 12 elapsed periods it stays within the per-request cap and is resumable.
- A **virtual fund balance** is one indexed `SUM` over `budget_fund_entries`, O(entries) not O(transactions), and stays < 20 ms at 10k entries.
- The **v1 adapter** adds < 30 ms over the v2 read it wraps.
- A closed-period read is a **single** snapshot row fetch — O(1), independent of transaction count.
- `ensurePeriods` after 12 elapsed periods completes within the per-request cap and is resumable.
- No query fans out per envelope (assert query **count**, not just latency — an N+1 over 40 envelopes is the likely regression).

### 16.12 Idempotency and concurrency

Concurrent double `closePeriod` → one snapshot version, one rollover application, one fund
credit · concurrent `openPeriod` → one period (unique constraint) · concurrent `sync` → no
double materialization, no second restatement (the `is_current` partial unique index makes
the loser fail rather than duplicate) · concurrent reallocation with the same `request_id` →
applied once · concurrent allocation edits on different envelopes → both succeed, same
envelope → 409 · concurrent occurrence settlement → one (`UNIQUE (commitment_id, due_date)`).

### 16.13 Soft-delete / restore

Transaction trash → restore → purge, each reflected in an open period and **never** in a
closed snapshot · client trash no longer hides a budget (**locks #16**) · envelope
soft-removal keeps its history and its snapshots readable.

### 16.14 Accessibility and responsiveness

axe-core with zero criticals on all four pages in both themes · full keyboard path through
reallocation and period close · contrast verified for amber/emerald/red on `bg-card` in
light **and** dark · `ar` RTL: bars fill from the inline start, chevrons mirrored, no
horizontal page scroll · 320 px-wide viewport: no horizontal scroll, no truncated figures ·
44 px minimum touch targets · 16 px minimum inputs · `prefers-reduced-motion` honoured.

---

## 17. Performance considerations

### 17.1 Fixing defect #13

| v1 problem | v2 resolution |
|---|---|
| `lifetime` forces an unbounded scan of the org's whole transaction history | **`lifetime` is removed** (§5.3). Every spend query is bounded by `date >= start AND date < end_exclusive`, so `(client_id, date)` is usable. |
| The scan runs on nearly every page load | Closed periods read **one snapshot row**. Only the current period is computed live, over one period's transactions. |
| `overview.ts` loads the org's entire `budget_history` unfiltered | `budget_events` is queried by `(organization_id, envelope_id, created_at)` with a limit; the overview needs **no** event data at all. |
| `spendForWindows` aggregates in JS | All aggregation moves to SQL (`GROUP BY` + `FILTER`), following the `analytics.ts` precedent. |
| Six components each fetch independently | One `BudgetProvider` + one aggregate endpoint (§11.4). |

**Cost model:** the hot path becomes *one period of transactions*, not *all of history* —
typically 50–300 rows instead of 10k–100k. Historical views become O(1).

### 17.2 Indexes required

| Index | Serves |
|---|---|
| `transactions (client_id, date)` | **already exists** — now actually usable |
| `budget_commitments (organization_id, envelope_id, status)` · `(plan_id, due_date)` | occurrence projection |
| `budget_occurrences (commitment_id, due_date)` UNIQUE · `(settled_transaction_id)` | deviation lookup + reverse settlement on trash |
| `budget_fund_entries (organization_id, envelope_id, created_at)` | virtual fund balances in one grouped `SUM` |
| `budget_period_snapshots (period_id) WHERE is_current` UNIQUE · `(period_id, version)` UNIQUE | O(1) historical read + restatement integrity |
| `budget_allocations (organization_id, contribution_status) WHERE contribution_status='planned'` | contributions awaiting confirmation |
| `budget_occurrences (commitment_id, due_date)` UNIQUE serves the per-commitment deviation range scan | carry lookback — a **bounded index range per commitment**, so a one-time commitment's unbounded reach finds at most one row and costs nothing |
| `budget_commitments (plan_id, status, kind)` | the projection loads active commitments and branches on kind |
| `budget_events (period_id, action) WHERE action='funding_adjusted'` | the funding-adjustment `SUM` (§8.4) |
| **`transactions (lower(btrim(category)))`** — functional, new | envelope matching (§8.3.1). Without it, case-insensitive matching forces a scan and we trade defect #13 for a new one. |
| `budget_periods (plan_id, status, start)` | current period + stale-period close |
| `budget_allocations (period_id, envelope_id)` UNIQUE | materialization + idempotency |
| `budget_period_snapshots (period_id)` UNIQUE | O(1) historical read |
| `budget_events (organization_id, envelope_id, created_at)` | envelope timeline |
| `budget_envelopes (plan_id, section, status)` | plan load |
| GIN on `budget_envelopes.match_keys` | reverse category→envelope lookup |

The functional index on a **shared, hot** table is the one change that needs review beyond
the budget team: it adds write cost to every transaction insert. An alternative — storing a
normalised `category_key` column — would be faster to read but requires backfilling and
maintaining a column on `transactions`, which §12.5 says Budget v2 must not own. **Decision
D-4** in §20.

### 17.3 Query budget per endpoint

| Endpoint | Target |
|---|---|
| `GET /api/budgets/v2` (open period) | **≤6 queries**: plan+envelopes · allocations · one grouped spend aggregate for all envelopes · available_now · commitments+stored occurrence deviations · virtual fund balances (one grouped `SUM`). **No per-envelope and no per-fund query.** |
| `POST /api/budgets/v2/sync` | 1 probe + only the writes actually required; a no-op costs 1 query |
| `GET /api/budgets/period` (closed) | **1** query (the snapshot) |
| `GET /api/budgets/periods` | 1 paginated query |
| `GET /api/budgets/suggestions` | 1 query over snapshots — **never** over raw transactions |
| Every write | 1 `db.batch()` |

`Promise.all` for independent reads, following `analytics.ts` and `budgets.ts:19-22`.

### 17.4 Other measures

- **Suggestions come from snapshots, not transactions** — this is what keeps them cheap; it is also why snapshots store per-envelope detail.
- `ensurePeriods` is capped per request (`MAX_PERIODS_PER_RUN = 24`) and resumable, mirroring `MAX_OCCURRENCES_PER_RUN = 60`.
- The client's 30 s GET cache + in-flight dedup already collapses concurrent identical fetches; the provider makes that one fetch instead of six.
- **Payload size:** the aggregate response grows with envelope count. Cap `sections[].envelopes` at 200 and paginate beyond that; a 300-envelope plan should not ship a 500 KB JSON to a mobile WebView.
- **Budget reads never call `materializeDueRecurring`** — it writes transactions and moves balances, so a GET must not do it. Reads run a one-`EXISTS` staleness probe and report `sync_required`; the write happens in the explicit idempotent `POST /api/budgets/v2/sync` (§8.10). This is the **reversed decision D-3** (§20.1): the cost is one extra round trip on the rare stale path, and the benefit is that no budget screen ever shows a figure it knows to be stale.

---

## 18. Security and permissions

### 18.1 Scoping

Every query is scoped by `orgId` from `requireAuth()` — never `userId`. `budget_envelopes`,
`budget_allocations`, `budget_periods` and `budget_events` all carry a denormalised
`organization_id` **specifically so that scoping never depends on a join chain** through
`plan → org` or, worse, through `clients` (which is how `transactions` is scoped today and
is a latent footgun).

Route-guard sweep: `scripts/check-route-guards.mjs` requires every `api/_routes` handler to
call an auth guard, and it runs in `security.yml` — so a new budget route that forgets
`requireAuth` fails CI. All 16 new handlers must satisfy it.

### 18.2 Role matrix

| Action | owner | admin | editor | viewer |
|---|---|---|---|---|
| Read plan, periods, history | ✅ | ✅ | ✅ | ✅ |
| Create plan | ✅ | ✅ | ✅ | ❌ |
| Edit allocations / envelopes | ✅ | ✅ | ✅ | ❌ |
| Reallocate | ✅ | ✅ | ✅ | ❌ |
| Close period / start next | ✅ | ✅ | ❌ | ❌ |
| Change plan settings (cadence, tz, accounts) | ✅ | ✅ | ❌ | ❌ |
| Pause / resume plan | ✅ | ✅ | ❌ | ❌ |
| Archive plan | ✅ | ✅ | ❌ | ❌ |
| Exclude a transaction | ✅ | ✅ | ✅ | ❌ |

Implemented with the existing `canWrite` (owner/admin/editor) and `canDelete`
(owner/admin) — **no new role primitive**. Period close and plan settings use `canDelete`
because they are irreversible or plan-wide.

**This tightens v1**, where an editor can delete a budget outright by POSTing `amount = 0`
(there is no `canDelete` path for budgets at all). Worth calling out in the release notes.

Client mirrors (`canWriteRole`/`canDeleteRole`) drive affordances only; the server always
re-enforces. The client should prefer the server-resolved `capabilities` block (§11.2) over
inferring from a role string — the pattern `/api/admin/me` already establishes.

### 18.3 Plan gating

**Recommendation: do not plan-gate Budget v2.** Reasons:

- Budgets are ungated today, on both `account_type` and `plan_key`. Gating an existing free feature is a regression users will notice.
- Budgets are structurally self-limiting: envelope count is bounded by the categories cap (300) and, in practice, by the free plan's 10-client / 30-tx-per-client limits.
- The genuine premium hooks already exist **around** budgeting: Spaces (free 1 / paid 7) gates sinking funds, and bank accounts (free 1 / paid 20) gates multi-account plans. A free user naturally hits those, not a budget wall.

If a limit is later wanted, the cheapest honest one is `limits.budgetEnvelopes` (free 5,
paid unlimited) via a new `checkBudgetEnvelopeQuota` following the existing `check*` shape
and returning the standard 402 + `upgradeHint`. **Decision D-2** (§20).

Note a pre-existing inconsistency worth avoiding reliance on: the `plan_key` returned by
`/api/organizations` does **not** honour the cancelled-grace-period that `getOrgPlan`
does, so client-side and server-side plan views can disagree during a grace window. Gate
server-side only.

### 18.4 Data exposure

- No new PII. Envelope names are user-authored and org-scoped.
- Budget figures are org-scoped; membership already grants read of all org financial data (there is **no** read-side role gate anywhere in the product — `viewer` is read-only only because every mutation is behind `canWrite`).
- `budget_events.actor_user_id` stores a Clerk user id, consistent with `created_by` elsewhere. Do not surface raw ids in the UI; resolve to names via the members list.
- Notifications must not leak amounts to users who cannot read them — recipients are org members filtered to `owner|admin|editor`, matching v1.
- The `secret-scan.mjs` pre-commit step covers the new files; no new env vars are introduced by Budget v2.

### 18.5 Input validation

Reuse the existing guards rather than writing new ones: `amountExceedsLimit` (all amounts),
`MAX_NAME_LENGTH = 60` (envelope names), the ISO-date regex `/^\d{4}-\d{2}-\d{2}$/`,
`safeTimezone` (timezones), `parseGoal`/`parseTargetDate` (sinking-fund goals), and
`validateRuleInput` (commitments). Enum values are validated **and** CHECK-constrained
(§10.1). Reject non-finite and negative amounts at the route boundary with a 400 carrying a
`reason` the client can render via `apiErrorMessage`.

### 18.6 Known pre-existing weaknesses inherited

Stated for completeness; none is introduced by Budget v2, and none should be silently
relied upon:

1. **`orgAuthCache` has a 60 s TTL, no eviction and no invalidation** (`auth.ts:220-234`) — a role change or membership removal takes up to a minute to take effect, and the `Map` is unbounded. Affects every route.
2. **Two non-atomic balance writes** exist in the wealth routes; concurrent balance adjustments can lose one. Budget v2 only *reads* balances, so it inherits any drift without amplifying it.
3. **`tag-ops.ts` reverses `is_system` legs** because it does not select `isSystem`, unlike every other reversal call site — a real inconsistency in the wealth ledger, adjacent to defect #1 and worth fixing in the same PR.
4. **No interactive transactions** (neon-http), so multi-statement money paths are sequential awaits. Budget v2 uses `db.batch()` where atomicity matters; a crash mid-sequence elsewhere remains a pre-existing risk.

---

## 19. Phased implementation plan

Each phase is independently shippable and leaves the product in a coherent state. Sizes are
rough and assume one engineer plus translation support.

### Phase 0 — Fix the live bugs (≈2–3 days) · **do this first, independently**

Not part of v2; a separate reviewable PR against `dev`.

- **#1** — add `is_system = false` to both queries in `api/_lib/budget-spend.ts`.
- **#6** — call `notifyIfBudgetExceeded` from the split-group and edit paths.
- **#7** — make the alert query handle the `client_id IS NULL` budget.
- **#18** — decide and document whether `analytics.ts`/`calendar.ts`/`flow.ts` also exclude `is_system` (recommend yes, for consistency).
- **#3 (bonus)** — fix `tag-ops.ts` to select `isSystem` (§18.6).
- Add the first DB-touching e2e assertions for these, and correct `CLAUDE.md`'s stale "migration head 0052" → 0058.

**Why first:** they are live correctness bugs, the fixes are small, and they make v1's
numbers trustworthy at the moment §13.3 snapshots them.

### Phase 1 — Foundation + beginner path (≈2 weeks)

Delivers a complete, useful product for personas **A** and **C**.

- Migration `0059`: the ten tables (§10).
- `src/lib/budget-math.ts` with the full committed unit suite (§16.1) — **written first**.
- `api/_lib/budget-engine.ts`: spend (gross/net), available, reserved, occurrence projection, `ensurePeriods`, snapshot write + restatement.
- `GET/POST/PATCH /api/budgets/v2`, **`POST /api/budgets/v2/sync`**, `/period`, `/period/close`, `/period/open`, `/period/funding-adjustment`, `/available`.
- **`api/_lib/budget-v1-adapter.ts`** — `/api/budgets` keeps its v1 shape from day one (§11.1), so no native client is ever broken.
- **Signed net spend from day one** (§8.8), so a refund reduces the catch-all envelope immediately; the split (`spent_gross` / `refunds_provisional` / `spent_net`) is in the payload and disclosed on the card, with `Confirm` / `Not a refund` wired to `budget_exclusions`. This resolves the D-5 phase inconsistency: **provisional refund handling is Phase 1**; only `transaction_settlements` (explicit partial, cross-period links) is Phase 2.
- Onboarding wizard (§6.1), overview with the four numbers (§6.3), empty state, paused state.
- One catch-all envelope; **timezone-correct periods**; **stored funding base**; **bounded `safe_to_spend` with `binding`**; period close + versioned snapshots + restatement.
- `BudgetProvider` + `useBudget()`; the dashboard card swapped.
- Alerting rebuilt per §14.2 (fixing #6/#7 properly in the new model).
- i18n: ~120 keys × 8 locales.
- **Exit criteria:** the §21.1 measured onboarding target is met; `Safe to spend` is correct for personas A and C in **both** binding directions; a budget GET performs no writes; a closed period restates (never silently rewrites) under a later transaction edit; a v1 client still works against a v2 plan.

### Phase 2 — Envelopes, commitments, sections (≈2 weeks)

Delivers personas **B** and **F**.

- Envelope CRUD, **per-section shapes** (§8.7), category matching + the functional index, plan view (§6.4), envelope detail (§6.6).
- **`budget_commitments` + occurrences: recurring *and* one-time**; `Reserved` fully populated; occurrence settle/skip/cancel.
- Debt section (fixes #3); reimbursable flag.
- **Overdue occurrence handling end-to-end** (§8.6.1): the back-reaching projection window, the overdue row, `Mark paid` / `Skip` / `Cancel` / `Reschedule`, the reschedule-collision guard, and recurring-only `needs_attention` with its disclosed `excluded_count`.
- **`transaction_settlements`** — explicit expense↔refund links for full and partial cross-period settlement, if D-12 assigns it here; otherwise consumed from the transactions team. (Provisional netting already shipped in Phase 1.)
- Rollover, period close/review (§6.14), start-next (§6.15).
- Overspend resolution + reallocation with audit (§6.11, §6.12).
- i18n: ~150 further keys.
- **Exit criteria:** no formula sums across sections; headroom is netted before flooring; `Σ flexible envelopes + unmatched = flexible.spent_net` under property tests; a one-time commitment moves no balance and stays reserved when overdue; reallocation is audited and provably capacity-neutral; no automatic money movement anywhere.

### Phase 3 — Savings, sinking funds, suggestions (≈1.5 weeks)

- Savings envelopes with **both funding modes**; **virtual funds unlimited on the free plan**; mode conversion (§8.9).
- **The four contribution states + confirmation UX + `auto_fund` opt-in** (§8.9.1), including the period-close confirmation block.
- The guided fund-spend flows for both modes (§9.8).
- Explainable suggestions + dismissals (§8.9); the three new notification types (§14.4).
- Custom cadences: weekly, payday, custom range (§6.16).
- **Exit criteria:** a free user creates three virtual funds; a Space-backed fund's balance is never double-reserved; a fund spend leaves `available_now` net-unchanged and records spend exactly once; **no contribution is ever labelled funded without confirmation or an explicit `auto_fund` opt-in**.

### Phase 4 — Migration + rollout (≈1 week)

- `scripts/migrate-budgets-v2.ts` with `--dry-run`, plus the full migration suite (§16.3).
- The `lifetime` prompt (§13.4), the salary-vs-target prompt (§13.8), legacy URL resolution (§13.6).
- Staged rollout (§13.9); performance validation at 100k transactions (§16.11).
- Documentation: rewrite `docs/budget/BUDGETS.md` as the v2 explainer, add a `budget-v2` skill mirroring `subscription-system`/`notification-system` (the repo's convention is a durable `docs/**` explainer paired with a skill).
- **Exit criteria:** zero v1 rows mutated; rollback verified; p95 within budget.

### Phase 5 — Deferred, each gated on its dependency

| Item | Gate |
|---|---|
| Multicurrency support in the engine | §12 M1–M12 answered and implemented |
| Credit cards | liability accounts + pending/cleared (§9.5) |
| Real pending transactions | `transactions.status` (§9.6) |
| Loan principal/interest split | debt-account model (§9.7) |
| Reimbursement claim links | a two-transaction settlement link (§9.8) |
| Business envelope plans | §23's re-evaluation trigger (no longer technically blocked — virtual funds need no Spaces) |
| Retiring the v1 API adapter | **D-14** sunset criteria met |
| Export / reports | after snapshots have accumulated |
---

## 20. Risks and unresolved decisions

### 20.1 Decisions requiring approval

| # | Decision | Recommendation | Owner | Blocks |
|---|---|---|---|---|
| **D-1** | **Personal-first, or personal + business simultaneously?** | **Personal-first**, shared engine, business client caps preserved unchanged (§23). Note virtual sinking funds (§8.9) have no Spaces dependency, so a future business rollout is no longer blocked by that | Fazil | Phase 1 scope |
| **D-2** | Plan-gate Budget v2 at all? | **No.** Budgets are ungated today. **Virtual sinking funds must stay unlimited on the free plan** (blocker #3) — only Space-backed funds consume the Spaces quota | Fazil | Phase 1 |
| **D-3** | ~~Accept staleness in budget reads~~ → **REVERSED.** How should budget reads handle unmaterialized recurring rows? | **Reads stay pure; staleness is detected and reported (`sync_required`), and resolved by an idempotent `POST /api/budgets/v2/sync`** (§8.10). Expectations come from projected occurrences and never depend on materialization at all. Cost: one extra round trip on the rare stale path. Rejected alternatives: a GET that writes transactions and moves balances (non-idempotent, surprising, lets a refresh create money movements), or accepting a knowingly-stale money screen | Fazil / eng | Phase 1 |
| **D-4** | Functional index `lower(btrim(category))` on `transactions`, or a normalised `category_key` column? | **Functional index.** Budget v2 must not own a column on the shared transactions table, and a backfill risks the data reinterpretation §13.1 forbids | eng + transactions owner | Phase 2 |
| **D-5** | Is **provisional refund netting** acceptable for Phase 1, with `transaction_settlements` in Phase 2? | **Yes.** Signed netting is intrinsic to the engine and cannot be deferred, so Phase 1 ships netting **plus** the reported split, the disclosure and one-tap `Confirm` / `Not a refund` (which only needs `budget_exclusions`, already a Phase-1 table). Phase 2 adds `transaction_settlements` for explicit partial/cross-period links. §19 now matches this | Fazil | Phase 1 |
| **D-6** | Should a failed audit write **block** a budget edit? | **Yes.** Reverses v1's best-effort `recordHistory` (defect #9). Cost: a rare DB hiccup becomes a user-visible 500 | Fazil | Phase 1 |
| **D-7** | A plan created mid-period: pro-rate targets, or full targets for a partial period? | **Full targets, flagged `is_partial`**, with copy explaining the short period. The period's `funding_base` is still snapshotted at open | Fazil | Phase 1 |
| **D-8** | May a reallocation push the **source** envelope over budget? | **No** — cap at the source's remaining | Fazil | Phase 2 |
| **D-9** | Promote `/budgets` to a primary mobile tab for personal accounts? | **Yes for personal**, keep it in More for business | Fazil | Phase 1 |
| **D-10** | The DB engine cannot have committed unit tests (DB-free gate). Cover it with committed **e2e** specs? | **Yes.** Otherwise the SQL stays untested — the v1 situation that let 8 defects through | eng | Phase 1 |
| **D-11** | Fix `formatMoney`'s forced 2 decimals for zero-decimal currencies (JPY/KRW/VND)? | **Out of scope for Budget v2**; couple to M7 so multicurrency fixes it once app-wide | Maqbool / Fazil | Phase 5 |
| **D-12** | **NEW** — Who owns `transaction_settlements` (§10.11): the budget feature or the transactions feature? | **Transactions.** A refund↔expense link is a transactions-domain fact that budgeting *consumes*. Budget v2 should specify and consume it, not own it. If transactions can't take it in Phase 2, Budget v2 builds it with an explicit note that ownership transfers later | Fazil | Phase 2 |
| **D-13** | **NEW** — Should a restatement be **auto-applied** by `sync`, or require confirmation? | **Auto-applied**, always versioned and audited (§8.11). The displayed record must be correct; requiring confirmation would leave a knowingly-wrong figure on screen, which is the problem we are fixing. The *original* is preserved and one tap away | Fazil | Phase 1 |
| **D-14** | **NEW** — Sunset criteria for the v1 API adapter? | **<1 % of active installs on a pre-v2 bundle AND ≥180 days**, measured from `budget_events.detail.via='v1_adapter'` traffic plus store-adoption telemetry. Until both hold, v1 stays. Do **not** set a calendar date | Fazil | Phase 4 |
| **D-15** | **NEW** — Default funding mode for a new sinking fund? | **`virtual`.** It works on every plan, needs no quota, moves no money, and is reversible. Space-backing is an explicit upgrade ("actually move the money") | Fazil | Phase 3 |
| **D-16** | **rev 3** — Should `auto_fund` default on for new sinking funds? | **No, off.** Automatic *reservation* is legitimate (it is the plan); an automatic claim that money **was set aside** is not (§8.9.1). Off by default, one tap to enable, audited when enabled | Fazil | Phase 3 |
| **D-17** | **rev 4 (revised)** — How is overdue carry bounded? | **Split by kind, because the risks are not symmetric.** **(a) `one_time` commitments are never bounded and never age out.** An unpaid fine, tax bill, university fee or personal repayment stays reserved **indefinitely** until it is settled, cancelled, skipped or rescheduled — it is a real debt, and it projects exactly **one** occurrence, so an unbounded reach costs O(1) per commitment. **(b) The `RECURRING_OVERDUE_LOOKBACK_DAYS = 365` / `MAX_UNRESOLVED_RECURRING_OCCURRENCES = 12` protection applies to `recurring` commitments only**, where an abandoned rule could otherwise reserve years of duplicate obligations. **(c) On reaching the cap:** set `needs_attention`, **require review**, exclude the older occurrences from `Reserved`, and **disclose the excluded count explicitly** in the UI — never a silent drop. A DB `CHECK` prevents `needs_attention` on a one-time commitment | Fazil | Phase 2 |
| **D-18** | **rev 3** — For a plan created **mid-period**, anchor the funding base at creation (`snapshot_at_open`) rather than reconstructing to the period start? | **Yes, anchor at creation.** Reconstructing to a boundary before the plan existed would describe a period the plan never governed and would inflate capacity by spending the plan never saw. Full periods use reconstruction, which is strictly more accurate (§8.4.2) | Fazil | Phase 1 |

### 20.2 Decisions requiring Maqbool

**M1–M12 in §12.3.** A written reply on those twelve rows unblocks Phase 5; none blocks
Phases 0–4. The two most consequential: **M5** (transaction-date vs current rate — determines
whether historical figures are stable; recommend transaction-date frozen at write) and
**M11** (freeze `organizations.currency` — the actual fix for defect #10, which belongs in
multicurrency, not here).

### 20.3 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Ten tables is more surface than the reviewed 7-table draft** | Certain | Medium | Each addition is forced by a correctness blocker and justified in §10.0/§10.5–10.7. Two of the three (`budget_occurrences`, `budget_fund_entries`) are small, append-only and read via a single indexed aggregate |
| **The four numbers plus `binding` is more vocabulary to teach** | Medium | High | `binding` is *explanatory*, not another number — it turns "why is this €187?" into one sentence. §6.19 is mandatory. Validate in the Phase 1 beta before Phase 2 builds on the vocabulary |
| **`sync` becomes a hot, write-heavy endpoint** | Medium | Medium | The staleness probe is one `EXISTS` query; `sync` is a no-op when nothing is due; the provider calls it at most once per mount. Measure adapter and sync traffic from day one |
| **Multicurrency lands with a different model than §12 assumes** | Medium | Medium | The whole currency surface is one function plus two snapshot columns |
| **Scope creep into credit cards / in-flight pending** | High | High | §9.5/§9.6 state the blockers precisely; §21 requires the UI to *state* the limitation. Approximating either double-counts spend |
| **i18n becomes the critical path** (~2,400–3,200 strings after this revision, hard CI gate) | High | Medium | Translate per phase; register `budget` as a page namespace |
| **The v1 adapter drifts from v2 semantics** and starts lying to old clients | Medium | High | Adapter tests are mandatory for every cadence × plan status (§16.4); the adapter only ever projects the *flexible* section, so it can lose detail but not invent a number |
| **Virtual/Space reservation asymmetry implemented wrongly**, double-counting a funded Space | Medium | **High** | The single most error-prone rule in the spec (§8.5). Dedicated tests in §16.1 and §16.2; stated twice in the document on purpose |
| **Headroom implemented as `Σ max(0, remaining)`** — the natural, wrong instinct | **High** | **High** | It is the rev-3 blocker precisely because it looks right. A property test asserts the netted form specifically, and §8.5.1 carries the worked counter-example |
| **Overdue carry implemented with a `today` lower bound**, silently forgetting obligations | Medium | **High** | Tests assert an obligation still reserved 30 days late and across two period boundaries; §8.6.1 states that time resolves nothing |
| **Funding-base reconstruction gets the trashed/system rollback set backwards** | Medium | **High** | Silently shifts every base. §16.2 asserts it over a mixed row set; the rule is called out inline in §8.4 |
| **Users leave contributions unconfirmed and funds look permanently behind** | Medium | Low | `auto_fund` exists for exactly this preference (opt-in, D-16); the period-close block makes `Confirm all` one tap |
| **Users don't understand a restatement** | Low | Low | It is disclosed as one chip with the original one tap away — strictly simpler than the permanent dual-figure UX it replaces |
| **Occurrence settlement mis-matches** a transaction to the wrong occurrence | Medium | Medium | Recurring matches on the existing unique `(recurring_rule_id, recurring_due_date)` key — exact. One-time matching is **suggested, never auto-applied** |
| **Funding-base snapshot taken at a bad moment** (e.g. the day before payday, in available mode) makes capacity look tiny | Medium | Medium | Explicit funding adjustments (§8.4) plus income accretion correct it; the period-open screen shows the base and offers to adjust it |
| **Lazy period close never runs** for a dormant user | Medium | Low | `MAX_PERIODS_PER_RUN = 24`, resumable; plus the best-effort boundary job |
| **Migration misinterprets a `lifetime` or salary-as-target budget** | Medium | High | §13.4 / §13.8: never infer; ask once. Migration is additive and reversible |
| **A 300-envelope plan ships a huge payload** | Low | Medium | Cap at 200 envelopes per response and paginate |
| **`Available now` is wrong for multi-currency orgs** | Low today | High later | Blocked on M12; every org is single-currency by construction today |

### 20.4 Explicitly out of scope

Bank feeds / open banking · receipt OCR into envelopes · shared/household budgets across
orgs (the unmerged `family` work) · goal-based investment tracking · tax categorisation ·
multi-year plans · CSV/PDF export (Phase 5) · **any automatic money movement** · **any
automatic reallocation**.

---

## 21. Acceptance criteria

### 21.1 Onboarding (**blocker #9** — decisions and a measured target, not interaction count)

1. The first-run flow presents exactly **four decisions**: planning period · expected income *or* "my income varies" · one spending target · confirm. No fifth decision is added, and categories, commitments, savings, funds, debt, rollover, timezone, accounts and priorities do not appear.
2. **Measured usability target:** in moderated first-run testing with **≥5 participants new to the feature**, the **median time from opening `/budgets` to a saved plan is under 60 s**, and **p90 is under 90 s**. Recorded with participant count, medians and failures — a target that is *measured*, not asserted.
3. **Instrumented in production:** `budget_onboarding_started` / `budget_onboarding_completed` events carry a duration, so the median is observable on real traffic and can regress a release.
4. Immediately after completion, `/budgets` shows a `Safe to spend` figure with `binding` rendered, and no configuration prompt.

*(Interaction count is deliberately **not** a criterion: it penalises good UI — a chip picker is one tap where a stepper is three — and it measures the wrong thing.)*

### 21.2 Safe to spend and the four numbers (**blocker #1**)

5. `safe_to_spend = min(cash_after_reservations, flexible_headroom)` whenever a ceiling is defined, and `= cash_after_reservations` when it is not.
6. `ceiling_defined = false` (no flexible envelope with a positive planned amount) yields `binding = 'cash_only'` and copy stating that no spending target is set. No division by zero, no NaN, no silent 0.
7. A user with €5,000 in the bank, no reservations, and a €900 flexible ceiling of which €880 is spent sees **`safe_to_spend = 20`, `binding = 'plan'`** — not €5,000.
8. A user with a €900 untouched ceiling but only €120 of cash after reservations sees **`safe_to_spend = 120`, `binding = 'cash'`**.
9. `unallocated` is **never** added into `safe_to_spend`; it is returned separately and only ever applied through an explicit user action.
10. Negative `cash_after_reservations` propagates as a negative `safe_to_spend` (not floored), rendered amber with an explanation.
10a. **Headroom is netted before flooring.** With Groceries planned 300 / spent 400 and Dining planned 200 / spent 0, `flexible_headroom = 100` — **not** 200. Asserted as a property over random envelope sets, and specifically that the implementation is not `Σ max(0, remaining)`.
10b. Each envelope card still shows its **own signed** remaining (−100 and +200 in that example); the netting applies only to the plan-wide figure.
10c. `flexible.remaining` is reported **signed** and may be negative; `flexible_headroom` is floored at 0 and is the value used in the `min()`.
10d. A **reallocation** leaves `Σ planned` and therefore `safe_to_spend` unchanged; **covering from unallocated** raises both by exactly the amount moved. The overspend dialog's copy states this difference.

### 21.3 Commitments and occurrences (**blockers #2, #10**)

11. A **one-time** commitment ("€400 on 15 Oct") can be created without a recurring rule, appears in `Pending` and `Reserved`, and **does not change any account balance**.
11a. **An overdue occurrence stays outstanding.** An unpaid fine, tax bill or personal repayment remains `expected`, in `Pending` **and** `Reserved`, on the day after its due date, 30 days after, and **after one or more period boundaries**.
11b. It is counted **exactly once**: it contributes to the single open period's `Pending`, while every closed period serves its frozen `pending_at_close`.
11c. Only `settled`, `cancelled`, `skipped` or `rescheduled` removes it. **The passage of time never does.**
11d. `rescheduled` consumes the original due date and produces exactly one `expected` occurrence at the new date.
11e. **A prior-period occurrence is actually projected**, not merely un-filtered: with `p.start = 2026-09-01`, `occurrences(e, p, today)` **contains** a one-time occurrence due `2026-08-14`, flagged `carried: true`, and it is present in `occurrences_overdue` in the API payload. An implementation whose projection window starts at `p.start` **fails** this criterion.
11f. **A one-time commitment never ages out.** One unpaid for **400 days** — and for 800 — is still projected, still `expected`, still in `Reserved`. `needs_attention` is never set on a one-time commitment, and a DB `CHECK` makes that unrepresentable.
11g. **It appears exactly once in live `Reserved`**, guaranteed structurally: identity is `(commitment_id, due_date)` with set semantics; `UNIQUE (plan_id) WHERE status = 'open'` allows only one live period; closed periods serve a frozen `pending_at_close` that is a report, not a live claim.
11h. **Each resolution removes the original reservation** — `settle`, `cancel`, `skip` and `reschedule` all do, for a carried occurrence as much as a current one. `reschedule` re-adds exactly one occurrence at the new date, and **none** if the target falls outside the projection window.
11i. **A reschedule onto an existing projected date is rejected** (409), so one obligation can never become two reservations.
11j. **Recurring commitments are bounded per the safety rule:** an abandoned monthly rule with 30 unresolved occurrences projects at most **12**, keeping the most recent; occurrences older than **365 days** fall outside the window; `needs_attention` is set, review is required, and the excluded count is disclosed in the UI.
11k. `overdue` is derived (`state = 'expected' AND due_date < today`) and is **not** a stored status.
12. No `budget_occurrences` row, of any state, ever writes to `wealth_accounts.current_balance`. Asserted by a test that creates commitments and compares balances before/after.
13. When a transaction settles an occurrence, the amount appears in `Spent` and is **absent** from `Pending` in the same read — enforced by occurrence *state*, not by arithmetic.
14. Trashing a transaction that had settled an occurrence returns that occurrence to `expected` and writes an `occurrence_unsettled` event.
15. A budget GET performs **no** transaction writes and moves **no** balances; it reports `sync_required` when stale.
16. When `sync_required` is true, the client resolves it in one `POST …/sync` and the rendered figures are then correct. **No budget screen ever displays a figure known to be stale.**
17. `POST …/sync` is idempotent: calling it twice in succession produces no second materialization, no double rollover, no duplicate fund credit and no second restatement.

### 21.4 Sinking funds (**blocker #3**)

18. A **free-plan** user can create **at least three virtual sinking funds**; no Spaces quota is consulted.
19. A virtual contribution changes **no** account balance, increases `reserved`, and decreases `safe_to_spend`.
20. A **Space-backed** fund's accumulated balance is **not** counted in `reserved` (it is already outside `available_now`); only its due, untransferred contributions are. A test asserts the same €500 is never reserved twice.
21. `virtual → space_backed` conversion performs exactly one transfer for the accumulated balance and writes a `fund_mode_converted` event; the reverse works symmetrically.
22. `fundBalance` for a virtual fund equals the signed sum of its ledger entries, exactly, after an arbitrary sequence of contributions, withdrawals and adjustments.
22a. **A contribution is never labelled funded without a decision.** A `planned` contribution is reserved, writes **no** `budget_fund_entries` row, and leaves `fundBalance` unchanged; only `confirmed` may be described as funded or set aside.
22b. **Confirming is `Reserved`- and `safe_to_spend`-neutral** — the amount moves from `virtual_contributions_unconfirmed` into `virtual_fund_balances`.
22c. Closing a period with `auto_fund = false` marks unconfirmed contributions `missed` (never `funded`) and does not block the close.
22d. Closing with `auto_fund = true` marks them `confirmed` and writes exactly one entry; `auto_fund` defaults **off** and enabling it is audited.
22e. Confirming the same contribution twice credits the fund once.
22f. A `missed` contribution moves the fund's pace to `behind` and raises `suggested_monthly`; it does **not** roll over as a doubled reservation.

### 21.5 Funding base (**blocker #4**)

23. Recording an expense **never** changes `funding_base`, `funding_capacity` or `unallocated`.
24. **Income is never double-counted.** A period opened five days late, with salary received on day 2, yields a `funding_capacity` that includes that salary **exactly once** — the direct regression test for the rev-3 blocker.
24a. `reconstructed_at_boundary` bases accrete income by `date >= funding_base_anchor_date`; `snapshot_at_open` bases accrete strictly by `created_at > funding_base_as_of`. A calendar date is never compared to an instant, and vice versa.
24b. `balanceMovedSince` includes soft-deleted **system** rows (whose balance effect survives Trash) and excludes soft-deleted ordinary rows (whose effect was reversed).
24c. All seven cases in §8.4.2 behave as tabulated, including a backdated income entered after the snapshot and an income later edited or trashed.
24d. A recomputed `reconstructed_at_boundary` base that differs from its cached value writes a `funding_base_recomputed` event with the diff; an unchanged recomputation writes nothing.
24e. A `snapshot_at_open` base is never recomputed; corrections to it are ordinary audited `funding_adjusted` events.
25. In `available` mode, qualifying income received during the period increases `funding_capacity`; in `expected` mode it does not (it is reported in the income section instead).
26. A funding adjustment is an audited `budget_events` row, is visible in the period's history with its reason, and may be negative.
27. A closed period's snapshot records `funding_base`, `funding_base_source`, adjustments and capacity, so the closed period's capacity is stable forever.

### 21.6 Section separation (**blocker #5**)

28. No payload field and no UI element sums planned or spent amounts **across** sections. There is no `totals.planned` / `totals.spent` pair anywhere.
28a. The savings section reports `planned`, `reserved`, `funded`, `missed` and `outstanding` as **five distinct figures**; no single "funded" number conflates intent with confirmation.
29. `plan_status` is identically `sections.flexible.utilisation`; funding a savings envelope or paying a bill does **not** change it.
30. `total_outflow` is labelled as cash out and is never used as a denominator; `savings.funded_cash` excludes virtual credits.
31. Each section renders its own vocabulary — income *received/outstanding*, commitments *settled/outstanding*, savings *funded/balance* — never "spent of planned".

### 21.7 Refunds and settlement (**blocker #6**)

32. A category-matched inflow is reported as `refunds_provisional`, **separately** from `spent_gross`, and the envelope card discloses it — **in Phase 1**, together with `Confirm` / `Not a refund`.
33. A provisional refund can be **confirmed** or **rejected** in one tap; rejection restores gross spend and writes an audited exclusion.
34. Salary can never net against a flexible envelope (income envelopes are not flexible match targets).
35. `spent_net` may be negative and the true signed value is preserved in data and API; only the bar width is clamped.
36. The `transaction_settlements` contract (§10.11) supports **partial** settlement (many rows per expense) with `Σ amount ≤ expense.amount` enforced on write, and both **cash** and **attributed** views are defined, with cash authoritative.
37. A settlement arriving after its expense's period has closed produces a **restatement candidate**, never a silent rewrite.

### 21.8 API compatibility (**blocker #7**)

38. `GET /api/budgets` returns the **v1 shape** for an org with a v2 plan; a pre-v2 native bundle continues to function with no error.
39. `POST /api/budgets` (v1 shape) still edits the plan: it sets the catch-all flexible envelope's amount, and `amount: 0` **pauses** rather than deletes.
40. Adapter behaviour is defined and tested for every cadence (`monthly`, `weekly`, `payday`, `custom`) and every plan status (`active`, `paused`, `archived`, `lifetime`-migrated).
41. Adapter traffic is measurable via `budget_events.detail.via = 'v1_adapter'`, so the D-14 sunset decision is evidence-based.
42. No existing v1 field changes meaning; the adapter may omit detail but never reports a wrong number.

### 21.9 Restatement (**blocker #8**)

43. A closed period displays **one** operative set of figures — the current snapshot version — never a permanent snapshot-vs-live pair.
44. Editing a transaction inside a closed period creates snapshot `version = N+1` with `is_current = true`, sets the prior version `is_current = false`, and writes a `period_restated` event with the reason, actor and diff.
45. **Version 1 is never mutated or deleted**, nor is any intermediate version; the original is reachable from the UI in one tap.
46. Exactly one snapshot per period has `is_current = true`, enforced by a partial unique index; a concurrent double restatement fails rather than producing two.
47. A restatement does not retroactively alter an already-applied rollover; the correction appears as an explicit funding adjustment in the affected later period, with an event explaining it.

### 21.10 Correctness carried over from the first review

48. A downward balance adjustment (`is_system`) produces **zero** budget spend. *(#1)*
49. A debt payment consumes only its `debt` envelope. *(#3)*
50. No figure aggregates across cadences; the authored "€20/day" is still displayed. *(#4)*
51. For a plan in `Pacific/Kiritimati`, a transaction at 23:30 local on the last day of the month lands in **that** month. *(#5)*
52. Alerts fire from create, split-create, edit, recurring-materialization and settlement paths. *(#6)*
53. A personal plan's catch-all envelope emits `budget_warning` and `budget_exceeded`. *(#7)*
54. A failed audit write fails the mutation. *(#9)*
55. A closed period reports in the currency it was closed in. *(#10, historical half)*
56. Spending exactly the planned amount reports `full`. *(#15)*
57. Trashing a client hides no budget object. *(#16)*
58. The overview and the transaction-form hint derive `Safe to spend` from the same computation. *(#17)*
59. `Σ flexible envelope spend + unmatched flexible spend = flexible.spent_net`, exactly, under property tests.
60. `Reserved` counts an **unpaid** commitment once and a **settled** one zero times.

### 21.11 Behaviour, honesty, migration, performance, gates

61. No action moves money or changes an allocation without explicit confirmation, and every such change writes an audit event. *(P4)*
62. No budget state prevents recording a transaction. *(P1)*
63. One calculation path; no `mode` column, no simple/advanced toggle. *(P2)*
64. A paused plan opens no periods, writes no snapshots, credits no funds and sends no notifications; resuming asks before backfilling.
65. Every suggestion shows its basis and observations, is dismissible, and never writes to the plan; confidence is a label, never a percentage. *(P8)*
66. `limitations` is returned machine-readably and rendered: card accounts excluded with an explanation, loan principal/interest not separated, reimbursement cross-period asymmetry disclosed, pre-migration periods labelled reconstructed.
67. Zero `budgets` / `budget_history` rows are mutated or deleted during the flag window; a user with no v1 budget gets no plan; a `lifetime` budget becomes a **paused** plan with a prompt; the migration is idempotent and `--dry-run` writes nothing; archiving a v2 plan restores v1 behaviour.
68. An existing `/budgets/:key` bookmark resolves to a real screen.
69. `GET /api/budgets/v2` p95 **< 400 ms** at 100k transactions / 24 months / 40 envelopes, ≤6 queries, **no** per-envelope query, no full-table scan in `EXPLAIN`.
70. A closed-period read is one snapshot row, O(1) in transaction count.
71. The overview, dashboard card and transaction-form hint share **one** HTTP request per org per 30 s.
72. `lint`, `typecheck`, `test:ci`, `i18n:check`, `check-esm-extensions`, `boot-functions` and the route-guard sweep all pass; all 8 locales complete; axe-core zero criticals in both themes; `ar` RTL verified; the e2e `prod-build` project renders every budget page; `cap:sync:android` **and** `cap:sync:ios` run before each phase is called done; no new Vercel function; no committed test opens a DB connection.

---

## 22. Files likely to change

### 22.1 New files

| Path | Purpose |
|---|---|
| `drizzle/0059_budget_v2_tables.sql` (+ snapshot/journal) | The ten tables |
| `src/lib/budget-math.ts` · `budget-math.test.ts` | Pure engine + the core suite |
| `api/_lib/budget-engine.ts` | SQL layer |
| **`api/_lib/budget-occurrences.ts`** | Occurrence projection + settlement reconciliation |
| **`api/_lib/budget-funds.ts`** | Virtual/Space fund balances, entries, conversion |
| **`api/_lib/budget-restate.ts`** | Drift detection + versioned restatement |
| **`api/_lib/budget-v1-adapter.ts`** · `budget-v1-adapter.test.ts` | v2 → v1 projection and v1 → v2 writes (§11.1) |
| `api/_lib/notify-budget-v2.ts` | Alert evaluator |
| `api/_routes/budgets/v2/` — `index.ts` · **`sync.ts`** · `period.ts` · `period/close.ts` · `period/open.ts` · **`period/funding-adjustment.ts`** · `periods.ts` · **`periods/[id]/versions.ts`** · `envelopes.ts` · `envelopes/[id].ts` · `envelopes/[id]/transactions.ts` · `allocations/[id].ts` · `reallocate.ts` · **`commitments.ts`** · **`commitments/[id].ts`** · **`occurrences/[key]/settle.ts`** · `/skip.ts` · `/unsettle.ts` · **`funds/[id]/entries.ts`** · **`funds/[id]/convert.ts`** · **`refunds/[txId]/confirm.ts`** · `/reject.ts` · `exclusions.ts` · `exclusions/[id].ts` · `available.ts` · `suggestions.ts` · `suggestions/dismiss.ts` | ~27 handlers |
| `src/lib/budget-context.tsx` | `BudgetProvider` + `useBudget()` (incl. `sync`) |
| `src/pages/BudgetOverviewPage.tsx` · `BudgetPlanPage.tsx` · `BudgetEnvelopePage.tsx` · `BudgetPeriodPage.tsx` | Four pages |
| `src/components/budget/` — `SafeToSpendHero.tsx` · `FourNumbers.tsx` · `BindingExplainer.tsx` · `SectionCard.tsx` · `EnvelopeCard.tsx` · `EnvelopeDialog.tsx` · **`CommitmentDialog.tsx`** (recurring + one-time) · **`OccurrenceRow.tsx`** · `SavingsDialog.tsx` · **`SinkingFundDialog.tsx`** (virtual/Space toggle) · **`FundEntrySheet.tsx`** · **`RefundReviewSheet.tsx`** · `OverspendSheet.tsx` · `ReallocateSheet.tsx` · `PeriodCloseSheet.tsx` · **`FundingAdjustmentSheet.tsx`** · **`RestatementChip.tsx`** · `SuggestionCard.tsx` · `ForecastDrawer.tsx` · `SafeToSpendDrawer.tsx` · `PlanSettingsForm.tsx` | UI |
| `scripts/migrate-budgets-v2.ts` | Migration |
| `e2e/budget-v2.spec.ts` · **`e2e/budget-v1-compat.spec.ts`** | Committed e2e (D-10) + adapter compatibility |
| `docs/budget-v2/SMART_HYBRID_BUDGET_SPEC.md` | **This document** |
| `.claude/skills/budget-system/SKILL.md` | Skill, mirroring `subscription-system` |

**Phase 2 (pending D-12):** `drizzle/00NN_transaction_settlements.sql` +
`api/_routes/transactions/[id]/settlements.ts` — owned by transactions, consumed by budgets.

### 22.2 Modified files

| Path | Change |
|---|---|
| `src/lib/db/schema.ts` | Ten table definitions |
| `api/index.ts` | ~27 route registrations — **`["budgets","v2"]` must precede any dynamic sibling at that depth** |
| `api/_routes/budgets.ts` · `budgets/overview.ts` · `budgets/detail.ts` | **Rewritten as v1 adapters** over the v2 engine (§11.1) — *not* deleted |
| `src/App.tsx` | Four lazy routes + the legacy `/budgets/:key` resolver |
| `src/components/AppLayout.tsx` | Mount `BudgetProvider` |
| `src/components/MobileAppLayout.tsx` | Primary-tab promotion (D-9) |
| `src/pages/Dashboard.tsx` | Swap the `budget` card component |
| `src/components/transactions/tx-form.tsx` | Hint reads `useBudget()`; keep `budget.remainingAfter` / `budget.overAfter`; **must reflect `binding`** so the hint agrees with the headline |
| `src/components/transactions/AddTransactionDialog.tsx` | Drop the ad-hoc `/api/budgets` fetch |
| `src/components/onboarding/MoneyWizard.tsx` | Budget step writes the new plan |
| `src/lib/types.ts` | `BudgetPlan`, `BudgetEnvelope`, `BudgetPeriod`, `BudgetAllocation`, `BudgetSection`, **`BudgetCommitment`**, **`BudgetOccurrence`**, **`FundEntry`**, **`FundingMode`**, **`SafeToSpendBinding`** |
| `src/lib/i18n/locales/*.json` (×8) | ~300–400 keys each |
| `src/lib/i18n/index.ts` | Add `budget` to `PAGE_NAMESPACES` |
| `src/lib/notifications.ts` | Three new types |
| `api/_lib/budget-spend.ts` | **Phase 0** `is_system` fix; retired in Phase 4 when the adapters move onto the v2 engine |
| `api/_routes/transactions.ts` · `transactions/[id].ts` · `transactions/group.ts` · `api/_lib/recurring-materialize.ts` · `api/_routes/trash/restore.ts` · `trash/purge.ts` | Call the alert evaluator; **trigger occurrence settlement/unsettlement** |
| `docs/budget/BUDGETS.md` · `docs/budget-history/SPEC.md` | Rewritten / superseded |
| `CLAUDE.md` | Budget-v2 conventions; fix the stale "migration head 0052" → 0058 |

### 22.3 Deleted (Phase 4, and later)

Phase 4: `api/_lib/notify-budget.ts` (+ test) · `src/lib/budget.ts` (+ test) ·
`src/lib/budget-history.ts` (+ test) · `src/pages/BudgetsPage.tsx` ·
`BudgetDetailPage.tsx` · `src/components/budget/{BudgetDialog,BudgetIndicator,PersonalBudgetCard,BusinessBudgetCard}.tsx`.

**Only after D-14's sunset criteria are met:** the v1 adapter files and
`drizzle/00NN_drop_budget_v1.sql` for the two v1 tables. **The v1 API paths outlive the v1
tables** — they keep responding, served by the v2 engine.

### 22.4 Explicitly NOT modified

`transactions` · `wealth_accounts` · `recurring_rules` · `categories` · `organizations`
(**no new columns on any of them**) · `api/_routes/wealth/**` · `api/_routes/spaces/**` ·
`api/_routes/recurring/**` · `src/lib/wealth-ledger.ts` · `src/lib/spaces.ts` ·
`api/_lib/notifications.ts` · `src/landing/**` · `worker/**` · `vercel.json`.

Two exceptions, both deliberate: the functional **index** on `transactions` (D-4 — an index,
not a column), and `transaction_settlements`, which *references* `transactions` without
adding a column and is owned by that feature (D-12).

---

## 23. Recommendation on personal versus business scope

### 23.1 Recommendation

**Build Budget v2 for personal workspaces first, on a shared engine, and preserve business
client spend caps as a separate, unchanged concept.** Do not force household allocation
concepts into business workflows.

### 23.2 Why, from the product's own architecture

1. **Business income has no single figure.** Business revenue is per-client and already modelled by clients, quotations and analytics. `expected_income`, `funding_base`, `unallocated` and much of `Safe to spend` have no natural business meaning.
2. **The business budget concept is a different thing.** v1's business budgets are **per-client spend caps** — project/cost-centre control, not the household equation.
3. **The v1 business surface is already broken and barely used.** The "default template" tracks nothing (`spent: null`), is a prefill rather than an inherited default (#11), and the cross-budget aggregate is meaningless (#4). Business budgeting was never really shipped.
4. **Personal is where the four numbers pay off.** "Safe to spend" is a daily personal question; a business asks "is this client profitable?", which `/analytics` answers.
5. **`account_type` gating is an established, cheap pattern** (`BusinessOnlyRoute` / `PersonalOnlyRoute` + `accountTypeAllows`).

> **Revised note on Spaces.** The previous draft argued business orgs were *structurally*
> excluded because savings and sinking funds required Spaces, which are personal-only. That
> argument no longer holds: **virtual sinking funds (§8.9) have no Spaces dependency and
> would work on a business org.** The recommendation stands on reasons 1–4, which are about
> product meaning rather than a technical block — and it is now a *choice* that can be
> revisited cheaply, not a constraint. That is a better position to be in.

### 23.3 What each account type gets

| | Personal | Business |
|---|---|---|
| Plan, periods, four numbers, funding base | ✅ | ❌ (Phase 1–4) |
| Flexible envelopes + categories | ✅ | ❌ |
| Commitments (recurring **and one-time**) | ✅ | ❌ |
| **Virtual** sinking funds | ✅ unlimited | ❌ by choice (no longer by constraint) |
| **Space-backed** funds | ✅ (Spaces quota) | ❌ structurally (Spaces are personal-only) |
| Debt section · rollover · reallocation · period close | ✅ | ❌ |
| **Per-client spend caps** | n/a | ✅ **unchanged** |
| Alerts | envelope-based | client-cap-based, unchanged |

### 23.4 The business path

Business orgs keep the per-client cap, **repaired but not redesigned**: Phase 0 fixes #1, #6
and #7 for them immediately; the "default template" is replaced by a **real inherited
default** materialized onto a cap when a client is created (fixing #11); the mixed-cadence
aggregate is removed (#4). Surface stays `/clients` + the simpler `/budgets`, served by the
v1 adapter.

### 23.5 The shared engine

| Shared | Personal-only | Business-only |
|---|---|---|
| `budget-math.ts`: thresholds, `state()`, boundaries, normalisation | The four numbers + `binding` | Per-client cap evaluation |
| Period materialization, snapshots, **restatement** | Sections, rollover, reallocation | Client-cap inheritance |
| `spent` (signed, net, `is_system`-excluded) | Commitments, occurrences, funds | — |
| `budget_events` audit · alert evaluation + dedupe | Debt, funding base | — |

A business cap is representable as a plan with one `flexible` envelope scoped to a client,
so business envelope budgeting later is additive, not a rewrite.

### 23.6 When to revisit

Re-evaluate when **any** holds: ≥3 business customers explicitly ask for allocation-style
budgeting; virtual funds prove popular enough that business users ask for them (now
technically trivial); `account_type='family'` merges; or per-client caps prove insufficient
in support volume.

---

## Change log

- **2026-09-02** — Initial specification. Design pass only. Verified all 15 reported defects against `dev` @ `5e57fd36` and found three more (#16 trashed-client budgets, #17 divergent derivation, #18 `is_system` in analytics). Established reuse of Spaces for savings and `recurring_rules` for commitments. Confirmed pending transactions, credit cards and multicurrency **do not exist** in the repository and specified them as dependencies. 7 tables, 11 open decisions.
- **2026-09-02 (rev 2)** — **Financial-model review.** Ten blockers resolved. `Safe to spend` redefined as the bounded intersection of cash and flexible headroom, with an explicit `binding` reason and explicit handling of plans with no ceiling (§8.5). **One-time commitments** added via `budget_commitments` + a projected-occurrence model that never touches a bank balance (§8.6, §10.5–10.6). **Virtual sinking funds** added so free users get unlimited funds; the virtual-balance-is-reserved / Space-balance-is-not asymmetry specified (§8.9, §10.7). A stable stored **period funding base** replaces the drifting available-mode formula (§8.4, §10.3). Section totals separated and plan utilisation restricted to the flexible section (§8.7). Refund netting reframed as **provisional and disclosed**, with a `transaction_settlements` contract for full/partial cross-period settlement (§8.8, §10.11). `GET /api/budgets` **no longer changes shape** — v1 is preserved indefinitely via adapters and v2 lives at `/api/budgets/v2`, protecting store-pinned native clients (§11.1). Permanent snapshot-vs-live divergence replaced by **audited, versioned restatement** (§8.11, §10.8). Onboarding criterion changed to four decisions plus a measured median-under-60 s target (§21.1). **D-3 reversed**: budget reads stay pure but detect staleness and self-heal through an idempotent `POST /api/budgets/v2/sync` (§8.10). **10 tables (+1 Phase-2 dependency), 15 open decisions.**
- **2026-09-02 (rev 3)** — **Correctness review.** Four blockers resolved, all within the existing tables. **(1)** Plan-wide `flexible_headroom` is now `max(0, Σ planned − Σ spent_net − Σ pending)` — netted across envelopes **then** floored once, so an overspend in one envelope consumes another's surplus (the review's 300/400 + 200/0 case yields 100, not 200); envelope cards keep their own **signed** remaining, and §8.5.2 states that reallocation moves room without creating capacity while covering from unallocated does create it (§8.5.1–8.5.2). **(2)** **Overdue** is a derived presentation condition over `expected`, not a state: an unpaid occurrence stays in `Pending` and `Reserved` until explicitly settled, cancelled, skipped or **rescheduled** (a new stored state), carries across period boundaries exactly once, and is bounded by `overdueFloor` / `MAX_OVERDUE_PER_COMMITMENT` with a `needs_attention` flag rather than silent forgetting (§8.6.1). *(Both constants were **superseded in rev 4** — the bound is now kind-dependent and one-time commitments are unbounded.)* **(3)** The funding base is **reconstructed at the true period boundary** (`balanceMovedSince`, including soft-deleted *system* rows and excluding soft-deleted ordinary ones) with a typed accretion boundary — `funding_base_anchor_date` compared to `transactions.date`, `funding_base_as_of` compared to `created_at` — so income already inside `Available now` can never be counted twice; all seven required cases are tabulated (§8.4, §8.4.2). **(4)** Virtual contributions have **four states** — `planned` (reserved automatically) · `confirmed` (the only state that may be called funded, and the only one that writes a fund entry) · `missed` · `skipped` — with an opt-in `auto_fund`, and confirmation is deliberately `Reserved`-neutral (§8.9.1). Also reconciled the D-5/§19 phase inconsistency: **provisional refund handling, including confirm/reject, is Phase 1**; only `transaction_settlements` is Phase 2. **Still 10 tables; 18 open decisions (D-16, D-17, D-18 new).**
- **2026-09-02 (rev 4)** — **Projection-range correction.** Fixed a real internal inconsistency: §8.6 claimed overdue occurrences from earlier periods stay reserved, but `projectOccurrences(c, p.start, …)` never *generated* them, and no downstream `due_date >= overdueFloor` filter can recover a row that was never projected. **The window itself now reaches back**, via a per-commitment `carryLowerBound` (§8.6): a `one_time` commitment's bound is its own `due_date` — **always in range, never ageing out** — while a `recurring` commitment's is `max(first_due_date, today − 365d)` with at most 12 unresolved occurrences. **D-17 revised accordingly:** the 365-day / 12-occurrence protection is **recurring-only**, because a one-time obligation projects exactly one occurrence (O(1), no explosion risk) and an unpaid fine, tax bill, university fee or personal repayment is a real debt that does not expire; on reaching the cap a recurring commitment sets `needs_attention`, requires review, and **discloses the excluded count**. "Counted exactly once" is now **structural**: identity on `(commitment_id, due_date)`, a new **`UNIQUE (plan_id) WHERE status = 'open'`** index so only one period is ever live, and a write-time guard rejecting a reschedule onto an existing projected date. Added `budget_commitments.first_due_date` (denormalised so the projection never joins `recurring_rules`) and `CHECK (needs_attention = false OR kind = 'recurring')`. Seven new acceptance criteria (11e–11k) and six new test groups, including the explicit regression test that a prior-period occurrence is *projected*, not merely un-filtered. **Still 10 tables; 18 open decisions.**
