---
name: budgets
description: Use when working on ProfitSync budgets — the /budgets pages, spending budgets and sub-budgets, category scope, the spending_budgets table, /api/spending-budgets, the v1 client spend caps at /api/budgets (and their personal-workspace shim), or budget notifications (budget_warning / budget_exceeded). Establishes the spend-is-never-stored / one-aggregate-statement / child-window-derived-on-read model and the invariants that keep every figure honest.
---

# ProfitSync budgets

**The rule everything here serves: a budget's number is always the ledger, never a copy of
it.** Nothing stores spend, nothing caches a total server-side, and every figure on every
surface (list, detail, chart, dashboard card, form hint, alert) is the same SQL over the
same seven predicates. Plain-English guide: `docs/budget/BUDGETS.md`.

## Mental model

Three layers, same split as the alerts rail — because the unit gate is DB-free, money math
is only testable if it lives in layer one:

| Layer | File | Owns |
|---|---|---|
| **Pure** | `src/lib/budget.ts` ("Spending budgets" section) | windows (`budgetWindow`, `windowsBack`), phase/days/pace, `budgetState`, `categoryKey` + scope helpers, `tightestBudget` (the form hint), `amountAt` (limit in effect at an instant, from the audit trail). No DB, no React; shared by API and client. |
| **SQL** | `api/_lib/spending-budgets.ts` | `loadRecords` → `withSpend` → `listBudgets`; `sectionSummaries`; `seriesFor`, `recentFor`, `historyFor`; `parseBudgetInput` + `checkRelations`; `planCategoryRename`/`applyCategoryRename`; the v1 bridge (`primaryBudget`, `toV1Period`, `fromV1Period`). Predicates come from `api/_lib/budget-spend.ts`. |
| **Routes** | `api/_routes/spending-budgets.ts`, `spending-budgets/[id].ts`, `spending-budgets/reorder.ts` | auth + role + compose + `logAudit`. |

- **Spend is never stored.** `spending_budgets` holds name, limit, period/dates, categories,
  status, position. Everything derived (`spent`, `remaining`, `ratio`, `state`, `window`,
  `per_day_left`, `other_spent`) is computed per request for `today` (UTC).
- **One aggregate statement.** `spendByItem` projects the ledger once (signed amount, date,
  category key) and gives every item — each budget, each parent's `rest:<id>` remainder,
  each section's union — its own `sum(...) filter (where <window> and <scope>)` column.
  Items with a lower bound share one statement (keeps the `(client_id, date)` index); the
  all-time ones (`once` with no start) share a second; both run concurrently.
- **A sub-budget has no window of its own.** `loadRecords` overwrites a child's
  period/start/end with its parent's on every read; the DB forbids dates on a child.

## Invariants — do not break these

1. **Every spend query goes through `budgetSpendPredicates` + `budgetSpendSignedAmount`.**
   Seven predicates: org via the clients join, client not trashed, client **not closed**, tx
   not trashed, `kind in (standard, refund)`, outgoing-or-refund, `is_system = false`.
   Refunds subtract; transfers (card payments) never match; card purchases do.
   `budget-spend.test.ts` asserts the count and the rendered SQL — extend it, never bypass it.
2. **A child's window is derived on read, never stored.** Don't add a "sync children" write;
   the 201/PATCH bodies rebuild the record from the parent for the same reason.
3. **Sibling sub-budgets are disjoint; a child's scope ⊆ its parent's** (an all-spending
   parent accepts anything); a child names ≥ 1 category; depth is 1; a budget with children
   cannot become a child. All of it is `checkRelations`, run on POST and PATCH with the
   *whole* org's records — call it on any new write path.
4. **Section money is never a sum of rows.** Union filter for spend; Σ limits only when the
   counted scopes are pairwise disjoint (`limit: null` otherwise); `once` gets no header money.
   The parent remainder is likewise a real `not in (...)` filter over ACTIVE children, not
   `parent − Σ children`.
5. **`name = ''` is legal only for a top-level, all-spending budget** (the migrated v1 row;
   UI shows "Personal budget"). Sibling names are unique case-insensitively via a unique index
   on `(org, coalesce(parent_id, org), lower(name))` → 409 `name_taken`.
6. **Alert dedupe key** is `${tier}:sb:${id}:${period}:${windowStart ?? "all"}:${amount}`.
   `sb:` keeps it out of the client-cap namespace; the amount re-arms the alert once when the
   limit changes. State `none` (paused/ended/upcoming/amount ≤ 0) is never alerted.
7. **`GET/POST /api/budgets` (+ `/overview`, `/detail`) must keep their v1 shape** — store-
   pinned native bundles read them. On a personal org they project `primaryBudget()` (top-level,
   all-spending, active; `''` first) and a v1 POST upserts that row. Change the projection,
   not the shape.
8. **`/api/spending-budgets` is in `ALWAYS_FETCH`** because its GET calls
   `materializeDueRecurring` first. It is also in `MONEY_PREFIXES` (every money write drops
   it); a budget write drops only `/api/spending-budgets`, `/api/audit`, `/api/notifications`.
   `npm run cache:check` re-derives both from source.
9. **Categories match on `lower(btrim(coalesce(category,'')))`** — `categoryKey()` is the JS
   twin (ASCII spaces only). Any category rename must go through `planCategoryRename` before
   writing and `applyCategoryRename` after; a sibling clash is a 409 with nothing applied.
10. **The audit trail IS the history.** Every create/update/delete calls `logAudit` with
    `entityType: "budget"` and `diffFields(AUDITED)`; the detail's "Changes" and the chart's
    per-window limit (`amountAt`) read it. No second history table.
11. **Role gates:** `canWrite` for POST/PATCH/reorder, `canDelete` for DELETE. Scope by
    `orgId` from `requireAuth` — never by user.

## Traps

- **Neon HTTP has no interactive transactions.** Reorder is one `UPDATE … FROM (VALUES …)`;
  the rename plans everything up front so a refusal leaves nothing half-written;
  `applyCategoryRename` is a `Promise.all` of updates, not atomic — keep writes idempotent.
- **Drizzle `date` columns are strings** (`YYYY-MM-DD`), `numeric` too — `toRecord` does
  `Number(amount)`; compare dates as strings, never `new Date(x)` (timezone shift).
- **Days are UTC.** `todayUtc()` and `budgetWindow` cut windows in UTC to match how the app
  stamps `transactions.date`; the UI renders them with `timeZone: "UTC"` (`fmtDay`). A local
  `Date` anywhere in the chain makes "1 Sep" print as 31 Aug west of Greenwich.
- **Postgres 23505 arrives wrapped** (DrizzleQueryError → `.cause`). `isSiblingNameClash`
  walks four levels of `cause` and also matches the index name in the message.
- **Plural keys:** `daysLeft`, `subBudgets`, `categoriesCount` are `_one/_other` in en.
  `i18n:check` requires the en forms in every locale (and lets `_zero/_one/_two` drop
  `{{count}}`); Arabic has six plural categories, so add `_zero/_two/_few/_many` there
  rather than relying on `_other`.
- **The detail page paints from the list's cached body** (`peekApiCache`) before its own
  request lands, and hands that `all` list to the dialog for the sibling-claim check — keep
  the list row a superset of what both need.
- `once` with no dates = all-time = the unbounded aggregate that reads the whole ledger.

## Where everything lives

| Concern | Path |
|---|---|
| Schema | `spendingBudgets` in `src/lib/db/schema.ts`; `drizzle/0067_spending_budgets.sql` (journal `when` 1788345426500; 0059–0061 retired) |
| Types | `SpendingBudget`, `SpendingBudgetDetail`, `SpendingBudgetsResponse`, … in `src/lib/types.ts` |
| Pure + tests | `src/lib/budget.ts`, `src/lib/spending-budget.test.ts` (v1: `budget.test.ts`) |
| SQL + predicates | `api/_lib/spending-budgets.ts`, `api/_lib/budget-spend.ts` (+ `.test.ts`) |
| Routes | `api/_routes/spending-budgets{.ts,/[id].ts,/reorder.ts}`; order in `api/index.ts`: `reorder` → `:id` → base |
| v1 caps + shim | `api/_routes/budgets.ts`, `budgets/overview.ts`, `budgets/detail.ts`; `src/pages/ClientBudgetDetailPage.tsx`; `src/components/budget/ClientBudgetsSection.tsx` |
| Alerts | `api/_lib/notify-budget.ts` (+ `.test.ts`); callers: `transactions.ts`, `transactions/[id].ts`, `transactions/group.ts`, `recurring-materialize.ts` |
| Rename hooks | `api/_routes/categories/[id].ts`, `categories/combined.ts` |
| Cache | `src/lib/api-cache.ts` (`ALWAYS_FETCH`, `MONEY_PREFIXES`, `FANOUT`), `api-cache.test.ts` |
| UI | `src/pages/BudgetsPage.tsx`, `BudgetDetailPage.tsx`; `src/components/budget/{SpendingBudgetDialog,BudgetRow,BudgetsCard,budget-format,budget-icons,BudgetIconPicker}.tsx` |
| Hint | `src/components/transactions/tx-form.tsx` (`spendingHint`), loaded by `AddTransactionDialog.tsx` |
| Onboarding | `src/components/onboarding/MoneyWizard.tsx` (personal → `POST /api/spending-budgets`, name `''`) |
| i18n | `budgets.*` (+ `budget.<period>` labels) in `src/lib/i18n/locales/*.json` |
| e2e | `e2e/budgets.spec.ts` |

## Verifying a change

- **Unit (DB-free, in the gate):** `npx vitest run src/lib/spending-budget.test.ts
  api/_lib/budget-spend.test.ts api/_lib/notify-budget.test.ts src/lib/api-cache.test.ts`.
  Extend `spending-budget.test.ts` for any window/scope/hint change; `budget-spend.test.ts`
  pins the predicate count and rendered SQL; `notify-budget.test.ts` greps the callers and
  the `sb:` key.
- **Anything that touches SQL:** a throwaway `*.test.ts` against the `.env.local` Neon DB —
  `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local` —
  calling `listBudgets` / `sectionSummaries` / `seriesFor` on a real org. Delete it before
  committing; the committed gate never opens a connection.
- **Route checks without a browser:** a scratch `*.mjs` run with `node -r dotenv/config …
  dotenv_config_path=.env.local` — `@clerk/backend` `createClerkClient()` →
  `users.getUserList({ emailAddress })` → `sessions.getSessionList({ userId, status: "active" })`
  → `sessions.getToken(sessionId, "")` gives a Bearer the dev server accepts; send `x-org-id`
  on every call (the e2e user's saved state pins the business org). Never commit it.
- **Browser:** `npx playwright test e2e/budgets.spec.ts` — dialog create, a real expense
  moving the figure, sub-budget from the detail, sibling clash 409, pause/resume, 44 px
  targets at 430 px, business client caps. Then **look at the rendered page** at
  `/budgets` and `/budgets/:id` in both workspace types.
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
  (`scripts/i18n-merge.mjs` for bulk) — `i18n:check` blocks the commit otherwise. Error codes
  from the API map to sentences in `budget-format.tsx budgetErrorMessage`.
- **A new spend surface:** reuse `budgetSpendPredicates`/`budgetSpendSignedAmount` and, for
  totals, add a `SpendItem` to the existing statement rather than a new query.
