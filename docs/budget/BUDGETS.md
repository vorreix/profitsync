# ProfitSync — Budgets, explained

A plain-English guide to the budgets feature (v3): what a budget is, the window the page reads
them in, how spend is measured, and how the older per-client caps fit alongside it.

> **TL;DR**
> - A **budget** is a named **limit** in a **rhythm** (a day / week / month / year, or a
>   fixed **custom-date** sum), scoped to **expense categories** or to **all spending**.
> - The page reports on **one window at a time** (Day / Week / Month / Year) and converts
>   every budget into it — the only way different rhythms can be compared and added up.
> - The **overall budget** — the top-level budget with no categories — is the page header,
>   and every other budget is measured against it, one by one and as a sum. One per workspace.
> - A budget can carry **sub-budgets** (one level) that split its scope **by category**, and
>   **siblings are disjoint at every level** — which is what makes those sums honest.
> - Spend is **never stored** — it is summed live from transactions by **one** aggregate SQL
>   statement covering every budget and every window on the page. Both workspace types get
>   them; a business workspace also keeps its **per-client spend caps** at
>   `/budgets/clients/:key`. It is an indicator, not a wall: nothing ever blocks an expense.

For working on the code, use the **`budgets` skill** — it carries the invariants and the
verification recipes.

---

## 1. The model

One table, `spending_budgets` (migrations `0067`, `0068`), holds the **target** — never the spend:

| Column | Meaning |
|---|---|
| `organization_id` | The workspace (cascades on org delete). |
| `parent_id` | NULL for a main budget; a main budget's id for a **sub-budget**. One level only — a sub-budget cannot have children, and a budget that has sub-budgets cannot become one. Cascades on delete. |
| `name` | Required on every write. `''` is allowed only for a top-level, all-spending budget (the row a v1 personal budget migrated into) and renders as **"Personal budget"**. Sibling names are unique, case-insensitively (409 `name_taken`). |
| `period` + `start_date`, `end_date` | `daily` \| `weekly` \| `monthly` \| `yearly` \| `once` — the rhythm it was **authored** in. The dates are for `once` only: first and last day, both **inclusive**, either optional; both empty = all time. |
| `amount` | The limit, `numeric(20,2)`, > 0 on the API. |
| `categories` | `jsonb` list of expense category **names**. `[]` = all spending. |
| `status` | `active` \| `closed`. Closed = folded away, counted nowhere, never alerted, its categories **released** for another budget to claim. |
| `position` | Manual order among siblings (drag in reorder mode, or ⋯ → Move up / Move down). |

**Sub-budget rules** (checked on create, edit and move — `checkRelations`):

- A child's window is its **parent's** and is **not stored**: a DB check forbids dates on a
  child, and every read copies the parent's period and dates onto it — so moving a parent
  from monthly to weekly moves its children with no second write.
- It must name **≥ 1 category**, each **inside the parent's scope** when the parent has
  explicit categories (an all-spending parent accepts anything), and **no active sibling may
  already claim it** (409 `category_claimed`, naming the sibling). Shrinking a parent below a
  child's scope is refused too (`child_outside_scope`).
- A sub-budget splits its parent **by category**, so a parent scoped to *one* category holds
  exactly *one* sub-budget. That is the rule, not a limitation to work around: two
  sub-budgets over one category would be two names for one number.
- Caps: 40 top-level, 20 sub-budgets per parent, 50 categories, 60-char names.

## 2. One window at a time

Budgets are **authored** in the rhythm their owner thinks in — rent monthly, coffee weekly —
but can only be compared, added up and set against one overall limit when they are all
expressed in the **same** window. So the page carries one toggle (Day / Week / Month /
Year), remembered per workspace, and converts every budget into it; a row whose rhythm is
not the chosen window says what was actually set underneath: "You set €300 a month".

Conversions pivot through a **day** (`PERIOD_DAYS`, `perDayRate`), never through a month — a
week must be exactly 7 days or "€10 a day" reads back as "€70.24 a week" and the first thing
anyone checks in their head is wrong. The month and year are the Gregorian means (30.436875
and 365.2425 days). Two conversions, deliberately different:

- **`limitForView`** — the limit to *quote* as a rate ("€300 a month is about €9.86 a day"),
  which is what the dialog's equivalence line shows.
- **`limitForWindow`** — the limit a window is actually *judged* against. It pro-rates by the
  window's **real** day count, so a 28-day February allows 28 days of a daily rate rather than
  the mean month's 30.44; calling an 8 % overspend "on budget" because the mean month is longer
  is a wrong verdict, not a rounding cosmetic. A budget authored in the window's own rhythm is
  exactly what was typed — a €300 month is €300 in February too.

A **custom-date** (`once`) budget never converts — it is a fixed sum over fixed dates, so
every view reports its own figure. **The toggle costs no request:** the API returns
`spent_by_view` for all four windows on every row (`withSpend`) and the client converts
(`inView` in `budget-format.tsx`), so switching window is a re-render. It is still one
statement — each distinct (window, scope) pair is one more `sum(...) filter (...)` column.

## 3. The overall budget, and disjoint siblings

The **overall budget** is the top-level budget with **no categories** — all spending. There
is **one per workspace**, enforced by a partial unique index (`0068`) and a 409
`overall_exists`; a **closed** one does not hold the slot, so putting one away and setting
another works. It is not a row in the list — it is the page **header** (spend, limit, bar,
days left, pace), and under it the allocation line (`allocation()`) with a segmented bar of
each budget's share:

> **Budgets use €1,400 of €2,000 · €600 unallocated**

Over-allocated turns amber and says by how much; it is never hidden. Custom-date budgets are
left out of the sum. With no overall budget the header offers to set one and quotes what the
budgets come to; closing it empties the header the same way (it never joins the "Closed"
fold — it was never in the list).

That sum only means something because **top-level budgets are disjoint too**: two active
top-level budgets with categories may not overlap, and `checkRelations` refuses the second with
409 `category_claimed`, naming the holder. Three exemptions, all deliberate — the **overall**
budget (covering everything is its job), a **custom-date** budget on either side (a one-off sum
is not a claim on a rhythm), and a **closed** budget (releasing its categories is most of the
point of closing one). The same rule holds among sub-budgets.

## 4. How spend is measured

Every spend figure — list, header, detail, charts, analytics, alerts — shares the same seven
predicates (`api/_lib/budget-spend.ts budgetSpendPredicates`, locked by a unit test): the
**client belongs to the org** (scoping is always via the client join), is **not trashed** and
is **not closed**; the transaction is **not trashed**, is a `standard` or `refund` `kind`
(**transfers never count**), is `type = outgoing` **or** a refund, and is **not a system row**.

Rows are summed **signed**: an expense adds, a **refund subtracts** from the window it lands
in. So a **credit-card purchase counts** (an ordinary outgoing on the card), **paying the
card does not** (a transfer), and a card refund comes back off the total.

**Category matching** is on the normalised key `lower(btrim(coalesce(category, '')))` —
"Groceries", "groceries" and " Groceries " are one category (`categoryKey()` is the JS twin,
ASCII spaces only, exactly like Postgres `btrim`); an **uncategorised** row only lands in
all-spending budgets. **Windows** are calendar-aligned in **UTC**, the way transaction dates
are stamped: daily = today; weekly = Monday → Monday; monthly = the 1st → the 1st; yearly =
1 Jan → 1 Jan; `once` = `start_date` (or −∞) → the day **after** `end_date` (or +∞). Only
the date decides membership: a **future-dated row inside the window counts** today.

**"Not in any sub-budget"** is the spend in a parent's scope that no **active** child
claims: a **subtraction** — parent minus its active children — exact only because children
are disjoint and inside the parent's scope, the rules `checkRelations` enforces on every
write. It is clamped at zero anyway. **One statement, not N:** Neon HTTP costs ~200 ms a
round trip, so the API projects the ledger once (signed amount, date, category key) and
gives every (window, scope) pair its own filtered `sum` — the bounded ones in one statement
that keeps the `(client_id, date)` index, the all-time ones in a second, run concurrently.

**Renaming a category** must move the budgets that named it or their spend would silently
drop to zero. `PATCH /api/categories/:id` and `PUT /api/categories/combined` first **plan**
the rewrite (`planCategoryRename`), replacing case-insensitively and deduping; if it would
leave two budgets **at the same level** — top level included, the overall budget excepted —
claiming one category, the whole rename is refused with 409 `category_claimed`, nothing
half-applied. Deleting a category leaves the name in place, as it does on transactions.

## 5. The states

`budgetState()` — the same thresholds as v1 and as the notifications:

| State | When | Colour |
|---|---|---|
| `ok` | under 80 % | emerald |
| `warn` | 80 % up to and including the limit | amber |
| `over` | spent > limit | red |
| `none` | **closed**, **ended** (a `once` budget past its end), **upcoming** (before its start), or limit ≤ 0 | grey — shown but **counted nowhere and never alerted** |

Each row also carries `remaining`, `ratio`, `window.days_left` (counts today), `per_day_left`,
`other_spent` (+ `_by_view`), `is_overall` and `children_count`. The colour on screen is the
state **in the chosen view window**; `state` on the API body is the state in the budget's
**own** window — what the alerts, the dashboard card and the form hint read.

## 6. The pages

**`/budgets`** — two tabs (**Budgets** | **Analytics**, via `?tab=analytics`) and, above
them, the Day / Week / Month / Year toggle both are read in. The Budgets tab is the overall
header (§3) and one list (`BudgetList`, `BudgetRow`): icon, name, badges (Closed / Ended /
Starts *date* / "3 sub-budgets"), `€spent of €limit`, `€left` or `€over`, a state-coloured
bar, and — off the budget's own rhythm — the "You set €300 a month" line.

**Sub-budgets are managed inline.** Every row folds open (rows with children start open) and
always shows its sub-budgets, the muted "€X not in any sub-budget" line, and a way forward:
**+ Add sub-budget**, or — when every category in the parent is already claimed — "Every
category in *Household* is already in a sub-budget" plus **Add a category to it**, which
opens the parent's edit dialog on its scope. A budget with no sub-budgets offers the same
button; that dead end is gone.

**Reorder** is a mode, not a permanent grip: the button turns rows into grips, stops the row
from navigating and hides the ⋯ menu. There are **two independent, single-level drag
scopes** — the top-level rows, and each expanded parent's children — and a drag can never
cross them, so a slip of the finger can only change *order*; re-parenting stays a deliberate
dialog action. Built on `@dnd-kit/core` alone (grip + rect snapshot + midpoint edge), like
WealthPage and the cards tab; ⋯ → **Move up / Move down** is the accessible equivalent. Both
write through `POST /api/spending-budgets/reorder`, one atomic statement.

**Closed budgets** fold away behind a "Closed (N)" line at the bottom; a closed **sub**-budget
stays inside its parent. Closing a parent **cascades** to its children in the same request, so
nothing keeps counting off-screen; reopening does the same. The ⋯ menu holds Edit, Add
sub-budget (main budgets, not the overall one), **Close / Reopen**, Move up / down and Remove
(sub-budgets go with it; transactions are never touched). A business workspace lists its
**client spend caps** under the Budgets tab as well.

**`/budgets/:id`** — the detail (`BudgetDetailPage`), read in the budget's **own** window (no
view toggle). It paints from the list's cached body the instant it opens and loads the rest
behind it: header and window banner; hero; **Sub-budgets** with the remainder line; **Spend vs
limit** over past windows (14 daily / 8 weekly / 6 monthly / 3 yearly), each judged against the
limit in effect when that window closed (`amountAt`, off the audit trail), no chart for `once`
or closed budgets; **Recent in this budget**; and **Changes**, the audit rows field by field.
Legacy URLs: `/budgets/default` → `/budgets`; an unknown id in a business workspace →
`/budgets/clients/:id`, the v1 detail, unchanged.

**The dialog** (`SpendingBudgetDialog`) covers create, create-overall, create-sub and edit. A
main budget asks name, limit and period first, its category scope folded away (**Custom**
reveals From / Until) under the limit's rate equivalences; the **overall** budget has no scope
to choose; a **sub-budget** puts the categories first and required — only the parent's, a
sibling's claim disabled and named — and has no period to choose.

## 7. The Analytics tab

`BudgetAnalyticsPanel` + `GET /api/spending-budgets/analytics?view=&back=` (`analyticsFor`)
— the questions the list cannot answer, in **three round trips** whatever the size of the
plan: the budget rows, then one grouped read of the ledger (window × category key) and one
of the audit trail, concurrently. Four blocks: **Spending over time** (a bar per window
against a dashed limit line, for the overall budget or any single one, over the last 6 / 12
/ 24 windows); **Not in any budget** (this window's spend that no active top-level category
budget claims, ranked by category); **Are you keeping to it?** (on-budget rate, streak, average over/under); **Where
it went** (every top-level budget against its limit, worst first).

Three rules keep the verdicts honest:

- a window is judged against the limit that applied **when it closed**, and **not judged at
  all before the budget existed** — `limitAt` returns `null` there, so a budget created last
  week is not painted across a year of windows it was never part of;
- the current window is **`partial`**: drawn faded, never judged, because month-to-date
  spend is trivially under any limit on the 3rd;
- a window is **`reliable: false`** when a budget's categories or period changed after it
  closed — folding today's scope onto an older window would rewrite history silently. Those
  windows are still drawn (dimmed), never counted. `lastChangedAt` ignores the create row,
  or every window before a budget was made would look unreliable and nothing would be judged.

Adherence counts only finished, reliable windows that had a cap: against the overall limit
when there is one (total spend), else against the sum of the category budgets' limits (the
spend they claim). Custom-date and closed budgets take no part here.

## 8. Dashboard card, form hint, notifications

**`BudgetsCard`** (dashboard card id `budget`, personal workspaces): up to three active,
in-window main budgets, the fullest first, each in its **own** window; it opens `/budgets`,
offers "Set a budget" to editors when empty, and reads the same cached body as the page, so it
costs no extra request. Business workspaces keep `BusinessBudgetCard` (the own-company cap).

**The transaction form** quotes the **tightest matching budget** for the chosen category
*and* date (`tightestBudget()`): a sub-budget beats a category budget, which beats an
all-spending one; among equals the one with the least room wins; closed budgets never speak,
nor does one whose window the date falls outside. Business workspaces keep the v1 line too.

**`notifyIfBudgetExceeded()`** runs fire-and-forget after a transaction is written and when
a recurring rule posts, evaluating only the budgets whose scope holds the row's category and
whose window holds its date; state `none` is skipped. `budget_warning` fires at ≥ 80 %,
`budget_exceeded` past the limit, to owners, admins and editors. One alert per budget, per
window, **per tier**: the key is `${tier}:sb:${id}:${period}:${windowStart ?? "all"}:${amount}`
— `sb:` can never collide with a client id, and the **amount is part of it**, so changing the
limit **re-arms** the alert once.

## 9. Business workspaces, and the v1 API

Spending budgets work in every workspace. A business workspace **also** keeps its v1 per-client
spend caps unchanged: the `budgets` / `budget_history` tables, `/api/budgets` (+ `/overview`,
`/detail`), the client cards, `BusinessBudgetCard`, `/budgets/clients/:key`.

Since migration 0067 a **personal** workspace has **no `budgets` row**: its v1 budget became
its first spending budget. Store-pinned bundles still ask `GET /api/budgets` for it, so on a
personal org the v1 routes **project the primary spending budget** — top-level, all-spending,
active, i.e. exactly the **overall** budget (the migrated `''`-named row first, else the
earliest) — into the v1 shape (yearly and custom read as `lifetime`), and a v1 `POST` upserts
that same row. `/overview` and `/detail` do the same, the timeline read from the audit trail.
Two clients, one row, no drift. Onboarding creates that budget with an empty name.

## 10. Migrations

**`0067_spending_budgets`** created the table with its indexes and checks, moved each personal
workspace's org-level `budgets` row into a spending budget (name `''`, `lifetime` → `once`,
categories `[]`; `budget_history` → `audit_logs`, then both v1 rows deleted), and kept
`transactions_category_key_idx` from the retired v2 engine — whose migrations **0059–0061 were
retired from the journal** rather than reverted, production never having run them.

**`0068_budget_view_and_overall`**, both parts additive: (1) `paused` → **`closed`** (an
`UPDATE` plus a new status check) — "closed" is the word the app already uses for a client put
away, and the page folds those behind a button rather than greying them in place; (2) a
**partial unique index** (`spending_budgets_overall_unique`) on `organization_id` `where
parent_id is null and categories = '[]'::jsonb and status = 'active'` — one overall budget per
workspace, a closed one not holding the slot.

## 11. Files

| Concern | File |
|---|---|
| Schema + migrations | `spendingBudgets` in `src/lib/db/schema.ts`; `drizzle/006{7_spending_budgets,8_budget_view_and_overall}.sql` |
| Pure math (windows, states, scope, conversions, allocation, hint, `amountAt`/`limitAt`) | `src/lib/budget.ts` (+ `spending-budget.test.ts`, `budget.test.ts`) |
| SQL + routes | `api/_lib/spending-budgets.ts`, predicates in `api/_lib/budget-spend.ts`; `api/_routes/spending-budgets{.ts,/[id].ts,/reorder.ts,/analytics.ts}`; v1 caps + shim in `api/_routes/budgets{.ts,/overview.ts,/detail.ts}`; alerts in `api/_lib/notify-budget.ts`; rename hooks in `api/_routes/categories/{[id],combined}.ts` |
| UI | `src/pages/{BudgetsPage,BudgetDetailPage,ClientBudgetDetailPage}.tsx`; `src/components/budget/{BudgetList,BudgetRow,BudgetAnalyticsPanel,SpendingBudgetDialog,BudgetsCard,ClientBudgetsSection,budget-format,budget-icons,BudgetIconPicker,drag-handle}`; the form hint in `src/components/transactions/tx-form.tsx` |
| Types · cache · browser test | `SpendingBudget*` in `src/lib/types.ts` · `src/lib/api-cache.ts` · `e2e/budgets.spec.ts` |

## 12. FAQ

**Does a budget stop me from spending?** No. It colours the bar, quotes what is left in the
form, and notifies at 80 % and 100 %. The expense always goes through. Transfers and income
never count — only outgoing rows and refunds (negative), so paying a credit card is invisible
to budgets while the purchases on the card already counted.

**Why does my weekly budget show a monthly number?** Because the page is read in the month
window; the row says what you actually set underneath. A budget written as a daily or weekly
rate is judged by the days a window really has, so February allows less than March — while a
budget written *as* a month is €300 in February too.

**Can two budgets count the same expense?** The overall budget counts everything, so it and a
category budget both see one receipt — that is the point of it. Otherwise no: two active
budgets at the same level may not claim one category. Custom-date budgets are exempt.

**I closed a budget — what happens?** It leaves the list for the "Closed" fold, is counted
nowhere and never alerted, releases its categories, and its sub-budgets close with it.
Reopening brings them all straight back; nothing is lost.

**Some bars in Analytics are faded.** The current window is unfinished, so it is never judged;
a dimmed past window closed before a budget's categories or rhythm changed, so its figures are
reported but not counted towards adherence.

**My old app version still shows a "Personal budget".** That is the v1 route projecting the
overall spending budget — the same row the new page edits (§9).
