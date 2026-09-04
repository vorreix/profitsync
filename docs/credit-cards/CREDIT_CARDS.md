# Credit-card accounts

> How ProfitSync models a credit card as a **liability**, why the design is the
> smallest coherent extension of the existing ledger, and the invariants every
> future change must keep. Companion to `src/lib/credit-card.ts` (the math) and
> `api/_lib/credit-card.ts` (the engine).

## 1. What was there before

- **Accounts** (`wealth_accounts`): `type ∈ bank | cash | space`, a **stored**
  `current_balance` that every money path mutates with a relative SQL delta
  (`balance = balance + Δ`). The single source of truth for the sign of that
  delta is `src/lib/wealth-ledger.ts`: `balanceDelta(type, amount)` is
  `+amount` for `incoming`, `−amount` for `outgoing`, and the same helper is
  used on create, edit (reverse old / apply new), trash (`reversalsByAccount`),
  restore (`applicationsByAccount`) and purge (no change — reversed at trash).
- **Transactions**: `type ∈ incoming | outgoing`, amounts always positive,
  `kind ∈ standard | transfer`. A transfer is two legs sharing a `group_id`.
  `is_system` marks *Opening Balance* / *Balance Adjustment* rows, which
  **define** a balance and are never reversed through Trash.
- **Reporting** (analytics, money flow, calendar, the transactions summary,
  budgets v1/v2): expense = standard outgoing, income = standard incoming,
  transfers and system rows excluded — each route inlined its own SQL.

That ledger already does the right thing for a liability **if** the sign is
respected. Nothing needed to be replaced.

## 2. The architecture chosen

### 2.1 One sign convention — the whole design in one sentence

`current_balance` stays the **signed, asset-equivalent value for every account
type**. A credit card is a liability, so its balance is normally **negative**:
`−950` means "€950 owed". Consequences, with no special cases anywhere in the
ledger:

| Event | Ledger rows | Card balance | Bank balance | Expense | Income | Net worth |
|---|---|---|---|---|---|---|
| Buy €100 groceries with Visa | outgoing €100 on Visa | −100 | — | +100 | — | −100 |
| Pay €100 Intesa → Visa | transfer legs (out on Intesa, in on Visa) | +100 | −100 | 0 | 0 | 0 |
| Refund €100 to Visa | **refund** (incoming, `kind='refund'`) | +100 | — | −100 | 0 | +100 |
| €10 annual fee | outgoing €10 on Visa | −10 | — | +10 | — | −10 |
| Overpay €150 on €100 debt | transfer | +50 (card credit) | −150 | 0 | 0 | 0 |

Only **presentation** reads the sign, through `src/lib/credit-card.ts`:
`cardDebt()`, `cardCredit()`, `availableCredit()`, `creditUsage()`,
`signedBalanceFromDebt()`. UI code never writes a minus sign for a card.

### 2.2 Refunds are a first-class `kind`

`transactions.kind` gains `refund`: an **incoming** row that gives money back for
an earlier expense. Balance effect: identical to any incoming (the ledger is
kind-agnostic). Reporting: **nets against expense, never income** — the rule
lives once in JS (`src/lib/tx-classify.ts`) and once in SQL
(`api/_lib/tx-sql.ts`: `incomeSumSql`, `expenseSumSql`, `pnlKindFilter`), and
every aggregate route now imports the SQL twins instead of inlining
`case when type = 'incoming'`. `tx-sql.test.ts` asserts that no route inlines
the old expression again. Budget v1 sums `budgetSpendSignedAmount` (refund =
−amount); Budget v2 counts a `refund` row as a **confirmed** refund in the
envelope whose category it carries (a stated fact, like a settlement — §8.8.1).

### 2.3 Statements: a snapshot table, derived payments

`credit_card_statements` holds one row per **closed** cycle: `closing_date`,
`due_date`, `statement_balance` (the amount owed at the end of the closing
date), `source ∈ computed | manual`. Rows are filed lazily by
`ensureStatements()` when the card is read after a closing date has passed
(idempotent on the unique `(wealth_account_id, closing_date)`), or entered by
the user when onboarding a card with a known latest statement.

**Payments are never stored.** What is paid / still owed on a statement is
derived: `remaining = clamp(statement_balance − Σ incoming transfer legs dated
after closing_date, 0, statement_balance)`. This is FIFO without an allocation
table: a later statement already includes older unpaid debt, so one payment
reduces every statement it is dated after and the oldest reaches zero first.
Trash / restore / edit of a payment recomputes deterministically. Post-close
refunds and credits are **not** payments — like a real issuer they post to the
current cycle. The **new-cycle spending** figure is a separate, gross,
historical sum of purchases; paying the card never "un-spends" them.

Why a table and not a mutable `statement_balance` column: statements are
immutable history (the brief's §9); why not a full allocation ledger: it would
be derived state that can drift, and the ledger already answers the question.

### 2.4 Statement balance at close

`debtAtClose = −(current_balance − movementAfterClose)`, where
`movementAfterClose` uses the same "effect currently applied" rule Budget v2
uses (`deleted_at is null OR is_system`). Anchoring on the authoritative stored
balance keeps statements consistent with what the card shows even where the
ledger and the stored balance legitimately differ (a trashed system row).

### 2.5 Dates

Fixed day-of-month settings (1..31), clamped at use: closing day 31 → Feb 28/29,
Apr 30; the due date is the first matching day **strictly after** the close.
All in UTC ISO strings like `src/lib/recurring.ts`. Covered by
`credit-card.test.ts` (28/29/30/31, leap years incl. 2000/2100, year boundary).

## 3. Data model

- `wealth_accounts`: `type='credit_card'`; new nullable `credit_limit`,
  `statement_closing_day`, `payment_due_day` (CHECK 1..31). Existing rows keep
  NULLs and are never reinterpreted.
- `credit_card_statements` (new, cascades with the account → org → factory
  reset leaves nothing behind).
- `transactions.kind` accepts `refund` (text column, no DDL).
- Migration `drizzle/0062_credit_card_accounts.sql` (hand-written like
  0060/0061 — `drizzle-kit generate` is out of sync with those two).

## 4. API

- `POST /api/wealth/accounts` `{ type: "credit_card", bank_name, nickname?,
  credit_limit, current_debt, statement_closing_day, payment_due_day,
  statement?: { balance, closing_date, due_date? } }` → opening debt becomes a
  negative opening balance + an outgoing *Opening Balance* system row; a known
  statement seeds a `manual` statement.
- `PATCH /api/wealth/accounts/:id` accepts `current_debt` (converted to the
  signed balance server-side), `credit_limit`, `statement_closing_day`,
  `payment_due_day`.
- `GET /api/wealth/accounts/:id/card` → `{ account, usage, statement, history,
  cycle }` (see `CreditCardSummary` in `src/lib/types.ts`).
- Paying the card = `POST /api/wealth/transfer` with the card as
  `to_account_id` (legs are labelled "Card payment to/from …").
- `POST /api/transactions`, `/group`, `PATCH /:id` accept `kind: "refund"`
  (must be incoming); a transfer leg refuses kind/type/account edits.
- Quota: `creditCards` plan limit (free 1 active, paid 20 incl. closed),
  reported by `GET /api/wealth/quota` as `credit_cards`.

## 5. UI

- `/wealth`: **Add Card** (issuer with logo autocomplete, name, limit, amount
  owed, closing/due day, optional latest statement or "I don't know"); card
  tiles show *€950 owed* + *€1,050 available of €2,000*; net worth shows
  *Assets · Owed on cards* when a card exists.
- `/wealth/:id` for a card: `CreditCardPanel` (amount owed / card credit,
  utilisation bar with `aria-valuetext`, STATEMENT with textual status
  Paid / Partially paid / Not paid yet / Overdue, NEW CYCLE, past statements),
  **Pay card** (`PayCardSheet`: pay from, statement remaining / everything owed /
  other amount → a transfer), Add purchase / Add refund / Add fee.
- Transaction forms: Income / Expense / **Refund** selector (refund = incoming,
  expense categories). `TxKindBadge` labels refunds, transfers and card
  payments in lists and detail views.
- Dashboard: *Total available* is liquid money only; *Owed on cards* shown
  separately; a card's negative balance is never flagged as "overdrawn".
- AI: `kind ∈ standard | refund | transfer`, `to_account_name`,
  `statement_payment`. "Paid 500 towards Visa from Intesa" → a transfer; "paid
  my Visa statement" fills the amount from the latest statement **flagged for
  review** (`amount_source: "statement"`); quick-fill refuses to fill a transfer
  into the expense form and points to Pay card / Transfer.

## 6. Invariants (tests)

`src/lib/credit-card.test.ts`, `credit-card-ledger.test.ts`, `tx-classify.test.ts`,
`api/_lib/tx-sql.test.ts`, `budget-spend.test.ts`, `budget-engine-refund.test.ts`:

1. Purchase = expense + increased debt; payment = transfer, never an expense.
2. Available credit is not an asset; card debt reduces net worth; a payment
   leaves net worth unchanged.
3. Statement balance ≠ current balance; new purchases never mutate a filed
   statement; partial / multiple / excess payments allocate FIFO; overpayment
   shows card credit.
4. Refunds reverse spending (expense −, income 0); fees are real expenses.
5. Delete / restore / edit reverse or re-apply exactly the original effect once.
6. Budgets count purchases once and payments zero (v1 SQL predicates + v2 rows).

## 7. Verifying against a database

The unit gate is DB-free. Route behaviour was exercised on the local
Neon-compatible Postgres (`docs/budget-v2/LOCAL_DB.md`) through the dev server
and `e2e/credit-card.spec.ts` (create card with a known statement → purchase →
partial payment → full payment → refund → fee → overpayment → trash/restore →
reload). Run it with the dev Clerk keys:

```bash
export CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY"
npx playwright test --project=chromium e2e/credit-card.spec.ts
```

## 8. Deliberately deferred

- Editing/deleting a filed statement (manual correction UX).
- Minimum-payment amounts, interest simulation, grace periods, issuer-specific
  rules (V1 is linear: available = limit + balance).
- Per-card currency: `wealth_accounts` has no currency column yet (Budget v2
  invariant 11). The domain helpers take plain numbers so a card currency can
  be added without touching the math.
- Loans: `isLiabilityType()` is the one switch to extend (`credit_card | loan`).
- Money Flow already excludes transfers and now nets refunds; a dedicated
  "cash movement vs economic spending" view is a separate design.
