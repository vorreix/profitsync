# Handoff prompt — reviewing / continuing the Debt & Loans work

Paste the block below into a fresh Claude Code session in the ProfitSync repo.

---

You are reviewing and continuing PR **"feat(debts): Debt & Loans — liabilities, receivables, split repayments, payoff planner"** (branch `feat/debt-loans`, stacked on `feat/credit-card-accounts` / PR #365, which is stacked on `feat/smart-hybrid-budget-v2` / PR #364, all targeting `dev`). Read these first, in order:

1. `docs/debts/DEBTS.md` — the design: a debt IS a wealth account, terms vs derived facts, the payment-group model, the engine.
2. `src/lib/debt-math.ts`, `src/lib/debt-status.ts`, `src/lib/debt-planner.ts` — every calculation. Nothing else may compute interest, schedules, statuses or plans.
3. `api/_lib/debts.ts` — how a debt is loaded, how a repayment becomes ONE ledger group, how the overview is built.
4. `src/lib/credit-card.ts` and `api/_lib/tx-sql.ts` — the liability sign convention and the SQL reporting rules from PR #365; debts reuse them, they do not add new ones.
5. `e2e/debts.spec.ts` — the scenarios the feature is defined by.
6. `docs/debts/DEBTS_REPORT.pdf` — the engineering report with screenshots.

## The invariants you must not break

1. A debt is a `wealth_accounts` row with `type = 'loan'` (I owe, balance NEGATIVE) or `'receivable'` (owed to me, balance POSITIVE). `current_balance` is the signed asset-equivalent value for every type. Never add a second balance column, never store debt as a positive number on a loan, never read the sign in a component.
2. Borrowing is a TRANSFER debt → bank/cash (or a system Opening Balance when the money is already gone). It is never income. Principal repayment is a TRANSFER bank → debt. It is never an expense. Only interest / fees / other charges are expenses (standard outgoing rows on the paying account). Interest received on a receivable is income.
3. A recorded repayment is ONE ledger group (`group_id`): the principal transfer legs plus the expense legs. `debt_payments` is the allocation of that group, anchored on its first leg with a cascading FK; it is live only while the anchor transaction is not trashed. Trash / restore / purge must reverse or re-apply the whole group exactly once (`api/_routes/trash/restore.ts` restores every trashed leg — keep it that way).
4. `debt_details` holds TERMS only. Status, progress, this month's obligations, next payment, remaining interest, debt-free date, insights and plans are DERIVED (`src/lib/debt-status.ts`, `debt-planner.ts`). Do not persist a derived value.
5. Money math is integer cents (`toCents` / `fromCents`). Amortization uses `finalPaymentTolerance` so schedules converge without a phantom period. The minimum-only strategy has NO pool and NO rollover; the other strategies roll a cleared debt's payment into the next target.
6. No FX is invented. Totals are per currency (`owedByCurrency`); only same-currency debts are folded into `/wealth` net worth. A receivable is an asset but never liquid.
7. Debt accounts are hidden from `GET /api/wealth/accounts` (like Spaces) and rejected by the plain transaction endpoints. Everything goes through `/api/debts/**`.
8. The unit gate is DB-free. Route behaviour is verified against the local Docker Postgres (`docs/budget-v2/LOCAL_DB.md`) with the dev server and Playwright — never against the shared Neon dev database, and never with `db:push`. Migration 0063 is hand-written; `drizzle-kit generate` is out of sync with 0060+, so write SQL + journal entries by hand and bump `when`.

## How to verify anything you change

```bash
docker start ps-budget-pg ps-budget-neonproxy          # local DB (creds in docs/budget-v2/.env.localdb)
set -a; . docs/budget-v2/.env.localdb; set +a
export DATABASE_URL="postgres://$LOCAL_DB_USER:$LOCAL_DB_PASSWORD@db.localtest.me:4444/$LOCAL_DB_NAME?sslmode=require"
export NODE_TLS_REJECT_UNAUTHORIZED=0
node scripts/db-migrate.mjs                             # applies 0063 (64 migrations)
VITE_DISABLE_DEV_TOOLS=1 npm run dev -- --port 5173 --strictPort &
PLAYWRIGHT_BASE_URL=http://localhost:5173 CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
  npx playwright test --project=chromium e2e/debts.spec.ts e2e/credit-card.spec.ts e2e/smoke.spec.ts
npm run i18n:check && npm run lint && npm run typecheck && npx vitest run
node scripts/check-esm-extensions.mjs && node scripts/boot-functions.mjs
```

In e2e specs, pin the workspace explicitly: capture the org id returned by `useWorkspace(page, "personal")` and send it as `x-org-id` on every API call (both specs do this via `orgIdForApi`). Do not read `localStorage.ps_active_org` (stale business org in the saved storage state) and do not rely on the header-less server fallback (a 60-second per-user cache can still name the previous workspace right after a switch).

## What to look at in review

- `api/_lib/debts.ts` `recordDebtPayment`: the leg construction for owed vs receivable, the relative balance updates, the quota check, and how `next_due_date` / `remaining_installments` advance.
- `api/_routes/debts/[id].ts` PATCH: the reconcile path writes a system Balance Adjustment — confirm it never creates an income/expense row.
- `api/_routes/debts.ts` POST with `disbursement_account_id`: the borrowing transfer, and the Opening Balance path when it is absent.
- `src/lib/debt-planner.ts` `simulatePlan`: rollover order, the stabilisation branch in `affordability`, and the `assumedZeroRate` flag.
- `src/pages/WealthPage.tsx`: the "Owed" line and `summarizeWealth` — receivables added, liabilities subtracted, same currency only.
- `api/_routes/wealth/accounts.ts` GET exclusion list and the rejections in `api/_routes/transactions.ts` / `transactions/group.ts`.

## Deliberately deferred (do not "fix" silently)

Refinancing comparison UI (model supports `refinanced_into_account_id`) · calendar / planned-transaction integration · variable rates (simulated as fixed) · FX for totals · milestones beyond progress % · AI quick add splitting interest on a loan payment · human translations for the `debts` namespace (English placeholders in 7 locales, per repo convention).

Do not commit or push to shared branches; work on a branch and open a PR into `dev`. Report outcomes faithfully — if a test fails, say so with the output.
