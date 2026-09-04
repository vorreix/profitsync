---
name: budget-v2
description: Use when working on ProfitSync budgeting — the /budgets screen, plans, periods, envelopes, categories, commitments/bills, occurrences, savings funds, debt, rollover, reallocation, overspend resolution, refunds/settlements, period close, restatement, the v1→v2 migration, or anything touching the budget_plans/budget_envelopes/budget_periods/budget_allocations/budget_commitments/budget_occurrences/budget_fund_entries/budget_period_snapshots/budget_events/budget_exclusions/transaction_settlements tables or GET /api/budgets. Establishes the three-layer engine, the money invariants that must not break, and how to verify a change without a committed DB test.
---

# ProfitSync Budget v2

The human explainer is **`docs/budget/BUDGETS.md`**. The authority on behaviour is
**`docs/budget-v2/SMART_HYBRID_BUDGET_SPEC.md`** (23 sections; cite section numbers in
code comments). Delivery history and the defects each phase found are in
**`docs/budget-v2/PHASE2.md`**. This skill is the **operating guide**.

## Mental model

- **Three layers, strictly.** Pure math (`src/lib/budget-math.ts`, zero imports) → DB
  engine (`api/_lib/budget-engine.ts`, SQL only, no arithmetic) → routes
  (`api/_routes/budgets/v2*`, no SQL). The split exists because the repo's unit gate is
  DB-FREE: every formula is testable only if it lives in layer 1.
- **Four numbers** answer "can I spend this?": `available_now`, `reserved`,
  `safe_to_spend` (with a `binding` reason), `forecast_balance`. `reserved` is money still
  in the account — **never** treat it as spent.
- **Sections are not interchangeable.** Only `flexible` has a target and can be *over*; a
  `commitment`/`debt` envelope has none, so its negative remaining means **unpaid**. Each
  section has its own vocabulary (§8.7) and blurring them is the bug class this design
  exists to remove.
- **Reads never write.** A GET detects staleness and reports `sync_required`;
  `POST /api/budgets/v2/sync` is the ONLY writer.
- **An occurrence is an EXPECTATION.** Settling a bill records that money moved; it must
  never move money or create a transaction.

## Invariants — do not break these

1. **Netted, then floored ONCE**: `max(0, Σplanned − Σspent − Σpending)`. Never
   `Σ max(0, remaining)` — that lets an overspend hide behind an untouched envelope. Pinned
   by `budget-math-phase2.test.ts` (Groceries 300/400 + Dining 200/0 → **100**, asserted
   *not* to be 200).
2. **Reallocation leaves total planned unchanged**, which is what makes `safe_to_spend`
   invariant under it. `reallocate.ts` asserts this before writing.
3. **`categoryKey()` ≡ SQL `lower(btrim(coalesce(category,'')))`** and the functional index
   `transactions_category_key_idx`. JS `.trim()` would be WIDER (it strips U+00A0), giving
   two different answers for one number. Same mirror discipline applies to the fund-balance
   SUM ≡ `fundBalanceFromEntries`.
4. **One category → one envelope.** Enforced before the insert, and the 409 names the
   owning envelope.
5. **The catch-all cannot be removed** — without it the plan has no ceiling and
   safe-to-spend silently degrades to cash-only.
6. **A closed period is read from its SNAPSHOT**, never recomputed. Restatement writes a
   NEW version and keeps the old one; it does **not** recompute cash (`available_now` is a
   past reading, carried forward and flagged `as_at_close`).
7. **Σ settlements ≤ expense.amount**, enforced on write (a CHECK cannot express a
   cross-row aggregate). A linked inflow stops counting as a provisional refund, so the
   same money is never counted twice.
8. **Only a CONFIRMED contribution may be called "set aside"** (§8.9.1). Auto-reserving is
   fine; auto-crediting a fund is not. Confirming is reserved-NEUTRAL by design.
9. **A failed audit write BLOCKS the edit** (decision D-6, reversing v1's swallowed
   `recordHistory`).
10. **A one-time bill never ages out** (D-17). The 365-day/12-occurrence cap is
    recurring-only.
11. **Nothing is ever converted.** All amounts pass through `amountInPlanCurrency()` (still
    the identity); a plan-vs-org currency mismatch is REPORTED via
    `detectCurrencyMismatch`, never guessed. Neither `transactions` nor `wealth_accounts`
    has a currency column — do not invent an FX table.
12. **`GET /api/budgets` keeps its v1 shape indefinitely** (native shells run store-pinned
    bundles). It returns `{ budgets, account_type }` — `projectPlanToV1` already returns
    that envelope, so return it as-is; wrapping it again empties every installed app.

## Traps that have already bitten

- **`db.batch()` is broken on the retry-wrapped client.** Use **`dbBatch()`** from
  `src/lib/db/index.ts`. Drizzle hands `client.transaction` an array whose elements must be
  lazy `NeonQueryPromise`s; the retry wrapper returns plain promises, so `db.batch` throws
  at runtime and no type check or unit test can see it.
- **Business orgs get NO plan.** A per-client cap is not a household envelope (§13.10.7).
- **Unique violations arrive wrapped.** Drizzle wraps the driver error in a
  `DrizzleQueryError` whose `message` is the SQL text — the constraint name is on `.cause`.
  Walk the chain (`violates()`), or every clash surfaces as a 500 instead of a 409.
- **Every query is an HTTPS round trip (~200 ms locally).** Count **round trips**, not
  milliseconds. An N+1 over 40 envelopes is the named regression (#13); the open-period
  read must stay flat in envelope count (currently 17 trips at 15 *and* 41 envelopes).
- **Account-less transactions count** when a plan names no accounts (`wealth_account_id` is
  nullable and the tx form allows "no account").
- **`transactions` has no `organization_id`** — scope through `clients`, or you sum every
  workspace.
- **Notifications are async.** `sync` can return before the insert lands (they are
  fire-and-forget), and `notifyOrgMembers` suffixes the dedupe key with the recipient id.
- **drizzle returns `date` columns as `'YYYY-MM-DD'` strings**; the RAW neon client returns
  `Date` objects parsed at LOCAL midnight, which shifts a day east of UTC. In ad-hoc
  scripts, `select start::text`.

## Where everything lives

- Pure math + tests: `src/lib/budget-math.ts`, `budget-math.test.ts`,
  `budget-math-phase2.test.ts`.
- Engine: `api/_lib/budget-engine.ts`. Notifications: `api/_lib/notify-budget-v2.ts`
  (v2) and `notify-budget.ts` (v1 caps). v1 adapter: `api/_lib/budget-v1-adapter.ts`.
- Routes: `api/_routes/budgets/v2.ts` + `v2/{sync,envelopes,envelopes/[id],
  envelopes/[id]/detail,envelopes/reorder,commitments,commitments/[id],occurrences,
  reallocate,refunds,contributions,prompts}.ts`.
- UI: `src/pages/BudgetOverviewPage.tsx`, `BudgetKeyPage.tsx` (legacy URLs),
  `src/components/budget/*`, `src/lib/budget-context.tsx`.
- Schema: `src/lib/db/schema.ts`; migrations `drizzle/0059_*` (10 tables), `0060_*`
  (`transaction_settlements` + the category index).
- Migration: `scripts/migrate-budgets-v2.ts` (`--dry-run` / `--org` / `--limit`).
- Database: the Neon instance in `.env.local` (no local Postgres — `npm run db:migrate` reads
  `.env.local` itself).

## Verifying a change

The unit gate is **DB-FREE**, so:

1. **Formulae** → extend `src/lib/budget-math*.test.ts` (committed, no DB).
2. **SQL / route behaviour** → write a **throwaway** script against the Neon database in
   `.env.local` (`node --env-file=.env.local --import tsx <script>.ts`), run it, and **delete it
   before committing**. Never commit a DB-touching test.
3. **UI** → `e2e/budget-v2.spec.ts` is committed and runs locally with the dev Clerk keys:
   ```bash
   export CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY"
   npx playwright test --project=chromium e2e/budget-v2.spec.ts
   ```
4. **Look at the rendered page**, not only the figures. Three real defects — a literal
   `{{amount}}`, a false "Held in a Space", and a pending bill shown as an overspend — were
   invisible in correct-looking numbers.
5. **`i18n:check` proves a string EXISTS, not that it reaches the screen.** Load the page in
   the target language and assert its script is actually rendered.

## Adding to the plan

- New i18n keys go under `budgetV2.*` in `en.json` first, then all 7 locales.
  `scripts/i18n-merge.mjs` needs **`--overwrite`** to change an existing value (its default
  is backfill-only and silently drops corrections). Regenerate native-review prompts with
  `scripts/i18n-review-prompts.mjs`; terms needing review are listed in
  `docs/budget-v2/I18N_REVIEW.md`.
- New route → handler in `api/_routes/budgets/v2/`, import in `api/index.ts`, and add the
  entry **static before dynamic at the same depth**.
- Budget icon is **MoneyBag** everywhere. A piggy bank means **Spaces**.
- Reuse `src/lib/spaces.ts` for fund goal math — it is pure `(balance, goal, targetDate)`
  and never assumed a Space.

## Deferred, and what gates each (Phase 5)

Multicurrency (§12 M1–M12) · credit cards (liability accounts) · real pending
transactions (`transactions.status`) · loan principal/interest split · business envelope
plans (§23 re-evaluation) · retiring the v1 adapter (**decision D-14**: <1 % of installs on
a pre-v2 bundle AND ≥180 days) · export/reports (after snapshots accumulate).

The v1 tables stay **read-only but intact** for the whole window, and dropping them is the
point of no return (§13.9) — gate it on the flag at 100 % for ≥30 days, zero v1-handler
traffic, and a verified backup.
