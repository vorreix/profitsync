# Budget History & Insights — design spec

Status: approved (brainstorm) → implementing. Built as a stacked branch chain off
`feat/ux2-25-mobile-create-org`. Mobile-first, simple UX is the explicit north star.

## Goal

Turn budgets from a static number into a behavioural tool: a **change timeline**
(who set/raised/lowered/changed-period/removed a budget, when, old→now) plus
**performance insights** (spend-vs-budget over time, adherence, budget-creep).

Decisions from the brainstorm:
- **Both** timeline + insights; timeline is the foundation, insights derive on top.
- **All budgets**: personal org budget + per-client business budgets get the full
  timeline + insights; the business default/template (no single spend) gets the
  timeline only.
- **Dedicated `/budgets` page** (list + cross-budget overview) → per-budget detail.
- Insights: spend-vs-budget chart, adherence summary, budget-creep detection,
  cross-budget overview.
- Data model: **append-only `budget_history` snapshot table** (Approach B).

## Data model

New table `budget_history` (append-only). Keyed by **org + client_id** — NOT a FK to
`budgets.id`, because a budget row is *deleted* on "remove" and history must survive
that (and a later re-set).

| col | type | notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK→organizations cascade | |
| client_id | uuid? FK→clients cascade | null = personal/default budget |
| amount | numeric(20,2) | snapshot **after** the change (0 for `remove`) |
| period | text | snapshot after the change |
| action | text | `set` \| `raise` \| `lower` \| `period_change` \| `remove` |
| changed_by | text | Clerk userId |
| created_at | timestamptz default now() | |

Index `(organization_id, client_id, created_at)`. *"Budget in effect at time T"* =
latest row with `created_at ≤ T`. Spend stays **derived** from transactions.

**Migration**: `npm run db:generate`; the new `_journal.json` entry's `when` must be
`> 1780964093751` (the 0033 entry) or it silently skips. **Backfill** in the migration:
one `set` row per existing budget (`amount`, `period`, `created_by`, `created_at`).

**Write hook** (`api/_routes/budgets.ts` POST): capture `existing` before the
upsert/delete, resolve `action` + snapshot, and after the mutation append a
`budget_history` row — **best-effort** (a failed insert never blocks the budget save),
mirroring `logAudit`.

## Pure logic — `src/lib/budget-history.ts` (unit-tested, DB-free)

- `periodBoundaries(period, n, now)` → last `n` `{start,end}` windows (UTC, reusing
  `periodStart`). Monthly/weekly/daily only; lifetime has no series.
- `budgetAmountAt(history, t)` → amount/period in effect at `t`.
- `buildSeries(boundaries, spentByBucket, history)` → `[{label, spent, budget, state}]`
  (`state` via existing `budgetState`).
- `adherence(series)` → `{ rate, streak, avgDelta }`; `evolution(history)` →
  `{ first, current, pct }`.
- `detectCreep(history)` → `{ flagged, raiseCount, reason }` (≥2 raises, each landing
  just above prior actual — heuristic).

## API

- `GET /api/budgets/overview` → `{ budgets:[{client_id, client_name, amount, period,
  spent, adherenceRate, creepFlagged}], aggregate:{ totalBudget, totalSpent, onTrack,
  total, best, worst } }`. Two grouped queries (all history + per-(client,bucket)
  spend over the lookback) → adherence computed in JS. Powers the list + header.
- `GET /api/budgets/detail?client_id=…` (omit/empty = the null budget) → `{ current,
  timeline:[history rows], series:[…], adherence, evolution, creep }`. Lazy, per budget.
- Registered in `api/index.ts` as `["budgets","overview"]` / `["budgets","detail"]`.

## UI (mobile-first, simple)

- `/budgets` **list page**: a one-glance header (this-period budgeted vs spent + bar +
  "N of M on track"), then a card per budget (name · `BudgetIndicator` · adherence
  chip · chevron). Tap → detail. Empty state → CTA.
- `/budgets/:key` **detail** (`key` = clientId, or `default` for the null budget):
  current budget + Edit (reuse `BudgetDialog`); spend-vs-budget **chart** (recharts,
  reusing `ChartContainer`/`ChartConfig`; over=red/amber/green); **adherence** stat
  tiles; **creep** callout (if flagged); **change timeline**. Lifetime/template budgets
  skip the chart.
- Nav: desktop sidebar + mobile "More" menu entry (`nav.budgets`). Transitions per
  transition-creator (chart bars in, timeline stagger, page-enter; reduced-motion safe).

## Edge cases / v1 simplifications

- Period changed (e.g. monthly→weekly): the chart buckets use the budget's **current**
  cadence; the budget *amount* in effect is still read from history (honest, simple).
- Transactions edited/deleted retroactively shift historical spend — it's **recomputed**,
  not snapshotted (acceptable, by design).
- "Removed" budgets: history is retained; the list shows current budgets only (removed
  budgets reappear with their history if re-set). No separate "removed" view in v1.
- Default/template budget: timeline only (no spend) — detail shows a "template, no
  spend tracking" note instead of the chart.

## Branch chain (as shipped)
- `feat/ux2-25-mobile-create-org` — pre-req bug fix (mobile create-org → wizard).
- `feat/ux2-26-budget-history-backend` — table (mig 0034) + backfill + write hook +
  pure lib + unit tests + the two endpoints.
- `feat/ux2-27-budgets-ui` — `/budgets` list + `/budgets/:key` detail (chart + adherence
  + creep + timeline) + nav + lazy routes + i18n (all 8 locales). (List + detail were
  combined into one branch so the chain stays a working increment.)
- `feat/ux2-28-budget-review-fixes` — fixes from the adversarial review (below).

## Budget entry points (feat/ux2-29-budget-links)
Every place a budget is shown now **links into `/budgets/:key`** (the detail page is the
home for history/insights *and* set/edit), with a consistent **PiggyBank** icon + a
chevron affordance:
- **Client detail** budget card → taps to `/budgets/:clientId`; keeps an inline Edit
  button (`stopPropagation`) for quick edits.
- **Clients list** card budget line → piggy icon + chevron, taps to `/budgets/:clientId`
  (both the with-budget indicator and the "Set budget" empty state). The inline
  `BudgetDialog` was removed from this page — edit/set lives on the detail page.
- **Dashboard** `PersonalBudgetCard` → `/budgets/default`, `BusinessBudgetCard` →
  `/budgets/:ownClientId`; whole card clickable, inline Edit kept (`stopPropagation`).
- **API:** `/api/budgets/detail` no longer 404s for a *valid* client with no budget yet
  (only invalid/trashed clients 404) — it returns `current: null` so the link never
  dead-ends; the page shows "No budget set" + a Set button. `BudgetDetailPage` gates the
  spend chart on `current` existing (no all-zero chart / wrong "template" note for a
  budget-less client).
Verified with Playwright on desktop + 390px mobile (no overflow): all four surfaces show
the piggy + chevron + navigate; Edit buttons `stopPropagation`; the no-budget link shows
the set state (not 404); `/budgets/default` renders. Gate green.

## Change log
- 2026-06-10: feat/ux2-29-budget-links — budget surfaces (client detail, clients list,
  dashboard cards) link into `/budgets/:key` with a PiggyBank icon; detail handles the
  no-budget case gracefully. See "Budget entry points" above.
- 2026-06-09/10: feature implemented across the branches above; verified with unit
  tests, throwaway handler tests (overview/detail/write-hook), and live Playwright on
  mobile + desktop (incl. a real edit→timeline round-trip, then data restored).
- Adversarial review (11 findings → 8 "confirmed"); after hand-verification, **3 were
  real**, fixed in branch 28:
  1. Soft-deleted (trashed) clients leaked into the budgets overview/detail — now
     excluded (`isNull(clients.deletedAt)`; overview drops their budgets, detail 404s).
     Verified with a throwaway test (active→present, trashed→excluded + 404).
  2. The detail chart ignored `prefers-reduced-motion` — recharts `isAnimationActive`
     now gated on it.
  3. Removed an unsafe `d!` non-null assertion.
  The other 5 were **false positives** and dismissed: the `spendForWindows`
  "Date vs string" bug (drizzle pg `date` returns a string — proven by the live June
  bucket = €3.46M), `budgetAmountAt` "fragility" (the boundary semantics are correct and
  unit-tested; the suggested fix would have introduced a bug), and the
  `budget_history.clientId` cascade (intentional + consistent with the `budgets` table —
  history survives a budget *remove*, which is the stated intent).
