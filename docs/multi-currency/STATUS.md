# Multi-currency implementation status

Last updated: 2026-09-09

## Completed this pass: money-writing and completed transfers

- Completed transfers now accept distinct source and destination native amounts and calculate the immutable effective rate as **destination currency units per one source currency unit** with Decimal arithmetic.
- A source-account transfer fee is persisted on the logical transfer, posted as a separate outgoing standard transaction, linked by `transfer_id`, and is the only part classified as expense. The source balance deduction is principal plus fee; the destination balance addition is its recorded native principal.
- The transfer header, both principal legs, optional fee leg, both balance updates, and existing caller-supplied statements are one `dbBatch` operation.
- Recurring Space auto-save no longer writes transfer legs and balances sequentially. It delegates completed occurrences to `createTransfer`; cross-currency schedules are rejected until the rule stores an explicit rate policy or destination fact.
- Normal recurring occurrences and super-admin-created transactions now snapshot currency. The shared `currencyForFinancialWrite` helper makes an account authoritative and uses reporting currency only for detached rows.
- Transaction edits re-derive currency from the selected account. Transfer legs cannot be independently edited, trashed, bulk-trashed, or restored through transaction endpoints.
- Account creation exposes searchable native-currency selection, defaulted to reporting currency. Empty bank/cash accounts can change currency; the selector is locked when transaction history exists and explains the create-and-transfer alternative.
- The existing transfer wizard supports recorded sent amount, received amount, optional source fee, and displays the effective rate for different-currency accounts. Same-currency input remains a single principal amount.

## Financial writers audited

| Writer | Currency/balance owner | Current status |
|---|---|---|
| Normal transaction create/edit | Selected account; reporting currency when detached | Currency derived server-side; edit balance updates retain legacy sequential behavior |
| Split/refund create | Each selected account | Account currency snapshot present; existing multi-account group arithmetic retained |
| Trash/restore/bulk trash | Original transaction account | Transfer-linked rows blocked; non-transfer updates retain existing per-account sequential operations |
| Opening balance/balance adjustment | Wealth account | Account currency snapshot present |
| Manual transfer/card payment/autopay | Source and destination accounts | Authoritative atomic completed-transfer service |
| Space manual transfer | Space and selected account | Authoritative service; cross-currency manual transfer supported |
| Space recurring auto-save | Source and Space | Authoritative service; same currency only until an explicit recurring FX policy exists |
| Regular recurring materialization | Rule/account | Currency snapshot required; missing legacy currency pauses the rule |
| Super-admin transaction create | Detached client/org | Reporting-currency snapshot added |
| Card statements | Card account | Statements do not create principal ledger rows; autopay delegates to transfer service |
| Imports | No active financial importer found in the audited server routes | No change |

## Transfer lifecycle delivered

- `completed`: same-currency and cross-currency principal, optional source fee, native balance effects, and effective-rate provenance work atomically.
- `planned` and `pending`: may be created as intent records with no ledger rows and no cleared-balance effect.
- `planned -> pending`, `planned -> completed`, `planned -> cancelled`, `pending -> completed`, and `pending -> cancelled` are enforced. Completion uses a row lock and performs status, legs, fee, balances, and audit writes inside one PostgreSQL function call.
- `cancelled`: retains intent for audit and has no ledger or cleared-balance effect. Completed transfers cannot be relabelled cancelled.
- Reversal/correction: a completed transfer can be reversed once. The reversal swaps the original native principal amounts, refunds the original source fee as a fee refund, links through `reverses_transfer_id`, and never consults current FX.
- Logical trash/restore: operates on every transaction linked by `transfer_id` and all affected balances in one database function. Transfer legs remain protected from transaction-level mutation. Reversal-linked transfers are immutable.
- Forecast presentation for planned/pending transfers remains deferred because ProfitSync has no general cleared-versus-forecast transaction model yet.

## Remaining unsafe writers

- `api/_routes/transactions/[id].ts`: ordinary transaction edit still updates the row and old/new account balances as separate statements.
- `api/_routes/transactions/bulk-delete.ts` and `api/_routes/trash/restore.ts`: ordinary grouped transaction balance changes remain sequential.
- `api/_lib/recurring-materialize.ts`: ordinary recurring transaction insert and balance update remain sequential under the existing idempotency model.
- `api/_routes/transactions/group.ts`: split creation uses existing multi-statement sequencing.
- Planned/pending forecast reads and recurring cross-currency rate policies remain unavailable.
- Currency dual-write remains to be verified for budget creation/update and any future import writer before nullable columns can be enforced.

## Completed in this pass

- Phase 0: strengthened accounting foundations with mixed-currency Money invariants while preserving existing same-currency transfer, refund, card-payment, balance-adjustment, and trash/restore tests.
- Phase 1: added exact decimal Money and FX-rate primitives using `decimal.js`.
- Phase 2 foundation: added nullable native currency metadata to wealth accounts and deterministic legacy backfill SQL.
- Phase 3 foundation: added nullable transaction currency snapshots, deterministic account/client-org backfills, and currency snapshots on normal transaction, split transaction, system adjustment, and transfer write paths covered in this pass.
- Phase 4 foundation: added `reporting_currency`, initialized from the legacy organization currency, and kept `currency` as the compatibility API name. Reporting-currency edits do not update accounts or transactions.
- Phase 5 foundation: removed the one-cash-wallet restriction and retained a unique guard only for the lazily provisioned `Cash in Hand` row.
- Phase 6 foundation: added a provider-neutral FX-rate contract, normalized pair/date requests, current-rate TTL caching, immutable historical caching, concurrent request coalescing, and immutable FX snapshot storage.
- Phase 7 foundation: added a first-class logical transfer record above the ledger legs. New same-currency transfers write the header, both linked legs, both balance changes, and any caller-supplied side effects in one atomic batch.

## Schema migration

`drizzle/0069_multi_currency_foundation.sql` adds:

- `organizations.reporting_currency`
- `wealth_accounts.currency_code`
- `transactions.currency_code`
- `recurring_rules.currency_code`
- `spending_budgets.currency_code`
- ISO-shape check constraints
- deterministic backfills without changing any numeric value
- a default-cash uniqueness index compatible with multiple named cash wallets

Columns intentionally remain nullable for the audit/dual-write rollout. Do not add `NOT NULL` until production audit queries report no gaps or ambiguity.

`drizzle/0070_fx_rate_snapshots.sql` adds immutable dated FX observations with explicit provider, source type, fallback provenance, and high-precision rates.

`drizzle/0071_logical_transfers.sql` adds the logical transfer header and links transaction legs through `transfer_id`. Its legacy backfill only accepts unambiguous two-leg, same-date, same-amount, same-currency groups; uncertain historical groups remain untouched for audit.

`drizzle/0072_transfer_execution.sql` adds effective-rate provenance, source-fee facts, and same-currency principal checks.

`drizzle/0073_transfer_lifecycle.sql` adds one-reversal uniqueness, logical deletion state, and row-locked database functions for atomic completion, legal unsettled transitions, and logical trash/restore.

## Tests and checks

- Focused accounting suite: 35 tests passed.
- Money and migration suite: 18 tests passed; FX-provider tests also remain green in the full suite.
- TypeScript typecheck: passed after the transfer-lifecycle stage.
- ESLint: passed.
- Full unit suite: 77 files and 897 tests passed.
- ESLint, cache-map validation, ESM extension validation, and serverless-function boot validation passed; 229 reachable serverless modules booted.
- Production build passed; it retains the existing large-vendor-chunk and stale Browserslist-data warnings.
- i18n parity passed with the existing Arabic extra-key warnings.

## Review fixes (2026-09-09, Claude)

An independent review of this working copy found three blockers; all are fixed here.

1. **Migrations could not run.** `scripts/db-migrate.mjs` uses the drizzle neon-http migrator, which splits a file on `--> statement-breakpoint` and sends every chunk as ONE query; Neon's HTTP endpoint rejects multi-statement queries (verified with `select 1; select 2;`). Migrations 0069-0073 had no breakpoints. Every statement now has one, each plpgsql function is its own chunk, and every `ADD CONSTRAINT` is preceded by `DROP CONSTRAINT IF EXISTS` so a re-run after a partial failure cannot wedge the deploy (the migrator records a migration only after the whole batch succeeds - see the header of 0067).
2. **Factory reset broke.** `transfers.source_account_id` / `destination_account_id` were `ON DELETE restrict`; `api/_lib/account-reset.ts` deletes wealth_accounts directly, so any workspace with a transfer could no longer be reset (verified in a scratch schema). They now CASCADE with the accounts, as the debts tables do; `transactions.transfer_id` and `transfers.reverses_transfer_id` are `ON DELETE set null` so no teardown order is ever blocked. `src/lib/db/schema.ts` matches.
3. **Existing transfer behaviour regressed.** `DELETE /api/transactions/:id`, `POST /api/trash/restore`, `POST /api/transactions/bulk-delete` and `PATCH /api/transactions/:id` returned 409 for any transfer leg, which broke the committed `e2e/credit-card.spec.ts` trash/restore/edit scenario and the account page's edit flow while the replacement routes had no UI. Those endpoints now DELEGATE to the transfer service: a leg with a `transfer_id` trashes/restores the WHOLE logical transfer through `set_transfer_trashed` (legs + fee row + balances, atomically); bulk delete does this once per transfer and excludes those rows from the standard path so nothing is reversed twice; legacy legs without a header keep the old group path. PATCH still allows relabelling a leg (description, category, tags) and refuses amount/date changes with `transfer_mutation_requires_transfer_service`.

Also: the five new UI strings are translated in all eight locales (`wealth.accountCurrency`, `accountCurrencyLocked`, `transferReceivedAmount`, `transferFeeAmount`, `transferFeeSummary`), and the migrations were rehearsed against the shared Neon dev database (see the session notes for the result).

## Known issues and migration risks

- Admin-created detached transactions, all recurring-rule creation paths, and some legacy/background writers still need explicit currency dual-write coverage before `transactions.currency_code` can become non-null.
- Wealth, dashboard, budgets, analytics, Money Flow, client totals, alerts, exports, and card/Space displays still aggregate or format with the organization currency. Mixed-currency UI must remain disabled until their conversion policies are implemented.
- Cross-currency transfers are deliberately rejected with `cross_currency_required`; unequal legs, rate snapshots, fee handling, and pending/completed lifecycle behavior are not yet implemented.
- Existing account currency edits are blocked when transaction history or currency-sensitive card/Space configuration exists. UI messaging still needs localization.
- Monetary database columns remain `numeric(20,2)`; widening to normal-fiat scale is pending a dedicated migration review.
- The repository dependency audit reports pre-existing package vulnerabilities after dependency installation; no automatic audit fix was applied.

## Remaining phases

1. Complete currency dual-writes for recurring, admin, Space auto-save, cards, budgets, imports, and every transaction writer; add migration audit tooling and enforce non-null after shadow validation.
2. Add account/Space/card native-currency selectors and render all local values with account currency.
3. Connect a production FX data adapter and define stale/missing-rate API contracts and historical fallback policy.
4. Implement atomic cross-currency transfers, fee transactions, status lifecycle, forecast balances, and corrections.
5. Implement server-side current wealth conversion and native totals.
6. Convert budgets, analytics, Money Flow, dashboard, client totals, alerts, exports, and historical reporting.
7. Route recurring transfer materialization through the authoritative atomic transfer service.
8. Add first-class native-currency reconciliation records.
9. Perform final unsafe-sum/static audit, native sync, E2E verification, and migration rehearsal.

## Release gate

Do not enable mixed-currency account creation in production until every aggregate either groups by currency or converts explicitly, and every financial writer snapshots currency. Same-currency behavior remains the production-safe mode during this staged rollout.
