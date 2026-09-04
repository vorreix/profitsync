# Handoff prompt — reviewing / continuing the credit-card accounts work

Paste the block below into a fresh Claude Code session in the ProfitSync repo.

---

You are reviewing and continuing PR **"feat(wealth): credit-card accounts as a liability"** (branch `feat/credit-card-accounts`, stacked on `feat/smart-hybrid-budget-v2` / PR #364, targeting `dev`). Read these first, in order:

1. `docs/credit-cards/CREDIT_CARDS.md` — the design, the sign convention, why statements are a snapshot table with derived payments.
2. `src/lib/credit-card.ts` and `src/lib/tx-classify.ts` — every accounting rule; nothing else may reason about the liability sign.
3. `api/_lib/tx-sql.ts` — the SQL twin of the reporting rules; `api/_lib/tx-sql.test.ts` fails if a route re-inlines `case when type = 'incoming'`.
4. `api/_lib/credit-card.ts` — statement filing (`ensureStatements`) and the card summary (`loadCardSummary`).
5. `e2e/credit-card.spec.ts` — the scenario the feature is defined by.

## The invariants you must not break

1. `wealth_accounts.current_balance` is the SIGNED asset-equivalent value for every type. A credit card's balance is negative when money is owed. Never store debt as a positive balance, never add a second balance column, never read the sign in a component — use `cardDebt()` / `cardCredit()` / `availableCredit()` / `signedBalanceFromDebt()`.
2. A card purchase is an ordinary `outgoing` on the card. A card payment is `POST /api/wealth/transfer` with the card as `to_account_id`. It is never an expense, never a category, never a budget line.
3. `kind='refund'` is an INCOMING row that nets against EXPENSE (never income). Budget v2 treats it as a CONFIRMED refund. If you add an aggregate anywhere, import `incomeSumSql` / `expenseSumSql` / `pnlKindFilter` from `api/_lib/tx-sql.ts`.
4. Statements (`credit_card_statements`) are immutable snapshots. What is paid is DERIVED: `statementRemaining(statement_balance, Σ incoming transfer legs dated after closing_date)`. Do not add a `paid_amount` column or an allocation table.
5. Delete / restore / purge / edit must reverse or re-apply exactly the original effect once, for ALL legs of a group (see the fix in `api/_routes/trash/restore.ts`).
6. Available credit is presentation only. Net worth is Σ signed balances (`summarizeWealth` in `src/lib/wealth.ts`).
7. The unit gate is DB-free. Route behaviour is verified against the local Docker Postgres (`docs/budget-v2/LOCAL_DB.md`) with the dev server and Playwright — never against the shared Neon dev database. Migration 0062 is hand-written; `drizzle-kit generate` is out of sync with 0060+, so write SQL + journal entries by hand and bump `when`.

## How to verify anything you change

```bash
docker start ps-budget-pg ps-budget-neonproxy          # local DB (creds in docs/budget-v2/.env.localdb)
set -a; . docs/budget-v2/.env.localdb; set +a
export DATABASE_URL="postgres://$LOCAL_DB_USER:$LOCAL_DB_PASSWORD@db.localtest.me:4444/$LOCAL_DB_NAME?sslmode=require"
export NODE_TLS_REJECT_UNAUTHORIZED=0
node scripts/db-migrate.mjs
VITE_DISABLE_DEV_TOOLS=1 npm run dev -- --port 5173 --strictPort &
PLAYWRIGHT_BASE_URL=http://localhost:5173 CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
  npx playwright test --project=chromium e2e/credit-card.spec.ts e2e/smoke.spec.ts
npm run i18n:check && npm run lint && npm run typecheck && npx vitest run
```

In e2e specs, never send `x-org-id` from `localStorage.ps_active_org` — the saved storage state carries the stale business org; rely on the server's profile fallback after `/api/organizations/switch`.

## What to look at in review

- `api/_routes/transactions/[id].ts`: the new 400 when a transfer leg's kind / direction / account is edited. Confirm no existing UI path hits it.
- `api/_lib/budget-engine.ts` `spendByCategoryKey` / `spendForKeys`: refunds as confirmed. Cross-check with `SMART_HYBRID_BUDGET_SPEC.md` §8.8.
- `api/_routes/trash/restore.ts`: group-wide restore now also applies to splits (matches delete).
- `api/_lib/ai.ts`: `kind` / `to_account_name` / `statement_payment`; `fillStatementAmount` only fills when the destination is a card with a statement on record and something left to pay, and flags `amount_source: "statement"`.

## Deliberately deferred (do not "fix" silently)

Statement edit/delete UX · minimum payment / interest / grace period · per-card currency (no currency column on accounts yet; the math takes plain numbers) · translating the ~100 new keys (English placeholders in 7 locales, per repo convention) · the bank-page account summary including system rows (pre-existing).

Do not commit or push to shared branches; work on a branch and open a PR into `dev`. Report outcomes faithfully — if a test fails, say so with the output.
