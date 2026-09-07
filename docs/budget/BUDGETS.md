# ProfitSync — Budgets, explained

A plain-English guide to the budgets feature (v3): what a budget is, how spend is
measured, what the colours and headers mean, where it shows up, and how the older
per-client caps and the old API fit alongside it.

> **TL;DR**
> - A **budget** is a named **limit** over a **window** (today / this week / this month /
>   this year / custom dates), scoped to some **expense categories** or to **all spending**.
> - A main budget can carry **sub-budgets** (one level) that split its scope by category —
>   "Household €2,000 → Groceries €600, Transport €200, the rest unclaimed".
> - Spend is **never stored** — it is summed live from transactions for the window, by
>   **one** aggregate SQL statement for every budget on the page.
> - Both **personal and business** workspaces get them. A business workspace also keeps its
>   **per-client spend caps** exactly as before, at `/budgets/clients/:key`.
> - It is an indicator, not a wall: nothing ever blocks an expense.

For working on the code, use the **`budgets` skill** — it carries the invariants and the
verification recipes.

---

## 1. The model

One table, `spending_budgets` (migration `0067`), holds the **target** — never the spend:

| Column | Meaning |
|---|---|
| `organization_id` | The workspace (cascades on org delete). |
| `parent_id` | NULL for a main budget; a main budget's id for a **sub-budget**. One level only — a sub-budget cannot have children, and a budget that has sub-budgets cannot become one. Cascades on delete. |
| `name` | Required on every write. `''` is allowed only for a top-level, all-spending budget (the row a v1 personal budget migrated into) and renders as **"Personal budget"**. Sibling names are unique, case-insensitively (409 `name_taken`). |
| `icon` | An icon key (`budget-icons.tsx`); `''` = suggested from the name/categories. |
| `period` | `daily` \| `weekly` \| `monthly` \| `yearly` \| `once`. |
| `start_date`, `end_date` | Only for `once`: first and last day, both **inclusive**, either optional. Both empty = all time. |
| `amount` | The limit, `numeric(20,2)`, > 0 on the API. |
| `categories` | `jsonb` list of expense category **names**. `[]` = all spending. |
| `status` | `active` \| `paused`. Paused = greyed, counted nowhere, never alerted. |
| `position` | Manual order among siblings (⋯ → Move up / Move down). |

**Sub-budget rules** (checked by the API on create, edit and move — `checkRelations`):

- A sub-budget's window is its **parent's**, and is **not stored**: a DB check forbids dates
  on a child, and every read copies the parent's period and dates onto it — so changing a
  parent from monthly to weekly moves its children with no second write.
- It must name **≥ 1 category**, each **inside the parent's scope** when the parent has
  explicit categories (an all-spending parent accepts anything), and **no sibling may already
  claim it** — 409 `category_claimed` names the sibling. Shrinking a parent's scope below a
  child's is refused too (`child_outside_scope`).
- **Top-level budgets may overlap** ("All spending" and "Groceries" both count a grocery
  receipt — see §4). Caps: 40 top-level, 20 sub-budgets per parent, 50 categories, 60-char names.

**"Not in any sub-budget."** A parent with sub-budgets shows the spend in its scope that no
**active** child claims. That figure is **not** `parent − Σ children`: it is one more filter
column in the same SQL statement (`… and not (category key in <active children's
categories>)`). Two sub-budgets that came to share a category through a rename would push a
subtraction negative; a real filter over the ledger cannot.

## 2. How spend is measured

Every spend figure — list, detail, chart, recent rows, alerts — shares the same seven
predicates (`api/_lib/budget-spend.ts budgetSpendPredicates`, locked by a unit test):

1. the transaction's **client belongs to the org** (scoping is always via the client join);
2. the client is **not trashed**; 3. the client is **not closed** (a closed client is out of
   every report, so out of budgets too); 4. the transaction is **not trashed**;
5. `kind` is `standard` or `refund` — **transfers never count**;
6. it is `type = outgoing` **or** a **refund**; 7. it is **not a system row** (opening
   balance / balance adjustment).

Rows are summed **signed**: an expense adds, a **refund subtracts** from the window it lands
in. So a **credit-card purchase counts** (an ordinary outgoing on the card), **paying the
card does not** (a transfer), and a card refund comes back off the total.

**Category matching** is on the normalised key `lower(btrim(coalesce(category, '')))` —
"Groceries", "groceries" and " Groceries " are one category (`categoryKey()` in
`src/lib/budget.ts` is the JS twin, ASCII spaces only, exactly like Postgres `btrim`).
An **uncategorised** row only lands in all-spending budgets.

**Windows** are calendar-aligned in **UTC**, the way transaction dates are stamped:

| Period | Window `[start, end)` |
|---|---|
| daily | today |
| weekly | Monday → next Monday |
| monthly | the 1st → the 1st of next month |
| yearly | 1 January → 1 January |
| once | `start_date` (or −∞) → the day **after** `end_date` (or +∞) |

Only the date decides membership: a **future-dated row inside the window counts** today, and a
row past the window's end does not (v1 had no upper bound).

**One statement, not N.** Neon HTTP costs ~200 ms a round trip, so the API projects the
ledger once (signed amount, date, category key) and gives every budget its own
`sum(...) filter (where <its window> and <its scope>)` column. Budgets with a lower bound
share one statement that keeps the `(client_id, date)` index; the all-time ones (a `once`
budget with no start) share a second; the two run concurrently.

## 3. The states

`budgetState()` — the same thresholds as v1 and as the notifications:

| State | When | Colour |
|---|---|---|
| `ok` | under 80 % | emerald |
| `warn` | 80 % up to and including the limit | amber |
| `over` | spent > limit | red |
| `none` | **paused**, **ended** (a `once` budget past its end), **upcoming** (before its start), or limit ≤ 0 | grey — shown but **counted nowhere and never alerted** |

Each row also carries `remaining`, `ratio`, `window.days_left` (counts today; `null` for an
open end or an unstarted window), `per_day_left` (only while counted, with money *and* days
left), `other_spent` and `children_count`.

## 4. Section headers — union spend, limit only when disjoint

The list groups main budgets by period (Today / This week / This month / This year / Custom
dates) and shows headers only when more than one period is in use. A header's money is
**never a sum of its rows**: with "All spending" and "Groceries" both present, summing rows
counts one receipt twice. Instead the server adds one more filter column over the **union**
of the section's counted scopes (an all-spending budget makes the union everything).

The header quotes a **limit** (`€X of €Y`) only when the counted scopes are **pairwise
disjoint** — because "All spending €1,000 + Groceries €200" is a €1,000 cap, not €1,200.
Overlapping scopes show `€X spent` alone. "N of M on track" counts rows with spent ≤ limit.
`once` budgets have their own windows and get no header money at all.

## 5. The pages

**`/budgets`** — one card, one list (`BudgetsPage`, `BudgetRow`). A row is the icon, the
name, small badges (Paused / Ended / Starts *date* / "3 sub-budgets"), `€spent of €limit`,
`€left` or `€over` (red), and a bar coloured by state. Sub-budgets sit indented under their
parent, each with its own bar, then the muted "€X not in any sub-budget" line. Tapping the
row opens the detail; a separate chevron folds the sub-budgets; the ⋯ menu holds **Edit**,
**Add sub-budget** (main budgets only), **Pause / Resume**, **Move up / down** (one atomic
reorder statement) and **Remove** (confirm; sub-budgets go with it, transactions are never
touched). A business workspace shows its **client spend caps** in a section underneath.

**`/budgets/:id`** — the detail (`BudgetDetailPage`). It paints from the list's cached body
the instant it opens and loads the rest behind it:

- header: name, window (or "Part of *parent*"), categories or "All spending"; a banner when
  paused / ended / upcoming;
- hero: `€spent / €limit`, bar, left/over, days left, "about €X a day";
- **Sub-budgets** (main budgets only) with "+ Add sub-budget" and the remainder line;
- **Spend vs limit**: past windows (14 daily / 8 weekly / 6 monthly / 3 yearly), a bar per
  window coloured by state and a dashed limit line. Each past window is judged against **the
  limit in effect when that window closed**, read off the audit trail (`amountAt`) — lowering
  the limit today does not repaint last month. No chart for `once` or paused budgets;
- **Recent in this budget**: the latest 10 matching rows in the current window, refunds as
  `+`; "See all" opens `/transactions` filtered by category and window (≤ 1 category);
- **Changes**: the audit rows (`entity_type = 'budget'`), field by field.

Legacy URLs: `/budgets/default` (the v1 personal page) goes to `/budgets`; an id the list
does not know, in a business workspace, goes to `/budgets/clients/:id` — the v1 client-cap
detail (`ClientBudgetDetailPage`), unchanged.

**The dialog** (`SpendingBudgetDialog`, create + edit + sub-budget). A main budget asks name,
limit and period first, with "Only count some categories" folded away (**Custom** reveals
From / Until). A sub-budget puts the **categories first and required** — only the parent's
categories when it has some, chips a sibling claims disabled with the sibling's name — its
name follows the first pick until typed, and it has no period to choose. Categories can be
created inline; editing a parent shows "Sub-budgets add up to €X" with **Use total**; Remove
sits in the footer behind a two-tap confirm.

## 6. Dashboard card

Personal workspaces get **`BudgetsCard`** (dashboard card id `budget`): up to three active,
in-window main budgets, the fullest first, each with its bar and what is left; the card opens
`/budgets`. With nothing to show it offers "Set a budget" to editors and disappears for
viewers. It reads the same cached `/api/spending-budgets` body as the page, so it costs no
extra request. Business workspaces keep `BusinessBudgetCard` (the own-company cap).

## 7. The transaction-form hint

While adding an outgoing transaction, the form quotes the **tightest matching budget** for the
chosen category **and date** (`tightestBudget()`): a sub-budget beats a category budget, which
beats an all-spending one; among equals the one with the least room wins; paused budgets never
speak, nor does one whose window the date falls outside (a receipt backdated into last month
does not touch this month). It reads "**Groceries: €120 left after this**" or "**€30 over
after this**", coloured by state. Business workspaces keep the v1 client-cap line as well.
(`AddTransactionDialog` loads the budgets; the quick-add modal shows no budget hint.)

## 8. Notifications

`notifyIfBudgetExceeded()` runs fire-and-forget after a transaction is created, edited or
split, and when a recurring rule posts. With the written row in hand it evaluates only the
budgets whose scope holds the row's category and whose window holds its date (tiers only fire
on the way up, so a row *leaving* a budget never needs one); state `none` is skipped.

- **`budget_warning`** at ≥ 80 %, **`budget_exceeded`** past the limit, to the workspace's
  owners, admins and editors, linking to `/budgets/:id`; i18n params `{ name, period, percent }`.
- One alert per budget, per window, **per tier**. The dedupe key is
  `${tier}:sb:${budgetId}:${period}:${windowStart ?? "all"}:${amount}` — the `sb:` namespace
  can never collide with a client id, and the **amount is part of the key**, so raising or
  lowering the limit **re-arms** the alert once in the same window.
- Business per-client caps alert as before (`${tier}:${clientId}:${period}:${windowStart}`).

## 9. Renaming a category

Budgets store category **names**, so a rename must move with them or their spend would
silently drop to zero. `PATCH /api/categories/:id` and `PUT /api/categories/combined` first
**plan** the rewrite (`planCategoryRename`): every matching element is replaced
case-insensitively and deduped. If the rename would leave two sub-budgets of one main budget
claiming the same category, the whole rename is refused with 409 `category_claimed`
(`{ a, b, categories }`) — nothing half-applied. Deleting a category leaves the name in place
(as it does on transactions); the dialog still shows it as a removable chip.

## 10. Business workspaces

Spending budgets work in every workspace. A business workspace **also** keeps its v1
per-client spend caps unchanged: the `budgets` / `budget_history` tables, `/api/budgets`
(+ `/overview`, `/detail`), the client cards, `BusinessBudgetCard`, `/budgets/clients/:key`.

## 11. Compatibility — the v1 API on a personal workspace

Since migration 0067 a personal workspace has **no `budgets` row**: its v1 budget became its
first spending budget. Store-pinned app versions still ask `GET /api/budgets` for it, so on a
personal org the v1 routes **project the primary spending budget** — top-level, all-spending,
active; the migrated `''`-named row first, else the earliest — into the v1 shape (yearly and
custom periods read as `lifetime`), and a v1 `POST` upserts that same budget (`amount 0`
removes it; `lifetime` becomes `once` with no dates). `/overview` and `/detail` do the same,
the detail's timeline read from the audit trail. Two clients, one row, no drift. Onboarding's
personal step creates the budget through `/api/spending-budgets` with an empty name.

## 12. Migration `0067_spending_budgets`

1. Creates `spending_budgets` with its indexes and checks.
2. Moves each **personal** workspace's org-level `budgets` row (`client_id IS NULL`,
   `account_type = 'personal'`, amount > 0) into a spending budget: name `''`, `lifetime` →
   `once`, categories `[]`; its `budget_history` rows become `audit_logs` entries (`from` =
   the previous row via `lag()`), then both v1 rows are deleted. Business rows are untouched.
3. Keeps the one useful thing from the v2 engine — `transactions_category_key_idx` on
   `(client_id, lower(btrim(coalesce(category,''))))` — which serves the WHERE-level matches.

The v2 migrations **0059–0061 were retired from the journal** rather than reverted: production
never ran them (its last applied migration is 0058, and the neon-http migrator records nothing
until a whole pending batch succeeds), so production never gets those tables. The **shared dev
DB** did run them and keeps them as **orphans** — a teammate's branch still reads them; they
are a one-line drop once that branch is closed.

## 13. Files

| Concern | File |
|---|---|
| Table + checks | `spendingBudgets` in `src/lib/db/schema.ts`; `drizzle/0067_spending_budgets.sql` |
| Pure math (windows, states, scope, hint, `amountAt`) | `src/lib/budget.ts` (+ `spending-budget.test.ts`, `budget.test.ts`) |
| SQL: live spend, sections, series, recent, history, validation, rename plan | `api/_lib/spending-budgets.ts`; shared predicates in `api/_lib/budget-spend.ts` (+ test) |
| Routes | `api/_routes/spending-budgets.ts`, `spending-budgets/[id].ts`, `spending-budgets/reorder.ts` (registered in `api/index.ts`) |
| v1 caps + personal shim | `api/_routes/budgets.ts`, `budgets/overview.ts`, `budgets/detail.ts` |
| Alerts | `api/_lib/notify-budget.ts` (+ test) |
| Category rename hooks | `api/_routes/categories/[id].ts`, `categories/combined.ts` |
| Cache policy | `/api/spending-budgets` entries in `src/lib/api-cache.ts` |
| Pages | `src/pages/BudgetsPage.tsx`, `BudgetDetailPage.tsx`, `ClientBudgetDetailPage.tsx` |
| Components | `src/components/budget/{SpendingBudgetDialog,BudgetRow,BudgetsCard,ClientBudgetsSection,BudgetIconPicker,budget-icons,budget-format}.tsx` |
| Tx-form hint | `src/components/transactions/tx-form.tsx` (`spendingHint`), data from `AddTransactionDialog.tsx` |
| Onboarding | `src/components/onboarding/MoneyWizard.tsx` |
| Types | `SpendingBudget*` in `src/lib/types.ts` |
| Browser test | `e2e/budgets.spec.ts` |

## 14. FAQ

**Does a budget stop me from spending?** No. It colours the bar, quotes what is left in the
form, and notifies at 80 % and 100 %. The expense always goes through.

**Are transfers or income counted?** No. Only standard outgoing rows and refunds (negative).
Paying a credit card is a transfer, so it never counts; the purchases on the card already did.

**Can two budgets count the same expense?** Two *main* budgets, yes — which is why a section
header shows union spend and only quotes a limit when scopes are disjoint. Two *sub-budgets of
the same parent*, never — the API refuses the overlap.

**I paused a budget — what happens?** It stays in the list, greyed, counted nowhere and never
alerted, and its parent's remainder no longer excludes it. Resume brings it straight back; nothing is lost.

**My old app version still shows a "Personal budget".** That is the v1 route projecting the
primary spending budget — the same row the new page edits.
