# Debt & Loans

> Know what you owe. Know what comes next. See your way out.
> Design notes for the Debt & Loans system: how a debt lives in the ledger, what
> the engine derives, what the planner does, and what was deliberately deferred.

## 1. A debt IS a wealth account

`wealth_accounts.type` gains two values: **`loan`** (I owe) and **`receivable`**
(owed to me). The balance follows the app-wide signed asset-equivalent
convention introduced for credit cards (`src/lib/credit-card.ts`): a loan's
balance is negative when money is owed, a receivable's is positive. Everything
that already works for every account therefore works for debts with no special
cases:

| Event | Ledger rows | Bank | Debt balance | Expense | Income | Net worth |
|---|---|---|---|---|---|---|
| Borrow €5,000 into the bank | transfer debt → bank | +5,000 | −5,000 | 0 | **0** | 0 |
| Already owe €700 (onboarding) | system Opening Balance on the debt | — | −700 | 0 | 0 | −700 |
| Pay €500 = €420 principal + €70 interest + €10 fees | transfer bank → debt (420) + expense 70 + expense 10 | −500 | +420 | **80** | 0 | −80 |
| Lend €400 to Luca (receivable) | transfer bank → receivable | −400 | +400 | 0 | 0 | 0 |
| Luca repays €100 | transfer receivable → bank | +100 | −100 | 0 | 0 | 0 |
| Interest received on a receivable | standard incoming on the bank | + | — | 0 | + | + |

Principal is never an expense; borrowed money is never income; only interest and
fees are spending. Trash / restore / edit reuse `wealth-ledger.ts` verbatim;
`api/_routes/trash/restore.ts` restores the whole group, so a payment's bank
movement, principal and expenses come back together. Factory reset and org
deletion cascade through `wealth_accounts` into the two debt tables.

Debt accounts are excluded from `GET /api/wealth/accounts` (like Spaces) so they
never appear as spendable sources; `/wealth` fetches `/api/debts` to add loans to
liabilities and receivables to assets in net worth. Posting a plain transaction
on a debt account is rejected with a pointer to the debt's page.

## 2. Terms vs derived facts

`debt_details` (1:1 with the account) stores only what the user told us: kind,
counterparty, **native currency**, original amount, annual rate (nullable =
unknown / interest-free), rate type, scheduled payment + frequency
(`weekly | biweekly | monthly | quarterly | yearly | irregular`), next due date,
start / maturity, remaining instalments, `balance_is_estimate`, notes, and the
**lifecycle** the user set (`active | paused | paid_off | refinanced |
written_off`, plus `refinanced_into_account_id` so history survives).

Everything else is derived, never stored (`src/lib/debt-status.ts`):
status (`overdue` / `due_soon` / `paid_off`-by-balance), progress, this month's
required / paid / remaining / overdue, the next payment, the upcoming schedule,
the estimated debt-free date (`unknown` with a reason when it cannot be
estimated — never invented), plain-language insights, and per-currency totals
(no FX is ever applied; mixed currencies are shown side by side).

`debt_payments` is the allocation of one recorded repayment (total / principal /
interest / fees / other + `split_source ∈ entered | calculated | principal_only`),
anchored on the group's first ledger leg: live while that leg is not trashed
(derived), cascaded away on purge.

## 3. Engine (`src/lib/debt-math.ts`, `debt-planner.ts`)

Integer cents throughout; interest rounded once per period; the final payment
absorbs the level-payment rounding residue so a loan ends at exactly 0. Every
schedule is capped at 600 periods, and a payment that does not cover the interest
reports `converges: false` instead of a date.

Payment split: explicit split as typed → `entered`; else with a rate, one
period's interest off the top → `calculated`; else all principal →
`principal_only` (an informal debt never grows a fake interest line).

Planner strategies (documented in the module header): **minimum** (baseline, no
rollover), **avalanche** (highest rate), **snowball** (smallest balance),
**cashflow** (largest scheduled payment relative to balance = most monthly cash
freed per euro of extra), **custom** (user order). Month-by-month simulation with
the rollover engine: a cleared debt's minimum joins the pool from the next month.
Unknown rates simulate at 0 % and are flagged. `affordability()` switches the UI to
**stabilisation** (gap, what is due next) when the budget cannot cover the
scheduled payments; `debtPaymentRatio()` gives the debt-payment ratio from the
last three months' income.

## 4. API

- `GET /api/debts` — hub payload: debts, receivables, closed, summary, insights, 3-month upcoming schedule.
- `POST /api/debts` — create (quick or detailed fields; `disbursement_account_id` records the borrowed money as a transfer).
- `GET/PATCH/DELETE /api/debts/:id` — detail + payments + schedule; edit terms / lifecycle / reconcile (`current_balance` → system Balance Adjustment); close (archive) or delete when there is no history.
- `GET/POST /api/debts/:id/payments`, `DELETE /api/debts/:id/payments/:paymentId`.

## 5. UI

`/debts` (hub: Overview · Your debts · Plan · Upcoming) and `/debts/:id`.
Quick/Detailed add sheet, Record payment sheet (auto or typed split), status
badges in words, progress, schedule table, payment history with delete, planner
with strategy cards, what-if (extra per month, lump sum), comparison table,
payoff chart, custom order, stabilisation mode, debt-payment ratio; empty and
debt-free states.

## 6. Verification

Unit (DB-free): `debt-math.test.ts`, `debt-planner.test.ts`, `debt-status.test.ts`,
`debt-ledger.test.ts`. End to end on the local database: `e2e/debts.spec.ts`
(informal debt, borrowing ≠ income, split payment, auto split, delete + restore,
hub tabs, receivable, net worth, paid off).

## 7. Deferred

Refinancing comparison UI (the data model supports it: `refinanced_into_account_id`);
integration with `/calendar` and planned transactions; milestones beyond progress
%; variable-rate modelling; per-debt FX conversion for totals (none is invented);
AI voice recording of loan payments with a split (a transfer to the loan works,
interest is not separated); translations for the new `debts` keys (English
placeholders per repo convention).

## 8. Screenshots

Captured on the local database with seeded demo debts (`docs/debts/screenshots/`):
hub overview / debts / plan / upcoming (desktop + mobile), add-debt sheet,
record-payment sheet, the mortgage detail screen (desktop + mobile) and the
Wealth page with the "Owed" line that links to the hub.
