# ProfitSync multi-currency accounts, wealth, and transfers

Status: living architecture report. It describes the staged implementation on branch `dev` and the remaining production design. This document does not itself change production behavior.

## A. Current state

ProfitSync is an organization-scoped React/Vite application backed by Vercel functions, Drizzle, and Neon Postgres. The staged implementation now distinguishes `organizations.reporting_currency` from native account currency while retaining `organizations.currency` as a compatibility alias. `CurrencyProvider` still exposes one reporting currency to many legacy UI consumers, so consolidated readers remain single-currency and must not yet be treated as correct for mixed accounts.

`wealth_accounts` represents bank, cash, Space, and credit-card liability accounts. It now has nullable `currency_code` during migration and keeps `opening_balance` and `current_balance` as `numeric(20,2)`. New accounts and Spaces snapshot native currency; account creation exposes searchable selection; currency changes are blocked once currency-sensitive history exists. The current balance remains materialized, so every transaction create, edit, trash, restore, recurring occurrence, and completed transfer must update it. Opening balances and manual balance adjustments remain system transactions excluded from profit-and-loss and budgets.

`transactions` stores an account reference, direction, `numeric(20,2)` amount, date, `kind = standard | transfer | refund`, nullable currency snapshot, and nullable logical `transfer_id`. Account-linked create and edit paths increasingly derive currency from the account through a shared server helper; migration audit is still required before `currency_code` becomes non-null. `group_id` continues to group split payments and pair principal transfer legs for backward compatibility.

`createTransfer` is the authoritative completed-transfer primitive. It writes a logical transfer header, source and destination principal legs, an optional source-fee expense leg, both native balances, and caller-supplied transactional side effects in one `dbBatch`. Cross-currency transfers preserve both native amounts and store the effective rate as destination units per source unit with `rate_source='effective_transfer'`. Transfers remain excluded from income, expense, budgets, global transaction lists, and analytics; only the fee is standard outgoing expense. Credit-card payments, autopay, manual Space moves, and recurring same-currency Space auto-saves delegate to this service. Cross-currency recurring rules are rejected until they store an explicit rate policy or destination fact.

Reporting is centralized in useful places. `api/_lib/tx-sql.ts` defines income and expense SQL; `api/_lib/budget-spend.ts` defines the seven budget predicates and signed refunds. However, analytics, Money Flow, budget queries, client totals, dashboard filters, wealth summaries, Spaces, and card summaries all sum raw native amounts. They are correct only under the current single-currency invariant.

Credit cards are negative-balance liability accounts. Card limit, balance, statement snapshot, payments, available credit, and cycle activity all implicitly use the organization currency. There is no general loan, mortgage, personal debt, investment, or valuation entity. Such obligations can only be approximated outside the current model.

Reconciliation is not first-class. Editing an account's current balance writes the new stored balance and inserts a `Balance Adjustment` system transaction for the difference. There is no statement balance check, reconciliation boundary, or lock that distinguishes reconciled history.

The logical transfer API now supports planned and pending intent without ledger effects, legal transitions to pending/completed/cancelled, one-time native-amount reversal, and logical trash/restore. Completion and trash/restore use database row locks and execute their status, ledger, balance, and audit effects inside one PostgreSQL function call. Forecast presentation remains unavailable because ProfitSync has no general cleared-versus-forecast transaction model. Unsafe individual transfer-leg edit/trash/restore operations remain blocked. Future recurring occurrences remain rules until lazily materialized; once materialized, a dated ordinary transaction immediately affects stored current balance even when its date is in the future, and alert code compensates by subtracting future deltas to derive today's balance.

## B. Problems

The following list describes the remaining production risks. Several persistence foundations now exist, but nullable rollout columns and legacy readers mean the system is not yet safe to expose as a fully mixed-currency product.

1. Changing `organizations.currency` changes symbols without converting data. A stored `5000` can be relabelled from EUR to INR.
2. Currency columns now exist for accounts, transactions, Spaces, budgets, and recurring rules, but they remain nullable for migration and not every writer/reader has completed explicit-currency validation.
3. Completed cross-currency transfers preserve unequal native principals and now have lifecycle, reversal, and logical trash/restore operations. Destination fees, forecast reads, and recurring FX policies remain incomplete.
4. Every raw `sum(amount)`, numeric `reduce`, and `summarizeWealth` call becomes invalid when rows can have different currencies.
5. The transfer core uses Decimal arithmetic, but `Number`, `parseFloat`, arithmetic, and `toFixed(2)` remain in ordinary transaction, balance, card, budget, Space, and reporting paths. The database also retains two-decimal monetary columns.
6. Historical reporting has no rate date, provider, rate snapshot, or missing-rate state.
7. Fees cannot be separated from transfer principal, so they cannot affect expense and net worth correctly.
8. There is no distinction between cleared and forecast balances at the transaction level.
9. Balance adjustment is useful but insufficient for audit-safe reconciliation and correction of completed transfers.
10. A single active Cash account per workspace prevents separate EUR Cash and INR Cash wallets.

Major mixed-currency breakpoints are `api/_lib/tx-sql.ts`, `api/_lib/budget-spend.ts`, `api/_lib/spending-budgets.ts`, `api/_routes/analytics.ts`, `api/_routes/flow.ts`, transaction summaries and client aggregates, `src/lib/wealth.ts`, `WealthPage`, `Dashboard`, `MoneyFlowPage`, `AnalyticsPage`, Space totals, card cycle/statement queries, alerts, and every component formatting values from `useCurrency()`.

## C. Existing reusable pieces

- Keep wealth accounts and their signed-balance convention. Add native currency; do not replace the ledger.
- Keep the two transaction legs and atomic `dbBatch` behavior for completed transfers.
- Keep `kind='transfer'`, `group_id`, transfer exclusion from P&L, refund classification, system-row classification, and budget predicates.
- Keep credit cards as liability accounts and cards as identity/attribution only.
- Keep server-side organization scoping, audit logs, soft deletion, recurring idempotency, cache invalidation tables, and locale infrastructure.
- Keep the workspace currency setting, but rename its product meaning to reporting currency.

## D. Proposed architecture

Use explicit currency at every persistence boundary and a small typed money layer. Currency should live primarily on the account, while transaction and transfer rows snapshot it for historical safety.

```ts
type CurrencyCode = string // validated uppercase ISO 4217; branded at boundaries
type DecimalString = string
type Money = Readonly<{ amount: DecimalString; currency: CurrencyCode }>
```

Money operations must require matching currencies. `addMoney(EUR, INR)` must fail. Conversion must be explicit and return both the converted Money and rate metadata. APIs should carry decimal strings; formatting may accept them. Adopt a decimal arithmetic library shared by client and server. Do not use `Number` in ledger, FX, balance, budget, or report calculations.

Keep Postgres `numeric`, expanding monetary columns to `numeric(28,8)` and FX rates to `numeric(30,14)`. This is less disruptive than migrating every field to integer minor units, supports currencies with 0–3 ISO minor digits, and leaves room for future asset quantities. Validate display/input scale from currency metadata. Integer minor units are excellent for fixed two-decimal payment systems but awkward for ProfitSync's existing decimal schema, zero/three-decimal currencies, and potential assets.

An account native balance changes only through completed ledger movements or an explicit reconciliation adjustment. Market rates never update it.

## E. Transfer model

Add one logical `transfers` row and retain two transaction legs. The transfer owns intent and FX facts; the legs own account balance effects.

For a same-currency completed transfer, source and destination principal amounts must match. For cross-currency transfers, each leg has its own amount and native currency. The effective rate is derived as destination principal divided by source principal in a documented quote direction, then stored as a snapshot. Never infer one leg later from a current market rate.

Fees should be separate ledger transactions linked to the transfer through `transfer_fees`. This supports multiple fees and currencies without widening `transfers` repeatedly. A source fee is an outgoing standard transaction on the source account; a destination-deducted fee is an outgoing standard transaction on the destination account after the transfer credit. Both count as expense. A fee paid from another owned account references that account. A fee withheld before receipt should record the gross destination principal and a destination fee when the statement exposes both; if only the net receipt is known, store the net as destination principal and mark fee details unknown rather than inventing them.

Status is `planned | pending | completed | cancelled`. Only completed legs affect cleared balances. Planned and pending transfers contribute to a separately derived forecast balance. Cancellation before completion creates no balance movement. Corrections to completed or reconciled transfers use reversal and replacement groups linked by `reverses_transfer_id`; they do not mutate historical legs in place.

Deleting one transfer leg independently must be forbidden. Trash, restore, and purge operate on the logical transfer and every principal/fee leg atomically.

## F. Exchange-rate architecture

Create a server-side `FxRateProvider` interface with `getCurrentRate(pair)` and `getHistoricalRate(pair,date)`. Providers receive currency pairs and dates only. They never receive balances, account names, or transaction descriptions.

Persist normalized immutable snapshots in `fx_rate_snapshots`: base currency, quote currency, rate, rate date/time, provider, fetched time, and source type (`provider | manual | effective`). Cache current rates with a short TTL and historical daily rates indefinitely. Deduplicate pair/date/provider fetches. Derive inverse rates from one snapshot when safe and record the derivation.

Three rate purposes must remain distinct:

- Market/current: current consolidated wealth and approximate account equivalents.
- Historical/reporting: transaction-date budgets, income, expenses, and historical charts.
- Actual/effective: cross-currency transfer facts. These never change after completion.

Current consolidated values may use the latest cached rate, but responses must include `as_of`, `provider`, and `stale`. Missing rates produce partial totals with an explicit list of excluded currencies. ProfitSync must never silently treat 1 INR as 1 EUR or label a partial total as complete.

Offline clients may show the last cached consolidated result and rate age. Financial data stays memory-only under the current cache policy; if offline persistence is later desired, it requires an encrypted local-data decision rather than placing balances in ordinary localStorage.

## G. Wealth and net worth

Return a structured wealth summary from the backend:

- native totals grouped by currency and asset/liability class;
- each account's native balance;
- optional reporting-currency equivalent with rate metadata;
- converted assets, converted liabilities, and consolidated net worth;
- completeness and stale-rate flags.

`netWorth = sum(converted assets) + sum(signed converted liabilities)` under the current signed-balance convention. Rate lookup is by currency pair and valuation date. Same-currency values require no FX snapshot.

Historical net-worth points must value balances as of each point date using rates for that date. Do not apply today's rates to 2022. Separate change into net cash flow and currency movement. “Currency movement” is valuation, not income or expense. This attribution can be deferred until historical balance reconstruction exists, but the rate snapshots and APIs should support it from the start.

## H. UX

Account creation asks for currency once, defaulted from reporting currency or inferred from country. Normal transactions inherit account currency and do not show a currency picker. An account card shows the native balance prominently and `≈ reporting amount` only when currencies differ, with a visible stale/as-of indicator when necessary.

The transfer form adapts automatically. Same currency asks for one amount. Cross currency asks for sent and received amounts; entering either plus a rate calculates the third value. Directly entering sent and received computes the effective rate. The confirmation shows principal, fees, total source deduction, destination receipt, and date in ordinary language.

The dashboard leads with consolidated net worth, then native totals by currency, assets/liabilities, and currency distribution. A secondary explanation separates money saved/spent from currency movement. Avoid accounting terms such as debit and credit in user flows.

The organization setting becomes “Reporting currency.” Changing it changes only reporting conversions and future default account currency. Existing account and transaction currencies remain unchanged.

Account currency may be changed only while the account has zero non-system financial rows and no statements, cards, transfers, recurring rules, reconciliation records, or attachments tied to currency-sensitive history. Otherwise offer “Create a new account in another currency” and an opening transfer/migration workflow.

## I. Integration impact

Budgets get an explicit currency, defaulting to reporting currency. Foreign transactions count at transaction-date historical rates. A missing rate makes the affected budget result incomplete and visible; it does not drop the row silently. The existing seven predicates and one-aggregate-query model remain, but queries must aggregate reporting amounts rather than raw native amounts.

Income, expense, savings, category reports, monthly/yearly reports, and cash flow use transaction-date rates into the report currency. Transfers contribute zero; fees contribute expense. Native-currency drilldowns remain available. Current account totals and net worth use valuation-date market rates.

Credit limits, statement balances, available credit, purchases, and payments remain in the card account's native currency. Bank-to-card payments are transfers. Cross-currency card payments use the cross-currency transfer model; issuer conversion charges are fee transactions.

Spaces need native currency and may accept same- or cross-currency transfers. Recurring transfers need source amount/currency and destination amount/rate policy. A scheduled cross-currency transfer should not freeze an invented received amount unless the user supplied one; it may use “calculate at completion” with an estimate clearly marked.

General loans and debts should be added later as liability wealth accounts with native currency, not mixed into the first FX migration. A future subtype/config table can hold principal, rate, lender, and schedule while the ledger continues to hold signed balances.

Reconciliation occurs in account currency. Add balance-check records containing expected native balance, observed native balance, difference, date, and generated adjustment transaction. Reconciled completed movements should be corrected by reversal/replacement.

## J. Database and persistence changes

Recommended minimum schema:

1. `organizations.reporting_currency` (initially copied from `currency`; retain the old API alias during migration).
2. `wealth_accounts.currency_code NOT NULL`, plus widened balance/goal/limit columns.
3. `transactions.currency_code NOT NULL`, `status`, `transfer_id`, and widened amount. Currency must equal its account currency whenever an account is present.
4. `recurring_rules.currency_code`, destination amount/rate policy fields for cross-currency transfers, and explicit posting behavior.
5. `spending_budgets.currency_code NOT NULL`.
6. `transfers`: id, org, source/destination account ids, source/destination principal amounts and currencies, status, initiated/effective dates, effective rate and direction, rate source/snapshot id, note, reversal link, actor timestamps.
7. `transfer_fees`: transfer id, account id, amount, currency, treatment/source/destination/third-account, category, transaction id.
8. `fx_rate_snapshots`: pair, rate, rate date/time, provider, source type, fetched time, uniqueness/indexes.
9. `account_balance_checks`: account, native currency, expected, observed, difference, statement date, adjustment transaction, actor timestamps.

Add database checks for uppercase three-letter currency codes, positive principal/rates, distinct transfer accounts, legal statuses, matching same-currency principals, and completed-transfer required fields. Application validation remains necessary for cross-row account/currency relationships; enforce critical invariants in the atomic write helper.

## K. Migration strategy

1. Add nullable currency columns and new tables without changing reads.
2. Backfill every existing account from its organization's current currency. Backfill transactions from their linked account; only detached rows fall back to organization currency. Backfill cards/statements through their account, budgets from organization currency, and recurring rules from their account.
3. Audit before constraints: no unassigned currencies, no grouped transfer with unequal same-currency legs, no orphan transfer legs, stored balances matching the ledger policy where derivable, and no invalid currency codes.
4. Create `transfers` rows for existing two-leg `kind='transfer'` groups, preserving ids/dates/amounts. Mark them same-currency completed. Flag malformed groups for manual review; never guess.
5. Dual-read and dual-write behind a capability flag. Old native clients keep existing response fields and v1 budget shapes.
6. Compare old and new same-currency calculations in shadow mode. They must be exactly equal before rollout.
7. Make currency columns non-null and switch aggregate endpoints one surface at a time.
8. Only after all consumers use explicit currency should `organizations.currency` become an alias or be retired.

Never rewrite existing numeric amounts during backfill. Existing users retain exactly the same displayed results because account and reporting currency initially match.

## L. Edge cases

- Triangulated rates, inverse-rate rounding, weekends/holidays, provider corrections, and unavailable exotic pairs.
- Fees included in sent amount versus charged separately; destination deductions; fee refunds; multiple fee currencies.
- Overdrafts and positive credit-card balances under the signed-balance model.
- Partial settlement, delayed destination posting, and transfers spanning reporting periods.
- Account archived while a transfer is pending; currency change attempts with history.
- One leg imported before its counterpart; duplicate imports; same-day similar transfers.
- Refund in a different currency from the original purchase. It needs its own native amount and historical conversion; it must not reuse today's rate.
- A changed reporting currency must recompute views without rewriting historical native data.
- Stale/missing rates must propagate a completeness state through charts, budgets, alerts, exports, and notifications.

Future import matching should score account ownership, date proximity, descriptions, amount equality for same currency, plausible historical FX range for cross currency, and fee patterns. It should propose a match for confirmation rather than silently merging ambiguous rows.

## M. Test strategy

Core automated invariants:

- Adding Money with different currencies fails.
- Rates never mutate native amounts or balances.
- Same-currency transfer: source decreases, destination increases, income/expense zero, net worth unchanged.
- Cross-currency transfer without fee preserves both amounts and actual rate; P&L zero.
- Fee is the only expense and only economic reduction, in its account currency.
- FX valuation movement is never income or expense.
- Historical results do not change when a current rate changes.
- Pending/planned/cancelled transfers do not affect cleared balances; pending/planned affect forecast according to policy.
- Transfer writes, reversal, trash, and restore are atomic across all legs.
- Account reconciliation and card limits/statements remain native-currency calculations.
- Every mixed-currency aggregate either converts explicitly or returns grouped native totals; raw cross-currency sums are forbidden.

Scenario expectations:

| Case | Expected result |
|---|---|
| A EUR→EUR 300 | Source −300, destination +300; cash flow transfer; net worth 0. |
| B EUR 500→INR 51,350 | Preserve both and 102.70 INR/EUR; P&L 0; net worth approximately 0 at chosen valuation methodology. |
| C B plus EUR 5 source fee | Source −505, destination +51,350; expense EUR 5; net worth falls by fee value. |
| D destination fee INR 350 | Gross destination +51,700 and fee −350 when known; expense INR 350; displayed receipt 51,350. |
| E INR→EUR | Same rules with explicit rate direction; inverse display must not change stored rate facts. |
| F pending international | Cleared balances unchanged; forecast reflects explicit/estimated legs and marks estimate. |
| G cancelled | No ledger or cleared/forecast effect; intent retained for audit. |
| H edit completed | Unreconciled may atomically replace; reconciled uses reversal plus replacement. No partial balance update. |
| I historical FX | Each point/report uses its date's immutable rate snapshot. |
| J missing rate | Native values shown; consolidated result marked partial with excluded currency. |
| K offline cached | Last value shown with rate timestamp and stale badge; no claim of currentness. |
| L native equals reporting | No conversion or redundant approximate line. |
| M mixed assets/debts | Convert each currency group at valuation date, assets plus signed liabilities; preserve native breakdown. |
| N card payment | Bank outgoing transfer and card incoming transfer; purchase remains expense, payment adds none. |
| O INR expense in EUR budget | Account −INR native amount; budget expense equals transaction-date EUR conversion with rate metadata. |

Tests should be layered: pure decimal/Money/FX/transfer invariant tests; SQL rendering tests that pin currency-aware P&L and budget predicates; database integration tests for constraints and atomic batches; migration fixtures with malformed legacy groups; API contract tests; and Playwright tests for account creation, adaptive transfers, stale/missing rate states, reporting-currency changes, reconciliation, and mobile layouts. Add a static guard that rejects direct `sum(transactions.amount)` in reporting code unless grouped by currency or wrapped by the approved conversion expression.

## N. Implementation phases

0. **Partial:** freeze invariants in tests and build a mixed-currency fixture; migration audit queries and database integration fixtures remain.
1. **Partial:** Decimal Money and transfer/FX primitives exist; remaining money-critical helpers still need conversion away from floating point.
2. **Partial:** nullable account/transaction/budget/recurring currency columns and deterministic backfills exist; writer audit, shadow validation, and non-null enforcement remain.
3. **Partial:** reporting-currency semantics and safe bank-account currency UX exist; remaining account types and every native display need completion.
4. **Partial:** provider abstraction, immutable snapshots, and in-process caching exist; a production adapter and stale/missing-rate response contracts remain.
5. **Implemented foundation:** logical transfers and deterministic legacy-group migration exist; same-currency compatibility is retained.
6. **Partial:** completed cross-currency principal, source fee, adaptive sent/received UI, lifecycle transitions, native reversal, and logical trash/restore exist; destination fees, replacement workflow UI, and forecast presentation remain.
7. Convert current wealth/net-worth endpoints and UI, retaining native breakdowns.
8. Convert P&L, budgets, flow, client totals, alerts, exports, and historical reports using transaction-date rates.
9. Add reconciliation records, import matching hooks, forecast balances, and recurring cross-currency policies.
10. Add currency-movement attribution and general multi-currency liability/asset subtypes when product scope requires them.

Each phase should ship behind compatibility gates. Do not combine schema migration, transfer rewrite, and report conversion in one release.

## O. Files likely to change

Core schema and migrations: `src/lib/db/schema.ts`, `drizzle/*`, `src/lib/types.ts`.

New core modules: `src/lib/money.ts` expansion, `src/lib/currency.ts`, `src/lib/fx.ts`, `api/_lib/fx-provider.ts`, `api/_lib/fx-rates.ts`, `api/_lib/reporting-money.ts`, transfer and reconciliation helpers/routes.

Existing money paths: `src/lib/wealth-ledger.ts`, `api/_lib/wealth-accounts.ts`, `api/_routes/wealth/transfer.ts`, account create/edit routes, transaction create/edit/group/trash routes, `api/_lib/recurring-materialize.ts`, card and Space helpers.

Aggregates: `api/_lib/tx-sql.ts`, `api/_lib/budget-spend.ts`, `api/_lib/spending-budgets.ts`, `api/_routes/analytics.ts`, `api/_routes/flow.ts`, transactions/calendar/client summary routes, alerts and notification formatters.

Frontend: `src/lib/currency-context.tsx`, `src/lib/wealth.ts`, org settings/context, transaction forms, `WealthPage`, `WealthAccountDetailPage`, `Dashboard`, `AnalyticsPage`, `MoneyFlowPage`, budget components/pages, card/Space components, `TransferWizard`, account dialogs/comboboxes, and all localized money formatters.

Platform policy: `src/lib/api-cache.ts`, `scripts/check-cache-map.mjs`, i18n locale files, E2E fixtures, and native compatibility projections.

## P. Risks

The highest risk is a partially migrated system in which some queries convert and others sum native values. Next are double-applied stored-balance updates, orphaned transfer/fee legs, reinterpreted legacy amounts, current rates leaking into historical reports, and floating-point rounding differences between client and server.

Ordinary recurring materialization deserves special attention because its transaction and balance writes remain sequential. Recurring Space transfers now use the atomic transfer owner, but account adjustment, ordinary trash/restore, split edits, category budget aggregation, and cache invalidation still touch money through different paths. Every completed-transfer write must continue to have one atomic owner; other routes must call it rather than reproduce its logic.

Do not permit a currency migration when legacy transfer groups are malformed or when an account cannot be assigned deterministically. Surface an audit queue. A partial consolidated number must never be presented as exact.

## Q. Recommendation

Extend ProfitSync's existing account ledger rather than replacing it. Give each account an immutable native currency, snapshot currency on every financial row, introduce a logical transfer header above the existing legs, store actual transfer FX separately from market/historical valuation rates, and convert only at reporting boundaries. Use decimal strings plus exact decimal arithmetic, server-side rate snapshots, atomic transfer lifecycle helpers, and explicit incomplete/stale states.

This is the smallest architecture that remains financially correct. It preserves ProfitSync's strongest current choices—atomic same-currency transfers, signed card liabilities, derived budget spend, audit logs, and centralized P&L classification—while preventing EUR and INR from ever being added without an explicit rate and purpose.

# QUESTIONS / DECISIONS FOR CHATGPT

1. Should planned cross-currency transfers freeze a user-entered destination amount, or default to “use the rate at completion” with only an estimate beforehand? Recommendation: support both, defaulting to rate at completion.
2. For v1, should historical reports require provider historical rates, or may transactions imported without a rate use the nearest available daily rate and be visibly marked estimated? Recommendation: allow the nearest prior market day with an estimated marker; never use today's rate silently.
3. Should general loans and personal debts enter the first multi-currency release? Recommendation: no. Make the account/valuation model ready, then add liability subtypes after account currencies and transfers are stable.
