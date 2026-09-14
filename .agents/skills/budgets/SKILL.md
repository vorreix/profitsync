---
name: budgets
description: Use when working on ProfitSync budgets — the /budgets pages (Budgets + Analytics tabs, the Day/Week/Month/Year view toggle), spending budgets, the overall budget and sub-budgets, category scope, the spending_budgets table, /api/spending-budgets, the v1 client spend caps at /api/budgets (and their personal-workspace shim), or budget notifications (budget_warning / budget_exceeded). Establishes the spend-is-never-stored / one-aggregate-statement / child-window-derived-on-read model and the invariants that keep every figure honest.
---

# ProfitSync budgets

**The rule everything here serves: a budget's number is always the ledger, never a copy of
it.** Nothing stores spend, nothing caches a total server-side, and every figure on every
surface (list, header, detail, analytics, dashboard card, form hint, alert) is the same SQL
over the same seven predicates. Plain-English guide: `docs/budget/BUDGETS.md`.

## Mental model

Three layers, same split as the alerts rail — because the unit gate is DB-free, money math
is only testable if it lives in layer one:

| Layer | File | Owns |
|---|---|---|
| **Pure** | `src/lib/budget.ts` ("Spending budgets" + "The view window") | windows (`budgetWindow`, `windowsBack`, `viewRange`), phase/days/pace, `budgetState`, `categoryKey` + scope helpers, the conversions (`PERIOD_DAYS`, `perDayRate`, `limitForView`, `limitForWindow`), `allocation`, `tightestBudget`, `amountAt` / `limitAt` / `lastChangedAt`. No DB, no React; shared by API and client. |
| **SQL** | `api/_lib/spending-budgets.ts` | `loadRecords` → `withSpend` → `listBudgets`; `analyticsFor`; `seriesFor`, `recentFor`, `historyFor`; `parseBudgetInput` + `checkRelations`; `planCategoryRename`/`applyCategoryRename`; the v1 bridge (`primaryBudget`, `toV1Period`, `fromV1Period`). Predicates from `api/_lib/budget-spend.ts`. |
| **Routes** | `api/_routes/spending-budgets{.ts,/[id].ts,/reorder.ts,/analytics.ts}` | auth + role + compose + `logAudit`. |

- **Spend is never stored.** The table holds name, limit, period/dates, categories, status,
  position; everything derived (`spent`, `spent_by_view`, `remaining`, `ratio`, `state`,
  `window`, `per_day_left`, `other_spent(_by_view)`, `is_overall`, `children_count`) is
  computed per request for `today` (UTC).
- **One aggregate statement.** `spendByItem` projects the ledger once (signed amount, date,
  category key) and gives every distinct **(window, scope)** pair one
  `sum(...) filter (where …)` column — the budget's own window *and* each of the four view
  windows. Items with a lower bound share one statement (keeps the `(client_id, date)`
  index); the all-time ones (`once` with no start) share a second; both run concurrently.
- **A sub-budget has no window of its own.** `loadRecords` overwrites a child's
  period/start/end with its parent's on every read; the DB forbids dates on a child.

## Invariants — do not break these

1. **Every spend query goes through `budgetSpendPredicates` + `budgetSpendSignedAmount`.**
   Seven predicates: org via the clients join, client not trashed, client **not closed**, tx
   not trashed, `kind in (standard, refund)`, outgoing-or-refund, `is_system = false`.
   Refunds subtract; transfers (card payments) never match; card purchases do.
   `budget-spend.test.ts` asserts the count and the rendered SQL — extend it, never bypass it.
2. **Conversions pivot through a DAY, and there are two of them.** `perDayRate` →
   `limitForView` is what you **quote** (a week is exactly 7 days; the month/year are the
   Gregorian means). `limitForWindow` is what you **judge** against — the daily rate times
   the window's *real* day count, and the authored amount verbatim when `period === view`.
   Never judge a window with `limitForView`: February would forgive an 8 % overspend.
   A `once` budget converts to nothing — it is a fixed sum, so every view reports its own.
3. **The page's toggle must never become a request.** `withSpend` returns `spent_by_view`
   for all four windows on every row and the client converts (`inView`); there is deliberately
   no `?view=` on the list route, so the page and the dashboard card share one cache entry and
   the detail paints from it. Alerts, the card and the form hint read the budget's **own**
   window (`spent` / `state`), not the view.
4. **One OVERALL budget per workspace** — top level, `categories = []`, `status = 'active'`;
   `is_overall` is derived, never stored. Enforced twice: the partial unique index
   `spending_budgets_overall_unique` (mig 0068) and `checkRelations` → 409 `overall_exists`; a
   **closed** one does not hold the slot. It is the page header and is filtered out of the list,
   so a closed overall budget shows nowhere — the header offers to set a new one.
5. **Siblings are disjoint at EVERY level**, top level included — that is what makes
   `allocation()` and the analytics fold honest. Exemptions, all in `checkRelations`: the
   overall budget (empty scope), a `once` budget on either side, and any **closed** budget
   (closing releases its categories). Plus the old child rules: ⊆ parent's scope, ≥ 1
   category, depth 1, a budget with children cannot become one. It runs on POST and PATCH
   with the *whole* org's records — call it on any new write path.
6. **Closing a top-level budget cascades to its children** in the same request (`[id].ts`),
   and reopening does the same; otherwise an active child of a closed parent keeps counting
   and alerting off-screen. `status` is `active | closed` — `paused` is gone (mig 0068).
7. **A child's window is derived on read, never stored** — no "sync children" write; the
   201/PATCH bodies rebuild the record from the parent for the same reason.
8. **The remainder is a clamped subtraction.** `other_spent(_by_view)` = parent − its
   **active** children, `max(0, …)` — exact only because children are disjoint and inside the
   parent's scope (5). Relax that rule and this must go back to a `not in (...)` filter.
9. **Analytics may not invent a past** (`analyticsFor`): `limitAt` returns `null` for a
   window that closed before the budget was created; the open window is `partial` (drawn, never
   judged); a window is `reliable: false` when any budget's `categories` or `period` changed
   after it closed (`lastChangedAt`, which **ignores the create row**). Adherence counts only
   `!partial && reliable && cap > 0`. Read-only — it materialises nothing.
10. **`name = ''` is legal only for a top-level, all-spending budget** (the migrated v1 row;
    UI shows "Personal budget"). Sibling names are unique case-insensitively via a unique index
    on `(org, coalesce(parent_id, org), lower(name))` → 409 `name_taken`.
11. **Alert dedupe key** is `${tier}:sb:${id}:${period}:${windowStart ?? "all"}:${amount}`.
    `sb:` keeps it out of the client-cap namespace; the amount re-arms the alert once when the
    limit changes. State `none` (closed/ended/upcoming/amount ≤ 0) is never alerted.
12. **`GET/POST /api/budgets` (+ `/overview`, `/detail`) must keep their v1 shape** — store-pinned
    native bundles read them. On a personal org they project `primaryBudget()` (now exactly the
    overall budget) and a v1 POST upserts that row. Change the projection, not the shape.
13. **`/api/spending-budgets` is in `ALWAYS_FETCH`** because its GET calls
    `materializeDueRecurring` first. It is also in `MONEY_PREFIXES` (every money write drops
    it); a budget write drops only `/api/spending-budgets`, `/api/audit`, `/api/notifications`.
    `/analytics` needs no rule of its own — `startsWithAny` matches the prefix, which also
    (harmlessly) makes the read-only analytics GET always revalidate. `npm run cache:check`
    re-derives both from source.
14. **Categories match on `lower(btrim(coalesce(category,'')))`** — `categoryKey()` is the JS
    twin (ASCII spaces only). Any rename goes through `planCategoryRename` before writing and
    `applyCategoryRename` after; it checks **every** sibling group, top level included (the
    overall budget skipped), and a clash is a 409 with nothing applied.
15. **The audit trail IS the history.** Every create/update/delete calls `logAudit` with
    `entityType: "budget"` and `diffFields(AUDITED)`; the detail's "Changes", the detail chart
    (`amountAt`) and all of analytics (`limitAt`, `lastChangedAt`) read it. No second table.
    **Role gates:** `canWrite` for POST/PATCH/reorder, `canDelete` for DELETE; scope by `orgId`
    from `requireAuth`, never by user.

## Traps

- **`date_trunc`'s unit must be INLINED, not bound** (`truncBucket` uses `sql.raw`). Drizzle
  numbers each bind separately, so a bound unit makes `date_trunc($1, …)` in the SELECT and
  `date_trunc($2, …)` in the GROUP BY two different expressions and Postgres refuses the whole
  query ("must appear in the GROUP BY clause") — a live 500 on the detail chart until it was
  inlined. The unit comes from a fixed set, never from a request; keep it that way.
- **Two drag scopes, never one.** `BudgetList`'s `DragScope` is instantiated per scope — the
  top-level rows, and each expanded parent's children — with `@dnd-kit/core` only (no
  `@dnd-kit/sortable`), matching WealthPage/CardsTab. A cross-scope drag would silently
  re-parent; re-parenting is a dialog action. Keep ⋯ Move up/down as the accessible path, and
  keep the reorder POST one `UPDATE … FROM (VALUES …)`.
- **Rate copy is one sentence per rhythm**, not an interpolated period word:
  `budgets.authored.{daily,weekly,monthly,yearly}` and `budgets.rate.*`. In several languages
  that word is an adjective and "You set €500 monthly" comes out ungrammatical. A new rhythm
  means a new sentence in each family, in all 8 locales.
- **Neon HTTP has no interactive transactions.** The rename plans everything up front so a
  refusal leaves nothing half-written; `applyCategoryRename` is a `Promise.all`, not atomic, and
  the close cascade is a second UPDATE — keep both idempotent.
- **Drizzle `date` columns are strings** (`YYYY-MM-DD`), `numeric` too — `toRecord` does
  `Number(amount)`; compare dates as strings, never `new Date(x)` (timezone shift). Days are
  **UTC** throughout (`todayUtc`, `budgetWindow`), and the UI renders them `timeZone: "UTC"`.
- **Postgres 23505 arrives wrapped** (DrizzleQueryError → `.cause`). `isSiblingNameClash`
  walks four levels of `cause` and also matches the index name in the message.
- **Plural keys:** `daysLeft`, `subBudgets`, `closedCount`, `analytics.lastN`,
  `analytics.judgedOver` are `_one/_other` in en; `i18n:check` requires the en forms in every
  locale (Arabic has six plural categories).
- **The detail page paints from the list's cached body** (`peekApiCache`) before its own request
  lands, and hands that `all` list to the dialog for the sibling-claim check — keep the list row
  a superset of what both need. `once` with no dates = all-time = the unbounded aggregate.

## Where everything lives

| Concern | Path |
|---|---|
| Schema | `spendingBudgets` in `src/lib/db/schema.ts`; `drizzle/0067_spending_budgets.sql` (journal `when` 1788345426500), `drizzle/0068_budget_view_and_overall.sql` (`…510`; 0059–0061 retired) |
| Types + pure | `SpendingBudget`, `SpendingViewWindow`, `SpendingBudgetAnalytics*`, … in `src/lib/types.ts`; `src/lib/budget.ts` + `spending-budget.test.ts` (v1: `budget.test.ts`) |
| SQL + predicates | `api/_lib/spending-budgets.ts`, `api/_lib/budget-spend.ts` (+ `.test.ts`) |
| Routes | `api/_routes/spending-budgets{.ts,/[id].ts,/reorder.ts,/analytics.ts}`; order in `api/index.ts`: `reorder` → `analytics` → `:id` → base |
| v1 caps + shim | `api/_routes/budgets{.ts,/overview.ts,/detail.ts}`; `src/pages/ClientBudgetDetailPage.tsx`; `src/components/budget/ClientBudgetsSection.tsx` |
| Alerts · rename hooks · cache | `api/_lib/notify-budget.ts` (+ `.test.ts`; callers `transactions{.ts,/[id].ts,/group.ts}`, `recurring-materialize.ts`) · `api/_routes/categories/{[id],combined}.ts` · `src/lib/api-cache.ts` (`ALWAYS_FETCH`, `MONEY_PREFIXES`, `FANOUT`) |
| UI | `src/pages/{BudgetsPage,BudgetDetailPage}.tsx`; `src/components/budget/{BudgetList,BudgetRow,BudgetAnalyticsPanel,SpendingBudgetDialog,BudgetsCard,budget-format,budget-icons,BudgetIconPicker,drag-handle}` |
| Hint · onboarding | `src/components/transactions/tx-form.tsx` (`spendingHint`, loaded by `AddTransactionDialog.tsx`) · `src/components/onboarding/MoneyWizard.tsx` (personal → `POST /api/spending-budgets`, name `''` = the overall budget) |
| i18n · e2e | `budgets.*` (incl. `budgets.{analytics,authored,rate}.*`) + `budget.<period>` in `src/lib/i18n/locales/*.json` · `e2e/budgets.spec.ts` |

## Verifying a change

- **Unit (DB-free, in the gate):** `npx vitest run src/lib/spending-budget.test.ts
  api/_lib/budget-spend.test.ts api/_lib/notify-budget.test.ts src/lib/api-cache.test.ts`.
  Extend `spending-budget.test.ts` for any window/scope/conversion/allocation/`limitAt`
  change; `budget-spend.test.ts` pins the predicate count and rendered SQL.
- **Anything that touches SQL:** a throwaway `*.test.ts` against the `.env.local` Neon DB —
  `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local` —
  calling `listBudgets` / `analyticsFor` / `seriesFor` on a real org. **Always exercise
  `analyticsFor` and the detail series against Postgres**: the `date_trunc` grouping is the
  one thing no unit test can catch. Delete it before committing.
- **Route checks without a browser:** a scratch `*.mjs` with `node -r dotenv/config …
  dotenv_config_path=.env.local` — `@clerk/backend` `createClerkClient()` → `users.getUserList`
  → `sessions.getSessionList({ userId, status: "active" })` → `sessions.getToken(id, "")` gives
  a Bearer the dev server accepts; send `x-org-id` on every call. Never commit it.
- **Browser:** `npx playwright test e2e/budgets.spec.ts` — dialog create, a real expense moving
  the figure, the view toggle re-expressing rows **with no request**, inline add-sub on a budget
  with none, close/reopen + the closed fold + the cascade, reorder grips, the analytics tab,
  44 px targets at 430 px, business client caps. Then **look at** `/budgets`,
  `/budgets?tab=analytics` and `/budgets/:id` in both workspace types.
- `npm run cache:check`, `npm run i18n:check`, `npm run typecheck`, then
  `npm run cap:sync:android && npm run cap:sync:ios` for any UI change.

## Adding to it

- **A field:** schema + hand-written migration (bump the journal `when`), `toRecord`,
  `parseBudgetInput`, `AUDITED` in `[id].ts`, the `SpendingBudget` type, the dialog, and
  `budgets.history.field.<name>` in i18n.
- **A route:** handler in `api/_routes/spending-budgets/`, import in `api/index.ts`, register
  **before** `["spending-budgets", ":id"]`; add its write path to `FANOUT` and, if its GET
  materialises money, to `ALWAYS_FETCH`.
- **Copy:** every string under `budgets.*` in `en.json` first, then all 7 other locales
  (`scripts/i18n-merge.mjs` for bulk). API error codes map to sentences in
  `budget-format.tsx budgetErrorMessage`.
- **A new spend surface:** reuse `budgetSpendPredicates`/`budgetSpendSignedAmount` and, for
  totals, add a `SpendItem` to the existing statement rather than a new query.
