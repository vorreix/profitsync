# Handoff prompt — ProfitSync multi-currency

Paste everything below the line into a fresh Claude Code session opened in the
working copy. It is written for an agent that has never seen this work.

---

You are picking up a **finished feature awaiting review** in the ProfitSync
working copy at `C:\Dev\ProfitSync-Codex`, on branch `feat/multi-currency`,
which is pushed and open as a pull request against `dev`. The original clone at
`C:\Dev\ProfitSync` is untouched and must stay that way. The repo is PR-only
into `dev` and Maqbool owns the merge — never push to a shared branch.

## What is already done — do not rebuild it

Multi-currency accounts, wealth and transfers are implemented, verified in a
real browser against `npm run dev`, and green on the full pre-commit gate plus a
production build (925 unit tests / 78 files). Read these first, in this order:

1. `docs/multi-currency/REPORT.pdf` (or `REPORT.html`) — what shipped, with screenshots.
2. `docs/multi-currency/ARCHITECTURE.md` — the design and the money invariants.
3. `docs/multi-currency/STATUS.md` — a per-writer audit table.
4. `.claude/skills/budgets/SKILL.md` and `.claude/skills/data-fetching-and-cache/SKILL.md`
   before touching budget math or adding any fetch.

The model in one paragraph: every account has a **native currency**
(`wealth_accounts.currency_code`) and every ledger row snapshots the currency it
was posted in (`transactions.currency_code`). A workspace has a **reporting
currency** (`organizations.reporting_currency`, `currency` kept as the
compatibility alias). Native balances are facts and never move because a rate
moved. Reports convert **each row at its own date** through the SQL function
`reporting_amount()` (migration 0074) and return `currency` plus
`excluded_count`; a row with no rate for its day is EXCLUDED and counted, never
treated as 1:1. A transfer is a logical `transfers` row above the two ledger
legs, keeping both native amounts and the rate it actually got; the fee is a
separate ordinary expense.

## The state of the database

Migrations **0069 to 0074 are already applied** to the shared Neon dev database
in `.env.local`. Do not re-run or re-order them. Every statement is separated by
`--> statement-breakpoint` because the neon-http migrator sends each chunk as
one query, and every `ADD CONSTRAINT` is preceded by `DROP CONSTRAINT IF EXISTS`
so a partial failure cannot wedge a deploy. Never run `npm run db:push`.

**Hazard for teammates:** these migrations carry `when` values from
`1788980400000` upward in `drizzle/meta/_journal.json`. Any other branch whose
new migration has a LOWER `when` will be silently skipped on a database that has
already run these. Check `drizzle/meta/_journal.json` before merging anything
that adds a migration — in particular Maqbool's Debt & Loans branch.

## What is left, in priority order

1. **Native parity.** `npm run cap:sync:android` and `npm run cap:sync:ios` have
   NOT been run. CLAUDE.md makes this mandatory before the task is considered
   done, because the Android and iOS shells wrap the same `dist/` bundle.
2. **Address review feedback** on the open PR, then let Maqbool merge it.
3. **Destination-side fees.** Only a source-side fee is modelled. A fee the
   receiving bank deducts needs its own row on the destination account.
4. **Historical net-worth chart.** Rate snapshots are stored per day, so the
   data is there, but no chart values balances at each point's own date yet.
5. **Currency-movement attribution.** Separating "my net worth changed because I
   saved" from "because the rate moved" is designed for but not built.
6. **A foreign key on `clients.organization_id`.** It has none, which is why the
   dev database holds ten orphaned client rows. Unrelated to this feature, worth
   a follow-up ticket.

## Rules you must not break

- Never sum amounts in different currencies. Every aggregate either groups by
  currency or converts explicitly through `reporting_amount()`, and reports what
  it excluded.
- A rate never changes a stored balance or a historical row.
- A cross-currency transfer keeps BOTH native amounts and its own effective
  rate. Never re-derive one side from today's market rate.
- Transfers are not income or expense. Only the fee is spending.
- FX providers receive a currency pair and a date. Never an amount, an account
  name, or a description.
- Relative imports inside `api/` keep the `.js` extension; call `serialize()` on
  every row; scope every query by `orgId`; all user-visible text goes through
  `useTranslation` with the key added to all eight locale files.

## How to verify your own changes

```
npm run typecheck && npm run lint && npx vitest run
npm run i18n:check && npm run cache:check
node scripts/check-esm-extensions.mjs && node scripts/boot-functions.mjs
npm run build

npm run dev -- --port 5173 --strictPort          # then, in another shell:
PLAYWRIGHT_BASE_URL=http://localhost:5173 npx playwright test e2e/multi-currency.spec.ts --project=chromium
```

`e2e/multi-currency.spec.ts` is the money-path suite: it pins that native
balances survive rate changes, that a cross-currency transfer keeps both amounts
and charges only the fee, that reversal restores both sides exactly once, and
that a scheduled transfer moves nothing until completed. Its two wallets are
DURABLE FIXTURES — a wallet that took part in a reversed transfer can only be
archived, never deleted, so the spec reuses them instead of creating new ones.

## Two things that will trip you up

- The unit gate is DB-free, and `src/test-setup.ts` pins the UI language by
  stubbing `navigator` BEFORE importing i18n. Money formatting follows the
  reader's language, so without that pin the same assertion passes on a US CI
  runner and fails on an Italian laptop. Do not remove it.
- A reversal chain is immutable, so its rows can never be trashed. On a FREE
  workspace they permanently consume the 30-transactions-per-client quota, which
  is why the reversal test reuses an existing pair rather than minting one.
- `e2e/smoke.spec.ts` "create a client" already fails on the untouched original
  repo: its locator resolves to the hidden floating-action-button item named
  "Add Client" before the visible "New Client" button. Not caused by this work.
