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

## 2b. The recurring repayment

A debt can be serviced by a **recurring rule** (`recurring_rules.kind = 'debt'`,
`debt_account_id` = the debt). It is created in the SAME atomic batch as the debt
itself (`dbBatch` — neon-http has no interactive transactions, so every id is
generated up front): a debt whose repayment silently failed to be created is
money that silently never moves.

It is neither an ordinary recurring expense nor a Space auto-save, and
`api/_lib/recurring-debt.ts` exists because of three differences:

- **It splits.** Part of an instalment repays principal (a transfer, never
  spending); the rest is interest and fees (real expenses on the paying
  account). Posted as a plain transfer, a €1,200 mortgage payment would pay down
  €1,200 of a loan that only fell by €800, and the €400 of interest would never
  appear as money spent.
- **The split is recomputed from the LIVE balance every occurrence**, so it
  tracks a real amortization on its own: interest shrinks and principal grows
  month after month with nothing stored.
- **The last instalment is capped at the payoff figure**
  (`payoffCappedAmount`). A rule paying €500 against €120 owed must move €120
  plus that period's interest — uncapped, the balance crosses zero into credit
  and every screen reports "nothing owed" while the extra money is simply gone
  from view.

Idempotency is unchanged from every other recurring money path: the first leg
carries `(recurring_rule_id, recurring_due_date)` and is inserted with `ON
CONFLICT DO NOTHING`; nothing else is written unless that insert returned a row.

**The rule is the single source of truth for the schedule.** `payment_amount`,
`payment_frequency` and `next_due_date` on `debt_details` are a MIRROR of it
(`debtScheduleMirror`), refreshed whenever the rule moves — materialization,
create, edit, pause. The planner, the payoff estimate, the month's obligations
and the amortization table all read the debt's own fields, so without the mirror
the plan would describe a schedule nobody is paying.

Lifecycle, both directions:

| Event | What happens to the rule |
|---|---|
| Debt paused / written off / marked repaid / refinanced | Deactivated |
| Debt resumed | Reactivated, cursor re-anchored to **today** — a payment holiday must not fire six back-dated instalments |
| Debt closed (archived) | Deactivated |
| Debt hard-deleted | Cascades away (`ON DELETE cascade`, unlike `wealth_account_id`) |
| Balance reaches zero | Rule retires itself and notifies (`debt_repaid`) |
| Paying account archived / quota hit | Rule pauses with `last_error`, cursor NOT advanced, so it resumes when fixed |

A **hand-recorded payment while a rule is live is an EXTRA one**: it does not
advance the due date, because doing so would silently cancel the next instalment
the user is still expecting to be taken (`advancesScheduleByDefault`). Without a
rule, the payment the user records IS the scheduled one and the date moves. The
sheet exposes the choice either way.

A recurring repayment must come from a **bank or cash** account. A credit card
may pay a loan by hand — a real, expensive thing people do — but on a schedule it
moves debt from one place to another forever with no cash ever leaving, and the
balance that grows is the one nobody is looking at.

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

- `GET /api/debts` — hub payload: debts, receivables, closed, summary, insights, 3-month upcoming schedule. Materialises due repayments first (hence `ALWAYS_FETCH`).
- `POST /api/debts` — create the debt AND its optional `repayment` rule in one atomic batch; `disbursement_account_id` records borrowed money as a transfer.
- `GET/PATCH/DELETE /api/debts/:id` — detail (`debt`, `activity`, `payments`, `schedule`, `repayment`); edit terms / lifecycle / the repayment / reconcile (`current_balance` → system Balance Adjustment); close (archive) or delete when there is no history.
- `GET/POST /api/debts/:id/payments`, `DELETE /api/debts/:id/payments/:paymentId`.
- A debt repayment also appears at `/api/recurring` and `/api/recurring/:id`, which keep the debt's mirror in step on every edit.

## 5. UI

`/debts` (hub: Overview · Your debts · Plan · Upcoming) and `/debts/:id`.

The **add sheet is four fields** — who it is with, what kind (free text, with
suggestions), what it started at, what is left — then the one question that
decides everything else: is a repayment being made on a schedule? Saying yes
builds the recurring rule in the same screen. Everything a loan document has and
a person rarely remembers (rate, formal name, notes, whether the money is
arriving now) sits behind one closed disclosure. It is not a second MODE: the
form never rearranges itself, it only gets longer if you ask it to.

The **detail screen shows ACTIVITY, not just repayments** — the opening balance,
the money as it was borrowed, each repayment with its interest and fees, and
every reconciliation, one row per ledger group. A screen that lists only the
repayments cannot explain the balance it is displaying.

Record payment sheet (auto or typed split, one-tap "scheduled" / "pay it off"
amounts, an overpayment warning, and the extra-vs-scheduled choice), status
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
interest is not separated). More than one repayment rule per debt is possible in
the schema (`drivingRule` picks the active one) but no UI creates a second.

## 8. Screenshots

Captured on the local database with seeded demo debts (`docs/debts/screenshots/`):
hub overview / debts / plan / upcoming (desktop + mobile), add-debt sheet,
record-payment sheet, the mortgage detail screen (desktop + mobile) and the
Wealth page with the "Owed" line that links to the hub.
