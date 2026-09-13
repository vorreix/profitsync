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
| Borrow €10,000, €6,000 of it into the bank | transfer debt → bank (6,000) + system Opening Balance (4,000) | +6,000 | −10,000 | 0 | **0** | −4,000 |
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
on a debt account is rejected with a pointer to the debt's page, and so is a
plain TRANSFER (`createTransfer`) — money reaching a loan has to go through the
debt engine, which splits principal from interest. Global search returns debts as
their own group (matched on the counterparty too, because people search for
"Marco"), never as bank accounts: `/wealth/:id` has no way to explain a loan.

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

## 2a. Money that lands, and money that never did

Creating a debt asks whether any of it arrived in a real account, and **how
much**. Partial is the normal case, not an edge case: you borrow 10,000 for a
car, 6,000 reaches your account and the dealer is paid the rest directly. You
owe 10,000 either way.

So the amount received is a TRANSFER (bank +6,000, debt −6,000) and the
remainder is a system Opening Balance on the debt (−4,000). The two always sum
to what is owed, `wealth_accounts.opening_balance` holds only the part with no
ledger movement behind it, and nothing is ever counted as income. Answering "no"
is the same thing with a received amount of zero — the whole balance becomes the
opening row, which is exactly the pre-existing behaviour.

This is also why a loan no longer reads as an account that is permanently short:
the money it produced is visible in the account it actually landed in.

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

**A conflict is diagnosed, not trusted.** The claim is an inserted ledger row,
so a run that died between claiming an occurrence and committing it would take
that (rule, date) pair forever and the instalment could never post again. So on
a conflict:

| What is there | What it means | What happens |
|---|---|---|
| A `debt_payments` allocation | the occurrence really posted | step over it; the balance read next already includes it |
| No allocation, claim newer than `STALE_CLAIM_MS` | another run is mid-batch | **stop and keep the cursor** — sizing the next instalment against a balance that is about to change is how two runs pay 1,000 against a 600 debt |
| No allocation, older | wreckage | delete it and take over |

A batch that fails also takes its own claim back out, so the stale path is the
backstop rather than the normal repair.

The **anchor is always the leg on the counter account** — the one whose cash
actually moved, in the direction the user experienced. Everything that
summarises "what this rule did" reads the anchor, and anchoring a receivable on
the debt side made €500 arriving in the bank report as €6 of interest.

The instalment's interest follows the rule's **real** rhythm, not the debt's
mirrored name. `payment_frequency` can only name five rhythms, so a rule running
every 10 days mirrors as `irregular` — and every interest calculation would fall
back to a whole month, booking roughly two thirds of each instalment's principal
as spending. `periodsPerYearForRule` answers for any (unit, interval), and the
materializer passes it into the split and the payoff cap.

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
| Debt resumed | Reactivated, cursor re-anchored to **today** — a payment holiday must not fire six back-dated instalments. Enforced on all three doors: the debt's lifecycle, its repayment block, and the rule's own pause/resume on `/recurring` |
| Debt closed (archived) | Deactivated |
| Debt hard-deleted | Cascades away (`ON DELETE cascade`, unlike `wealth_account_id`) |
| Balance reaches zero | Rule retires itself and notifies (`debt_repaid`) |
| Paying account archived / quota hit | Rule pauses with `last_error`, cursor NOT advanced, so it resumes when fixed |

A **hand-recorded payment while a rule is live is an EXTRA one**: it does not
advance the due date, because doing so would silently cancel the next instalment
the user is still expecting to be taken (`advancesScheduleByDefault`). Without a
rule, the payment the user records IS the scheduled one and the date moves. The
sheet exposes the choice either way.

A debt repayment posts as ONE ledger group mixing a transfer with expenses,
which is not a split. The transactions list shows only its expense legs, so it
arrives at the edit dialog looking like a lone grouped row; editing it there
would delete the group and rebuild it as plain allocations. Both the list and
`PATCH /api/transactions/:id` refuse, and point at the debt.

### Adopting a repayment you already have

The standing order is almost always older than the debt. "Car loan €300" runs as
a plain expense for eight months, the loan gets added, and the same money is in
the app twice. Either screen can join them — the debt adopting a rule, or the
rule being pointed at a debt — and both go through the ONE operation,
`linkRuleToDebt`, so there is one set of rules.

**Forward only, and that is the whole design.** The eight occurrences already
posted were expenses; they stay expenses. Rebuilding them would move balances,
rewrite budget periods already reported on, and invent an interest split nobody
recorded at the time. A debt whose balance does not reflect them is RECONCILED
instead, which is one visible row. The route materialises BEFORE the change in
both directions, so an occurrence already due lands in the shape it was owed in
rather than being stepped over.

A rule is refused when it cannot honestly become a repayment:

| Refusal | Why |
|---|---|
| `direction_mismatch` | Never auto-flipped. Silently flipping an incoming €3,000 salary rule dropped on a loan would start taking €3,000 a month OUT of the account. |
| `rule_pays_with_card` | A card would move the debt, not clear it. |
| `account_not_cash` / `rule_has_no_account` / `account_archived` | A repayment needs somewhere real to be paid from. |
| `rule_is_autosave` | A Space auto-save belongs to the Space. |
| `rule_linked_elsewhere` | Moving it would leave the other debt with a schedule describing a rule that had walked away. |
| `rule_ended` | Past its end date: it would never pay anything. |
| `rule_has_pending` | Instalments are waiting to post; the link moves the cursor past them and they would be recorded in neither shape. |
| `repayment_exists` | ONE repayment per debt — see below. |
| `debt_closed` | |

**One repayment per debt, active or paused**, enforced by a partial unique index
(mig 0068) as well as in code, because the application check was read-then-write
and two links arriving together both saw an empty debt. Counting only the ACTIVE
ones was the subtler bug: a debt quietly took a second rule while the first was
paused, and resuming paid it twice a month.

Linking and unlinking both re-anchor the cursor with `GREATEST(next_due_at,
today)`. Unlinking has to as well: the resume re-anchor only fires for a debt
repayment, so a paused rule handed back with a cursor frozen six months ago
would fire the whole holiday the moment it was resumed.

A PAUSED rule's cursor is NOT mirrored onto the debt. It has a cursor but no
next payment, and `derivedStatus` reads that date — an active debt whose rule
was merely paused started reporting itself overdue. The amount and the rhythm
still describe the intent.

A recurring repayment must come from a **bank or cash** account. A credit card
may pay a loan by hand — a real, expensive thing people do — but on a schedule it
moves debt from one place to another forever with no cash ever leaving, and the
balance that grows is the one nobody is looking at.

### Making the other half from here

Adoption assumes both halves exist. Usually only one does, and the answer to
"which debt does this pay?" is "one I have not entered yet" — so both screens
can make the missing half without leaving, and each is a SINGLE request,
because half of it landing is the failure worth designing against: a debt
nobody pays, or a repayment against nothing.

| From | Request | What the one batch writes |
|---|---|---|
| Add debt, with a repayment | `POST /api/debts { repayment }` | account + `debt_details` + opening balance + the new rule |
| Add debt, adopting a rule | `POST /api/debts { link_rule_id }` | the same, and the `recurring_rules` UPDATE that adopts it |
| Add recurring, existing debt | `POST /api/recurring { debt_account_id }` | the rule and the debt's mirrored schedule |
| Add recurring, new debt | `POST /api/debts` (as above) | the recurring dialog posts to the DEBT route, because the debt route owns the write |

`link_rule_id` and `repayment` are refused TOGETHER (`link_or_create`): they are
two answers to one question, and honouring both would make two repayments for a
debt that may have none.

The rule is validated by `refusalForNew` — `linkRefusal` against a synthetic
debt that does not exist yet — so adopting into a brand-new debt obeys exactly
the table above. The dialog runs the same predicate client-side and only offers
"Create a new one…" while it passes, which is why picking a card or leaving the
account empty removes the option and says which one it is rather than claiming
no debt fits.

The direction is DERIVED, never asked twice: money going out makes a debt you
owe, money coming in makes one owed to you. There is no second control to
disagree with the first.

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
- `POST /api/debts` — create the debt AND its repayment in one atomic batch: a NEW rule via `repayment`, or one you already have via `link_rule_id` (the two are mutually exclusive — `link_or_create`). `disbursement_account_id` records borrowed money as a transfer.
- `GET/PATCH/DELETE /api/debts/:id` — detail (`debt`, `activity`, `payments`, `schedule`, `repayment`); edit terms / lifecycle / the repayment / reconcile (`current_balance` → system Balance Adjustment); close (archive) or delete when there is no history.
- `GET/POST /api/debts/:id/payments`, `DELETE /api/debts/:id/payments/:paymentId`.
- A debt repayment also appears at `/api/recurring` and `/api/recurring/:id`, which keep the debt's mirror in step on every edit. `PATCH /api/recurring/:id { debt_account_id }` links or unlinks it; that field must arrive ON ITS OWN, because combined with other edits the link could not be atomic.
- `POST /api/recurring { debt_account_id }` creates a rule already linked — the rule and the debt's mirrored schedule in one batch. Making a rule and then linking it would leave a plain expense behind whenever the second request failed.

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

A **live preview** sits above the optional details and answers the question the
form cannot: what will this actually do? It is recomputed from what has been
typed on every keystroke (`src/lib/debt-preview.ts`, pure and unit-tested) and
reports the payoff date, the number of instalments, the interest and the total —
or refuses to invent a date and says what the instalment would have to be, when
the amount entered does not even cover the interest. It says out loud that it is
an estimate and that nothing is saved yet, because a card full of confident
figures on an unsubmitted form otherwise reads like a record of something that
happened.

The direction chooser uses the **same colour language as the add-transaction
form**: money leaving is red, money arriving is green. A debt you owe is the red
one, and the colour should say so before the label is read.

The **recurring dialog mirrors all of it.** `/recurring` asks the same
question — "does this pay a debt?", or "is someone paying you back?" when the
money comes in — and answers it with the same three options: no, one you have,
or a new one made right there. It uses the same direction chips, the same
preview card, and hides category and client when a debt is involved because a
repayment's are the engine's. Its account label follows the direction too:
money arriving COMES INTO an account, it is not paid with one. When nothing
fits, the picker offers to make the debt rather than ending in a sentence.

Record payment sheet (auto or typed split, one-tap "scheduled" / "pay it off"
amounts, an overpayment warning, and the extra-vs-scheduled choice), status
badges in words, progress, schedule table, payment history with delete, planner
with strategy cards, what-if (extra per month, lump sum), comparison table,
payoff chart, custom order, stabilisation mode, debt-payment ratio; empty and
debt-free states.

## 6. Verification

Unit (DB-free): `debt-math.test.ts`, `debt-planner.test.ts`, `debt-status.test.ts`,
`debt-ledger.test.ts`, `debt-recurring.test.ts` (the refusal table and the
cursor), `debt-preview.test.ts` and `recurring-preview.test.ts` (the two live
previews). End to end on the local database: `e2e/debts.spec.ts`
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
