# ProfitSync multi-currency: impact analysis and test plan

_Generated 2026-09-30 from 20 area analyses; every medium+ issue adversarially verified. Branch: feature/multi-currency-full-maqbool._

## 1. Executive summary

Multi-currency is built end to end. Accounts carry their own currency. FX snapshots feed a `reporting_amount` conversion path. Transfers are logical, with fees and reversal. Debts and budgets have their own currency. Even so, the work is **not ready to merge to `main`**. The analysis found **177 deduplicated issue groups: 5 critical, 31 high, 86 medium and 55 low**. Of these, 24 are flagged as deferred, meaning they are known and planned for a later phase. Of the 20 areas, 17 are partial, 2 are mostly ready (reporting, alerts) and 1 is missing entirely (FX and currency operations tooling). Three of the five criticals are not conversion bugs at all. They are gaps in the new transfer lifecycle that let a balance move twice: a trashed row can be deleted again (MC-002), a fee row escapes the transfer guards (MC-003), and a trashed transfer can be reversed (MC-004). The other two write money in the wrong currency. Onboarding leaves every new workspace reporting in USD (MC-001), and referral payouts mix currencies (MC-005).

Three patterns explain most of the high and medium groups:

1. **Display.** Amounts stored in a foreign account's own currency are shown with the workspace symbol. Many totals (cards, debts, Spaces, budgets, recurring, admin) add numbers in different currencies without converting them. The entry screens (the recurring dialog, the quick-add sheet, the AI assistant) have the same problem, so users type a value behind the wrong symbol and it is saved as-is.
2. **Currency identity.**
   - The two org currency columns drift apart (MC-033).
   - Business caps, quotations and newly created budgets have no currency of their own.
   - The account currency lock ignores rules and autopay that still point at the account.
3. **Operations.**
   - FX rates are fetched lazily inside user GETs, and nothing refreshes them on a schedule.
   - Historical rates exist only for the ECB currencies.
   - Rates fetched before ECB publishes are never replaced.
   - No tool exists to audit balances or to monitor FX.

Rollout has its own conditions. The migration journal has an ordering trap. Three data backfills must be checked. The native shells still run the bundle from before multi-currency. Once cross-currency data exists, rolling back is not safe.

| Area | Readiness | Critical | High | Medium | Low |
|---|---|---:|---:|---:|---:|
| Schema, migrations & data integrity | partial | 3 | 4 | 8 | 3 |
| FX rates & conversion core | partial | 0 | 3 | 11 | 5 |
| Wealth accounts, Spaces & transfers | partial | 2 | 5 | 10 | 3 |
| Transactions, splits, refunds, trash | partial | 1 | 6 | 11 | 4 |
| Recurring rules & materialization | partial | 0 | 5 | 7 | 2 |
| Cards & credit cards | partial | 0 | 7 | 3 | 1 |
| Debts & loans | partial | 0 | 4 | 7 | 5 |
| Budgets | partial | 0 | 3 | 11 | 2 |
| Reports: dashboard, analytics, calendar, flow, clients, search | mostly | 0 | 2 | 10 | 6 |
| Alerts rail, notifications, reminders, worker | mostly | 0 | 4 | 3 | 2 |
| Org settings, onboarding, quotations, billing, referrals, admin | partial | 2 | 6 | 8 | 3 |
| UI money-formatting sweep | partial | 0 | 8 | 15 | 5 |
| AI assistant, quick add, imports/exports | partial | 1 | 2 | 4 | 2 |
| API contracts, cache, i18n, native, mobile | partial | 1 | 5 | 9 | 5 |
| Cascade soft-delete writers (tags, clients) and Trash | partial | 2 | 2 | 6 | 2 |
| Concurrency, atomicity & DB-level currency invariants | partial | 3 | 3 | 11 | 2 |
| Refusal UX: error codes to translated messages | partial | 0 | 2 | 11 | 5 |
| Rollout, backward compatibility & native bundles | partial | 2 | 6 | 7 | 2 |
| FX & currency operations tooling | **missing** | 1 | 3 | 8 | 3 |
| Deterministic test harness & cross-feature e2e matrix | partial | 0 | 9 | 9 | 4 |
| **All groups (deduplicated)** | — | **5** | **31** | **86** | **55** |

*A group is counted once in every area it touches, so the area rows add up to more than the 177 groups.*

### Top risks

1. **MC-003** (critical): Transfer fee rows are guarded by `kind==='transfer'` rather than by `transfer_id`, so a fee can be edited, trashed or tag-deleted on its own. Reverse then refunds it a second time (`api/_routes/transactions/[id].ts:232`).
2. **MC-004** (critical): `reverseTransfer` never checks `deleted_at`. A trashed or partly trashed transfer can be reversed, and its money moves back twice (`api/_lib/wealth-accounts.ts:583`).
3. **MC-002** (critical): `DELETE /api/transactions/:id` reverses the balance again for a row that is already trashed, and PATCH moves the live balance of a trashed row (`api/_routes/transactions/[id].ts:229`).
4. **MC-001** (critical): Onboarding saves the chosen currency only to `organizations.currency`, so every new workspace reports in USD and its accounts are tagged USD (`api/_routes/onboarding.ts:54`).
5. **MC-005** (critical): Referral balances add rewards across currencies and take their currency label from the programme settings, so payouts are requested in the wrong amount and currency (`api/_lib/referral.ts:160`).
6. **MC-033** (high): `organizations.currency` and `reporting_currency` drift apart. The admin "Default currency" edit and `scripts/migrate-org-currency.ts` write only the old column, which debts, AI, PDFs and billing still read.
7. **MC-013** (high): Tag "delete with records" trashes single transfer legs directly. The result is one-sided trash, stuck restores and reversals that can't be restored (`api/_lib/tag-ops.ts:105`).
8. **MC-011** (high): The account currency lock counts only transaction rows. An empty account's currency can therefore change under a recurring rule, Space auto-save, debt repayment or card autopay that still points at it.
9. **MC-025** (high): Card autopay can be funded from a bank in another currency, and the wizard sets this up by default. Autopay then never pays and retries on every read (`api/_lib/cards.ts:280`).
10. **MC-007** (high): Dashboard KPIs, the chart and the breakdown count opening balances, balance adjustments and refunds as income (`src/pages/Dashboard.tsx:1072`).
11. **MC-021** (high, deferred): 125 of the 155 selectable currencies, including AED, SAR, KWD, QAR, PKR and LKR, have no source for historical rates. Their older rows are excluded from converted totals for good.
12. **MC-034** (high): Store-pinned native builds (1.4.0) and stale PWA builds (v0.14.1) display and write foreign-currency accounts wrongly, and the server can't tell them apart from current clients.

### Release gate (fix before merging to main)

Every item is either fixed, or accepted in writing with a named owner and a mitigation that users can see. The gate covers all criticals, all highs, five cheap or regression mediums, and the deploy conditions.

**A. Stop ledger corruption (must fix)**

1. [ ] **MC-002**: No balance movement on DELETE or PATCH of an already-trashed row.
2. [ ] **MC-003**: Every transfer guard (edit, trash, bulk delete, tag delete) recognises fee rows through `transfer_id`.
3. [ ] **MC-004**: `reverseTransfer` refuses trashed and partly trashed transfers.
4. [ ] **MC-012**, **MC-013**: Purge and the tag cascade handle the header, fee and legs together. **MC-114**'s dialog copy is corrected in the same change.
5. [ ] **MC-010**, **MC-036**: Transaction PATCH guards account type and system rows. Admin edit and delete go through the ledger services.
6. [ ] **MC-043**: Fix the regression where editing any transaction on an archived account returns 409.

**B. One currency source of truth (must fix)**

7. [ ] **MC-001**: Onboarding writes the reporting currency. **MC-032**: Provide a repair for workspaces already created in the wrong currency, or accept a manual runbook.
8. [ ] **MC-033**: The admin edit and `scripts/migrate-org-currency.ts` keep both columns in sync, or readers move to `reporting_currency`.
9. [ ] **MC-005**, **MC-110**: Keep referral balances per currency, and validate the reward currency. An invalid code currently crashes `/referrals` for every user.
10. [ ] **MC-011**, **MC-015**: The currency lock covers rules, auto-save, repayments and autopay. Editing a rule never silently switches its currency.
11. [ ] **MC-025**, **MC-026**: Refuse autopay funding from a bank in another currency, and fix the shortfall projection in alerts.
12. [ ] **MC-020**: Give the business per-client caps a currency, or accept that a reporting-currency change re-denominates them.

**C. Money shown or entered wrongly (must fix)**

13. [ ] **MC-007**, **MC-008**: System rows and refunds must not count as income or expense.
14. [ ] **MC-014**, **MC-016**, **MC-029**, **MC-030**: Entry screens show the currency the row is actually saved in.
15. [ ] **MC-006**, **MC-009**, **MC-017**, **MC-028**: Headline totals use the right symbol and never show unconverted sums.
16. [ ] **MC-027**: A reversed card payment must not silence overdue and due-soon alerts.
17. [ ] **MC-037**, **MC-038**: Two cheap, visible fixes. Remove the raw `fx.excludedNotice` key from every report screen, and stop showing old-currency figures under the new symbol after a currency change.

**D. Known deferred highs: fix or explicitly accept**

18. [ ] **MC-018**, **MC-019**: Budget currency is NULL on new budgets, and the budget UI ignores `budgetCurrency`.
19. [ ] **MC-022**, **MC-023**, **MC-024**: Card screens carry no currency, the summary strip sums without converting, and the liability account is always created in the reporting currency and can't be changed later. MC-024 is the urgent one: data created now can't be fixed.
20. [ ] **MC-021**: Accept only once MC-037 is fixed, so that excluded rows are visible to users.
21. [ ] **MC-031**: Money uses 2 decimals regardless of the currency (KWD, JPY).

**E. Rollout decisions**

22. [ ] **MC-034**: Set a minimum supported client version, or ship new native builds before enabling foreign accounts.
23. [ ] **MC-035**: Adopt a roll-forward-only policy. Rolling back to v0.14.1 after cross-currency data exists corrupts transfer state.

**Deploy-order and migration conditions**

24. [ ] **MC-115**: Apply 0069–0074 to every database **before** anything carrying origin/dev's 0075 reaches it. Run `npm run migrations:check` on the merge. After migrating, confirm on production that the 0069–0076 columns exist. Don't rely on the "up to date" message.
25. [ ] **MC-116**: Fix the 0071 backfill, or repair its output, for legacy transfers trashed before the migration. Otherwise restoring them returns 409.
26. [ ] **MC-117**: Before 0076 runs on production, audit foreign debts whose existing repayments span two currencies.
27. [ ] **MC-118**: Re-run the `currency_code` backfill after cutover to catch rows the old deployment wrote during the build window.
28. [ ] **MC-061**: Run a read-only report comparing balances with the ledger on production before and after the deploy. The dev DB already has drifted accounts and orphaned transfer rows.
29. [ ] **MC-120**: Run `npm run cap:sync:android` and `npm run cap:sync:ios`, bump the version and submit to the stores.

### Suggested fix order

Critical ledger fixes come first. After that, the risk of each wave grows in this order: server guards, then validation and additive migrations, then read-side maths, then a client-only sweep, then error UX, then infrastructure. Every group id appears exactly once.

**Wave 1: Stop ledger corruption and measure the damage.** These are server-only guards that refuse more; there is no schema change. Each critical bug is a missing guard in a shared service, so one fix covers every caller.
- MC-002, MC-003, MC-004, MC-132, MC-012, MC-013, MC-114, MC-165, MC-173, MC-010, MC-036, MC-068, MC-043, MC-096, MC-125, MC-158, MC-061

**Wave 2: One currency source of truth, locks and per-entity currencies.** Validation plus additive migrations.
- Workspace currency: MC-001, MC-033, MC-032, MC-038, MC-164, MC-109
- Account, rule and debt locks: MC-011, MC-054, MC-055, MC-062, MC-015, MC-075, MC-044, MC-042, MC-157, MC-126, MC-145, MC-172 (delete the unused helper)
- Entities that need their own currency: MC-018, MC-020, MC-024, MC-108
- Autopay funding: MC-025
- Referrals and billing: MC-005, MC-110, MC-163

**Wave 3: Server-side money maths.** Covers sums, classification, materialization and alerts; almost all of it is on read paths.
- Income classification: MC-007, MC-008, MC-052, MC-053
- Sums across currencies without converting: MC-006, MC-023, MC-028, MC-074, MC-080, MC-089, MC-090, MC-091, MC-092, MC-142, MC-111, MC-112, MC-124, MC-130, MC-171 (delete the unused helper), MC-040, MC-041, MC-045, MC-161
- Budgets and FX: MC-081, MC-082, MC-083, MC-084, MC-085, MC-149, MC-150
- "Excluded" notices: MC-037, MC-136, MC-137
- Alerts, cards, debts, auto-save: MC-026, MC-027, MC-087, MC-148, MC-094, MC-071

**Wave 4: UI money-formatting sweep.** Pass `currency_code` to every screen and format through `formatMoney`. This wave is client-side, so each batch ships with `cap:sync` for Android and iOS.
- API fields first: MC-050, MC-048, MC-022, MC-113
- Screens and notifications: MC-009, MC-017, MC-019, MC-073, MC-079, MC-049, MC-051, MC-086, MC-131, MC-135, MC-144, MC-129, MC-103, MC-138, MC-139, MC-140, MC-141
- Entry screens and dialogs: MC-014, MC-016, MC-088, MC-070, MC-072, MC-093, MC-078, MC-065, MC-134, MC-146, MC-147, MC-066
- Debt planner: MC-095, MC-143
- AI: MC-029, MC-030, MC-106, MC-107, MC-162

**Wave 5: Refusal UX and i18n.** Give refusals stable error codes and translate them in all 8 locales. Start with MC-063, because it unlocks the rest. This wave can run alongside Waves 3–4.
- MC-063, MC-152, MC-154, MC-064, MC-067, MC-069, MC-076, MC-077, MC-105, MC-133, MC-151, MC-153, MC-155

**Wave 6: FX engine and operations, concurrency hardening, rollout and tests.** The rollout items here are also release-gate conditions and are handled at deploy time, whatever wave is in progress.
- FX engine: MC-021, MC-031, MC-047, MC-097, MC-098, MC-099, MC-100, MC-101, MC-102, MC-123, MC-159, MC-166, MC-167, MC-169
- FX operations: MC-104, MC-039, MC-168, MC-127
- Concurrency and atomicity: MC-056, MC-057, MC-058, MC-059, MC-060, MC-046, MC-160
- Rollout and migrations: MC-115, MC-116, MC-117, MC-118, MC-119, MC-034, MC-035, MC-156, MC-120
- Tests: MC-121, MC-122, MC-128, MC-174, MC-175, MC-176, MC-177. Extending the MC-121 static check early, alongside Wave 3, keeps new unconverted sums from getting back in.
- Deferred feature: MC-170


## 2. How multi-currency works now

Every account has a native currency (`wealth_accounts.currency_code`); every ledger row snapshots its currency (`transactions.currency_code`). A workspace reports in `organizations.reporting_currency` (`currency` is the legacy alias). Reports convert each row at its own date via `reporting_amount()` and count rows with no rate as excluded. Net worth converts at the latest rate (`/api/wealth/summary`). Transfers are logical `transfers` rows with both native amounts, the effective rate and an optional fee expense. See ARCHITECTURE.md and STATUS.md.

## 3. Impact map (per area)

### 3.1 Schema, migrations & data integrity

**Readiness:** partial. The schema is in place. On the shared dev DB, migrations 0069–0076 are applied and `fx_rate_on`, `reporting_amount`, `complete_transfer`, `set_transfer_trashed` and `transition_unsettled_transfer` all exist. Every account, recurring rule and spending budget there has a currency, no transaction's currency differs from its account's, and no org has `currency` and `reporting_currency` out of sync.

The risk is in the code paths around the schema:
- Onboarding, the admin PATCH and a stale script write only the legacy `organizations.currency`. A new user who picks a non-USD currency therefore gets USD-tagged accounts.
- Transfer fee rows (kind `standard`/`refund`) get past every transfer-leg guard, so trashing the fee and then reversing the transfer creates money.
- `reverseTransfer` does not check `deleted_at`.
- The 0071 backfill gives trashed legacy transfers a live header, which blocks restoring them.
- Editing a row on an archived account fails with a misleading 409.
- Changing an account's currency ignores recurring rules that have not posted yet.

Deploy order is also a hazard. origin/dev already ships 0075 stamped above 0069–0074, so a database that runs dev's migrations first silently skips the whole multi-currency schema.

NOT NULL cannot be enforced yet. Spending-budget writers still write NULL currency, and 69 legacy transactions with no account have NULL currency on dev.

Money columns are `numeric(20,2)` and no writer checks decimal places. 3-decimal currencies (KWD/BHD/OMR/JOD/TND) lose their third digit, and a 3-dp outgoing amount leaves the balance 0.01 off the ledger (checked in Postgres: 98.77 vs 98.76). The existing unit tests for money, migration text, tx-sql, FX and ledgers pass (7 files, 75 tests).

#### What changes / what is affected

**Schema**
- `src/lib/db/schema.ts` — `organizations.currency` / `reportingCurrency` (L14-17) — ⚠️ partial — The org currency has two sources of truth. `reporting_currency` is nullable and every reader uses `coalesce(reporting, currency)`, but onboarding and the admin PATCH write only `currency`.
- `src/lib/db/schema.ts` — `wealthAccounts.currencyCode` (L171), `transactions.currencyCode` (L524), `recurringRules.currencyCode` (L633), `spendingBudgets.currencyCode` (L1239) — ⚠️ partial — Still nullable, with only an ISO-shape CHECK (0069). Dev DB: 0 NULL accounts, 0 NULL rules, 0 NULL budgets (but new budgets are written NULL), 69 NULL transactions (all with no account).
- `src/lib/db/schema.ts` — money columns `numeric(20,2)` (`transactions.amount` L521, `wealth_accounts` balances L172-173, rules L632, budgets L1238); transfers `numeric(20,4)` (L250-256) — ⚠️ partial — Every column is 2-decimal except transfers. `money.ts` caps transfers at 2 dp, so the 4-dp columns never hold more, and ordinary writers silently round anything past 2 dp.
- `src/lib/db/schema.ts` — `transfers` (L242-277), `transactions.transferId` (L510) — ✅ correct — Matches 0071-0073: rows cascade with the accounts, `transfer_id` is set null when the transfer goes, and there are checks on the pair and the fee. The FK on `transfer_id` exists only in SQL, not in Drizzle (harmless, because migrations are hand-written).
- `drizzle/0069_multi_currency_foundation.sql` — backfills + `currency_code` CHECKs — ✅ correct — Relabels only; amounts are untouched. The ADD CONSTRAINT fails the deploy if any `organizations.currency` is not 3 uppercase letters, so audit prod first: `select currency from organizations where upper(currency) !~ '^[A-Z]{3}$'`.
- `drizzle/0071_logical_transfers.sql` — legacy backfill (L49-80) — ⚠️ partial — Correctly skips debt groups and ambiguous groups, but ignores `deleted_at`. Trashed legacy transfers get a live header, and 0073 adds `deleted_at` without backfilling it.
- `drizzle/0076_debt_account_currency.sql` — debt currency repair — ⚠️ partial — Relabels debt accounts and their rows to the debt's currency. It does not audit pre-merge repayment/disbursement groups whose bank leg is in another currency (same number on both legs, different currencies).
- `drizzle/meta/_journal.json` — 0069-0074 `when`=1789303202114..614, 0075=1789383113149 — ⚠️ partial — Consistent inside this branch (check-migrations passes), but origin/dev ships 0075 without 0069-0074. Any DB that migrates dev first skips 0069-0074 silently.

**Writes**
- `drizzle/0073_transfer_lifecycle.sql` — `complete_transfer` / `set_transfer_trashed` / `transition_unsettled_transfer` — ⚠️ partial — Atomic and locks the row. `set_transfer_trashed` moves balances for every row with that `transfer_id`, but callers send it only `kind='transfer'` rows, so fee rows escape. The fee row has no `group_id`, so purge-by-group misses it.
- `api/_routes/onboarding.ts` — POST handler L54, L71 — ❌ missing — Sets `organizations.currency` only. `reporting_currency` keeps the USD from `createOrgForUser`, so the UI, Cash in Hand and new accounts use USD.
- `api/_routes/admin/organizations.ts` — PATCH L145 — ❌ missing — Sets `currency` only, without `CURRENCY_LIST` validation, and leaves `reporting_currency` untouched.
- `api/_routes/organizations/[id].ts` — PATCH L72-79 — ✅ correct — Writes both columns and deliberately leaves accounts and transactions alone, so history is converted, not relabelled. GET returns the raw `currency` column, not the coalesced value (the two differ only when the columns are out of sync).
- `api/_lib/auth.ts` — `createOrgForUser` L92-110 — ✅ correct — Sets `currency` and `reportingCurrency` together.
- `api/_routes/wealth/accounts.ts` — `ensureCashAccount` L18-40 — ⚠️ partial — Tags Cash in Hand with `reportingCurrency`, which is wrong after the onboarding bug.
- `api/_lib/wealth-accounts.ts` — `createWealthAccount` L113-117, L175 — ⚠️ partial — Currency defaults to the reporting currency. A cash wallet the user names "Cash in Hand" hits the default-cash unique index and returns an unhandled 500.
- `api/_lib/wealth-accounts.ts` — `createTransfer` L303-513 — ✅ correct — One atomic `dbBatch` writes the header, legs, fee, fee refund and balances, with 2-dp Decimal. The fee row has no `group_id` (L461-475).
- `api/_lib/wealth-accounts.ts` — `reverseTransfer` L577-605 — ⚠️ partial — Checks the status and whether a reversal already exists, but not `deleted_at`, so a trashed or purged transfer can be reversed.
- `api/_routes/wealth/accounts/[id].ts` — balance adjustment L197-214; DELETE L277-328 — ✅ correct — The adjustment row gets the account's currency. Hard delete happens only when the account has no rows at all (trashed rows count).
- `api/_routes/transactions.ts` — POST L470-490 — ⚠️ partial — Currency comes from the account. The amount is written with `String(amount)` and no decimal-place check, so a 3-dp input drifts the balance by 0.01.
- `api/_routes/transactions/[id].ts` — PATCH currency re-derive L157-178 — ⚠️ partial — Re-stamps the currency on every edit, so a row on an archived account gets a 409 `currency_missing` (verified). A separate claim, that account-less rows are re-denominated to the current reporting currency, was **refuted**.
- `api/_routes/transactions/bulk-delete.ts` — L41-47 — ⚠️ partial — Same `kind==='transfer'` filter as the single-row routes, so fee rows take the standard path.
- `api/_routes/trash/restore.ts` — L31-40 — ⚠️ partial — Hands off to `set_transfer_trashed` only for `kind='transfer'`. Restoring an orphaned fee row goes down the ordinary restore path.
- `api/_routes/trash/purge.ts` — L33-41 — ⚠️ partial — Expands by `group_id` only, so the transfer's fee row and header are left behind.
- `api/_routes/transactions/group.ts` — split legs L155-165 — ⚠️ partial — Each leg gets its own account's currency, but a split across currencies is accepted, and the group total becomes a raw cross-currency sum.
- `api/_lib/recurring-materialize.ts` — regular occurrence L145-200 — ⚠️ partial — Posts `rule.currencyCode` without comparing it to the account's current `currency_code`.
- `api/_routes/recurring.ts` — POST/PATCH L61-62, L122 — ✅ correct — Create uses `currencyForFinancialWrite`; edits re-stamp from the account.
- `api/_routes/spending-budgets.ts` — POST insert L89-105 — ❌ missing — Sets no `currencyCode`, so new budgets are NULL and follow the current reporting currency.
- `api/_routes/budgets.ts` — personal shim insert L113-116 — ❌ missing — Sets no `currencyCode` (MoneyWizard creates budgets this way).
- `api/_lib/transaction-currency.ts` — `currencyForFinancialWrite` — ✅ correct — The account's currency wins; the reporting currency is used only when there is no account.
- `api/_lib/debts.ts` — `recordDebtPayment` `legValues` L508-517; `currency_mismatch` L419-425 — ✅ correct — Enforces one currency. The check is skipped when the account's currency is NULL (legacy).
- `api/_routes/debts/[id].ts` — currency change L245-246; DELETE L268-290 — ⚠️ partial — The currency relabel is fine (only allowed while unlocked). DELETE counts only non-trashed rows, so a debt whose whole history is in Trash is hard-deleted and its trashed rows lose their account.
- `api/_lib/account-reset.ts` — `resetOrgData` L47-68 — ⚠️ partial — The delete order is safe (transfers cascade with the accounts; FX snapshots are global). It relies on onboarding to set the currency again, and onboarding writes only the legacy column.
- `api/_lib/admin-org-delete.ts` — teardown L56-60 — ✅ correct — Deleting the org cascades transfers, accounts and debts.
- `api/_lib/account-delete.ts` — `deleteUserAccount` — — not needed — Touches only user-scoped rows; org money goes through `admin-org-delete`.

**Aggregates**
- `api/_lib/tx-sql.ts` — `convertedSql` / excluded predicate L48-60, L84-88 — ⚠️ partial — Converts each row at its own date and counts rows that have no rate. NULL-currency rows are neither converted nor counted as excluded. The issue claim built on this (NULL rows counted 1:1 in reports) was **refuted**.

**Displays**
- `api/_routes/debts.ts` — `orgCurrency` L44-45 — ⚠️ partial — Reads the legacy `organizations.currency` instead of the reporting currency, so the two diverge once the columns are out of sync. Same in `quotation-pdf.ts:81`, `ai.ts:167` and billing pricing/create-subscription.
- `src/lib/wealth.ts` — `formatMoney` L118-128 — ✅ correct — Uses each currency's ISO minor units (JPY 0, KWD 3). Because storage is 2 dp, KWD always shows `x.xx0` and JPY rounds away stored decimals.
- `src/components/TransactionPeekModal.tsx` — amount format L46 — ⚠️ partial — `minimumFractionDigits: 2` forces ¥1,500.50 while the rest of the app shows ¥1,501.
- `src/components/ClientDetailSheet.tsx` — `fmt` L38 (also `ClientOverviewModal.tsx:67`) — ⚠️ partial — `maximumFractionDigits: 0` rounds KWD/BHD/USD to whole units.
- `src/components/TransactionDetailModal.tsx` — `canReverse` L78-88 — ⚠️ partial — When `tx.transfer_id` is set, the transfer is never looked up, so "Reverse" appears on reversal legs and on transfers that were already reversed.

**FX**
- `drizzle/0074_fx_reporting_amount.sql` — `reporting_amount` (L34) — ⚠️ partial — Passes a NULL-currency row through 1:1 (checked: `reporting_amount(1000,NULL,…,'EUR') = 1000`). The issue built on this was **refuted**.
- `api/_lib/fx-rates.ts` — `reportingCurrencyFor` L307 — ✅ correct — `reporting ?? currency ?? USD`.
- `api/_lib/spending-budgets.ts` — `budgetCurrency` L112-113 — ⚠️ partial — NULL falls back to the reporting currency, so the budget is relabelled whenever the reporting currency changes.

**Validation**
- `api/_routes/wealth/accounts/[id].ts` — PATCH currency lock L76-92 — ⚠️ partial — Locks the currency when the account has rows, is a card, or has a Space goal. Ignores `recurring_rules` and planned/pending transfers on the account.
- `api/_routes/transactions/[id].ts` — transfer guards L106-118, L232 — ⚠️ partial — Only `kind==='transfer'` rows are guarded or delegated, so fee and fee-refund rows with a `transfer_id` can be edited or trashed on their own.
- `src/lib/money.ts` — `transferAmounts` L104-146 — ⚠️ partial — Allows at most 2 dp. That matches the columns, but it refuses valid KWD/BHD fils and allows fractional JPY.
- `scripts/check-migrations.mjs` — linear/`when` checks — ✅ correct — Passes (77 entries, head 0076). It cannot see ordering across branches (origin/dev's 0075).

**API contracts**
- `api/_routes/organizations.ts` — GET/POST coalesce L53-54, L102-103 — ✅ correct — The client's `useCurrency` receives the reporting currency.

**Other**
- `scripts/db-migrate.mjs` — `migrate()` — ⚠️ partial — Never checks after migrating that the expected schema exists (e.g. `transactions.currency_code`, the `transfers` table), so a skipped migration still prints "up to date".
- `scripts/migrate-org-currency.ts` — L24 — ⚠️ partial — A stale one-off that rewrites `organizations.currency` only. Running it again would put the columns out of sync.

#### Issues in this area

| Severity | Issue | Location | Known-deferred? |
|---|---|---|---|
| critical | The currency picked at onboarding never reaches `reporting_currency`, so new users' accounts are tagged USD | `api/_routes/onboarding.ts:54` | No |
| high | Transfer fee rows escape the transfer guards: trashing the fee and then reversing creates money | `api/_routes/transactions/[id].ts:232` | No |
| high | An account's currency can change under a recurring rule that has not posted yet, producing rows in the wrong currency | `api/_routes/wealth/accounts/[id].ts:84` | No |
| high | Purge leaves the fee row and header behind; restoring the fee row brings the header back | `api/_routes/trash/purge.ts:33` | No |
| medium | Deploy order: origin/dev ships 0075 stamped above 0069-0074, so they would be skipped silently | `drizzle/meta/_journal.json:1` | No |
| medium | The 0071 backfill gives trashed legacy transfers a live header, so restoring them from Trash returns 409 | `drizzle/0071_logical_transfers.sql:65` | No |
| medium | `reverseTransfer` does not check `deleted_at`, so trashed or purged transfers can be reversed | `api/_lib/wealth-accounts.ts:583` | No |
| medium | Admin org PATCH updates only `organizations.currency` and does not validate it | `api/_routes/admin/organizations.ts:145` | No |
| medium | New spending budgets are written with NULL currency and are relabelled when the reporting currency changes | `api/_routes/spending-budgets.ts:90` | Yes |
| medium | Ordinary writers do not validate decimal places: a 3-dp amount drifts the balance from the ledger, and KWD/BHD fils are lost | `api/_routes/transactions.ts:479` | Yes |
| medium | Editing any row on an archived account fails with a misleading 409 "currency migration is incomplete" | `api/_routes/transactions/[id].ts:167` | No |
| medium | A split can mix accounts in different currencies | `api/_routes/transactions/group.ts:164` | No |
| medium | Debt DELETE hard-deletes when all its rows are in Trash, leaving legs with no account | `api/_routes/debts/[id].ts:273` | No |
| low | 0076 relabels old debt legs without auditing cross-currency principal groups | `drizzle/0076_debt_account_currency.sql:25` | No |

Unverified (low): "'Reverse' is offered on reversal legs, and the server accepts a reversal of a reversal"; "Zero- and three-decimal currencies render inconsistently"; "A cash wallet named 'Cash in Hand' returns 500"; "Dev DB integrity drift left by earlier iterations". Refuted (not bugs): "Editing a transaction re-stamps its currency; rows with no account get the current reporting currency"; "Transactions with NULL currency are counted 1:1 in reports and never reported as excluded".

#### Decisions

- **Meaning of a workspace currency change.** Today it is a *reporting* switch: accounts and transactions keep their currency and are converted. Legacy users used it as a *relabel* to fix a wrong setup. Do we need a "relabel single-currency workspace" action, for example for users hit by the onboarding bug?
- **Release order.** This branch must merge into dev before any dev→main promotion, because origin/dev's 0075 is stamped above 0069-0074. Who checks the watermarks of the Preview and e2e databases?
- **Money scale.** Options:
  - widen to `numeric(20,4)`, with transactions and balances to match;
  - enforce per-currency minor units (JPY 0, KWD 3);
  - drop the 3-decimal currencies (KWD, BHD, OMR, JOD, TND) from `CURRENCY_LIST` until one of the above lands.
- **Budget currency.** Should a budget always be stamped with the reporting currency at create time (and converted after a reporting change), or always follow the reporting currency (relabel)? Today old and new budgets behave differently.
- **Transfer fee semantics.** Is the fee part of the immutable logical transfer (refuse edit or trash of the fee row alone), or an independent expense the user may edit (with the header updated to match)?
- **Reversals and trashed transfers.** Should a reversal of a reversal be allowed? Should a trashed or purged transfer keep its header at all?
- **NULL-currency backfill and NOT NULL order.** Should the 69 account-less NULL-currency transactions be backfilled with the org's reporting currency or its legacy currency? After that, what is the SET NOT NULL order? `wealth_accounts` and `recurring_rules` are ready now, `transactions` after the backfill, and `spending_budgets` after the writer fix.
- **Pre-merge debt groups after 0076.** For groups whose legs now carry different currencies: fix them by hand, post correcting rows, or leave them excluded from reports?
- **Debt DELETE.** Should it count trashed rows (and archive instead of hard-deleting), as account DELETE does?

#### Existing tests

- `src/lib/multi-currency-migration.test.ts` — Static text checks on 0069-0073: currency columns declared in the schema, amounts never rewritten, account-first backfill, default-cash index, `transfer_id` link, fee/rate checks, row lock in `complete_transfer`. Does not cover `deleted_at` in the 0071 backfill, 0074 or 0076.
- `src/lib/money.test.ts` — Decimal Money/FX invariants, `transferAmounts` (2-dp limit, effective rate, same-currency equality), `reversalTransferAmounts`, `MAX_MONEY`.
- `api/_lib/tx-sql.test.ts` — Reporting aggregates go through the tx-sql helpers (income/expense/refund classification, `convertedSql` shape).
- `api/_lib/fx-rates.test.ts` — Rate lookup and caching, historical coverage, conversion helpers that depend on `reportingCurrencyFor`.
- `api/_lib/fx-provider.test.ts` — Provider contract, pair/date normalisation, fallback provenance.
- `src/lib/wealth-ledger.test.ts` — Balance shifts for trash/restore (`reversalsByAccount`/`applicationsByAccount`); system rows are not re-applied.
- `src/lib/credit-card-ledger.test.ts` — Card purchase/payment/refund ledger semantics.
- `src/lib/debt-ledger.test.ts` — Debt principal/interest split legs.
- `src/lib/recurring-transfer.test.ts` — Shape of a Space auto-save transfer occurrence.
- `src/lib/billing-currency.test.ts` — Checkout currency resolved from `organizations.currency` (legacy column).
- `e2e/multi-currency.spec.ts` — Account keeps its own currency; consolidated wealth conversion; cross-currency transfer with fee and rate; reversal restores both native amounts; a planned transfer moves no money until done; wealth screen shows native + approx + split. Does not cover trashing the fee row then reversing, reversing a trashed transfer, onboarding currency, or a reporting-currency change.
- `e2e/credit-card.spec.ts` — Trash/restore/edit of a card-payment transfer through the delegated transfer service.
- `e2e/debts.spec.ts` — Debt create and payment flows (same currency only).
- `scripts/check-migrations.mjs` — Journal/file agreement, contiguous numbering, strictly increasing `when`, no future stamps (within the branch only, not across branches).

### 3.2 FX rates & conversion core

**Readiness:** partial. The primitives are sound. Money arithmetic in `src/lib/money.ts` is exact and refuses to mix currencies. The rate direction (quote per base) is used the same way in SQL, JS and `formatRate`, and every aggregate route converts through `reporting_amount()` and counts the rows that have no rate. The weak point is the rate data behind those functions:
- **History sources.** Frankfurter (ECB) is the only source of history, and open.er-api only gives today's rate. Rows in non-ECB currencies (AED, SAR, KWD, QAR, PKR, LKR and others) dated before their first stored rate are therefore excluded for good.
- **Early fetches.** A business day first fetched before the ECB publishes (about 14:00 UTC) is frozen at the previous day's rate. This is confirmed in the dev DB: EUR/USD on 2026-09-10 is stored as 1.1652 against the ECB's 1.1616, and on 2026-09-14 as 1.1592 against 1.1551.
- **Fetch direction.** Rates are always fetched foreign→reporting, which cuts weak-currency rates to 2–4 significant digits (KRW→USD 0.00074, +0.30%).
- **Pair precedence.** `fx_rate_on` uses a direct row that is weeks old before a fresh inverse row. USD→INR on 2026-09-30 returns 95.11 (from 09-10) instead of about 95.88.
- **`ensureRatesForOrg`.** It only fetches pairs into the reporting currency, even though budgets convert into their own currency. It also re-inserts the whole history one row at a time every day.
- **Display.** Rates carried forward from an older date are never marked as estimates. The "excluded" notice on 8 screens shows the raw key `fx.excludedNotice`.
- **Tests.** Unit tests cover parsing, caching and the SQL text, but nothing tests the rate data itself. The e2e suite depends on the live FX APIs.

#### What changes / what is affected

**Schema**
- `drizzle/0070_fx_rate_snapshots.sql` — `fx_rate_snapshots` + `fx_rate_snapshots_observation_unique` — ⚠️ partial — Global (not org-scoped), immutable observations. The unique key (24-25) leaves out `is_fallback`, so a placeholder and the real observation for the same day collide. The `manual` source type exists, but nothing writes it and there is no UI for it.

**Writes**
- `api/_lib/fx-rates.ts` — `storeSnapshot` — ⚠️ partial — `insert … onConflictDoNothing` on (base, quote, rate_date, provider, source_type) (141-155). A carried-forward fallback row can never be replaced by the real observation, and `fetched_at` never refreshes.
- `api/_routes/spending-budgets.ts` — POST insert — ❌ missing — New budgets are inserted without `currency_code` (90-103; same in `api/_routes/budgets.ts:114`). They follow the reporting currency, while budgets backfilled by 0069 are pinned.
- `api/_routes/organizations/[id].ts` — PATCH currency — ✅ correct — Writes `currency` and `reporting_currency` together and leaves accounts and rows untouched (71-79).

**Aggregates**
- `api/_lib/tx-sql.ts` — `convertedSql` / `reportingAmountSql` / `incomeSumSqlIn` / `expenseSumSqlIn` / `missingRateSql` / `missingRateCountSql` — ✅ correct — Every P&L sum converts at the row's own date and counts NULL-rate rows (48-76). The excluded count only covers "no rate ever before this date", not stale carried-forward rates.
- `api/_lib/tx-sql.ts` — `accountBalanceInSql` / `missingAccountRateCountSql` — ⚠️ partial — Converts balances with SQL `fx_rate_on(current_date)` (83-88). `/api/wealth/summary` picks its rate differently (JS `currentRate`), so the same account converts differently on `/flow` and `/wealth`.
- `api/_lib/wealth-summary.ts` — `buildWealthSummary` — ✅ correct — Native totals per currency, with each currency group converted once at `currentRate`. Returns `excluded_currencies`, `complete`, card_liabilities, debts_owed and debts_receivable (17-140). `as_of` is the earliest rateDate, so it inherits the rate_date inconsistency. It calls `ensureRatesForOrg` and then `currentRate` again for each currency.
- `src/lib/reporting-fields.ts` — `reportingAmountOf` / `sumInReporting` / `excludedCountOf` / `reportingCurrencyOf` — ✅ correct — Client-side sums skip and count null reporting amounts. Untagged rows are treated as the reporting currency (37).
- `src/components/wealth/use-consolidated-wealth.ts` — `availableFromSummary` / `liquidFromSummary` / `savedFromSummary` — ✅ correct — Skips accounts with no `converted_balance`. Callers must show the `complete` flag.
- `api/_lib/spending-budgets.ts` — `budgetCurrency` / `listBudgets` — ⚠️ partial — Spend is converted into the budget's own currency (112-113, 303), but `ensureRatesForOrg` is only asked for the reporting currency (281-282).
- `api/_routes/transactions.ts` — grouped row amount — ⚠️ partial — The amount of a multi-currency split is `sum(reporting_amount)`. The SQL sum skips NULL legs, so the route returns a partial total labelled in the reporting currency, although the comment says it returns NULL (109-110).
- `api/_routes/flow.ts` — timeline `accountBalanceInSql` — ⚠️ partial — Starts from today's balances at today's rate and walks back with flows converted at historical rates (223), so past points mix rates (valuation deferred per ARCHITECTURE G).

**Displays**
- `src/lib/money.ts` — `formatDecimalMoney` — ✅ correct — Intl currency formatting with ISO minor units (85-90).
- `src/lib/wealth.ts` — `formatRate` — ⚠️ partial — Formats as "1 base = quote rate", with `maximumFractionDigits` 4 when the rate is below 1 (158-172). Tiny rates collapse: "1 IDR = $0.0001", "1 VND = $0.00".
- `src/lib/wealth.ts` — `formatMoney` / `formatApprox` / `accountCurrency` — ✅ correct — Formats in the currency it is given (the native one) and prefixes converted values with "≈" (122-134, 175-177).
- `src/components/wealth/CurrencyBreakdown.tsx` — `CurrencyBreakdown` — ⚠️ partial — Lists every currency, excluded ones included, with the "not included" warning and a rate and date on each row (57). The rate label has the `formatRate` precision bug.
- `src/components/wealth/ApproxBalance.tsx` — `ApproxBalance` — ✅ correct — Shows the ≈ line only when the account is foreign and was converted, with the rate date and a stale badge.
- `src/components/FxExcludedNotice.tsx` — `FxExcludedNotice` — ❌ missing — Calls `t('fx.excludedNotice', {count})` (20), but the key is in neither en.json nor any other locale. The raw key shows on Dashboard, Transactions, Calendar, Analytics, MoneyFlow, Budgets, Clients and ClientDetail.
- `src/components/wealth/PayCardSheet.tsx` — `formatRate(fromCurrency, cardCurrency, amt / sourceAmt)` — ✅ correct — Direction verified: destination per source (263).
- `src/components/spaces/SpaceTransferModal.tsx` — `formatRate` fund/withdraw — ✅ correct — Direction verified for both modes (139).
- `src/components/wealth/ScheduledTransfersPanel.tsx` — `formatRate(tr.source_currency, tr.destination_currency, tr.effective_rate)` — ⚠️ partial — Direction is correct, but it has the same tiny-rate precision problem (106).

**FX**
- `src/lib/money.ts` — `normalizeCurrencyCode` / `decimalFxRate` / `convertMoney` / `add|subtract|compareMoney` — ✅ correct — Uses Decimal.js and throws `CurrencyMismatchError` on mixed currencies. A rate is quote units per 1 base, and a rate ≤ 0 is rejected (18-83). Codes are validated against the 158-code `CURRENCY_LIST`.
- `src/lib/money.ts` — `transferAmounts` / `reversalTransferAmounts` — ✅ correct — Effective rate is destination per source to 14 dp, the inverse is stored, and the fee stays outside the principal FX (110-167). Never looks at market rates.
- `api/_lib/fx-provider.ts` — `CachedFxRateProvider` — ✅ correct — Merges concurrent requests, caches current rates for 1h and historical rates forever, and returns 1 for the same currency. The app never uses its historical path: `ensureHistoricalRates` calls `frankfurter.getSeries` directly (`fx-rates.ts:252`), so series fetches are never merged.
- `api/_lib/fx-rates.ts` — `FrankfurterProvider.getCurrentRate` / `getSeries` — ⚠️ partial — Sends only the pair and the date, so privacy is fine. It always requests `base=<foreign>`, and Frankfurter rounds cross rates to a few significant digits for weak bases (IDR 5.6e-05, KRW 0.00074, INR 0.01043). Covers only the ~30 ECB currencies (64, 79).
- `api/_lib/fx-rates.ts` — `OpenErApiProvider` — ⚠️ partial — Today's rate only, no history (99-101). It is the only source for AED, SAR, KWD, QAR, OMR, BHD, PKR, LKR, BDT, NPR, EGP and VND.
- `api/_lib/fx-rates.ts` — `currentRate` — ⚠️ partial — "Fresh" means a `market` row for today fetched less than 12h ago (179-187). After that it calls the provider on every call, and the insert conflicts, so nothing is saved. The provider path sets rate_date to the provider's date while the DB path uses today. `stale` is true only on the DB fallback (204-215), never for a weekend value.
- `api/_lib/fx-rates.ts` — `convertAmount` — ✅ correct — Decimal multiply that rounds to 2 dp whatever the target's minor units (219-221).
- `api/_lib/fx-rates.ts` — `ensureHistoricalRates` — ⚠️ partial — Counts distinct days in [from, today] (241-245). Today is always missing on the first call of each UTC day, so it refetches the whole series and awaits one INSERT per calendar day in the range (263-268). If the ECB has not published today yet, today is stored as `is_fallback=true` with the previous day's rate, permanently. Frankfurter only, with a 6-year floor (29, 236).
- `api/_lib/fx-rates.ts` — `ensureRatesForOrg` — ⚠️ partial — Pairs: every non-reporting currency found in the org's transactions (through clients, including trashed rows and transfer legs) and in wealth_accounts (including archived ones), fetched only in the X→reporting direction. Dates: min(tx.date)→today for transaction currencies, and today only for currencies found only on accounts (280-292). It ignores `spending_budgets.currency_code` targets and `recurring_rules`, and fetches one currency at a time (295-302). All 11 callers ignore the `uncovered` result (`.catch(() => undefined)`).
- `api/_lib/fx-rates.ts` — `reportingCurrencyFor` — ✅ correct — `coalesce(reporting_currency, currency, 'USD')`, normalized (307-314). The org PATCH validates against the same list.
- `drizzle/0074_fx_reporting_amount.sql` — `fx_rate_on` — ⚠️ partial — Returns the latest rate on or before the date. It tries the direct pair first and the inverse only when the direct pair has no row at all (21-28), so a weeks-old direct row beats a fresh inverse. Carry-forward has no age limit. The function is not inlined because it contains sub-selects, and costs about 27µs per foreign row.
- `drizzle/0074_fx_reporting_amount.sql` — `reporting_amount` — ⚠️ partial — Treats a NULL source currency as the reporting currency (rate 1) (34). Untagged rows silently take the current reporting currency and are never counted as excluded. Each row is rounded to 2 dp.
- `src/components/wealth/TransferWizard.tsx` — market-rate suggestion effect — ✅ correct — Calls `/api/fx/rate` and pre-fills received = sent × rate until the user edits it. Shows "suggested" or a stale label with the date, and a "no rate" hint on 404 (155-179, 309-314). The saved transfer uses the user's amounts, not the market rate.
- `api/_routes/analytics.ts` — `ensureRatesForOrg` before aggregates — ✅ correct — The same pattern is in `calendar.ts:40`, `clients.ts:69`, `clients/[id].ts:32`, `transactions.ts:183`, `flow.ts:82`, `budgets.ts:57`, `budgets/overview.ts:66`, `budgets/detail.ts:122`, `notify-budget.ts:153` and `spending-budgets.ts:282/518`. All of them await the daily backfill inside the request.

**Validation**
- None recorded for this area.

**API contracts**
- `api/_routes/fx/rate.ts` — `GET /api/fx/rate` — ⚠️ partial — Validates codes (400 `invalid_currency`), returns 404 `no_rate`, and otherwise `{rate, rate_date, provider, stale}` (21-38). It inherits `currentRate`'s stale/rate_date inconsistency. There is no throttling: any signed-in user can make the server fetch arbitrary pairs and save them in the global table.
- `api/_routes/wealth/summary.ts` — `GET /api/wealth/summary` — ✅ correct — Read-only, apart from filling in snapshots.

**Other**
- `src/lib/api-cache.ts` — `/api/fx/rate` policy — ✅ correct — `config` class, fresh for 5 min, not persisted (157-159).

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | Currencies outside the ECB set have no historical rates, so their older rows are excluded for good | `api/_lib/fx-rates.ts:252` | yes |
| high | New spending budgets are saved without a currency and follow the reporting currency | `api/_routes/spending-budgets.ts:90` | yes |
| medium | A business day's rate is permanently frozen at the previous day's value when first fetched before ECB publication (reported high) | `api/_lib/fx-rates.ts:263` | no |
| medium | The FX "excluded" notice shows a raw i18n key on 8 screens | `src/components/FxExcludedNotice.tsx:20` | no |
| medium | Weak-currency rates lose precision because they are always fetched as foreign-to-reporting | `api/_lib/fx-rates.ts:297` | no |
| medium | Budgets convert into their own currency, but only reporting-currency pairs are fetched | `api/_lib/spending-budgets.ts:282` | no |
| medium | The daily coverage check re-inserts the whole history one row at a time in the request path | `api/_lib/fx-rates.ts:263` | no |
| medium | Two definitions of "today's rate", and the market snapshot can never refresh after 12h | `api/_lib/fx-rates.ts:185` | no |
| medium | A partial sum is shown as a multi-currency split's amount when one leg has no rate | `api/_routes/transactions.ts:109` | no |
| medium | Rates carried forward have no age limit and no "estimated" marker | `drizzle/0074_fx_reporting_amount.sql:22` | yes |
| medium | `formatRate` rounds tiny rates to zero or wrong values | `src/lib/wealth.ts:166` | no |
| low | `fx_rate_on` prefers a stale direct row over a fresh inverse row (reported medium, 1/2 votes) | `drizzle/0074_fx_reporting_amount.sql:21` | no |
| low | Untagged rows (`currency_code` NULL) are treated as the current reporting currency (reported medium, 1/2 votes) | `drizzle/0074_fx_reporting_amount.sql:34` | yes |

**Unverified lows:** six low-severity claims were not verified:
- The stale flag and rate_date are inconsistent between the provider path and the DB path (`api/_lib/fx-rates.ts:198`).
- `fx_rate_on` is not inlined, so foreign rows are expensive in aggregates (`drizzle/0074_fx_reporting_amount.sql:17`).
- Conversions always round to 2 decimals, whatever the target currency's minor units (`api/_lib/fx-rates.ts:220`). This one is known-deferred.
- Rows older than 6 years never get a rate (`api/_lib/fx-rates.ts:29`).
- The multi-currency e2e depends on the live FX APIs (`e2e/multi-currency.spec.ts:211`).
- `/api/fx/rate` lets any user write arbitrary pairs into the global rate table (`api/_routes/fx/rate.ts:35`).

**Refuted:** none in this area.

#### Decisions

- **History for non-ECB currencies.** Where do historical rates for AED, SAR, QAR, KWD, OMR, BHD, PKR, LKR, BDT, NPR, EGP and VND come from? The options are a second history provider, triangulation through USD/EUR (for pegged currencies), manual rates per workspace, or "estimated at the nearest available rate". Today those rows are excluded forever.
- **Staleness policy for historical conversion.** How old can a carried-forward rate be before the row counts as excluded? And should every aggregate response and notice carry an `estimated_count` (fallback or old rate) next to `excluded_count`?
- **Upgrading same-day fallbacks.** May a same-day fallback snapshot be replaced when the real observation arrives? It is a placeholder, not an observation, so allowing this bends the "immutable snapshots" wording.
- **Canonical rate storage.** Keep fetching each pair foreign→reporting, or store only EUR-based ECB rates and derive every cross rate in Decimal/SQL? The second option fixes precision, pair precedence and budget-target coverage at once.
- **Scope of `fx_rate_snapshots`.** Keep it global (shared by tenants, so one org's fetches change another org's results), or make rate coverage deterministic per org?
- **Current rate for net worth.** Pick one definition: JS `currentRate` (used by `/api/wealth/summary`) or SQL `fx_rate_on(current_date)` (used by `/flow` balances).
- **Budget currency.** Pin every budget to the reporting currency at creation (what 0069 does), or let all budgets follow the reporting currency (what new rows do now)?
- **Lagging provider dates.** Does a provider date behind today (a weekend, or before the ECB publishes at ~14:00 UTC) count as stale for the UI badge and the TransferWizard hint?
- **Rate label convention.** Always "1 foreign = X reporting", or always the direction that gives a number ≥ 1 ("1 USD = ₩1,355.40")?

#### Existing tests

- `src/lib/money.test.ts` — Currency normalization, Decimal add/subtract/multiply, `CurrencyMismatchError` on mixed currencies and the `convertMoney` direction guard. Also locale formatting (INR grouping, JPY with no decimals), `transferAmounts` effective and inverse rate (500 EUR→51,350 INR = 102.7), the fee kept outside the principal FX, and a reversal that swaps principals and refunds the fee.
- `api/_lib/fx-provider.test.ts` — `CachedFxRateProvider`: the vendor receives the normalized pair, concurrent requests are merged, historical rates are cached per date, the same currency returns 1 without a vendor call, and invalid dates and non-positive rates are rejected.
- `api/_lib/fx-rates.test.ts` — Frankfurter current and series parsing with a mocked fetch (only the pair in the URL), a 404 becomes `FxUnavailable` (never 1), open.er-api current parsing with no history, and `convertAmount` rounding to cents.
- `api/_lib/tx-sql.test.ts` — Renders the P&L SQL and checks that income, expense and refund go through `reporting_amount(amount, currency_code, date, $n)`. Also checks that the excluded count uses `fx_rate_on(...) is null` for standard and refund rows only, and that `accountBalanceInSql` and the missing-account-rate count use `current_date`.
- `api/_lib/budget-spend.test.ts` — Budget spend SQL converts through `reporting_amount` into the budget's target currency and negates refunds, and the missing-rate predicate uses `fx_rate_on`.
- `src/lib/multi-currency-migration.test.ts` — The text of migrations 0069–0073: currency columns, no amount rewrite, transfer header, fee/rate provenance and row-lock completion. It does **not** cover the unique-key semantics of 0070 or how `fx_rate_on`/`reporting_amount` in 0074 behave.
- `e2e/multi-currency.spec.ts` — An account keeps its native currency, and `/api/wealth/summary` is complete with an INR rate (over the live network). A cross-currency transfer keeps both amounts, an effective rate of 102.7 and a fee-only expense; its reversal restores the native amounts. A scheduled transfer moves nothing. The wealth screen shows the ≈ line and the currency split.

### 3.3 Wealth accounts, Spaces & transfers

**Readiness:** partial. The core engine is sound. `createTransfer` writes the header, both native legs, the optional source fee and both balance changes in one Decimal-based `dbBatch`. The 0073 lifecycle functions are row-locked and currency-checked, and `GET /api/wealth/summary` converts every account at the latest rate and reports `complete`/`excluded_currencies`. The wealth tiles, ApproxBalance, CurrencyBreakdown, TransferWizard, ScheduledTransfersPanel, PayCardSheet and SpacesCard all format money in each account's own currency. Money can still move wrongly in two ways: a trashed transfer can be reversed, and a reversal refunds the header's fee even after the fee row was trashed or edited on its own. The account currency lock counts only transaction rows, so a row-less non-zero balance, a recurring rule or a funded card can be silently relabelled. The Spaces screens and the account page's Income/Expenses/Net never got per-currency handling. The Wealth and Dashboard heroes show a raw cross-currency sum until the summary arrives, or permanently if it fails. Multi-cash-wallet support is only half built (an archived extra wallet can't be restored, there is no creation UI and no quota), and planned transfers skip the debt-account guard.

**What changes / what is affected**

*Writes*
- `api/_lib/wealth-accounts.ts` — `createWealthAccount` (110-239) — ✅ — Native currency = `currency_code` ?? reporting ?? org currency (validated), and the Opening Balance row snapshots it. The account insert and the system row are not atomic, and cash wallets have no quota.
- `api/_lib/wealth-accounts.ts` — `createSystemTransaction` (52-81) — ✅ — Opening Balance and other system rows carry the explicit `currencyCode`.
- `api/_lib/wealth-accounts.ts` — `createTransfer` (303-518) — ⚠️ — Atomic `dbBatch` with both native amounts, Decimal, an effective rate (destination units per source unit) and a fee leg in the source currency. Refuses debt accounts (322) and a missing currency (325). The fee leg is `kind='standard'` with `transfer_id` but no `group_id`, so the transaction routes treat it as an ordinary row.
- `api/_lib/wealth-accounts.ts` — `createTransferIntent` (626-671) — ⚠️ — Stores a planned/pending header with frozen native amounts. It has no `isDebtAccountType` guard, unlike `createTransfer`:322.
- `api/_lib/wealth-accounts.ts` + `drizzle/0073` — `transitionTransfer` (520-574) / `complete_transfer` — ⚠️ — Row-locked. Refuses if an account's currency changed since planning and uses the `destination_amount` frozen at planning time. No debt-account guard, and a debit card chosen at planning is not carried onto the out leg.
- `api/_lib/wealth-accounts.ts` — `reverseTransfer` (577-607) — ⚠️ — Swaps the native principals with no FX step. Does not check `original.deletedAt`, and refunds the header's `source_fee_amount` even if the fee row was trashed or edited. It also allows reversing a reversal, which is a product decision (see Decisions).
- `drizzle/0073_transfer_lifecycle.sql` — `set_transfer_trashed` — ✅ — Trashes or restores every `transfer_id` row and all affected balances in one function. Refuses reversal-linked transfers.
- `api/_routes/wealth/transfers/[id]/reverse.ts` — POST — ⚠️ — Delegates to `reverseTransfer`, so it inherits the missing trashed and reversal-of-reversal checks.
- `api/_routes/wealth/accounts.ts` — `ensureCashAccount` (18-42) — ✅ — Lazily creates Cash in Hand in the reporting currency. Skipped when any active cash wallet exists.
- `api/_routes/wealth/accounts/[id].ts` — PATCH balance adjustment (195-220) — ⚠️ — When `currency_code` arrives in the same PATCH, the adjustment row uses the pre-change `account.currencyCode`. The delta is a float, and the absolute balance write is not atomic with the row insert.
- `api/_routes/spaces.ts` — POST — ✅ — Accepts `currency_code` (default: reporting currency). The UI never sends it.
- `api/_lib/recurring-materialize.ts` — transfer branch (158-183) / regular branch (186-213) — ⚠️ — Space auto-save delegates to `createTransfer`, which uses live account currencies. Regular rows are stamped with `rule.currencyCode` and never compared with the account's current currency.
- `src/components/wealth/TransferWizard.tsx` — `TransferWizard` — ⚠️ — Asks for the sent and received amounts when currencies differ and prefills the received amount from the market rate. `overBalance` (199-204) ignores the fee, and an untouched market suggestion is stored as `rate_source='effective_transfer'`.
- `src/components/wealth/PayCardSheet.tsx` — `PayCardSheet` — ✅ — Uses the card's currency and asks for the source amount when paying across currencies.
- `src/components/spaces/SpaceFormModal.tsx` — create/edit (36-37, 64) — ❌ — No currency picker, so every new Space is in the reporting currency. The goal input prefix is the workspace symbol, not the Space's.
- `src/components/spaces/SpaceTransferModal.tsx` — fund/withdraw — ✅ — Asks for the other side's amount across currencies and sends both native amounts and both currencies.
- `api/_routes/organizations/[id].ts` — PATCH currency (72-79) — ✅ — Changes only `reporting_currency` and its alias. Never touches native accounts or rows.

*Aggregates*
- `api/_lib/wealth-summary.ts` — `buildWealthSummary` — ✅ — Native totals per currency, converted at the latest rate. Returns `card_liabilities`/`debts_owed`/`debts_receivable`, `complete` + `excluded_currencies` and `stale`/`as_of`, and excludes archived accounts. It first awaits `ensureRatesForOrg`, a full historical backfill (line 32).
- `src/lib/wealth.ts` — `summarizeWealth` (191-219) — ⚠️ — Raw `Number` sum across currencies. WealthPage and Dashboard still use it as the fallback before the summary arrives or when it fails.
- `src/components/wealth/use-consolidated-wealth.ts` — `availableFromSummary` / `liquidFromSummary` / `savedFromSummary` — ✅ — Sums only `converted_balance` and skips accounts with no rate. Callers must show `complete`.

*Displays*
- `src/lib/wealth.ts` — `formatMoney` / `accountCurrency` / `formatRate` / `formatApprox` / `accountBalanceLabel` — ✅ — Formats in the native currency using ISO minor units. `accountCurrency` falls back to the workspace currency (the dev DB has no NULL account currencies).
- `src/pages/WealthPage.tsx` — hero net worth / assets / available / saved (299-331, 500-575) — ⚠️ — Correct once the summary lands. Before that, or on error, it shows raw cross-currency sums (`local.total`, `localSaved`) formatted in the reporting currency.
- `src/pages/WealthPage.tsx` — AccountCard / archived list / create dialog — ✅ — Native balance, then ApproxBalance. The create dialog has a CurrencyCombobox and an opening balance with the matching symbol.
- `src/pages/WealthAccountDetailPage.tsx` — stats income/expenses/net (116, 219, 240-244, 382) — ❌ — The summary from `/api/transactions?wealthAccountId` is in the reporting currency (`transactions.ts:361-378`) but is formatted with the account's symbol. `excluded_count` is ignored.
- `src/pages/WealthAccountDetailPage.tsx` — balance header + rows (358, 377, 450) — ✅ — Native balance, ApproxBalance, and each row in `tx.currency_code`.
- `src/components/wealth/ApproxBalance.tsx` — `ApproxBalance` — ✅ — Hidden for reporting-currency accounts and accounts with no rate. Shows the as-of date and a stale badge.
- `src/components/wealth/CurrencyBreakdown.tsx` — `CurrencyBreakdown` — ✅ — Per currency: native assets − liabilities, ≈ `converted_net`, share, rate + date. Shows a notice for currencies not included.
- `src/components/wealth/ScheduledTransfersPanel.tsx` — `ScheduledTransfersPanel` — ✅ — Shows native source → destination, rate and fee. Mark done cannot adjust the received amount, and touch targets are 36px (`min-h-9`/`size-9`).
- `src/components/wealth/AccountCombobox.tsx` — `AccountCombobox` — ✅ — Every option shows its own currency. There is no option to show only same-currency accounts, which the Space auto-save and delete pickers need.
- `src/pages/SpacesPage.tsx` — `totalSaved` (84, 170) / SpaceCard (318, 347, 350) — ❌ — Raw `Number` sum across Space currencies, and every figure is formatted with `useCurrency()`.
- `src/pages/SpaceDetailPage.tsx` — balance/goal (150, 185, 188), autoSave (213), history (251), DeleteSpaceDialog (417-440), AutoSaveModal (346) — ❌ — Every amount is in the workspace currency. Move & close posts `amount` only, so it fails across currencies, and the auto-save picker offers foreign accounts the server refuses.
- `src/components/spaces/SpacesCard.tsx` — dashboard Spaces card — ✅ — The headline is converted when the summary is complete and split per currency otherwise. Rows are in native currency.
- `src/pages/Dashboard.tsx` — WealthCard (576-583) — ⚠️ — Same raw-sum fallback (`localLiquid`/`localLiabilities`) until or unless the summary lands.

*FX*
- `api/_lib/fx-rates.ts` — `currentRate` / `ensureHistoricalRates` / `ensureRatesForOrg` — ⚠️ — Never falls back to 1:1 and labels stale rates honestly. But `ensureHistoricalRates` inserts one snapshot per day, one at a time (263-268), and `ensureRatesForOrg` walks currencies one by one with a 4s timeout per provider. All of this runs before the wealth summary can answer.
- `api/_routes/fx/rate.ts` — GET `/api/fx/rate` — ✅ — Market-rate suggestion for the transfer form. Returns 404 `no_rate` rather than a guess.
- `src/lib/money.ts` — `transferAmounts` / `reversalTransferAmounts` — ✅ — Decimal, equality check for same-currency transfers, rate to 14dp. Always 2dp regardless of ISO minor units (known limit: `numeric(20,2)`).

*Validation*
- `api/_routes/wealth/accounts/[id].ts` — PATCH currency lock (76-93) — ⚠️ — Locks only on transaction count (trashed rows included), card type or a non-zero goal. Ignores a non-zero current/opening balance with zero rows, recurring rules on the account, cards it funds and planned transfers.
- `api/_routes/wealth/accounts/[id].ts` — PATCH archive/restore cash (135-137, 154-161) — ❌ — Treats every cash wallet as the default one. Archiving any cash wallet is refused, and restoring one fails while any cash wallet is active. The DELETE path (288) correctly keys on `bank_name === DEFAULT_CASH_NAME`.
- `api/_routes/spaces/[id].ts` — PATCH/DELETE — ✅ — No currency edit. Archive and delete require a native balance of 0.
- `api/_routes/spaces/[id]/auto-save.ts` — PUT — ✅ — Same currency only (`cross_currency_recurring_policy_required`). The rule's `currency_code` snapshots the source account's.
- `api/_lib/quota.ts` — `checkBankAccountQuota` (209-235) — ⚠️ — Counts only `type='bank'`. Extra cash wallets, the way free users get multi-currency, are unlimited.
- `src/components/wealth/WealthAccountDialogs.tsx` — edit currency + adjust — ⚠️ — The adjust symbol follows the account. The currency picker is disabled based on `transaction_count`, which counts live rows only, while the server also counts trashed rows.
- `src/components/TransactionDetailModal.tsx` — reverse guard (77-88) — ⚠️ — Rated partial by the analyst: `isReversal`/`alreadyReversed` are computed only when the leg has no `transfer_id`. The issue built on this ("Reverse offered on reversal legs") was **refuted** by verifiers (0/2), so this note is not a confirmed bug.
- `api/_routes/transactions/[id].ts` — PATCH guard (106-119) / DELETE (232-238) — ⚠️ — Decides whether a row belongs to a transfer by `kind==='transfer'`. The fee row (kind standard, `transfer_id` set) can therefore have its amount, account or date edited, or be trashed on its own. `bulk-delete.ts:36-47` and `trash/restore.ts:31` do the same by design.

*API contracts*
- `api/_routes/wealth/transfer.ts` — POST handler — ✅ — Accepts `source_amount`/`destination_amount`/`source_fee_amount`/`source_currency`/`destination_currency`/`status`. The currencies are checked against the accounts, never trusted.
- `api/_routes/wealth/transfers.ts` — GET list — ✅ — Returns the native header facts plus `reversed_by_transfer_id` and excludes trashed rows by default. Headers of purged transfers remain with `deleted_at` set (9 on the dev DB).

*Other*
- `src/lib/api-cache.ts` — FANOUT organizations rule (291) — ⚠️ — A reporting-currency change invalidates no money reads. `/api/wealth/summary` in the old reporting currency is reused for up to 15s and painted stale for up to 2 min.

**Issues in this area** (verified; full scenarios in the global table)

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | A trashed transfer can still be reversed: money moves twice, and neither transfer can be undone afterwards | `api/_lib/wealth-accounts.ts:586` | No |
| high | Reversal refunds the header's fee even after the fee row was trashed or edited on its own | `api/_routes/transactions/[id].ts:232` | No |
| high | Account page Income/Expenses/Net shows reporting-currency totals with the account's own symbol, silently excluding rows with no rate | `src/pages/WealthAccountDetailPage.tsx:241` | No |
| high | Spaces hub and Space detail use the workspace currency for every figure and add different currencies together | `src/pages/SpacesPage.tsx:84` | No |
| high | Currency lock ignores recurring rules and funded cards, so later postings carry the old currency or autopay never succeeds | `api/_routes/wealth/accounts/[id].ts:84` | No |
| high | Wealth and Dashboard heroes show a raw cross-currency sum until the summary arrives, or forever if it fails | `src/pages/WealthPage.tsx:309` | No |
| medium | Currency lock ignores a non-zero balance with no rows, so the stored native amount is relabelled | `api/_routes/wealth/accounts/[id].ts:86` | No |
| medium | GET /api/wealth/summary runs a full daily FX backfill with one INSERT per day, run one after another, before answering | `api/_lib/fx-rates.ts:263` | No |
| medium | Planned/pending transfers bypass the debt-account guard | `api/_lib/wealth-accounts.ts:635` | No |
| medium | Deleting a Space with money fails when the destination account is in another currency | `src/pages/SpaceDetailPage.tsx:420` | No |
| medium | No UI to create a foreign Space or a foreign cash wallet, and cash wallets are uncapped server-side | `src/components/spaces/SpaceFormModal.tsx:64` | No |
| low | Archived extra cash wallets can never be restored, and PATCH refuses to archive any cash wallet | `api/_routes/wealth/accounts/[id].ts:155` | No |

*Unverified (low):*
- Space auto-save picker offers accounts the server will refuse (known-deferred)
- Balance adjustment in the same PATCH as a currency change is tagged with the old currency
- Edit dialog enables the currency picker based on live rows only, while the server also counts trashed rows and 409s with raw English
- Transfer wizard's insufficient-funds warning ignores the fee
- Planned transfer freezes the received amount; Mark done cannot record the real rate and drops the debit-card attribution (known-deferred)
- Stored amounts are always 2dp regardless of the currency's minor units (known-deferred)
- Reporting-currency change doesn't invalidate money reads
- Account balance adjustment is non-atomic and writes an absolute balance

*Refuted:* "'Reverse transfer' is offered on reversal legs, and the server reverses a reversal" (0/2). Not a bug.

**Decisions**
- **Cash wallets per currency:** should extra cash wallets count toward the free-plan bank allowance, or have their own cap? Should the UI offer "Add cash wallet" with a currency picker? Today the API allows unlimited ones and the UI allows none.
- **Spaces:** add a currency picker at creation, with the goal in the Space's currency? Allow cross-currency auto-save with an explicit rate policy (fixed received amount vs "rate at completion")?
- **Planned cross-currency transfers:** freeze the received amount at planning, or ask for or confirm it at "Mark done" (ARCHITECTURE Q1)?
- **Untouched market-rate prefill:** a received amount prefilled from the market rate and left untouched is stored with `rate_source='effective_transfer'`. Accept that, or mark it "estimated" / require explicit confirmation?
- **Reversal of a reversal:** allow it as a new transfer, or refuse it? The UI comment says originals only.
- **Fee refund date on reversal:** the refund is dated at reversal time, so reports convert it at a different rate than the original fee, leaving a small P&L residual. Date it at the original fee date, or accept the residual?
- **Account-scoped transaction summary** (`/wealth/:id` stats): native account currency, or the reporting currency with a label?
- **Hero for multi-currency workspaces while the summary loads or fails:** skeleton, native per-currency totals, or the last cached summary with "as of"?
- **Account currency change policy:** allow it only when balance = 0 AND no rows, rules, cards or planned transfers reference the account? Should a renamed "Cash in Hand" stay the permanent default (today keyed on `bank_name`)?
- **Archiving/deleting a bank or cash account with a non-zero balance** removes it from net worth, whereas Spaces must be at zero first. Keep that, or require a zero balance or a transfer-out first?

**Existing tests**
- `src/lib/money.test.ts` — currency normalization, Decimal arithmetic, `CurrencyMismatchError`, `convertMoney` direction. `transferAmounts`: native principals, rate direction, fee outside FX, missing cross-currency amount, same-currency equality, precision and negative fee. `reversalTransferAmounts` fee refund.
- `src/lib/multi-currency-migration.test.ts` — static checks on migrations 0069-0073: schema columns, no amount rewrites, backfill order, multiple cash wallets vs the unique default, transfer header linkage, fee/rate provenance and same-currency check, and the row-locked completion function.
- `src/lib/wealth-ledger.test.ts` — `balanceDelta`/`reverseDelta` signs, `reversalsByAccount`/`applicationsByAccount`, and system rows not being reversed on trash/restore.
- `src/lib/wealth-spendable.test.ts` — `accountSpendableLabel`: bank balance vs a card's remaining credit, privacy masking.
- `src/lib/recurring-transfer.test.ts` — leg shape and idempotency anchor of the legacy `buildRecurringTransferLegs` (auto-save now delegates to `createTransfer`).
- `src/lib/spaces.test.ts` — Space goal math, which does not depend on currency: progress, `suggestedMonthly`, goal status, `monthlyEquivalent`, `autoSavePace`.
- `api/_lib/spaces.test.ts` — `parseGoal` / `parseTargetDate` validation, including `MAX_MONEY`.
- `api/_lib/fx-rates.test.ts` — Frankfurter/open.er-api parsing, an unsupported pair raising `FxUnavailable` (never 1), series parsing, `convertAmount` rounding.
- `api/_lib/fx-provider.test.ts` — cached provider: TTL, coalescing, immutable historical cache.
- `api/_lib/tx-sql.test.ts` — P&L SQL predicates, including the reporting-currency conversion helpers and missing-rate counts (transfers excluded, fee counted).
- `e2e/multi-currency.spec.ts` covers:
  - EUR/INR cash wallets keep their native currency.
  - `/api/wealth/summary` converts: net worth ≠ raw sum, `by_currency` present.
  - A cross-currency transfer with a fee stores both native amounts and rate 102.70, and only the fee counts as an expense.
  - A reversal restores the native amounts exactly once.
  - A planned transfer moves money only when completed, and a cancelled one never moves it.
  - `/wealth` tiles show ₹/€ with ≈ values, plus the "By currency" card.
- `e2e/credit-card.spec.ts` — card payment as a transfer; trash/restore/edit of transfer legs applied exactly once (same currency only).

### 3.4 Transactions, splits, refunds, trash

**Readiness:** partial. The core is in place. Every create, split and edit path stamps the account's currency on the row. The global list returns native amounts plus `reporting_amount`, and the /transactions summary strip converts each row at its own date and reports `excluded_count` through FxExcludedNotice. Trash, restore and bulk delete move balances per account in native money, and transfer legs go through the atomic `set_transfer_trashed`.

The gaps are at the edges, and some were confirmed on the dev DB:
- The summary does not exclude `is_system` rows. One USD workspace shows Income $2,943.70 when its real income is $0.
- The account page formats a reporting-currency summary with the account's symbol. An INR account in an EUR workspace shows "₹180.60" for a ₹20,000 row.
- A transfer's fee row is an ordinary standard row that carries a `transfer_id`. It can be trashed or edited on its own, and reversing the transfer then refunds the fee a second time.
- Several screens print native amounts with the org symbol: Trash, the dashboard peek, global search, the admin tab, and the detail modal when opened from a deep link.
- Several client and server checks are missing: optimistic deletes, cross-currency edits, cross-currency splits, archived-account edits, and PATCH onto Spaces or debts.

This area has no CSV export and no daily-total headers.

#### What changes / what is affected

**Schema**
- _No touchpoints recorded for this area. The FX SQL function from `drizzle/0074` is listed under FX._

**Writes**
- `api/_routes/transactions.ts` — POST handler (lines 412-506) — ⚠️ partial — copies `account.currencyCode` onto the row (line 480) and applies the native `balanceDelta`. Unlike PATCH, there is no guard when the account currency is NULL.
- `api/_routes/transactions/[id].ts` — PATCH (lines 89-225) — ⚠️ partial — re-reads the currency from the new account (158-172) and applies native deltas per account. Keeps the same number when the currency changes. Archived account → 409 `currency_missing`. No account-type guard and no `is_system` guard. Transfer fee and fee-refund rows can be edited freely.
- `api/_routes/transactions/[id].ts` — DELETE (lines 227-276) — ⚠️ partial — transfer legs go through `setTransferTrashed` (atomic), and splits trash every leg natively. A fee row alone takes the standard path, so the header's `source_fee_amount` is left unchanged.
- `api/_routes/transactions/group.ts` — POST split create (lines 62-201) — ⚠️ partial — each leg copies its account's currency (line 164) and shifts balances natively per account. There is no server-side same-currency check (only the UI enforces it, in AccountSelector) and no NULL-currency guard.
- `api/_routes/transactions/bulk-delete.ts` — handler (lines 31-71) — ⚠️ partial — transfers go through the service once each, and other legs are reversed natively per account. A fee row selected on its own is deliberately trashed as an ordinary expense (comment at 34-40).
- `src/lib/wealth-ledger.ts` — `balanceDelta` / `reversalsByAccount` / `applicationsByAccount` — ✅ correct — groups by account, so native amounts are only ever added within one currency.
- `api/_routes/trash/restore.ts` — type=transaction (lines 23-80) — ⚠️ partial — transfer legs are restored atomically and splits re-applied natively. Restoring a fee row on its own brings back a fee for a transfer that is still trashed.
- `api/_routes/trash/purge.ts` — type=transaction (lines 22-44) — ⚠️ partial — purges transfer legs by `group_id`. The fee row (`group_id` NULL, `transfer_id` set) is left orphaned in Trash, and the transfers header stays behind with `deleted_at` set.
- `api/_routes/trash/clear.ts` — handler — ✅ correct — does not touch balances for trashed rows. Live rows of trashed clients are reversed natively per account.
- `api/_routes/admin/transactions.ts` — GET/POST/PATCH/DELETE — ⚠️ partial — POST copies the currency via `currencyForFinancialWrite`. GET omits `currency_code`. PATCH changes the amount without re-syncing balances or checking transfer ownership. DELETE hard-deletes without reversing balances.
- `api/_lib/wealth-accounts.ts` — `reverseTransfer` (~line 579) + `src/lib/money.ts` `reversalTransferAmounts` (line 151) — ⚠️ partial — refunds the header's `source_fee_amount` without checking that the fee row is still live.
- `src/pages/TransactionsPage.tsx` — `openEditTx` / `handleEdit` (lines 551-652) — ⚠️ partial — editing a split is a DELETE (to Trash) followed by POST `/group`, which is not atomic. A single-row edit PATCH sends the amount unchanged when the account's currency changes.
- `src/components/transactions/AddTransactionDialog.tsx` — save → POST `/api/transactions/group` (lines 350-390) — ✅ correct — the server stamps the currency per leg. The `onCreated` amount is native and only used for the toast.
- `api/_lib/ai.ts` — `loadOrgAiContext` / `promptRules` (lines 157-199, 314) — ⚠️ partial — AI quick add only knows `organizations.currency`. The account list it gets has no currencies, so "paid 50 EUR from Revolut" can't be matched to the EUR account.
- `src/components/wealth/AccountQuickAddSheet.tsx` — save PATCH (line 182) — ✅ correct — never changes the account, so the currency never changes. It still hits the archived-account 409.

**Aggregates**
- `api/_routes/transactions.ts` — `groupedFieldsFor` amount/currencyCode/reportingAmount (lines 82-113) — ⚠️ partial — a mixed-currency split sums `reporting_amount`, but SQL `sum()` skips NULLs, so a leg with no rate silently drops out of `amount` (the comment at 108 claims the result is NULL). `reportingAmount` correctly uses `bool_or`. `currency_count` is returned but the UI never uses it.
- `api/_routes/transactions.ts` — GET `?page` summary (lines 319-379) — ⚠️ partial — converted per row, and returns `currency` + `excluded_count`. But `summaryWhere` lacks `eq(transactions.isSystem, false)`, which `tx-sql.ts:25` says callers must add. For `?wealthAccountId` and `?cardId` it still returns the reporting currency, while the page that reads it formats in the account currency.
- `api/_routes/transactions.ts` — `pickOrder` / `groupedOrder` (lines 23-35, 128-140) — ❌ missing — `amount_desc`/`amount_asc` sort by raw `amount::numeric` or `sum(amount)` across currencies.
- `api/_lib/tx-sql.ts` — `incomeSumSqlIn` / `expenseSumSqlIn` / `missingRateCountSql` / `reportingAmountSql` — ✅ correct — each row is converted at its own date, rows with no rate are counted, refunds are negative and transfers excluded. Pinned by `tx-sql.test.ts`.
- `src/lib/tx-grouping.ts` — `summarizeLegs` — ❌ missing — adds raw amounts across legs regardless of currency. Dead code today (only its test imports it).

**Displays**
- `src/lib/reporting-fields.ts` — `rowCurrency` / `reportingAmountOf` / `sumInReporting` — ✅ correct — the right helpers, but they have no unit test file.
- `src/pages/TransactionsPage.tsx` — TransactionRow `fmt` (lines 99-103, 213) — ✅ correct — formats each row with `rowCurrency(tx)`, the native symbol. The header of a mixed-currency split shows a converted total with no "approximate" marker.
- `src/pages/TransactionsPage.tsx` — summary strip (lines 506-512, 863-876) — ✅ correct — uses `summary.currency` and `FxExcludedNotice(excluded_count)`.
- `src/pages/TransactionsPage.tsx` — `handleDelete` / `handleBulkDelete` optimistic summary (lines 655-673, 801-829) — ❌ missing — subtracts native amounts from reporting-currency totals and counts a refund as income. Bulk delete drops `currency` and `excluded_count`. Nothing reconciles after success, because the page does not use `useDataRefresh`.
- `src/pages/TransactionsPage.tsx` — view modal + deep-link effect (lines 454-472, 1010-1100) — ⚠️ partial — rows that come from the list format natively. The deep-link path fetches GET `/api/transactions/:id`, which has no `currency_code`, and keeps that copy even after the list loads.
- `src/components/transactions/tx-form.tsx` — `budgetHint` / `spendingHint` (lines 277-294) — ❌ missing — adds the native allocation total to `budget.spent`, which is in the budget's currency, and formats the result with the org currency.
- `src/components/TransactionPeekModal.tsx` — amount (line 46) — ❌ missing — formats `tx.amount` with the org currency prop and ignores `tx.currency_code`.
- `src/components/TransactionDetailModal.tsx` — `fmt` (line 71) — ✅ correct — uses `tx.currency_code ?? currency` (account, card and recurring pages).
- `src/pages/TrashPage.tsx` — `fmtAmount` (lines 38-39, 194) — ❌ missing — org currency, 0 decimals. The API returns no currency.
- `src/components/GlobalSearchDialog.tsx` — transaction result amount (line 200) + `MobileSearchOverlay.tsx:313` + `api/_routes/search.ts:44-50` — ❌ missing — the search API omits `currency_code`, and both screens format with the org currency.
- `src/pages/WealthAccountDetailPage.tsx` — stats (lines 116, 219-244, 383) — ❌ missing — formats the reporting-currency summary from `/api/transactions?wealthAccountId` with the account currency.
- `src/pages/ClientDetailPage.tsx` — row + view amounts (lines 633, 869) — ✅ correct — `rowCurrency` per row. Its edit flow mirrors TransactionsPage and has the same problem of keeping the number when the currency changes.
- `src/pages/admin/AdminOrgDetailPage.tsx` — TransactionsTab (lines 636-842) — ❌ missing — says "Amounts are in {org currency}" and prints raw `tx.amount`.
- `src/pages/Dashboard.tsx` — LatestTransactionsCard (line 546) — ✅ correct — `rowCurrency` per row, but it passes the org currency to TransactionPeekModal (line 1618).

**FX**
- `drizzle/0074_fx_reporting_amount.sql` — `fx_rate_on` / `reporting_amount` — ✅ correct — uses the latest rate on or before the date, falls back to the inverse rate, and returns NULL when no rate is known. A NULL currency is treated as the reporting currency (legacy rows).
- `api/_lib/fx-rates.ts` — `ensureRatesForOrg` / `ensureHistoricalRates` (lines 231-305) — ✅ correct — fills daily history back to the earliest foreign row. Frankfurter has no AED/SAR history (open.er-api only has current rates), so back-dated AED/SAR rows are excluded. That is the realistic way to test `excluded_count`.
- `api/_lib/transaction-currency.ts` — `currencyForFinancialWrite` — ✅ correct — the account's currency wins, and rows with no account use the reporting currency.

**Validation**
- `src/components/AccountSelector.tsx` — `optionCurrency` / `activeCurrency` / `wrongCurrency` / `selectSingle` (lines 64-72, 133-165, 251-263) — ⚠️ partial — a split is limited to one currency, with a note on each blocked tile, and tile balances are native. `selectSingle` carries the typed amount over to an account in another currency.

**API contracts**
- `api/_routes/transactions.ts` — `txFieldsFor` (lines 42-73) — ✅ correct — flat rows return native `amount` + `currency_code` + `reporting_amount`, which `rowCurrency`/`reportingAmountOf` consume.
- `api/_routes/transactions/[id].ts` — GET (lines 33-87) — ❌ missing — the select list omits `currency_code`/`reporting_amount`, and the split aggregate adds raw amounts across legs (line 80). Every `?view=<id>` deep link uses it (search, flow, notifications, attachments, peek).
- `api/_routes/trash.ts` — `txFields` (lines 7-19) — ❌ missing — trashed rows come back without `currency_code`, `kind`, `group_id`, `transfer_id` or the wealth account.

**Other**
- `api/_lib/tx-legs.ts` — `resolveTxLegs` — — not needed — expands ids into split legs. Currency doesn't matter here because every balance shift is per account, and each account has one currency.
- `src/lib/tx-classify.ts` — `refundShapeValid` / `expenseContribution` — — not needed — classification doesn't depend on currency. Refunds net against expense in whatever currency the caller converts to.
- `src/components/QuickAddModal.tsx` — client/quotation quick add — — not needed — writes no transaction money.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | Trashing a transfer's fee row alone, then reversing the transfer, refunds the fee twice | `api/_routes/transactions/[id].ts:232` | No |
| high | /transactions summary counts system Opening Balance / Balance Adjustment rows (incl. debt opening rows) as income or expense | `api/_routes/transactions.ts:319` | No |
| high | Account page Income/Expenses/Net show reporting-currency numbers with the account's currency symbol | `src/pages/WealthAccountDetailPage.tsx:383` | No |
| high | Transfer fee and fee-refund rows can be edited through PATCH, so the ledger no longer matches the transfer record | `api/_routes/transactions/[id].ts:106` | No |
| high (raised from medium) | PATCH has no account-type or system guard: rows can be moved onto Spaces or debts, and a debt's system Opening Balance can be moved off the loan | `api/_routes/transactions/[id].ts:157` | No |
| medium (lowered from high) | Optimistic delete and bulk delete subtract NATIVE amounts from the converted summary, count a refund as income, and never reconcile | `src/pages/TransactionsPage.tsx:662` | No |
| medium | GET /api/transactions/:id omits `currency_code` and adds raw amounts across split legs, so a deep-linked detail shows the org symbol | `api/_routes/transactions/[id].ts:37` | No |
| medium | Mixed-currency split row shows a silently partial total when a leg has no rate | `api/_routes/transactions.ts:109` | No |
| medium | Server accepts splits across accounts in different currencies | `api/_routes/transactions/group.ts:88` | No |
| medium | Editing a row onto an account in another currency keeps the number, so the amount silently changes currency | `api/_routes/transactions/[id].ts:168` | No |
| medium | Rows on an archived account can no longer be edited (409 "currency migration is incomplete") | `api/_routes/transactions/[id].ts:167` | No |
| medium | Trash list shows every trashed amount with the org currency, rounded to whole units | `src/pages/TrashPage.tsx:194` | No |
| medium | Dashboard transaction peek modal formats with the org currency | `src/components/TransactionPeekModal.tsx:46` | No |
| medium | Global search shows transaction amounts with the org currency | `api/_routes/search.ts:44` | No |
| medium | Budget impact hint in the transaction form mixes currencies | `src/components/transactions/tx-form.tsx:277` | No |
| medium | Editing a split trashes the old group and recreates it. This is not atomic, and restoring the old version from Trash counts the money twice | `src/pages/TransactionsPage.tsx:611` | Yes |

**Unverified (low):**
- Purging a trashed transfer leaves its fee row orphaned in Trash.
- Sorting by amount compares raw native numbers across currencies.
- The header of a mixed-currency split shows a converted total with no "approximate" marker, and `currency_count` is unused.
- Admin transactions tool: amounts are labelled in the org currency, and PATCH/DELETE skip balance updates and transfer checks (known-deferred).
- The single-row create and split writers don't refuse an account with a NULL `currency_code` (known-deferred).
- AI quick add can't express a foreign-currency amount.
- `summarizeLegs` sums raw amounts across currencies (dead code).

**Refuted:** none.

#### Decisions

- **System rows in /transactions.** Should system rows (Opening Balance, Balance Adjustment, debt opening rows) appear in the global /transactions list at all? Either way the summary must exclude them, as analytics, calendar and flow already do. If they stay listed, should they be read-only and badged?
- **Account-scoped summary currency.** Should `GET /api/transactions?wealthAccountId|cardId&page=` return NATIVE totals in the account currency (recommended)? The alternative is reporting totals that the account page then labels as converted.
- **Cross-currency splits.** Should the server forbid them (recommended; matches the web UI and needs a native-app release)? Or should they be supported, with a converted header marked "≈"?
- **Refunds in another currency or long after the purchase.** One option is to keep converting at the refund's own date. That is today's behaviour, and a fully refunded foreign purchase leaves an FX difference in net expense (per ARCHITECTURE L). The other is to add a `refund_of` link and convert at the original purchase's rate.
- **Moving a row to an account in another currency.** Keep the number (today's behaviour), convert at the rate on the row's date, or make the user re-enter the amount?
- **Transfer fee and fee-refund rows.** May they be trashed, restored or edited independently of their transfer? If yes, reversal must refund only the live fee. If no, every row with a `transfer_id` must go through the transfer service.
- **Sort by amount in a mixed-currency workspace.** Sort by reporting amount (nulls last), or keep sorting by native amount?
- **Editing a split.** Should there be one atomic server "replace" endpoint instead of today's DELETE+POST, which leaves a restorable copy in Trash?
- **Admin transaction tools.** Must admin edits and deletes keep wealth balances and transfer headers in sync, or should they be limited to rows with no account?

#### Existing tests

- `api/_lib/tx-sql.test.ts` — the SQL versions of the income/expense/refund/transfer rules, plus the reporting-currency variants (`reporting_amount` per row at the row's date, `missingRateCountSql`).
- `src/lib/tx-classify.test.ts` — a refund is incoming and nets against expense. Transfers and system rows count as neither. Also covers `refundShapeValid`.
- `src/lib/tx-grouping.test.ts` — `summarizeLegs` raw sum and account count, and `isSplitTx`. Neither looks at currency.
- `src/lib/wealth-ledger.test.ts` — `balanceDelta`, `reversesOnTrash`, and the per-account grouping in `reversalsByAccount`/`applicationsByAccount` that delete, bulk delete, restore and purge use.
- `src/lib/money.test.ts` — Decimal `Money` invariants, `transferAmounts`, and `reversalTransferAmounts` (the fee refund taken from the transfer header).
- `src/lib/multi-currency-migration.test.ts` — the shape of the backfill SQL in migrations 0069-0076 (currencies copied onto rows, no amounts rewritten).
- `api/_lib/budget-spend.test.ts` — budget filters exclude transfers and system rows, and refunds count negative.
- `e2e/multi-currency.spec.ts` — account native currency, consolidated wealth, a cross-currency transfer with a fee (the fee is the only expense), reversal refunds the fee, and a scheduled transfer. It has no cases for the transactions list, splits, trash or fee rows.
- `e2e/credit-card.spec.ts` — a refund reverses spending, not income. Trash, restore and edit reverse and re-apply exactly once (same currency only).
- `e2e/smoke.spec.ts` — create a transaction and see it in the list, plus the client-delete cascade and purge.
- `e2e/cards.spec.ts` — card attribution on `/api/transactions/group`. It uses bulk delete and trash clear for cleanup.

### 3.5 Recurring rules

**Readiness:** partial. The server write path mostly handles currency correctly. When a rule is created or edited, `currency_code` is copied from the account through `currencyForFinancialWrite`. The materializer posts that stored currency and pauses rules that have none. Debt repayments are refused as `currency_mismatch` at every entry point, and a Space auto-save between two currencies is refused at setup.

Three server gaps remain:
- An account's currency can be changed while rules still point at it, because the lock counts only transactions.
- When an auto-save transfer fails, the cursor still advances and `last_error` is cleared, so the occurrence is lost without any trace.
- Edits change the currency without warning. A rule moved to an account in another currency keeps the same number. A rule with no account takes on the new reporting currency after the org currency changes.

On the read side, `posted_total` is a raw `sum(amount)` across currencies. Almost every recurring screen formats amounts in the workspace currency: the list, the detail page, the edit sheet, the create/edit dialog, the card page's upcoming charges and the Space auto-save line. The dashboard Recurring card, the alerts rail, the link-debt pickers and the transaction detail modal are already right: they use per-currency totals or the row's own currency.

Tests cover only schedule math and the debt link check. No unit, API or e2e test puts a recurring rule in a non-reporting currency. The dev DB has no foreign-currency rules (all 10 match their account and org currency), so every UI check needs its own setup.

#### What changes / what is affected

**Schema**
- No schema touchpoints recorded for this area. `recurring_rules.currency_code` already exists (asserted by `src/lib/multi-currency-migration.test.ts`).

**Writes**
- `api/_routes/recurring.ts:61-62` — POST handler (`currencyForFinancialWrite`) — ✅ correct — The rule's currency is the attributed account's currency. Returns 409 `currency_missing` when the account has none. A rule with no account gets the org reporting currency.
- `api/_routes/recurring/[id].ts:187` — PATCH full-edit currency re-copy — ⚠️ partial — Copies the currency from the new account but keeps the same amount number, so the amount silently changes currency. A rule with no account re-reads the *current* org reporting currency, so any edit after an org currency change flips the rule's currency.
- `api/_routes/recurring/[id].ts:90-115` — PATCH pause/resume — — not needed — Does not touch `currency_code`.
- `api/_lib/recurring-materialize.ts:147-151, 190-225` — standard occurrence insert + balance change — ⚠️ partial — Posts `rule.currencyCode` and adds `rule.amount` to the balance, but never compares it with the account's current `currency_code`: the account check at 118-124 selects only `archivedAt`. The insert and the balance update are two separate statements (known deferred).
- `api/_lib/recurring-materialize.ts:162-188, 295-302` — Space auto-save branch via `createTransfer` — ❌ missing — `createTransfer` rejects cross-currency and `currency_missing`, but the failure `continue`s only the inner loop. The cursor then advances and `last_error` is reset to `''`. `sourceCurrency: rule.currencyCode` is not passed.
- `api/_lib/recurring-debt.ts:57-117` — `postDebtOccurrences` → `recordDebtPayment` (`debts.ts` 419-426, 517) — ✅ correct — The engine refuses a payer/debt currency mismatch: the rule pauses with `last_error` and the cursor stays put. All legs are stamped with `debtCurrency`. The interest, fee and counter legs carry the rule id; the debt-side leg does not.
- `api/_routes/debts.ts:341-356` — repayment rule insert — ✅ correct — `currencyCode` = the debt's currency, which is checked to equal the payer's.
- `api/_routes/debts/[id].ts:402-440` — repayment upsert — ✅ correct — `currencyCode = acc.currencyCode ?? currency`.
- `src/components/recurring/RecurringRuleDialog.tsx:238, 429` — `candidate.accountCurrency` + new debt currency — ✅ correct — A new debt is created in the paying account's currency. The pickers run the same check as the server.
- `src/lib/recurring-transfer.ts` — `buildRecurringTransferLegs` — ⚠️ partial — Dead code (only its test imports it). It builds legs with no `currency_code` and no transfer header, and must not be brought back.

**Aggregates**
- `api/_lib/recurring-query.ts:79-82` — `ruleStatsFields.postedTotal` — ❌ missing — Raw `sum(t.amount)` over every row with the rule id, whatever its `currency_code` (and type). Returns no currency and no `excluded_count`.
- `api/_lib/recurring-materialize.ts:262-264` — `notifyIfBudgetExceeded` call — ✅ correct — `api/_lib/notify-budget.ts` formats spend in the budget's currency, with FX via `ensureRatesForOrg`.
- `api/_routes/spaces/[id]/auto-save.ts:54-57` — `withDerived` `monthly_equivalent` — ✅ correct — One rule, so one currency.
- `api/_lib/alerts.ts:142-183, 315` — `recentlyPosted` / rule currency — ✅ correct — Posted sums are grouped by the account's `currency_code`. The rule's currency comes from the account.
- `src/pages/RecurringDetailPage.tsx:323, 433` — `postedTotal` — ❌ missing — Shows the raw mixed-currency `posted_total` with the org symbol.
- `src/components/recurring/RecurringCard.tsx:50-80, 161` — summary `inBy`/`outBy` per currency, next payment — ✅ correct — Monthly equivalents per currency, joined with ` + ` (`formatByCurrency`). The next payment is shown in its own currency.

**Displays**
- `api/_lib/recurring-materialize.ts:79-96, 233-288` — `recurring_posted` / `space_autosaved` / `debt_payment` notifications — — not needed — The text carries only a name and a count, no amounts.
- `src/pages/RecurringPage.tsx:223` — `renderRule` amount — ❌ missing — `formatMoney(rule.amount, currency)` uses the workspace currency, not `rule.currency_code`.
- `src/pages/RecurringDetailPage.tsx:306-307` (used at 414, 433, 569) — `money()`/`signed()` — ❌ missing — Each payment, Posted so far and every payment row use the org currency. `tx.currency_code` and `rule.currency_code` are ignored.
- `src/pages/RecurringDetailPage.tsx:589` — `TransactionDetailModal` currency prop — ✅ correct — The modal uses `tx.currency_code ?? currency` (`TransactionDetailModal.tsx:71`).
- `src/pages/RecurringDetailPage.tsx:601` — `AccountQuickAddSheet` currency — ❌ missing — Passes the org currency; `WealthAccountDetailPage` passes `accountCur`. The amount prefix is wrong when editing a payment on a foreign-currency account.
- `src/components/recurring/RecurringRuleDialog.tsx:227` (used at 544, 649, 656) — `symbol = getCurrencySymbol(currency)` — ❌ missing — The amount and the new-debt original/balance inputs always show the workspace symbol, while the save posts in the chosen account's currency.
- `src/components/recurring/RecurringRuleDialog.tsx:756, 737` — `previewPerYear`, `DebtPreviewCard` currency — ❌ missing — The yearly cost and the debt payoff preview are formatted in the org currency.
- `src/components/recurring/RecurringRuleDialog.tsx:624, 586-594` — debt select labels, `AccountCombobox` — ✅ correct — Debt balance in `d.currency`; each account's balance in its own currency.
- `src/components/debts/LinkRepaymentDialog.tsx:85, ~150` — eligible rules + amount — ✅ correct — Only rules in a compatible currency are listed, so formatting with `debt.currency` is right. The only edge case is a legacy rule with NULL currency.
- `src/pages/CardDetailPage.tsx:110, 507` — upcoming recurring charges `fmt` — ❌ missing — Rule amounts on a card page use the org currency, not the card account's or the rule's currency.
- `src/pages/SpaceDetailPage.tsx:213, 346` — `autoSaveOn` amount, `AutoSaveModal` source picker — ⚠️ partial — The auto-save amount uses the org currency. The source list is not filtered to the Space's currency, so the server's English 409 message is the only guard.

**FX**
- `api/_routes/organizations/[id].ts:72-79` — PATCH currency → `reportingCurrency` — ⚠️ partial — Does not touch rules, but it changes what `currencyForFinancialWrite` returns for rules with no account on their next edit.
- `api/_lib/transaction-currency.ts:7-24` — `currencyForFinancialWrite` — ⚠️ partial — Correct when the write has an account. For rules with no account, callers should keep the rule's stored currency instead of re-reading the reporting currency.

**Validation**
- `api/_routes/recurring.ts:73-99` — POST with `debt_account_id` (`refusalForNew`) — ✅ correct — The payer's currency is passed to `linkRefusal` and compared with `debtCurrencyOf`. A mismatch returns 400 `currency_mismatch`.
- `api/_routes/recurring/[id].ts:154-166` — PATCH debt payer currency check — ✅ correct — Refuses a payer whose currency differs from the debt's (`currency_mismatch`). Skipped when the payer's currency is NULL (legacy).
- `api/_lib/recurring-debt.ts:174-314, 327-381` — `linkRuleToDebt` / `refusalForNew` / `payerShape` — ✅ correct — Passes `accountCurrency` to `linkRefusal` (`src/lib/debt-recurring.ts:292`). An unknown currency on either side is allowed (legacy).
- `api/_routes/spaces/[id]/auto-save.ts:83-84, 111, 134` — PUT — ✅ correct — Refuses a source/Space currency mismatch with 409 `cross_currency_recurring_policy_required`. The rule's currency is the source's currency.
- `api/_routes/wealth/accounts/[id].ts:83-91` — PATCH currency lock — ❌ missing — The lock fires only when a transaction row exists, or for credit cards and Spaces with a goal. Recurring rules (as payer, card, or auto-save source or destination) are not checked, which contradicts ARCHITECTURE.md line 117.
- `src/components/recurring/LinkDebtDialog.tsx:70, 157` — `candidate.accountCurrency` / debt balance — ✅ correct — Same check as the server; balances shown in `d.currency`.

**API contracts**
- `api/_routes/recurring.ts:37-50` — GET list — ✅ correct — Returns `currency_code` and `account_currency` per rule (`ruleFields`). Materializes due occurrences first (`ALWAYS_FETCH`).
- `api/_lib/recurring-query.ts:40, 60` — `ruleFields.accountCurrency` / `currencyCode` — ✅ correct — Exposes both the rule's stored currency and the account's live currency. The UI mostly ignores them.
- `api/_routes/transactions.ts:202-217, 356-376` — GET `?recurringRuleId=` — ✅ correct — Rows carry `currency_code` and `reporting_amount`. The summary is converted row by row and returns `excluded_count`, which the detail page ignores.

**Other**
- `src/lib/recurring-preview.ts` — `previewRecurring` `perYear` — — not needed — Returns a plain number with no currency. The caller must format it in the account's currency.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high (reported critical) | An account's currency can be changed while recurring rules post to it, so occurrences land in the old currency on the new-currency account | `api/_routes/wealth/accounts/[id].ts:83` | no |
| high | Editing a rule with no account after an org currency change flips the rule's currency | `api/_routes/recurring/[id].ts:187` | no |
| high | Rule dialog shows the workspace currency symbol on the amount and new-debt inputs, but saves in the account's currency | `src/components/recurring/RecurringRuleDialog.tsx:227` | no |
| medium (reported high) | A failed Space auto-save transfer is silently skipped: the cursor advances and `last_error` is cleared | `api/_lib/recurring-materialize.ts:182` | no |
| medium (reported high) | Moving a rule to an account in another currency silently changes the currency of its amount | `api/_routes/recurring/[id].ts:187` | no |
| medium (reported high) | Posted so far is a raw mixed-currency sum shown with the workspace symbol | `api/_lib/recurring-query.ts:79` | no |
| medium | Recurring list formats every rule amount in the workspace currency | `src/pages/RecurringPage.tsx:223` | no |
| medium | Rule detail page: Each payment and every payment row use the workspace currency | `src/pages/RecurringDetailPage.tsx:306` | no |
| medium | Editing a posted payment from the rule page puts the workspace symbol on the amount | `src/pages/RecurringDetailPage.tsx:601` | no |
| medium | Dialog previews (per-year cost, debt payoff card) are formatted in the workspace currency | `src/components/recurring/RecurringRuleDialog.tsx:756` | no |
| medium | Card page "Upcoming" recurring charges use the workspace currency | `src/pages/CardDetailPage.tsx:507` | no |
| medium | Space auto-save modal offers source accounts in other currencies and labels the rule in the workspace currency | `src/pages/SpaceDetailPage.tsx:346` | no |
| medium | Ordinary recurring occurrence insert and balance update are separate statements | `api/_lib/recurring-materialize.ts:190` | yes |

**Unverified (low):**
- A recurring Space auto-save between two currencies has no rate or destination-amount policy (`api/_routes/spaces/[id]/auto-save.ts:84`, known-deferred).
- Currency-related `last_error` strings are English server text shown as-is on the rule page (`src/pages/RecurringDetailPage.tsx:402`).
- The dead helper `buildRecurringTransferLegs` builds transfer legs with no currency (`src/lib/recurring-transfer.ts:48`).

**Refuted:** none.

#### Decisions
- **Lock or follow:** when an account has recurring rules (as payer, card account, or auto-save source or destination), should its currency be locked (ARCHITECTURE.md line 117 says yes)? Or should changing it pause the rules with a visible reason?
- **Moving a rule to an account in another currency:** keep the number and change the currency (today's behaviour), convert the amount at today's rate, or make the user re-enter the amount in the new currency?
- **Rules with no account:** confirm that their currency is fixed at creation and never re-read from the reporting currency on edit. Also decide whether the dialog should show that currency with its own picker.
- **"Posted so far" on `/recurring/:id`:** show native per-currency parts, a reporting-currency total converted at each row's date with `excluded_count`, or both (≈ converted total plus the breakdown)?
- **Dashboard Recurring card:** keep per-currency parts only, or also show "≈ reporting total" when every rate is available?
- **Space auto-save between two currencies:** keep refusing it, or add a policy (fixed destination amount, or calculate at completion with an estimate)?
- **Blocked occurrences:** when an occurrence is blocked by currency (drift or mismatch) and later fixed, should the missed occurrences be posted afterwards (the current catch-up behaviour), or should the schedule restart from today, as it does when a debt resumes?

#### Existing tests
- `src/lib/recurring.test.ts` — `occurrenceAt` / `occurrencesDue` / `firstIndexAtOrAfter` / `ruleExhausted`: schedule math, the catch-up cap, month-end clamping, end dates. No currency.
- `src/lib/recurring-preview.test.ts` — `previewRecurring` dates, `perYear`, the backdated and neverRuns flags. No currency (the number only).
- `src/lib/recurring-transfer.test.ts` — the dead helper `buildRecurringTransferLegs`: leg shape and balance changes. One amount, no currency.
- `src/lib/debt-recurring.test.ts` — `linkRefusal`/`isLinkable`, including `currency_mismatch` (lines 245-250): a EUR payer against a USD debt is refused, the comparison ignores case, and an unknown currency is allowed.
- `src/lib/alerts.test.ts` — alert amounts labelled with the account's currency (lines 437+), including upcoming and posted recurring alerts.
- `src/lib/multi-currency-migration.test.ts` — the schema exposes `recurring_rules.currency_code`.
- `api/_lib/notify-budget.test.ts` — budget-breach notifications triggered by materialized spend, formatted in the budget's currency.
- `src/lib/api-cache.test.ts` — `/api/recurring` is `ALWAYS_FETCH` (it materializes) and writes invalidate the right reads.
- `e2e/recurring-debt.spec.ts` — dialog flows: create a debt from a new rule, a rhythm with no name, required category, keep/clear draft. All in one currency.
- `e2e/multi-currency.spec.ts` — EUR/INR fixture wallets (`e2e-ux4-mc-eur` / `-mc-inr` in a USD personal workspace), cross-currency transfers, combined wealth totals. No recurring coverage.
- `e2e/alerts.spec.ts` — the attention rail, including alerts that come from recurring rules (one currency).
- `e2e/smoke.spec.ts` — `/recurring` loads.

### 3.6 Cards & credit cards

**Readiness:** partial

The server-side card maths is safe per currency. Every card figure (debt, limit, available credit, filed statements, payments since close, cycle activity, a debit card's month spend) is computed over one ledger account, and every row on that account is snapshotted in the account's currency. Card payments go through `createTransfer`, so PayCardSheet can already pay a card from an account in another currency: it records both native amounts and the effective rate, and it refuses a missing received amount instead of treating it as 1:1.

What is missing is everything around that maths:
- **Creation currency:** a credit card's liability account always gets the workspace reporting currency, and that currency is locked from the moment the card is created.
- **Display:** the card API carries no currency, so every card surface formats native amounts with the workspace currency.
- **Cards tab totals:** the status bar adds "owed" and "available credit" across currencies with no conversion.
- **Autopay:** POST/PATCH `/api/cards` accept a funding account in another currency. At run time `transferAmounts` refuses that autopay, so it never pays. The statement is claimed and released on every card read, the card page keeps promising the payment, and the alerts rail projects the payment as a card-currency debit on the foreign funding account.

Foreign debit cards can be reached today: the dev DB has a debit card on the INR bank in the EUR Personal workspace. Foreign credit cards can be reached after a reporting-currency change. Both show the wrong currency symbol on the main card screens. In short, money writes are correct, but presentation, creation currency and autopay configuration are not.

#### What changes / what is affected

**Schema**
- `src/lib/db/schema.ts` — `wealth_accounts.currency_code` (the credit_card and bank rows behind cards) — ⚠️ partial — Card money lives on the account row, and `currency_code` is still nullable. On the dev DB there are 0 nulls on credit_card accounts and 0 card-account transactions with a mismatched or null currency. `cards` and `credit_card_statements` have no currency column, so `statement_balance` is implicitly in the account currency. That is safe only because the account currency cannot change once statements exist (`wealth/accounts/[id].ts:85`).

**Writes**
- `api/_routes/cards.ts` — POST `/api/cards`, credit branch (`createWealthAccount` call, L124-136) — ❌ missing — No `currency_code` is passed, so the liability account defaults to `org.reportingCurrency` (`api/_lib/wealth-accounts.ts:117`) and the issuer bank's currency is ignored. Funding defaults to the issuer bank (L154) even when that bank is in another currency. Autopay is accepted with no currency check (L168-171).
- `api/_lib/wealth-accounts.ts` — `createWealthAccount` — ⚠️ partial — Supports `currency_code` (falling back to the reporting currency) and snapshots it on the Opening Balance system row (L213). The card path never passes it, so the limit, current debt and seed statement are stored in whatever currency the account gets.
- `api/_lib/card-autopay.ts` — `autopayStatement` / `syncCards` — ⚠️ partial — Calls `createTransfer` with `amount` only (L136-152). For a funding account in another currency, `transferAmounts` throws, which becomes a 400 and then a "deferred" outcome. The claim is released with an `autopay_error` (L153-158), and a notification goes out with dedupe suffix `quota`. Every later card read claims and releases again. No money moves wrongly, but the due-soon notice was already suppressed because autopay "covers" the statement (L283-287).
- `api/_lib/wealth-accounts.ts` — `createTransfer` (a card payment is a transfer into the liability account) — ✅ correct — One atomic batch holds native source and destination amounts, a currency snapshot on each leg, the effective rate, an optional source fee and the credit card id on the incoming leg. It checks both currencies against the account currencies.
- `api/_lib/transaction-currency.ts` + `api/_routes/transactions.ts` / `transactions/[id].ts` / `recurring.ts` — `attributeCard` → currency snapshot — ✅ correct — The card decides the account and the account decides `currency_code` (`transactions.ts:420-480`, `[id].ts:135-170`, `recurring.ts:57-62`). Card purchases and refunds are therefore always in the card account's currency.

**Aggregates**
- `api/_lib/credit-card.ts` — `ensureStatements` / `movementAfter` / `paymentsAfter` / `loadCardSummary` — ✅ correct — Each sum runs over a single `wealth_account_id`, so it is native and needs no conversion. The incoming leg of a cross-currency payment is recorded in the card currency, which keeps `paymentsAfter` consistent.
- `src/lib/credit-card.ts` — `cardDebt` / `creditUsage` / `statementView` / `cycleActivity` / `debtAtClose` — ✅ correct — Pure per-account maths with `round2`. Callers must label the results with the account's currency, and most UI callers do not. Uses `Number`, not Decimal, on 2-decimal columns (known deferred).
- `src/components/cards/CardsSummaryStrip.tsx` — `stats` useMemo (L68-89), Figure render (L110-127) — ❌ missing — Adds `owed += debt` and `available += available` across every credit card with no conversion, then formats the totals in the workspace currency. The next-due amount is also in the workspace currency.
- `api/_lib/wealth-summary.ts` — `card_liabilities` — ✅ correct — Converts card debt per currency at the latest rate and lists currencies with no rate in `excluded_currencies`. The Cards tab strip does not use it.
- `src/pages/Dashboard.tsx` — `localCardsOwed` fallback (L588-589) — ⚠️ partial — Sums card debt across currencies until `/api/wealth/summary` lands, and keeps doing so if that call fails.
- `src/lib/alerts.ts` — `autopayEvents` (L349-367) → `projectShortfalls` (L382-401) — ⚠️ partial — Card alerts are labelled with the card account's currency (tested). The autopay projection applies −owed (card currency) to the funding account's balance (funding currency), which mixes currencies when the funder is in another currency.
- `api/_lib/alerts.ts` — `loadAlertInputs` (`currencyByAccount`, L267-297) — ✅ correct — Every card and account carries its native currency into the pure model.

**Displays**
- `src/components/wealth/PayCardSheet.tsx` — `PayCardSheet` — ⚠️ partial — Uses the card's own currency (L76). When the source is in another currency it asks for "Amount leaving <account> (<cur>)" and shows `formatRate` (L148-170, L258-265). It has no fee field for issuer conversion charges. It relies on the card prop carrying `currency_code`, which `accountFromCard` does not set (`types.ts:84`).
- `src/components/cards/CardTile.tsx` — `money()` (L199) + `DueStrip` (L424-466) — ❌ missing — Used / left / limit / over-limit (L316-361), the debit bank balance (L372-375) and the statement remaining (L464-465) are all formatted in the workspace currency.
- `src/components/cards/CardFanSheet.tsx` — `money()` (L65), owed / `availableAt` (L286-288) — ❌ missing — The phone card fan shows a card's owed amount and the debit bank balance in the workspace currency.
- `src/pages/CardDetailPage.tsx` — `fmt` (L110) + currency props (L337, L451, L469, L600, L609, L625) — ❌ missing — The page has `ledgerAccount.currency_code` but formats with `useCurrency()`: "Available at", spent/refunds this month, recurring rows (L507) and transaction rows (L568). It also passes the workspace currency to CreditCardPanel, AutopayPanel and AccountQuickAddSheet.
- `src/components/wealth/CreditCardPanel.tsx` — `money()` (L83) — ⚠️ partial — Formats with whatever `currency` the caller passes. WealthAccountDetailPage passes the account currency (correct), but that page redirects every card-backed account to `/wealth/cards/:id` (L258-262). The main card page passes the workspace currency (wrong).
- `src/components/cards/AutopayPanel.tsx` — `money()` (L45), next-autopay line (L110-115), funding combobox (L134-143) — ❌ missing — "Autopay: next <date> · <amount>" uses the workspace currency. The funding picker offers accounts in any currency with no warning. After a deferred failure the panel still shows "next" and hides "Pay manually".
- `src/components/cards/CardActionsMenu.tsx` — `payOffTitle` (L231) — ❌ missing — The "Pay off <debt> before closing" dialog formats the server's native debt in the workspace currency.
- `src/components/wealth/AccountQuickAddSheet.tsx` — `symbol = currencySymbol(currency)` (L75) — ⚠️ partial — The symbol on the Add purchase / refund / fee input. It is correct from WealthAccountDetailPage and wrong from CardDetailPage (L609). The row is still saved in the account currency.
- `src/components/cards/AddCardWizard.tsx` — `symbol = currencySymbol(useCurrency())` (L85-86); single-bank funding default (L146-157) — ❌ missing — The credit limit, current debt and statement inputs always carry the workspace symbol, including in edit mode for a card in another currency. Funding defaults to the issuer bank whatever its currency.
- `src/components/cards/wizard/BankPicker.tsx` — `createBank` (L134-141), bank list balance (L232) — ❌ missing — Inline bank creation has no currency choice; it uses the reporting currency, which is acceptable. The list shows every bank's balance in the workspace currency, so IDFC NRO's ₹20,000 appears as €20,000.00.
- `src/components/wealth/AccountCombobox.tsx` — option labels (L84-110) — ✅ correct — Each account or card option is formatted in its own account's currency.
- `src/components/TransactionDetailModal.tsx` — `fmt` (L71) — ✅ correct — Uses `tx.currency_code`, falling back to the caller's currency.
- `src/pages/WealthAccountDetailPage.tsx` — `accountCur` (L115) → CreditCardPanel / PayCardSheet / QuickAdd — ✅ correct — Native currency throughout, but because of the redirect at L262 it is only reached for legacy liability accounts with no card.
- `api/_lib/notify-cards.ts` — `money = n.toFixed(2)` (L17) — ❌ missing — Statement ready, due soon, overdue, autopay paid/failed and utilisation notifications carry bare numbers with no currency ("1000.00 due 2026-10-15"). The autopay-failed reason is the raw English server error.

**FX**
- `src/lib/money.ts` — `transferAmounts` (L110-148) — ✅ correct — Requires an explicit destination amount for a cross-currency transfer and stores the effective rate (destination per source). This is why a cross-currency autopay is refused instead of being posted 1:1.

**Validation**
- `api/_lib/cards.ts` — `resolveFunding` (L280-312) — ❌ missing — Checks only the funding account's type, archive state and self-pay. It never reads or returns the funding currency, so neither POST nor PATCH can refuse a cross-currency autopay.
- `api/_routes/cards/[id].ts` — PATCH funding/autopay (L116-155) — ❌ missing — Autopay can be switched on with a funding account in another currency. The only guard is liability vs asset.
- `src/components/cards/wizard/StepCredit.tsx` — funding `AccountCombobox` + autopay Switch (L90-130) — ❌ missing — The autopay switch is enabled for any asset funder, including one in another currency.
- `api/_routes/wealth/accounts/[id].ts` — PATCH currency lock (L76-91) — ⚠️ partial — A credit card's currency is locked from creation (`isCard` → `currencySensitiveConfig`), so a wrong default can never be fixed. A bank that funds a card's autopay, or carries a debit card, can still change currency while it has 0 rows.
- `src/lib/cards.ts` — `autopayEligible` / `autopayPreview` (L438-484) — ⚠️ partial — Ignores `autopay_error`, so a deferred statement still counts as eligible and is previewed as the next autopay.

**API contracts**
- `api/_routes/wealth/transfer.ts` — POST `/api/wealth/transfer` (`from_card_id`) — ✅ correct — Passes `source_amount`, `destination_amount`, `source_fee_amount` and both currencies through. A debit or credit card on the source side resolves to its own account.
- `api/_routes/cards/[id]/summary.ts` — GET `/api/cards/:id/summary` — ⚠️ partial — Returns native figures but no currency field. The debit card's `month_spent` / refunds are summed by `card_id`, which is fine because `attributeCard` pins every row to the card's account. `next_autopay` (L42-45) comes from `autopayPreview`, which ignores a deferred failure. `last_autopay` (L46-54) skips statements whose status was reset to null.
- `api/_lib/cards.ts` — `cardColumns` / `serializeCard` (L29-109) — ❌ missing — Selects the account's balance, limit and cycle days but not `wealth_accounts.currency_code`. GET `/api/cards`, GET `/api/cards/:id` and the summary's `card` therefore carry no currency. This is the root cause of the display issues.
- `src/lib/types.ts` — `Card` type (L560-610) — ❌ missing — No `account_currency_code` field.
- `src/components/cards/types.ts` — `accountFromCard` (L84-103) — ❌ missing — Builds a WealthAccount from a Card without `currency_code`. PayCardSheet, CreditCardPanel and the dialogs fall back to the workspace currency whenever the account row has not loaded or failed to load.
- `src/lib/card-wizard.ts` — `cardCreatePayload` / `cardEditPayload` (L457-497) — ❌ missing — No currency field for the card.

**Other**
- `api/_routes/cards/reorder.ts`, `api/_routes/search.ts` (cards group), `src/pages/CardGalleryPage.tsx`, `src/components/cards/BankCardsDialog.tsx` — card identity only — — not needed — No money is shown or moved.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | The Cards tab status bar adds owed and available credit across currencies with no conversion | `src/components/cards/CardsSummaryStrip.tsx:74` | yes |
| high | Every card screen formats native amounts with the workspace currency (the card API carries no currency) | `src/pages/CardDetailPage.tsx:110` | yes |
| high | A credit card always gets the workspace reporting currency, ignores the issuer's currency, and can never be changed | `api/_routes/cards.ts:124` | yes |
| high | The card page's Add purchase / refund / fee input shows the workspace currency symbol for a foreign card | `src/pages/CardDetailPage.tsx:609` | yes |
| medium (reported high) | Autopay from a funding account in another currency is accepted, then never pays and re-runs on every read | `api/_routes/cards/[id].ts:136` | no |
| medium | After a deferred failure, the card page keeps promising the next autopay and hides "Pay manually" | `src/lib/cards.ts:438` | no |
| medium | The alerts projection subtracts a card-currency autopay amount from a funding account in another currency | `src/lib/alerts.ts:361` | no |
| medium (1/2 votes) | A bank's currency can be changed while it funds a credit card's autopay | `api/_routes/wealth/accounts/[id].ts:85` | no |
| medium | Add-card wizard: the limit, debt and statement inputs and the bank list use the workspace symbol | `src/components/cards/AddCardWizard.tsx:86` | yes |

Unverified lows: "Card notifications show amounts with no currency" (`api/_lib/notify-cards.ts:17`); "PayCardSheet cannot record an issuer or FX fee on a cross-currency card payment" (`src/components/wealth/PayCardSheet.tsx:168`); "If the card's account row fails to load, PayCardSheet falls back to the workspace currency" (`src/components/cards/types.ts:84`). Refuted claims: none.

#### Decisions

- **Credit card currency at creation:** should the user choose it, with a default of the issuer bank's `currency_code` and then the reporting currency? Or should it always be the reporting currency, as today? And may a card's currency change while it has no non-system rows or statements? Today it is locked from creation.
- **Autopay from a funding account in another currency:** refuse it at configuration time, or support it with a rate policy? The recommended option is to refuse it until a recurring FX policy exists; Space auto-save already rejects cross-currency schedules the same way. Supporting it would mean recording an estimated source amount and marking it for confirmation.
- **Cards tab "Owed / Available credit":** show one converted figure (from `/api/wealth/summary`, with an excluded-currency notice), or per-currency native totals? And how should available credit across currencies be defined: converted at the latest rate, or never summed?
- **Bank currency lock:** should a bank's currency be locked because configuration references it (it funds a card's autopay, carries debit cards, or has recurring rules)? Or should changing it switch that configuration off automatically?
- **PayCardSheet fee field:** should PayCardSheet offer a fee field on cross-currency payments, booking the issuer or bank FX charge as a separate expense?
- **Notification currency:** should card notifications carry a currency and a translatable reason code instead of bare numbers and raw English errors?

#### Existing tests

- `src/lib/cards.test.ts` — `autopayEligible` / `autopayPlan` / `autopayAmount` / `autopayPreview`, expiry and card identity helpers. Single currency; no deferred-failure case.
- `src/lib/credit-card.test.ts` — `cardDebt` / `cardCredit` / `creditUsage` / `statementView` / `debtAtClose` / `cycleActivity` and closing-date maths. The numbers are currency-agnostic.
- `src/lib/credit-card-ledger.test.ts` — A card purchase is an expense, a payment is a transfer (no expense), a refund nets against spending, and trash/restore reverses correctly. Single currency.
- `src/lib/card-alerts.test.ts` — Card alert rules: due soon, overdue, utilisation, expiry.
- `src/lib/alerts.test.ts` — The attention rail, including "alert money is labelled with the ACCOUNT's currency" (a card alert carries its liability account's currency), and the autopay projection. It only tests a legacy null currency; there is no case with a funder in another currency.
- `src/lib/card-wizard.test.ts` — Create/edit payload shapes and validation for the add-card wizard. No currency field.
- `src/lib/money.test.ts` — `transferAmounts`: a cross-currency transfer requires a destination amount; effective rate and fee; same-currency amounts are equal.
- `src/lib/card-drag.test.ts` / `src/lib/card-fan.test.ts` / `src/lib/bank-cards.test.ts` — Card grid drag actions (pay/transfer targets), the fan model and bank-overlay relationships. No money currency.
- `e2e/credit-card.spec.ts` — Creates a card with a statement and checks owed / available / statement on the card screen. Covers purchase, partial and full payment, refund/fee, overpay, and trash/restore/edit. Single currency.
- `e2e/cards.spec.ts` — Debit-card wizard, card attribution chip, freeze, bank overlay and drag handle. Single currency.
- `e2e/multi-currency.spec.ts` — Account currency, consolidated wealth, cross-currency transfer with fee, reversal, scheduled transfer and wealth tiles. No card or credit-card coverage.
- `e2e/alerts.spec.ts` — Smoke test of the dashboard attention rail.


### 3.7 Debts & loans

**Readiness:** partial. The code that writes money for debts is multi-currency safe, and so are the screens that show a single debt. The screens that total several debts are not. Every writer stamps the debt's currency: create, opening balance, disbursement, reconcile adjustment, the repayment rule and `recordDebtPayment`. A repayment or disbursement in another currency is refused as `currency_mismatch` in five places: the engine, `POST /api/debts`, the repayment editor, `/api/recurring` create/edit and the shared `linkRefusal` predicate.
- **Legacy data:** Migration 0076 relabelled it. A read-only audit of the dev DB found 0 debt accounts, rows or rules with a mismatched currency. The DB holds only 2 EUR loans in one EUR workspace.
- **Single-debt screens:** DebtCard, DebtDetailPage, RecordPaymentSheet, activity and schedule all use the debt's own currency. `/api/wealth/summary` converts loans and receivables at the latest rate and flags `excluded_currencies`.
- **Hub totals:** `buildDebtsOverview` adds `month.required/paid/remaining/overdue`, `required_monthly`, `interest_this_month`, `total_repaid` and `average_monthly_income` across currencies, then labels the result with the workspace currency. A user can get a foreign-currency debt in two ways: create one from `/recurring` on a foreign bank, or change the workspace currency on `/organizations`. From then on the Debts hero, the insights and the dashboard Debts card show wrong totals.
- **Plan tab:** It silently drops foreign debts and explains this with the receivables hint.
- **Two creation paths disagree:** The Add-debt sheet only allows the workspace currency. The `/recurring` path creates the debt in the paying account's currency but shows the workspace currency symbol.

#### What changes / what is affected

**Schema**
- `src/lib/db/schema.ts` — `debt_details.currency` (NOT NULL) / `wealth_accounts.currency_code` (nullable) / `debt_payments` (no currency column) — ⚠️ partial — `debt_details.currency` is NOT NULL (~417) but the account's `currency_code` can still be null. `debt_payments` total/principal/interest/fees have no currency of their own, so relabelling a debt also relabels its allocations.
- `drizzle/0076_debt_account_currency.sql` — migration 0076 — ✅ correct — debt account `currency_code` follows `upper(debt_details.currency)`. Rows on debt accounts, untagged rows and untagged rules take their account's currency. Transfer headers are detached from debt groups. Dev DB: 0 null, 0 mismatch, 0 lowercase, 0 `transfer_id` on debt legs.

**Writes**
- `api/_lib/debts.ts` — `recordDebtPayment` (419-426, 517) — ✅ correct — refuses a counter account in another currency (400 `currency_mismatch`) and stamps every leg with the debt currency. An untagged (null) legacy counter account is still allowed.
- `api/_routes/debts.ts` — handler GET / POST (44-45, 69, 145, 172, 256, 299, 322, 357) — ✅ correct — the default currency is `organizations.currency`. A repayment or disbursement account in another currency is refused. The account, opening row, disbursement legs and rule are stamped with the debt currency.
- `api/_routes/debts/[id].ts` — PATCH reconcile adjustment (210-237) — ✅ correct — the system row gets the debt currency. The insert and the balance update run one after the other, not in a batch (this predates multi-currency).
- `api/_routes/debts/[id].ts` — `applyRepayment` (304-448) — ✅ correct — `currency_mismatch` guard at 344. The rule's `currency_code` is the account currency, falling back to the debt currency.
- `api/_routes/debts/[id]/payments.ts` — POST record payment — ✅ correct — delegates to `recordDebtPayment` and passes `currency_mismatch` through.
- `api/_routes/debts/[id]/payments/[paymentId].ts` — DELETE payment group — — not needed — reverses native amounts per account; no FX involved.
- `src/components/debts/DebtFormSheet.tsx` — `currency = isEdit ? editing.currency : orgCurrency` (134), account filter (152) — ⚠️ partial — there is no currency picker on create, and foreign accounts are hidden from the disbursement and repayment pickers. Edit keeps the debt's currency.
- `src/components/recurring/RecurringRuleDialog.tsx` — new-debt body currency (429), symbol (227/544/649/656), `DebtPreviewCard` currency (737) — ⚠️ partial — the debt is created in the payer's currency, but the inputs and preview show the workspace currency symbol.

**Aggregates**
- `api/_lib/debts.ts` — `buildDebtsOverview`: `interestThisMonth` (239-243), `monthObligations` (253), `requiredMonthly` (255), `totalRepaid` (256-261), insights `currency: orgCurrency` (285) — ❌ missing — adds cents from debts in different currencies into one number and labels it with the workspace currency.
- `api/_lib/debts.ts` — `owedByCurrency` / `receivableByCurrency` (270-271) — ✅ correct — native totals grouped per currency and never converted.
- `api/_lib/debts.ts` — `averageMonthlyIncome` (190-209) — ❌ missing — a raw `sum(transactions.amount)` across every currency. It does not use tx-sql `reportingAmountSql`/`missingRateCountSql`, and the `tx-sql.test.ts` convention test does not scan this file.
- `api/_lib/debts.ts` — `upcomingSchedule` `paidByMonth` (244-248, 287) — ⚠️ partial — keyed by debt and month, so it never mixes currencies. But one payment marks every instalment in that month as paid.
- `src/lib/debt-status.ts` — `monthObligations` (97-120), `requiredMonthly` (164-166), `debtInsights` (180-209), `nextPayment` (123-133), `upcomingSchedule` (66-87) — ❌ missing — pure helpers that sum across currencies (obligations, required, interest insight) or compare across them (`smallest_clearable`, the `nextPayment` tie-break). `owedByCurrency` (157-161) is correct.
- `src/lib/debt-planner.ts` — `simulatePlan` / `comparePlans` / `debtPaymentRatio` — ⚠️ partial — works in cents with no currency, so it is only correct because the caller filters to one currency. The ratio's income input is a mixed-currency sum.
- `src/components/wealth/use-consolidated-wealth.ts` — `availableFromSummary` / `liquidFromSummary` — ✅ correct — debt types are excluded from available/liquid.
- `api/_lib/alerts.ts` — `recentlyPosted` debt repayment legs (141-185) — ✅ correct — grouped by the posting account's currency.

**Displays**
- `api/_lib/debts.ts` — `buildDebtActivity` / `scheduleFor` — ✅ correct — one debt with same-currency legs, so amounts stay native.
- `src/lib/debt-format.ts` — `debtMoney` / `formatByCurrency` — ✅ correct — each debt in its own currency; a joined string per currency for totals.
- `src/pages/DebtsPage.tsx` — hero Stats (178, 192-195), insights (221-225), planner currency (290) — ❌ missing — `money()` falls back to the workspace currency for `month.*`, `total_repaid` and `interest_this_month`. The per-currency hero total (185) and the next payment (204) are correct.
- `src/components/debts/DebtsCard.tsx` — headline `total_repaid` (103), tiles `month.remaining/overdue/paid` (111-115) — ❌ missing — mixed-currency sums formatted in the workspace currency. The owed headline uses `formatByCurrency` (correct) but gets truncated.
- `src/components/debts/DebtPlanner.tsx` — plannable filter (38-44), ratio (70), excluded note (246-249), `PLAN_KEY` (15) — ⚠️ partial — plans only workspace-currency debts, labels the excluded foreign debts with the `receivablesHint` text, and saves the plan without scoping it to the workspace.
- `src/components/debts/UpcomingPayments.tsx` — per-month totals by currency (33-38) — ⚠️ partial — correctly grouped per currency, but "paid" is overstated for debts paid more often than monthly because every row in the month is flagged paid.
- `src/components/debts/DebtCard.tsx` — `money = debtMoney(debt)` — ✅ correct — native currency.
- `src/pages/DebtDetailPage.tsx` — `money = debtMoney` (132), reconcile label (359), `DebtFormSheet orgCurrency={debt.currency}` (352) — ✅ correct — native currency throughout.
- `src/components/debts/DebtPreviewCard.tsx` — `money = formatMoney(n, currency)` — ⚠️ partial — correct when mounted from DebtFormSheet, wrong currency when mounted from RecurringRuleDialog.
- `src/pages/WealthPage.tsx` — `debtsOwed` chip / `netWorth` / `localDebts` fallback (318-331, 554-560) — ⚠️ partial — uses the summary (converted to the reporting currency) when it has loaded. Before that, the fallback keeps only workspace-currency buckets and shows no partial flag.
- `api/_routes/search.ts` — debts group (153-177) — — not needed — returns currency and balance, but the UI shows no amount.

**FX**
- `api/_lib/debts.ts` — `debtCurrencyOf` (63) — ✅ correct — `account.currencyCode ?? details.currency`, uppercased. This is the source of truth for the currency that every guard uses.
- `api/_lib/wealth-summary.ts` — `buildWealthSummary` `debts_owed` / `debts_receivable` (74-131) — ⚠️ partial — converts each currency at the latest rate and reports excluded currencies, but counts every non-archived loan/receivable, including `written_off` / `paid_off` / `refinanced` ones that the hub treats as closed.

**Validation**
- `api/_routes/debts.ts` — `link_rule_id` adoption (191-220) — ✅ correct — `refusalForNew` checks `accountCurrency` against the new debt's currency.
- `api/_routes/debts/[id].ts` — PATCH currency change / `currency_locked` (122-145, 240-250) — ⚠️ partial — locks the currency once the debt account has non-system rows or any rule. It misses interest-only payments, which leave no leg on the debt account. The relabel is 3 sequential UPDATEs, not a batch.
- `api/_lib/recurring-debt.ts` — `postDebtOccurrences` / `linkRuleToDebt` / `refusalForNew` / `payerShape` — ✅ correct — the link predicate compares the payer's currency with the debt's. The materializer relies on the refusal in `recordDebtPayment`, which pauses the rule and sets `last_error`.
- `api/_routes/recurring.ts` — POST with `debt_account_id` (73-95) — ✅ correct — `refusalForNew` with `payer.currency`.
- `api/_routes/recurring/[id].ts` — PATCH debt rule payer change (161-166) + currency re-snapshot (199-201) — ✅ correct — returns `currency_mismatch` when the payer moves to a foreign account.
- `api/_routes/wealth/accounts/[id].ts` — PATCH `currency_code` lock (83-90) — ⚠️ partial — checks only the transaction count and card/goal config, not recurring rules (including debt repayments) that pay from the account.
- `src/lib/debt-recurring.ts` — `linkRefusal` `currency_mismatch` (292) — ✅ correct — case-insensitive comparison; an unknown (null) currency on either side is allowed.
- `src/components/debts/RecordPaymentSheet.tsx` — account filter (82), symbol (47) — ✅ correct — shows only same-currency or untagged accounts, the same rule as the server guard.
- `src/components/debts/LinkRepaymentDialog.tsx` — `isLinkable` with `accountCurrency` (85), amount in `debt.currency` (150) — ✅ correct — uses the same predicate as the server.
- `src/components/recurring/LinkDebtDialog.tsx` — eligible debts, balance in `d.currency` (157) — ✅ correct — native currency, same predicate.

**API contracts**
- `api/_lib/debts.ts` — `toDebtLike` (109) / `serializeDebt` (137) — ⚠️ partial — both read `details.currency`, not `debtCurrencyOf`. The two are always equal by design, but the client compares `a.currency_code === debt.currency` case-sensitively.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | Hub "this month" figures and `required_monthly` add up debts in different currencies and show the total in the workspace currency | `api/_lib/debts.ts:253` | no |
| high | A new debt created from the Recurring dialog is stored in the paying account's currency, but its amount fields and preview show the workspace currency | `src/components/recurring/RecurringRuleDialog.tsx:429` | no |
| medium (reported high) | The "Interest this month" insight adds interest from all currencies and labels it with the workspace currency | `api/_lib/debts.ts:243` | no |
| medium | The planner drops foreign-currency debts and explains it with the receivables text; after a workspace currency change it drops every debt | `src/components/debts/DebtPlanner.tsx:248` | no |
| medium | The debt-payment ratio ("pressure") divides workspace-currency minimums by a raw sum of income in every currency | `api/_lib/debts.ts:190` | no |
| medium | "Repaid in total" adds principal across currencies and ignores closed (archived) debts, so the debt-free hero reads 0 | `api/_lib/debts.ts:256` | no |
| medium | Net worth / "Liabilities" on /wealth still counts written-off, paid-off and refinanced debts that /debts no longer counts | `api/_lib/wealth-summary.ts:81` | no |
| medium | The Add-debt sheet only allows the workspace currency, and foreign accounts are hidden from its pickers | `src/components/debts/DebtFormSheet.tsx:134` | no |
| medium | The Upcoming tab marks every instalment in a month as paid after a single payment, so paid totals are too high | `src/lib/debt-status.ts:80` | no |
| medium | A bank's currency can be changed while it pays a debt repayment rule; the rule then fails with `currency_mismatch` | `api/_routes/wealth/accounts/[id].ts:84` | no |

**Unverified lows:**
- The debt currency lock ignores interest-only payments, so a currency change relabels recorded allocations (`api/_routes/debts/[id].ts:131`).
- Insights compare debt balances across currencies (`src/lib/debt-status.ts:198`).
- The planner's "extra" and "lump sum" values are saved globally and carried into workspaces with other currencies (`src/components/debts/DebtPlanner.tsx:15`).
- The dashboard Debts card truncates the per-currency total and hides the other currencies on phones (`src/components/debts/DebtsCard.tsx:103`).
- /wealth net worth drops foreign debts without any notice until the summary loads, or when it fails (`src/pages/WealthPage.tsx:318`).
- The e2e net-worth test still assumes only same-currency debts count (`e2e/debts.spec.ts:389`).

**Refuted claims:** none.

#### Decisions
- **Hub totals:** Should the Debts hub report multi-currency money in per-currency buckets everywhere (like `owed_by_currency`)? Or should it convert into the reporting currency, with an `excluded_count` and `FxExcludedNotice`? Conversion would use `reporting_amount` at the payment date for paid and interest, and the latest rate for required and owed.
- **Converted total on /debts:** Should /debts also show "Total debt ≈ X (reporting)" beside the per-currency breakdown, so it matches `debts_owed` on /wealth?
- **Add-debt currency:** Should the Add-debt sheet get a currency picker (default = reporting currency), or infer the currency from the chosen account as /recurring does? Today the two creation paths disagree.
- **Planner across currencies:** Offer a per-currency plan switcher, convert every debt at the latest rate with an FX-risk disclaimer, or keep excluding foreign debts with a correct message?
- **Closed debts and net worth:** When a debt is written off, paid off with a balance left, or refinanced, should the app post a system adjustment to zero so the ledger and net worth follow? Or should `wealth-summary` exclude non-open lifecycles? The two screens must agree.
- **Cross-currency repayment and disbursement:** Keep refusing them (`currency_mismatch`)? Or support them through the transfer service with sent/received amounts and an effective rate, which would mean storing principal as two amounts?
- **"Repaid in total":** Should it include closed (archived) debts, and should it be shown per currency?
- **Debt-payment ratio income:** Convert income into the reporting currency, or count only income in the planner's currency?

#### Existing tests
- `src/lib/debt-status.test.ts` covers:
  - `derivedStatus`, `isOpenDebt` and `progressPct`
  - `upcomingSchedule` (monthly only)
  - `monthObligations` and `requiredMonthly` (EUR-only fixtures)
  - `nextPayment` (mixed EUR/INR, date only)
  - `owedByCurrency`, which keeps EUR and INR apart
  - `debtInsights` with a single currency (EUR)
- `src/lib/debt-math.test.ts` covers `amortize`, `splitPayment`, `interestForPeriod`, `monthlyEquivalent` and `addPeriods` (cents with no currency).
- `src/lib/debt-planner.test.ts` covers strategy ranking, the rollover simulation, affordability and `debtPaymentRatio` (no currency dimension).
- `src/lib/debt-preview.test.ts` covers the live create preview (payoff, instalments, interest) in cents.
- `src/lib/debt-recurring.test.ts` covers:
  - `linkRefusal` including `currency_mismatch` (line 245: an EUR payer paying a USD debt is refused; case-insensitive; null tolerated)
  - `payoffCappedAmount`, `periodsPerYearForRule` and `repaymentCursor`
- `src/lib/debt-ledger.test.ts` covers the ledger shape of borrow/repay/interest, plus "multi-currency: native amounts are never touched by a display currency" (line 109).
- `api/_lib/tx-sql.test.ts` checks the reporting-currency convention for the analytics/calendar/flow/transactions/clients routes. It does **not** scan `api/_lib/debts.ts`.
- `e2e/debts.spec.ts` covers:
  - empty state, borrowing as a transfer, the schedule and hub tabs
  - split payment, auto split, and deleting/restoring a payment
  - partial disbursement, search, and recurring repayment posting
  - the receivable flow, and marking paid off and closing
  - "net worth includes loans", which assumes same-currency debts only
- `e2e/recurring-debt.spec.ts` covers creating a debt from the recurring dialog, the rhythm round trip, category rules and dialog draft persistence. It has no foreign-currency case.
- `e2e/multi-currency.spec.ts` covers:
  - account native currency and consolidated wealth conversion
  - cross-currency transfers, their reversal, and scheduled transfers
  - the wealth screen breakdown (no debts)


### 3.8 Budgets

**Readiness:** partial. Most of the server side is done. Every budget spend query (`spendByItem`/`aggregate`, `seriesFor`, `recentFor`, `analyticsFor`, `outgoingByClient`, `spendForWindows`) converts each row at its own date with `reporting_amount()` and returns `currency` and `excluded_count`. The seven spend predicates are unchanged and pinned by `budget-spend.test.ts`.

The budget's own currency is broken where budgets are written. No writer sets `spending_budgets.currency_code`: not the POST, not the v1 personal upsert, not onboarding. Budgets from before mig 0069 are pinned to the org's old currency, and newer ones are NULL, so they follow the reporting currency. A workspace currency change therefore relabels limits (₹50,000 becomes €50,000) and creates mixed-currency families. The v1 client caps and `budget_history` have no currency column at all.

The UI ignores the per-row `currency`. It formats every figure with `useCurrency()` or the response's reporting currency. The detail page shows native Recent amounts with the org symbol. Several places add amounts from different budgets as if they were one currency: the allocation header, the dashboard total, the dialog's children total and the add-transaction hint.

Excluded (no-rate) rows show up only as one notice on `/budgets`. That notice over-counts across overlapping budgets and misses rows left out only of the Day/Week/Month/Year view windows. State, alerts and adherence ignore excluded rows. Rates are only fetched into the reporting currency, and there is no conversion through a third currency, so a budget in a non-reporting currency permanently drops rows in a third currency.

In practice, single-currency workspaces with foreign accounts mostly work on the list page. Changing the reporting currency is not safe yet, and neither are the detail page, analytics, the add-transaction hints or the client-cap screens.

#### What changes / what is affected

**Schema**
- `src/lib/db/schema.ts` — `spendingBudgets.currencyCode` (line 1239) — ⚠️ partial — The column exists and is nullable, but nothing writes it after the 0069 backfill. NULL means "follow the reporting currency".
- `src/lib/db/schema.ts` — `budgets` / `budgetHistory` (lines 1174-1214) — ❌ missing — v1 per-client caps and their history snapshots have no currency column, so an amount's currency is whatever the reporting currency is today.
- `drizzle/0069_multi_currency_foundation.sql` — `spending_budgets` backfill (lines 56-61) — ⚠️ partial — Pins existing budgets to the org currency at migration time. Budgets created later stay NULL, so old and new budgets react differently to a currency change.

**Writes**
- `api/_routes/spending-budgets.ts` — POST insert (lines 89-105) — ❌ missing — Does not set `currencyCode`, not even the parent's for a sub-budget.
- `api/_routes/spending-budgets/[id].ts` — PATCH + `AUDITED` (lines 24, 114-131) — ❌ missing — Currency can't be edited and isn't audited. History amounts carry no currency.
- `api/_routes/budgets.ts` — POST personal upsert (lines 101-118) — ❌ missing — The v1 shim inserts/updates the overall spending budget without a currency.
- `api/_routes/budgets.ts` — POST business caps + `recordHistory` (lines 138-165) — ❌ missing — Cap and history amounts are stored with no currency.
- `src/components/onboarding/MoneyWizard.tsx` — POST `/api/spending-budgets` (line 172) — ❌ missing — The onboarding overall budget is created with a NULL currency and relies on the server to set one.
- `api/_routes/organizations/[id].ts` — PATCH currency (lines 72-79) — ❌ missing — Sets `currency` and `reporting_currency` with no policy for budget limits, caps or history.
- `api/_lib/wealth-accounts.ts` — `createTransfer` fee leg (lines 459-476) — ⚠️ partial — The fee counts as budget spend (category `Transfer Fee`, source currency), but no budget alert is checked.

**Aggregates**
- `api/_lib/spending-budgets.ts` — `aggregate` / `spendByItem` (lines 175-230) — ✅ correct — One statement, with one converted column and one missing flag per budget currency. Excluded rows are counted per item.
- `api/_lib/spending-budgets.ts` — `withSpend` (lines 272-351) — ⚠️ partial — Only ensures rates into the reporting currency. `excluded_count` covers only the budget's own window (nothing for `spent_by_view`). State ignores excluded rows. `restIn` silently skips a child in another currency.
- `api/_lib/spending-budgets.ts` — `seriesFor` (lines 430-455) — ✅ correct — Converted per window, with an `excluded_count` per window (the UI ignores it).
- `api/_lib/spending-budgets.ts` — `recentFor` (lines 704-743) — ✅ correct — Returns the native amount plus `currency_code` and `amount_in`. The consumer ignores both.
- `api/_lib/spending-budgets.ts` — `analyticsFor` (lines 516-695) — ⚠️ partial — `budgeted_limit` drops lines in other currencies, but `spendOf` keeps their spend. The excluded count covers only the reporting-currency column (x0).
- `api/_lib/budget-spend.ts` — `outgoingByClient` / `spendForWindows` — ✅ correct — Reporting currency, with excluded rows counted per window.
- `src/lib/budget.ts` — `allocation` / `tightestBudget` / `limitForWindow` — ⚠️ partial — Pure and currency-blind. Callers must pass amounts that are all in one currency.

**Displays**
- `api/_lib/notify-budget.ts` — `notifyIfBudgetExceeded` / `emitBudgetAlert` — ⚠️ partial — Labels amounts in the budget's currency, but ignores excluded rows. The dedupe key has no currency, and `ensureRatesForOrg` runs twice.
- `src/components/budget/budget-format.tsx` — `budgetCurrency` / `budgetExcluded` / `budgetsExcluded` (lines 123-138) — ⚠️ partial — The per-row currency helper exists but no component uses it. `budgetsExcluded` adds counts across overlapping budgets.
- `src/pages/BudgetsPage.tsx` — `money` (64-65), `allocation` (109), `FxExcludedNotice` (331) — ⚠️ partial — The header uses the response's reporting currency instead of `overall.currency`. Allocation adds limits as if they shared one currency. The notice over-counts.
- `src/components/budget/BudgetRow.tsx` — `money` (79-80) — ⚠️ partial — Uses `useCurrency()`, not `budget.currency`. The row has no excluded-rows indicator.
- `src/components/budget/BudgetList.tsx` — `money` + `notInSubBudgets` (150-151, 244) — ⚠️ partial — Uses `useCurrency()`. The remainder can be inflated when currencies are mixed.
- `src/pages/BudgetDetailPage.tsx` — `money` (59), hero (227), recent (316), `formatChange` (377) — ❌ missing — Recent rows show native amounts with the org symbol. There is no excluded notice, and the chart ignores the per-window excluded counts.
- `src/components/budget/BudgetsCard.tsx` — `money` (63), totals (97) — ⚠️ partial — The dashboard card uses `useCurrency()`. Its "your budgets" total adds amounts without converting them. No excluded notice.
- `src/components/budget/BudgetAnalyticsPanel.tsx` — `money` (42), series focus (56-57) — ⚠️ partial — The overall focus plots `w.total` (reporting currency) against `overall_limit` (the budget's own currency). No excluded notice.
- `src/components/budget/SpendingBudgetDialog.tsx` — `symbol`/`money` (55-57), `childrenTotal` (177) — ⚠️ partial — The amount prefix is the org currency, and the children's limits are added without conversion.
- `src/components/transactions/tx-form.tsx` — `budgetHint` / `spendingHint` (lines 277-293) — ❌ missing — Adds the native amount typed for the chosen account to spend in the budget's currency, then formats the result with the org currency.
- `src/components/budget/ClientBudgetsSection.tsx`, `src/pages/ClientBudgetDetailPage.tsx`, `src/components/budget/BusinessBudgetCard.tsx`, `src/components/budget/BudgetIndicator.tsx`, `src/components/clients/client-views.tsx:70`, `src/pages/ClientDetailPage.tsx:539` — v1 cap displays — ⚠️ partial — The symbol is right (org currency = reporting). No surface shows an excluded notice, and the history timeline shows old amounts with the current symbol.
- `src/components/budget/BudgetDialog.tsx` — v1 cap dialog symbol (49-50) — ✅ correct — Caps are judged in the reporting currency, which equals `useCurrency()`.

**FX**
- `api/_lib/spending-budgets.ts` — `budgetCurrency` (lines 112-113) — ⚠️ partial — NULL falls back to the live reporting currency, so the meaning of a limit changes silently when the reporting currency changes.
- `api/_lib/budget-spend.ts` — `budgetSpendSignedAmountIn` / `budgetSpendMissingRate` — ✅ correct — Uses `reporting_amount` at the row's date. A refund subtracts its converted amount, and a missing rate is flagged.
- `api/_lib/fx-rates.ts` — `ensureRatesForOrg` (lines 278-304) / `ensureHistoricalRates` — ⚠️ partial — Only fetches rates from transaction/account currencies into the reporting currency. The per-day backfill inserts one row at a time and blocks budget GETs while it runs.
- `drizzle/0074_fx_reporting_functions.sql` — `fx_rate_on` / `reporting_amount` SQL functions — ⚠️ partial — Cannot convert through a third currency. A NULL row currency passes through 1:1. An old rate is carried forward with no age limit or flag.

**Validation**
- `api/_lib/spending-budgets.ts` — `parseBudgetInput` / `checkRelations` (lines 790-906) — ❌ missing — Accepts no `currency_code`, and has no rule that a child's (or sibling's) currency matches its parent's.

**API contracts**
- `api/_routes/budgets.ts`, `api/_routes/budgets/overview.ts`, `api/_routes/budgets/detail.ts` — v1 GET shapes — ⚠️ partial — The v1 shape is kept, with `currency` and `excluded_count` added. Adherence and state still treat partial totals as complete.
- `src/lib/types.ts` — `SpendingBudgetAnalytics` / `SpendingBudgetRecentTx` / `SpendingBudgetDetail` (lines 1100-1137) — ❌ missing — The client types lack `currency`, `excluded_count`, `currency_code`, `amount_in` and the per-window `excluded_count`, even though the server sends them.

**Other**
- `api/_lib/spending-budgets.ts` — `loadRecords` (lines 238-251) — ⚠️ partial — A child gets its parent's window on read, but not its parent's currency.
- `api/_lib/spending-budgets.ts` — `historyFor` + `limitAt`/`amountAt` — ⚠️ partial — Audit amounts carry no currency. That is fine only while a budget's currency never changes.
- `src/lib/api-cache.ts` — `FANOUT` organizations rule (line 291) — ⚠️ partial — An org currency PATCH doesn't drop the cached `/api/spending-budgets` or `/api/budgets` reads.
- `api/_routes/categories/[id].ts`, `api/_routes/categories/combined.ts` — `planCategoryRename` / `applyCategoryRename` — — not needed — Category keys don't depend on currency.

#### Issues in this area

| Severity | Title | file:line | Known-deferred? |
|---|---|---|---|
| high | Budget currency is never written; NULL budgets re-denominate when the workspace currency changes | `api/_routes/spending-budgets.ts:89` | yes |
| high | Budget UI formats every figure in the org/reporting currency, not the budget's own | `src/components/budget/BudgetRow.tsx:80` | yes |
| high | Per-client caps and `budget_history` have no currency; a reporting change re-denominates every cap | `src/lib/db/schema.ts:1174` | no |
| medium (reported high) | Budget detail "Recent" list shows native foreign amounts with the org currency symbol | `src/pages/BudgetDetailPage.tsx:316` | no |
| medium | Add-transaction budget hints add the native amount to spend in the budget's currency | `src/components/transactions/tx-form.tsx:289` | no |
| medium | Cross-budget sums add amounts without converting when budgets end up in different currencies | `src/pages/BudgetsPage.tsx:109` | no |
| medium | Analytics adherence and trend mix currencies | `api/_lib/spending-budgets.ts:642` | no |
| medium | Excluded (no-rate) rows are invisible outside the `/budgets` list | `src/pages/BudgetDetailPage.tsx:227` | no |
| medium | State, alerts and adherence judge partial totals as complete | `api/_lib/spending-budgets.ts:342` | no |
| medium | Excluded notice over-counts and misses the view windows | `src/pages/BudgetsPage.tsx:331` | no |
| medium | Rates are only fetched into the reporting currency and there is no third-currency conversion, so budgets in other currencies lose third-currency rows forever | `api/_lib/fx-rates.ts:278` | no |
| medium | Budget GETs block on the FX backfill, which inserts one row per day; the alert path ensures rates twice | `api/_lib/fx-rates.ts:267` | no |

**Unverified (low):**
- "Budget figures convert at an old rate with no warning when the provider is behind" (`drizzle/0074_fx_reporting_functions.sql:19`, known-deferred)
- "Changing the workspace currency doesn't invalidate cached budget reads" (`src/lib/api-cache.ts:291`)
- "Alert dedupe key and budget audit trail carry no currency" (`api/_lib/notify-budget.ts:202`)
- "A transfer fee counts as budget spend but raises no budget alert" (`api/_lib/wealth-accounts.ts:459`)

**Refuted (not a bug):** "NULL-currency transactions count 1:1 in any budget currency" (`drizzle/0074_fx_reporting_functions.sql:34`, 0/2 votes).

#### Decisions

- **Currency of a new budget:** snapshot the reporting currency, with a sub-budget taking its parent's (ARCHITECTURE §M implies this)? Or keep NULL, meaning "always the current reporting currency"?
- **Reporting-currency change:** what happens to budget limits, v1 client caps and `budget_history`? Options:
  - (a) keep each budget in the currency it was created in and display it that way;
  - (b) convert limits at the change-date rate and re-pin them, with an audit entry;
  - (c) block the change, or require confirmation, while budgets exist.
- **Choosing a currency:** can a user pick a budget's currency in the dialog, or is it always the reporting currency? Must every sub-budget match its parent's currency (recommended)?
- **Cross-budget figures in different currencies** (overall header allocation, dashboard "your budgets" total, analytics `budgeted_limit`/unclaimed): convert at the latest rate (as the wealth summary does), convert at the window-close rate, or refuse to add them and show a total per currency?
- **Verdict when `excluded_count > 0`:** a distinct "incomplete" state? Should alerts still fire on the counted spend alone? Should adherence skip incomplete windows?
- **Excluded-count semantics on `/budgets`:** count distinct rows in the selected view window, or count per budget in its own window?
- **Rate policy for budget conversion:** what is the maximum rate age before a row counts as excluded? Should budgets in a currency other than reporting convert through a third currency (reporting/EUR/USD)?
- **Transfer fees:** should `Transfer Fee` rows count against the overall budget and trigger alerts? When a transfer is reversed, the fee refund is converted at the reversal date; may that leave a small residual in spend?
- **Detail page Recent rows:** show the native amount, the converted amount (≈), or both?

#### Existing tests

- `api/_lib/budget-spend.test.ts` — Pins the seven spend predicates (`is_system`, closed client, refunds negative, transfers excluded). SQL checks that the converted amount is `reporting_amount(amount, currency_code, date, target)` and the missing flag is `fx_rate_on(...) is null`. Source checks that `spending-budgets.ts` uses `budgetSpendSignedAmountIn(cur)` and never the raw sum, and that v1 routes pass `reporting` and call `excludedFor`.
- `src/lib/spending-budget.test.ts` — Pure windows, view conversions (`perDayRate`, `limitForView`, `limitForWindow`), `allocation`, `tightestBudget`, `limitAt`/`amountAt`/`lastChangedAt`. No currency cases.
- `api/_lib/notify-budget.test.ts` — `budgetAlertTier` boundaries, `orgTotals`, and a check that every writer that changes spend calls `notifyIfBudgetExceeded`. No currency or excluded-row cases.
- `src/lib/budget-history.test.ts` — v1 adherence, creep, evolution and `seriesState`. Currency-blind.
- `src/lib/budget.test.ts` — v1 `periodStart` and period helpers.
- `src/lib/multi-currency-migration.test.ts` — Checks that the schema declares `spending_budgets.currency_code` (column name only).
- `e2e/budgets.spec.ts` — Single-currency e2e:
  - creating a budget in the dialog, and an expense moving the figure;
  - the view toggle sending no request;
  - sub-budgets, the close/reopen cascade and reorder;
  - the analytics tab;
  - 44px touch targets at 430px width;
  - business client caps.

  No foreign-currency or missing-rate case.
- `e2e/multi-currency.spec.ts` — Multi-currency accounts, transfers and wealth. No budget assertions.


### 3.9 Reports (dashboard, analytics, calendar, flow, clients, search)

**Readiness:** mostly

The server side is converted. `analytics.ts`, `calendar.ts`, `flow.ts` (grouped and timeline), `clients.ts` and `clients/[id].ts` all sum through `incomeSumSqlIn`/`expenseSumSqlIn`, which convert each row at its own date with `reporting_amount()` and return `currency` plus `excluded_count`. No raw `sum(amount)` is left in these routes. Flow account balances stay native and are labelled with `account_currency`, and the flow root balance is converted at today's rate. The client side is weaker in four ways:
- `FxExcludedNotice` prints the raw key `fx.excludedNotice` on every report screen, because the key is in no locale file.
- The Dashboard wealth card shows a raw cross-currency sum under the reporting symbol until `/api/wealth/summary` arrives. If that request fails, the wrong figure stays.
- Dashboard KPIs classify rows by `type` only, so opening balances, adjustments and refunds count as income: about $2,944 on the Dashboard vs $0 on Analytics for the same e2e workspace. Client totals have the same system-row problem on the server.
- Global search and the category/tag drilldown show native amounts with the workspace symbol, and changing the reporting currency invalidates none of the cached money reads.

Smaller gaps: the flow canvas sums the legs of a mixed-currency split raw, closed clients and the client quick views have no excluded notice, per-bucket excluded counts are never shown, and `ensureRatesForOrg` runs in every report request, one currency at a time with one INSERT per day. No test covers reports at the API or UI level. `e2e/multi-currency.spec.ts` covers only accounts, the wealth summary and transfers.

#### What changes / what is affected

**Schema**
- None in this area. The FX functions in `drizzle/0074_fx_reporting_amount.sql` are listed under FX.

**Writes**
- `api/_routes/organizations/[id].ts` — PATCH currency -> reportingCurrency — ✅ correct — Keeps `currency` and `reporting_currency` in sync. The cache fanout is the gap (see Other).

**Aggregates**
- `api/_routes/analytics.ts` — handler (summary/series/by_category/by_client) — ✅ correct — Returns `currency` and `excluded_count` on the summary and on each bucket. Excludes transfers and system rows.
- `api/_routes/calendar.ts` — handler (per-day sums) — ✅ correct — Returns `currency` and `excluded_count` per day and in the summary.
- `api/_routes/flow.ts` — grouped root/groups, timeline periods/final, leaves — ✅ correct — Income and expense are in the reporting currency. Account balances are native with `account_currency`, and leaves carry `currency_code`. `root.balance` is converted at today's rate and comes with `balance_excluded_count`. The root includes cards, loans, receivables and Spaces (existing behaviour).
- `api/_routes/clients.ts` — GET totalIncoming/totalOutgoing/totalsCurrency/excludedCount — ⚠️ partial — Conversion is correct, but the LEFT JOIN (l.129/143) doesn't exclude `is_system` rows, so opening balances and adjustments count as income.
- `api/_routes/clients/[id].ts` — GET total_incoming/total_outgoing/totals_currency/excluded_count — ⚠️ partial — Same scope as the list, system rows included (l.42). It is missing from the `tx-sql.test.ts` convention route list.
- `src/pages/Dashboard.tsx` — KPIs `sumInReporting` (l.1072-1076) — ⚠️ partial — Uses `reporting_amount` but classifies by `type` only, so refunds and `is_system` rows count as income or expense. The label comes from `useCurrency()`, not from the server's reporting currency.
- `src/pages/Dashboard.tsx` — buckets -> chart + breakdown (l.1104-1120) — ⚠️ partial — Converted, with the same classification problem. No excluded notice next to the chart or the breakdown.
- `src/pages/Dashboard.tsx` — WealthOverview total/liabilities/cardsOwed (l.576-589) — ⚠️ partial — Uses the server summary once it has loaded. Before that, or on error, `summarizeWealth()` and `localCardsOwed` show raw cross-currency sums formatted in the reporting currency.
- `src/components/budget/BudgetsCard.tsx` — totals (l.97), money() (l.63) — ⚠️ partial — Belongs to the Budgets area. Sums spent/limit across budgets in the org currency and ignores each budget's `currency_code`.
- `src/lib/money-flow.ts` — collapseLegs (l.220-240) — ❌ missing — Sums split legs raw and keeps `legs[0].currency_code`. Legs carry no currency.
- `src/components/wealth/use-consolidated-wealth.ts` — liquidFromSummary / availableFromSummary — ✅ correct — Server-converted; accounts with no rate are skipped. The caller must show `complete`.

**Displays**
- `src/pages/Dashboard.tsx` — flow teaser card — ⚠️ partial — Reuses the KPI numbers, with no excluded notice.
- `src/pages/Dashboard.tsx` — LatestTransactionsCard (l.546) — ✅ correct — Native amount with `rowCurrency`. Only a mixed split with a missing rate shows a partial amount.
- `src/pages/Dashboard.tsx` — WealthOverview tiles `accountBalanceLabel(accountCurrency)` + `ApproxBalance` — ✅ correct — Native balance with its own symbol, plus a muted approximate line in the reporting currency.
- `src/components/spaces/SpacesCard.tsx` — headline — ✅ correct — One figure per currency, or a converted figure when the summary is complete.
- `src/components/debts/DebtsCard.tsx` — owed_by_currency — ✅ correct — Never summed across currencies.
- `src/components/recurring/RecurringCard.tsx` — per-month totals — ✅ correct — Grouped by `currency_code`.
- `src/pages/AnalyticsPage.tsx` — KPIs, trend/profit charts, top categories/clients — ✅ correct — Uses the response's currency (`reportingCurrencyOf`) and shows the summary notice. Per-series, per-category and per-client excluded counts are never shown, and chart tooltips are unformatted.
- `src/pages/CalendarPage.tsx` — periodSummary, day cells, inspect modal — ✅ correct — Uses the response's currency; inspect rows are native via `rowCurrency`. The header notice counts the whole fetched grid, including days from the adjacent months, while the figures cover only the month. Day cells have no excluded marker.
- `src/pages/MoneyFlowPage.tsx` — RootNode/GroupNode/LeafNode/TimelineNodes/buildDetail/TxPopup — ✅ correct — Aggregates use the response's currency, account balances use `account_currency`, and leaves use `currency_code`. The notice adds the account count to the row count (l.912-917).
- `src/pages/ClientsPage.tsx` — currency = clientTotalsCurrency, excludedTotals, ClientTable/List/Card — ✅ correct — Formats in `totals_currency` and shows the notice. The count covers only the pages loaded so far.
- `src/components/ClientDetailSheet.tsx` — quick view totals (l.36-42) — ⚠️ partial — Formatted in the org currency, with no excluded note.
- `src/components/ClientOverviewModal.tsx` — totals (l.65-98) — ⚠️ partial — Formatted in the org currency, with no excluded note.
- `src/pages/ClosedClientsPage.tsx` — fmt + totals (l.35, 165, 198) — ⚠️ partial — Formatted in the org currency, not `totals_currency`, and no `FxExcludedNotice`.
- `src/pages/ClientDetailPage.tsx` — totals (l.223-226, 502-516), tx rows (l.633, 869), BudgetIndicator (l.539) — ✅ correct — Totals in `totals_currency` with the notice; rows are native. The amount sort compares raw native amounts (l.238-239).
- `src/components/GlobalSearchDialog.tsx` — transaction hit amount (l.200) — ❌ missing — `formatMoney(Number(tx.amount), orgCurrency)`, so a EUR 5 fee shows as $5.00.
- `src/components/MobileSearchOverlay.tsx` — transaction hit secondary (l.313) — ❌ missing — Same problem as the desktop dialog.
- `src/components/entity-drilldown/EntityDrilldown.tsx` — item amount (l.199) — ❌ missing — Native amount formatted in the org currency.
- `src/components/FxExcludedNotice.tsx` — `t("fx.excludedNotice")` (l.20) — ❌ missing — The key is in neither `en.json` nor any other locale, so i18next renders the literal key.

**FX**
- `api/_lib/tx-sql.ts` — incomeSumSqlIn / expenseSumSqlIn / missingRateCountSql / reportingAmountSql / accountBalanceInSql — ✅ correct — The single place where every report converts rows at the row's own date. A NULL rate is skipped by `sum()` and counted, but only for standard and refund rows.
- `drizzle/0074_fx_reporting_amount.sql` — fx_rate_on / reporting_amount — ⚠️ partial — A NULL `currency_code` is treated as the reporting currency (identity). There is no staleness cap: the latest rate on or before the date is used however old it is. EUR->USD snapshots currently stop at 2026-09-14.
- `api/_lib/fx-rates.ts` — ensureRatesForOrg / ensureHistoricalRates — ⚠️ partial — Awaited on every report GET. Currencies are processed one after another (l.295) with one INSERT per day (l.263), and each provider has a 4s timeout.
- `src/lib/reporting-fields.ts` — reportingAmountOf / sumInReporting / clientTotalsCurrency — ✅ correct — Correctly skips rows with no rate and counts them. No unit test.

**Validation**
- `api/_routes/transactions/group.ts` — POST split legs — ❌ missing — Snapshots each leg's account currency (l.164) but doesn't refuse legs in different currencies. Only `AccountSelector` in the UI prevents them.

**API contracts**
- `api/_routes/transactions.ts` — txFieldsFor.reportingAmount / groupedFieldsFor.amount,currencyCode,reportingAmount — ⚠️ partial — Feeds the Dashboard KPIs and the Latest list. A mixed-currency split's `amount` is `sum(reporting_amount)`, which skips a NULL leg, so it can be a partial total labelled with the reporting currency (l.109). The grouped amount sort compares raw native sums (l.133-135). The bare-array response carries no reporting currency.
- `api/_routes/search.ts` — transactions select — ❌ missing — Transaction hits have no `currency_code` (l.43-52), so clients can't label native amounts.
- `api/_lib/entity-drilldown.ts` — fetchTransactionItems / sortDrilldown — ❌ missing — `DrilldownItem.amount` is native and has no currency. The `amount_desc`/`amount_asc` sorts compare raw native numbers across currencies (l.144-160).

**Other**
- `src/lib/api-cache.ts` — FANOUT `/api/organizations` rule (l.291) — ❌ missing — A reporting-currency change drops only identity prefixes. `/api/transactions`, analytics, calendar, flow, clients and `wealth/summary` stay cached (15s fresh, 2min stale).

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | Dashboard KPIs, chart and breakdown count opening balances, balance adjustments and refunds as income (existed before multi-currency) | `src/pages/Dashboard.tsx:1072` | no |
| medium | `FxExcludedNotice` renders the raw i18n key `fx.excludedNotice` on every report screen | `src/components/FxExcludedNotice.tsx:20` | no |
| medium | Dashboard wealth card shows a raw cross-currency sum before (or instead of) the server summary | `src/pages/Dashboard.tsx:582` | no |
| medium | Global search shows foreign transaction amounts with the workspace currency symbol | `api/_routes/search.ts:43` | no |
| medium | Category/tag drilldown formats native amounts in the org currency and sorts raw amounts across currencies | `api/_lib/entity-drilldown.ts:45` | no |
| medium | FX coverage runs inside every report request, one currency at a time, one INSERT per day | `api/_lib/fx-rates.ts:263` | no |
| medium | Client totals include system rows (opening balance / adjustments), unlike analytics, calendar and flow (existed before multi-currency) | `api/_routes/clients.ts:129` | no |
| medium | Closed clients page, client quick-view sheet and overview modal show partial totals with no excluded note | `src/pages/ClosedClientsPage.tsx:35` | no |
| low | Changing the reporting currency leaves every money read cached; the Dashboard labels old-currency figures with the new symbol | `src/lib/api-cache.ts:291` | no |

**Unverified lows:**
- Money flow sums the legs of a mixed-currency split raw
- Dashboard excluded notice appears only under the KPI card
- Per-bucket excluded counts are never surfaced, and the calendar and flow notices count the wrong scope
- A mixed-currency grouped transaction with one rate-less leg shows a partial amount
- Amount sorts compare raw native amounts across currencies
- NULL-currency rows are treated as the reporting currency (known-deferred)
- No staleness bound on the rates used in reports (known-deferred)
- Analytics chart tooltips show unformatted numbers
- Dashboard BudgetsCard adds up budgets in different currencies raw

**Refuted claims:** none.

#### Decisions
- **Dashboard KPI semantics:** should "Total revenue / expenses" follow the same P&L rules as Analytics (no system rows, refunds as negative expense)? Should they be all-time or follow the analytics window? Today the two screens disagree on the same data.
- **Client totals:** should the list, detail and closed-clients totals exclude balance-defining system rows, as analytics, calendar and flow do?
- **Mixed-currency splits:** refuse them on the server (`currency_mismatch`, matching the UI), or support them by showing each leg in its own currency and never a summed native amount?
- **Dashboard wealth card:** what should it show before the server summary arrives, or when the request fails: a skeleton, per-currency native totals, or the last cached summary?
- **Reporting-currency change:** should it trigger a full cache purge, and should the user be warned that every report will be re-denominated?
- **FX history backfill:** where should it run: in the request path (today), at write time when a foreign row is created, or in the `worker/` job queue?
- **Stale-rate policy:** what is the maximum rate age before a row counts as stale or excluded, and how is a stale rate shown?
- **Excluded counts:** show them at page level only, or also as markers per day, bucket, group and client?
- **Search and drilldown amounts:** native only, or native plus ≈ reporting amount?
- **"Balance" definitions:** the money-flow root "Balance" includes cards, loans, receivables and Spaces, while the Dashboard "Total available" excludes Spaces and debts. Decide what each label means.
- **NULL `currency_code` rows:** keep treating them as the reporting currency until NOT NULL is enforced, or count them as excluded?

#### Existing tests
- `api/_lib/tx-sql.test.ts` — Renders the converted SQL helpers: `reporting_amount` per row, refunds negated, transfers excluded, missing-rate count only for standard/refund rows, account balance at `current_date`. A convention check requires `analytics.ts`, `calendar.ts`, `flow.ts`, `transactions.ts` and `clients.ts` to use the `*In` helpers and `ensureRatesForOrg`; `clients/[id].ts` is not in the list. Its 54 tests (counted together with `money-flow.test.ts`) pass.
- `src/lib/money-flow.test.ts` — Flow graph builder and `collapseLegs`, for same-currency splits only.
- `src/lib/tx-classify.test.ts` — Income, expense, refund and system classification rules. The Dashboard doesn't use them.
- `api/_lib/fx-rates.test.ts` — FX rate service: current and historical lookup, and caching.
- `api/_lib/fx-provider.test.ts` — Provider chain and the caching provider.
- `src/lib/money.test.ts` — Decimal Money and FX primitives; refuses to add amounts in different currencies.
- `src/lib/api-cache.test.ts` — Freshness classes and fanout rules. Nothing asserts that a reporting-currency change invalidates money reads.
- `e2e/multi-currency.spec.ts` — EUR/INR wallets, `/api/wealth/summary` conversion, a cross-currency transfer with a fee (checks the P&L in the `/api/transactions?page=1` summary), reversal, scheduled transfer, and the wealth screen. It doesn't cover analytics, calendar, flow, clients, Dashboard KPIs, search or drilldown.
- `e2e/smoke.spec.ts` — The calendar renders and opens a day. No money assertions.
- `e2e/debts.spec.ts` — `/api/search` returns debts in their own group. No amounts.


### 3.10 Alerts, notifications & worker

**Readiness:** mostly. The dashboard attention rail shows every amount in its own currency. Each alert carries its account's currency (`api/_lib/alerts.ts:271-316`, `src/lib/alerts.ts:76-83`), and `AlertsBanner` formats it with `formatMoney(value, alert.currency ?? org currency)` (`src/components/alerts/AlertsBanner.tsx:269-271`). None of the sums behind the rail (the as-of-today baseline, future-dated legs, posted amounts) ever adds two currencies together. `src/lib/alerts.test.ts:437-468` locks this in, and a live read-only `GET /api/alerts` returned `"currency":"USD"` on every slide.

Card autopay is the weak spot:
- The projection subtracts the amount owed, in the card's currency, from the funding bank (`src/lib/alerts.ts:363`).
- Nothing stops a credit card being funded from a bank in another currency (`api/_lib/cards.ts:280-311`), and the card wizard sets this up by default.
- The rail then shows a "may not cover this" warning in the wrong currency, or misses one. It sits next to "Autopay has this covered" for a payment the engine always refuses (`api/_lib/card-autopay.ts:136` → `money.ts:134-136`).

Two ledger gaps also feed wrong state into the rail:
- A reversed card payment still counts as paid (`api/_lib/alerts.ts:77-83`, `api/_lib/credit-card.ts:127-141`).
- An empty account's currency can be changed while a recurring rule keeps posting rows in the old currency (`api/_routes/wealth/accounts/[id].ts:83-91`, `api/_lib/recurring-materialize.ts:199`).

Card notifications (bell and push) show bare numbers with no currency (`api/_lib/notify-cards.ts:17`). Budget notifications are formatted in the budget's currency but skip rows that have no rate, so they can fire late or not at all. Reminders, broadcasts, the cron route and the Go worker handle no money, with one exception: the quotation PDF labels amounts with the org's reporting currency, because quotations have no currency column. The worker has no monthly-analysis or CSV money jobs yet.

#### What changes / what is affected

**Schema, FX:** no touchpoints recorded in this area.

**Writes**
- `api/_lib/alerts.ts` — `loadAlertData` `rules[].currency` — ⚠️ partial — L315 labels a rule with its account's currency, not `recurring_rules.currency_code` (the currency that materialization writes). The two are equal today (0 mismatches in the dev DB) but drift apart once an account's currency changes.
- `api/_lib/card-autopay.ts` — `payStatement → createTransfer` — ❌ missing — L136-143 passes only `amount` (card currency) as the source amount. With a funder in another currency, `transferAmounts` throws "Destination amount is required for a cross-currency transfer" (`money.ts:134-136`), so autopay defers forever and no money moves.
- `api/_routes/cards.ts` — `POST /api/cards` (credit) — ⚠️ partial — L123-135 creates the liability account with no `currency_code`, so it gets the reporting currency. L154 defaults the funder to the step-1 issuer bank, which may be in another currency, and L171 allows autopay regardless.
- `api/_lib/recurring-materialize.ts` — regular occurrence insert — ⚠️ partial — L147-151 and L199 write `currencyCode = rule.currencyCode` without checking that it still equals the account's currency.

**Aggregates**
- `api/_lib/alerts.ts` — `loadAlertData` (`accounts.balanceToday`, `currencyByAccount`) — ✅ correct — L262-281: the as-of-today baseline is `current_balance` minus future deltas, all native to one account. Each `AlertAccount` carries `wealth_accounts.currency_code`.
- `api/_lib/alerts.ts` — `newestStatements` (LATERAL paid sum) — ⚠️ partial — L66-103 sums incoming transfer legs on the card account after the close. Correct per currency, but ignores outgoing reversal legs.
- `api/_lib/alerts.ts` — `recentlyPosted` — ✅ correct — L145-173 groups by (rule, type, date, `wa.currency_code`), so currencies are never added. Uses the account currency rather than `t.currency_code`, which is equivalent while the snapshot invariant holds.
- `api/_lib/alerts.ts` — `scheduledLegs` — ✅ correct — L201-230: each future-dated leg (including both legs of a cross-currency transfer and its fee leg) is a native delta on its own account.
- `src/lib/alerts.ts` — `upcomingEvents` — ✅ correct — L301-339: the rule amount goes to `rule.accountId` in that account's currency. The auto-save to-leg (L333-335) assumes the same currency, which `spaces/[id]/auto-save.ts:84` enforces. A cross-currency rule gets `last_error` and is skipped (L307).
- `src/lib/alerts.ts` — `autopayEvents` — ❌ missing — L360-364: `owed` is in the card's currency but is also subtracted from `fundingAccountId`, which may be in another currency. No currency check, no conversion.
- `src/lib/alerts.ts` — `projectShortfalls` / `headroom` — ⚠️ partial — L382-426: the per-account walk is correct only while every event on an account is in that account's currency. Autopay events break this.
- `api/_lib/notify-budget.ts` — `notifyIfBudgetExceeded` — ⚠️ partial — L150-206 converts spend per row at each row's own date, but ignores the count of excluded (no-rate) rows, so the tier is judged on partial spend.
- `api/_lib/credit-card.ts` — `paymentsAfter` — ⚠️ partial — L127-141 (and its copy in `api/_lib/alerts.ts` L77-83) counts incoming transfer legs only. The outgoing card leg of a reversal is never netted.

**Displays**
- `src/lib/alerts.ts` — `shortfallAlerts` — ⚠️ partial — L520-524 labels `money {amount, short}` with `account.currency`. For autopay sources the delta is in the card's currency, so both the figure and the symbol are wrong.
- `src/lib/alerts.ts` — `cardAlerts` — ✅ correct — L437-507: owed, available and utilisation all come from the card's own account, with currency = `card.currency`.
- `src/lib/alerts.ts` — `recurringAlerts` / `postedAlerts` — ✅ correct — L564-601: currency is `source.currency` (the rule's account) or `posted.currency`.
- `src/components/alerts/AlertsBanner.tsx` — `AlertSlide` — ✅ correct — L268-271: `formatMoney(value, alert.currency ?? org currency, balancesVisible)`. Handles the privacy mask, JPY's zero decimals (via Intl) and RTL.
- `api/_lib/notify-cards.ts` — `money()` + all card notifications — ❌ missing — L17 uses `n.toFixed(2)`. The statement-ready, due-soon, overdue, autopay paid/failed and utilisation bodies and their `i18nParams` show `1800.00` with no currency (seen in the dev DB). `data` has no currency, so the client cannot re-format.
- `api/_lib/notifications.ts` — `createNotification` push payload — ⚠️ partial — L158-167 sends the stored English body to web push and FCM, so card pushes have no currency (budget pushes do).
- `src/components/notifications/notification-ui.tsx` — `notificationBody` — ⚠️ partial — L88-101 fills in the server's pre-formatted amount strings and never re-formats from `data.currency`.
- `api/_lib/notify-budget.ts` — `emitBudgetAlert` / `formatBudgetMoney` — ✅ correct — L32-38 and L80-121 format in the budget's own currency (en locale) and put currency, spent and amount in `data`.
- `api/_lib/notify-billing.ts` — `notifyPaymentSucceeded` — ✅ correct — L31 `${amount.toFixed(2)} ${currency}` uses the Dodo charge currency.
- `api/_lib/referral.ts` — `referral_credited` notification — ✅ correct — L116-120: amount plus the reward/payment currency code.
- `api/_routes/admin/payouts/[id].ts` — `referral_payout` notification — ✅ correct — L50: payout amount plus `row.currency`.
- `api/_lib/recurring-materialize.ts` — `recurring_posted` / `debt_payment_posted` / `space_autosaved` notifications — — not needed — L79-96, L242-255 and L269-287 carry no amounts.
- `src/components/notifications/RemindersCard.tsx` — `RemindersCard` — — not needed — weekday/time pickers only.
- `worker/app/internal/jobs/pdf_quotation.go` — `pdfQuotationHandler` / `currencyFallback` — ✅ correct — L30-44, L166 and L199-206 render the app's pre-formatted `amount_label`. The fallback is `CODE amount`.
- `api/_lib/quotation-pdf.ts` — `buildQuotationSnapshot` — ⚠️ partial — L81 labels `quotations.amount` with `org.currency` (the reporting currency). Quotations have no currency column, so when the reporting currency changes every PDF is relabelled, and regenerated because the currency is part of the hash.

**Validation**
- `src/lib/alerts.ts` — `autopayOutlook` — ⚠️ partial — L209-226 returns `'pending'` for a funder in another currency, although `createTransfer` always refuses it. The rail says "Autopay has this covered" (L464) and hides the due-soon slide.
- `api/_lib/cards.ts` — `resolveFunding` — ❌ missing — L280-311 never compares the funding account's currency with the card's liability account.
- `api/_routes/cards/[id].ts` — PATCH funding/autopay — ❌ missing — L116-150 checks only liability-vs-asset, not currency.
- `api/_routes/wealth/accounts/[id].ts` — PATCH `currency_code` lock — ⚠️ partial — L83-91 locks only on transaction rows, a liability type or a goal amount. It ignores recurring rules, card funding and debit cards that reference the account.

**API contracts**
- `api/_routes/alerts.ts` — `GET /api/alerts` — ✅ correct — read-only. `items[].currency` is the account currency, or null for a legacy account (the dev DB has none). Checked live: 200, with a currency on each slide.

**Other**
- `api/_lib/alerts.ts` — `materializedOccurrences` — — not needed — L115-130: dedupe keys only, no money.
- `src/lib/api-cache.ts` — `NO_STALE` / `MONEY_PREFIXES` — ✅ correct — L117-124 and L240: `/api/alerts` is never painted stale, and every money write drops it.
- `src/lib/schedule-notifications.ts` — reminder/broadcast scheduling — — not needed — time-zone and date math only.
- `src/lib/native-reminders.ts` — local add-transaction reminders — — not needed — no amounts.
- `api/_routes/cron/notifications.ts` — cron dispatch — — not needed — fires scheduled broadcasts and reminders, no money.
- `api/_lib/worker-jobs.ts` — `enqueueNotificationTickAt` / `enqueue` — — not needed — queue plumbing only.
- `worker/app/internal/jobs/jobs.go` — `RegisterAll` (ping, app.trigger, pdf.quotation) — — not needed — no monthly-analysis or CSV job exists yet, so the worker computes no money.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | Autopay projection subtracts the card-currency amount from a funding bank in another currency, giving a false or missed "may not cover this" warning in the wrong currency | `src/lib/alerts.ts:363` | no |
| high | A credit card can be funded and autopaid from a bank in another currency (the wizard's default). Autopay then defers forever while the rail says "Autopay has this covered" | `api/_lib/cards.ts:280` | no |
| high | A reversed card payment still counts as "paid", so the overdue/due-soon alert and the statement status stay silent | `api/_lib/alerts.ts:77` | no |
| high | An empty account's currency can be changed while a recurring rule points at it. The rule keeps posting rows in the old currency, and the rail disagrees with the Recurring card (reported critical, verified as high) | `api/_routes/wealth/accounts/[id].ts:83` | no |
| medium | Card notifications (bell and push) show bare amounts with no currency | `api/_lib/notify-cards.ts:17` | no |
| medium | Budget notifications ignore rows with no FX rate, so the tier is judged on partial spend and can silently never fire | `api/_lib/notify-budget.ts:181` | no |
| medium | Quotation PDF (worker) labels the amount with the org's reporting currency, so changing that currency relabels every quotation | `api/_lib/quotation-pdf.ts:81` | yes |

**Unverified (low):**
- "Translated in-app budget notifications drop the amounts; only the English body/push shows 'X of Y'" (`api/_lib/notify-budget.ts:96`).
- "Planned and pending transfers are not projected into the shortfall walk" (`api/_lib/alerts.ts:201`, known-deferred).

**Refuted:** none.

#### Decisions

- **Cross-currency credit-card funding.** Refuse autopay when the funder's currency differs from the card's (simplest, and matches the same-currency-only rule for recurring auto-save)? Or define an autopay FX policy: convert at the latest rate on the due date and record the effective rate and fee? The rail's projection follows whichever is chosen.
- **Liability account currency.** Should a credit card's liability account take the issuer bank's currency (or get a picker in the card wizard) instead of silently defaulting to the reporting currency?
- **Foreign funder on the rail.** When a card is paid from a foreign bank, should the shortfall/autopay slide show an approximate converted figure (≈ in the funder's currency, at the latest rate), or only say "autopay can't run across currencies"?
- **Card notification copy.** Should the server format it with a locale-neutral symbol (`₹1,800.00`, as budgets do)? Or should `data` carry raw `{amount, currency}` for the client to format in the reader's locale? Push would still need a server-formatted string.
- **Budget notifications when some rows lack a rate.** Fire on partial spend with an "incomplete" marker, hold until rates exist, or ignore the gap (current behaviour)?
- **Account currency change.** Lock it whenever any rule, card or debt references the account? Or allow it and re-snapshot the dependent rules and cards in the same write?
- **Card statement "paid" after a transfer reversal.** Net the reversal legs in `paymentsAfter` and reset `autopay_status`, or treat a reversal as a new charge?
- **Quotations.** Give each quotation its own currency (priced in the client's currency)? Or keep them pinned to the reporting currency and freeze the PDF label at creation?
- **Converted figures on the rail.** Should the rail ever show a reporting-currency figure next to the native one, for example on "Money came in" for a foreign account? The current design is native-only.

#### Existing tests

- `src/lib/alerts.test.ts` — the pure alert rules: projection, as-of-today baseline, autopay outlook, shortfall, ordering. L437-468 check that each alert is labelled with its account's currency (INR shortfall, card, upcoming, posted) and that a legacy row stays null. No case covers autopay funded from another currency.
- `src/components/alerts/alert-dismissals.test.ts` — snooze/dismiss persistence of rail slides (no money).
- `src/lib/card-alerts.test.ts` — card tile expiry alerts (no money).
- `api/_lib/notify-budget.test.ts` — tier boundaries (80% / 100%), `orgTotals`, and the wiring of budget alerts into every spend path. Nothing on currency, excluded counts or `formatBudgetMoney`.
- `api/_lib/notify-billing.test.ts` — which payment and subscription transitions notify; payment amount plus currency code.
- `api/_lib/push-fcm.test.ts` — FCM payload and service-account parsing (no money).
- `src/lib/notifications.test.ts` — notification categories and render-key resolution (no money).
- `src/lib/schedule-notifications.test.ts` — next-fire math for reminders and broadcasts (no money).
- `src/lib/native-reminders.test.ts` — native local reminder scheduling (no money).
- `api/_lib/worker-jobs.test.ts` — worker enqueue plumbing (no money).
- `api/_lib/quotation-pdf.test.ts` — snapshot and `amount_label` formatting from `org.currency`, hash stability, fallback for an unknown currency.
- `e2e/alerts.spec.ts` — the dashboard rail shows, orders and mirrors state (single currency only).
- `e2e/multi-currency.spec.ts` — native account currency, consolidated wealth, cross-currency transfer and fee, reversal, scheduled transfer, wealth split. Nothing on alerts, notifications or card autopay across currencies.


### 3.11 Org settings, onboarding, quotations, billing, referrals and admin

**Readiness:** partial

The foundations are correct. The user-facing reporting-currency edit (`PATCH /api/organizations/:id`) writes both `currency` and `reporting_currency` and leaves account and transaction currencies alone, and `reportingCurrencyFor`, `currencyForFinancialWrite` and the `coalesce` alias on `/api/organizations` are sound. The entry points around that edit still use the legacy column. Onboarding and the admin currency edit write only `organizations.currency`, so a non-USD signup reports in USD and the Money Wizard creates USD accounts that lock as soon as they get an Opening Balance row. Billing, the Debts hub, quotation PDFs and the AI context also read the legacy column, so the app splits between two currencies. Four kinds of stored money have no pinned currency (quotations, v1 per-client caps, spending budgets created after 0069, new detached rows), and all of them silently change currency when the reporting currency changes. Referral earnings are summed raw across INR and USD and labelled in the programme currency, and a payout can be requested from that total. The admin console sums org and client money raw across currencies with no unit, and edits or deletes ledger rows without going through the balance and transfer services.

#### What changes / what is affected

**Schema**
- `src/lib/db/schema.ts` — `quotations.amount` (L670) — ❌ missing — No currency column; the amount implicitly follows the org currency.

**Writes**
- `api/_routes/onboarding.ts` — handler (personal path L54, reuse-business path L71) — ❌ missing — Updates only `organizations.currency`, so `reporting_currency` keeps the USD set when the personal org was auto-created (`auth.ts:96-109`). The new-business path (L75-82) is correct via `createOrgForUser`.
- `api/_lib/auth.ts` — `createOrgForUser` / `ensurePersonalOrg` — ⚠️ partial — `createOrgForUser` sets both columns (L108-109). `ensurePersonalOrg` runs on the first `/api/profile` GET with `profile.currency` (default `'USD'`), before onboarding lets the user choose.
- `api/_routes/organizations/[id].ts` — PATCH currency (L72-79) — ⚠️ partial — Writes both columns and does not rewrite accounts. It has no audit log, no money-cache invalidation and no warning or FX-coverage check, and it also changes billing currency because billing reads `organizations.currency`.
- `api/_routes/profile.ts` — PATCH currency — — not needed — The profile currency is only the default for new orgs (`organizations.ts:78-82`, `auth.ts:192`). It has no UI editor; ProfilePage links to `/organizations`.
- `src/pages/OrganizationsPage.tsx` — `handleSaveEdit` + Reporting currency dialog (L61-90, L366-370) — ⚠️ partial — Sends only `body.currency`, with no confirmation or impact summary, and offers every `CURRENCY_LIST` code, including codes with no FX history.
- `src/pages/OnboardingPage.tsx` — `createWorkspace` (L79-98) — ⚠️ partial — Sends the detected or chosen currency, but the server drops it for reporting (see `onboarding.ts`).
- `src/components/onboarding/MoneyWizard.tsx` — `finish` (L128-180), symbol L90 — ⚠️ partial — Shows the chosen currency's symbol but never sends `currency_code`, so Cash (PATCH `current_balance`), the bank (POST) and budgets all take the server's reporting currency.
- `src/pages/OrgSetupPage.tsx` — `createOrg` (L40-56) — ✅ correct — POST `/api/organizations` sets both columns via `createOrgForUser`; the wizard then targets the new org.
- `api/_routes/wealth/accounts.ts` — `ensureCashAccount` (L18-43) — ✅ correct — Cash in Hand gets `reporting_currency ?? currency`. This is only right when reporting was set correctly, so it inherits the onboarding bug.
- `api/_lib/wealth-accounts.ts` — `createWealthAccount` (L113-121) — ✅ correct — The default currency is `body.currency_code ?? reporting ?? legacy`.
- `api/_lib/transaction-currency.ts` — `currencyForFinancialWrite` (L17-23) — ⚠️ partial — Detached (no-account) rows and rules snapshot the reporting currency at write time, so after a reporting change new rows silently use the new currency.
- `api/_routes/quotations.ts` — POST insert (L142-161), GET list — ❌ missing — No currency snapshot on create.
- `api/_routes/quotations/[id].ts` — PATCH amount — ❌ missing — No currency on edit.
- `api/_routes/quotations/[id]/convert.ts` — convert to client — — not needed — Copies contact fields only; no money moves to the client.
- `src/components/QuickAddModal.tsx` — quotation amount (L280) — ⚠️ partial — Uses the org-currency symbol and has no currency field.
- `api/_routes/billing/create-subscription.ts` — checkout (L135-152) — ⚠️ partial — The `billing_currency` attempts come from the legacy org currency plus the profile country; India is always INR.
- `api/billing/webhook.ts` — `payment.succeeded` invoice currency (L169-202) — ✅ correct — The invoice currency comes from Dodo, the source of truth for money.
- `api/_lib/billing-sync.ts` — reconcile invoices (L64-106) — ✅ correct — Stores Dodo's amount and currency, and credits the referral with the payment currency.
- `api/_lib/referral.ts` — `creditReferralOnPaid` (L69-138) — ✅ correct — Snapshots `reward_currency`: the payment currency for percent rewards, the programme currency for fixed ones.
- `api/_routes/referrals/payouts.ts` — POST payout request (L28-45) — ❌ missing — Validates against the mixed-currency available total and saves `currency` = the programme currency.
- `api/_routes/admin/transactions.ts` — POST (L80-121) — ✅ correct — The detached row snapshots the reporting currency via `currencyForFinancialWrite`.
- `api/_routes/admin/transactions.ts` — PATCH (L123-157) / DELETE (L159-168) — ❌ missing — Updates or hard-deletes the row directly: no balance update, no transfer, debt or trash service, and no currency re-derivation.
- `api/_routes/admin/organizations.ts` — GET list currency (L83), POST (L104-131), PATCH currency (L145) — ❌ missing — PATCH writes only the legacy column with no ISO validation, and the list shows the legacy column. POST with an invalid code hits the `reporting_currency` CHECK and returns 500.
- `src/pages/admin/AdminOrgsPage.tsx` — Default currency edit (L184, L514-517), create (L294) — ⚠️ partial — Takes currency as free text and sends it to the legacy-only admin PATCH.
- `api/_routes/spending-budgets.ts` — POST insert (L88-105) — ❌ missing — `currencyCode` is never set, so the budget follows the reporting currency (`budgetCurrency`, spending-budgets lib L112-113).
- `api/_routes/budgets.ts` — personal shim insert (L113-116); business caps GET (L53-70) — ❌ missing — The personal primary budget is inserted with no currency. Business per-client caps (`budgets` table, no currency column) are judged in the current reporting currency.

**Aggregates**
- `api/_lib/referral.ts` — `computeStats` (L153-184) — ❌ missing — Adds `reward_amount` and payout amounts raw across currencies and labels the result `settings.rewardCurrency`.
- `src/pages/admin/AdminReferralsPage.tsx` — owed (L93, L171) — ❌ missing — Adds paid rewards across currencies and formats the total in `settings.reward_currency`.
- `api/_routes/admin/stats.ts` — GET — — not needed — Counts only; no money sums.
- `api/_routes/admin/org-detail.ts` — counts `incomingTotal`/`outgoingTotal` (L57-66) — ❌ missing — Raw `sum(t.amount)` across currencies, with no conversion or grouping. Outgoing ignores refunds, and the transaction count includes trashed rows.
- `api/_routes/admin/clients.ts` — GET `totalIncoming`/`totalOutgoing` (L64-71) — ❌ missing — Raw `incomeSumSql`/`expenseSumSql` over a leftJoin with no `deleted_at` or `is_system` filter and no currency.

**Displays**
- `src/lib/currency-context.tsx` — `CurrencyProvider` — ✅ correct — `currency = activeOrg.currency` (the coalesced reporting currency); falls back to USD while the org list loads.
- `api/_lib/quotation-pdf.ts` — `buildQuotationSnapshot` (L80-81) — ⚠️ partial — Uses the legacy `organizations.currency`, not reporting and not the quotation's own. The currency is part of `snapshotHash`, so any org currency change marks every PDF stale.
- `api/_routes/quotations/[id]/pdf.ts` — GET/POST (L48-50) — ⚠️ partial — Passes the full org row to the snapshot, so it inherits the legacy-column read.
- `src/pages/QuotationsPage.tsx` — `fmt` (L178-179), amount prefix (L116) — ⚠️ partial — Formats every quotation with `useCurrency()` and 0 decimals.
- `src/components/quotations/quotation-views.tsx` — `actions.formatAmount` (L151, L218, L293) — ⚠️ partial — Receives the page's org-currency formatter.
- `api/_lib/entity-drilldown.ts` — `fetchQuotationItems` (L109-140) — — not needed — Returns the amount, but EntityDrilldown renders amounts only when `tx_type` is set.
- `api/_routes/billing/pricing.ts` — GET (L21-36) — ⚠️ partial — Takes the country from the IP header only and the currency from `organizations.currency`. Checkout resolves the country from the profile first, so the two can disagree.
- `src/pages/SubscriptionPage.tsx` — `formatMinor`/`formatMoney` (L115-120, L761) — ✅ correct — Uses `local_pricing.currency` and the invoice currency, independent of `useCurrency`. `Intl` is unguarded, so an invalid invoice currency throws.
- `src/pages/ReferralPage.tsx` — stats cards (L134-185), `money` (L27) — ⚠️ partial — Per-row rewards and payouts use their own currency (correct), but totals use `stats.currency` (wrong). `money()` is unguarded `Intl`.
- `api/_routes/admin/payouts.ts` — GET list / `[id]` PATCH — ✅ correct — Per-row amount and currency.
- `api/_routes/admin/transactions.ts` — GET `txFields` (L11-23) — ❌ missing — No `currency_code` in the payload.
- `src/pages/admin/AdminOrgDetailPage.tsx` — header currency (L227), Net flow tile (L320-323), ClientsTab (L462, L528-529), TransactionsTab (L781, L842) — ❌ missing — Shows raw numbers with no currency unit, under headers that say everything is in the legacy org currency.
- `src/pages/admin/AdminInvoicesPage.tsx` — invoice list (L270, L350) — ✅ correct — Shows amount plus currency code per invoice.
- `api/_lib/notify-billing.ts` — payment notification — ✅ correct — Uses the invoice's own currency.

**FX**
- `api/_lib/fx-rates.ts` — `reportingCurrencyFor` (L307-314) — ✅ correct — `reporting ?? legacy ?? USD`; used by every converted report.
- `api/_lib/fx-rates.ts` — `ensureHistoricalRates` / `ensureRatesForOrg` (L226-305) — ⚠️ partial — After a reporting switch every existing currency becomes foreign. The backfill inserts one row per calendar day sequentially (L263-267, up to 2,196 days). Currencies the ECB does not publish (AED, SAR) get no history.
- `src/lib/billing-currency.ts` — `resolveBillingCurrency` / `billingCurrencyAttempts` — ⚠️ partial — Pure and tested, but its `orgCurrency` input is `organizations.currency`, which the reporting-currency PATCH also writes, so billing is coupled to reporting.
- `api/_routes/debts.ts` — `orgCurrency` (L44-45) — ⚠️ partial — The Debts hub summary and insights read the legacy `organizations.currency` instead of `reportingCurrencyFor`.

**Validation**
- `api/_routes/wealth/accounts/[id].ts` — PATCH `currency_code` lock (L77-92) — ⚠️ partial — Any row (including the Opening Balance system row) or any card locks the currency. A mislabelled single-currency workspace has no relabel path.
- `api/_routes/admin/referral-settings.ts` — PATCH `reward_currency` (L33) — ❌ missing — Accepts any 0-3 characters with no ISO check, and changing it relabels existing balances.
- `api/_routes/admin/invoices.ts` — POST (L105-127) — ⚠️ partial — Currency is not validated (`currency ?? 'USD'`).

**API contracts**
- `api/_routes/organizations.ts` — GET/POST (`currency = coalesce(reporting_currency, currency)`, L53-54, L102-103) — ✅ correct — The compatibility alias returns the reporting currency first, which is why an onboarding or admin write to the legacy column alone never reaches the UI.

**Other**
- `src/lib/org-context.tsx` — `OrgProvider` refresh — ✅ correct — Re-fetches `/api/organizations` after an org PATCH. That path is persisted to L2, so a cold start can briefly paint the old currency.
- `src/lib/api-cache.ts` — FANOUT `/api/organizations` (L291) — ⚠️ partial — An org PATCH drops only the identity, referrals, search and audit prefixes, not `MONEY_PREFIXES`. Converted aggregates stay fresh for 15 s, and can be painted stale for up to 2 min, in the old reporting currency.
- `api/_lib/ai.ts` — `loadOrgAiContext` (L167) — ⚠️ partial — The AI quick-add context uses the legacy org currency.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | Onboarding stores the chosen currency only in the legacy column, so the workspace reports in USD and the wizard creates USD accounts for non-USD money | `api/_routes/onboarding.ts:54` | no |
| critical | Referral balances add rewards across currencies and payout requests are saved from that total | `api/_lib/referral.ts:160` | no |
| high | No way to correct a workspace created in the wrong currency: accounts lock and a currency change converts instead of relabelling | `api/_routes/wealth/accounts/[id].ts:85` | no |
| high | New spending budgets are saved with `currency_code` NULL, so a reporting change turns 'EUR 500' into 'INR 500' against converted spend | `api/_routes/spending-budgets.ts:90` | **yes** |
| high | Business per-client spend caps (`budgets` table) have no currency and are judged in whatever the reporting currency is today | `api/_routes/budgets.ts:56` | no |
| high | Admin transaction edit/delete changes ledger rows directly, without the balance, transfer or debt services | `api/_routes/admin/transactions.ts:150` | no |
| medium | Admin 'Default currency' edit writes only `organizations.currency`, so billing, Debts, PDFs and AI disagree with the app's reporting currency | `api/_routes/admin/organizations.ts:145` | no |
| medium | Quotations have no currency: the list and regenerated PDF change currency when the reporting currency changes | `api/_lib/quotation-pdf.ts:81` | no |
| medium | Changing the referral programme currency relabels every existing balance and future payout | `api/_routes/admin/referral-settings.ts:33` | no |
| medium | Pricing page and checkout use different country sources, so the displayed currency can differ from the charged one | `api/_routes/billing/pricing.ts:21` | no |
| medium | Admin org-detail 'Net flow' and client totals add raw amounts across currencies, include trashed and system rows, and show no unit | `api/_routes/admin/org-detail.ts:57` | no |
| medium | Admin Transactions tab shows foreign rows as bare numbers under an 'Amounts are in {org currency}' header | `src/pages/admin/AdminOrgDetailPage.tsx:781` | no |
| medium | Admin referrals 'Owed' adds rewards of different currencies | `src/pages/admin/AdminReferralsPage.tsx:93` | no |
| medium | Reward currency is not validated, and an invalid code crashes `/referrals` for every user | `api/_routes/admin/referral-settings.ts:33` | no |
| medium | A reporting-currency change does not invalidate cached converted aggregates | `src/lib/api-cache.ts:291` | no |
| medium | First report reads after a reporting switch backfill FX one day at a time, sequentially and concurrently across routes | `api/_lib/fx-rates.ts:263` | no |
| medium | The reporting-currency picker offers currencies with no historical FX, and past foreign rows are then excluded permanently | `api/_lib/fx-rates.ts:104` | **yes** |

**Unverified (low):** Debts hub and AI context read the legacy `organizations.currency` instead of the reporting currency (`api/_routes/debts.ts:44`); admin-created invoices accept any currency string, and the org's Subscription page then crashes (`api/_routes/admin/invoices.ts:122`); the quotation list rounds amounts to 0 decimals, unlike the PDF (`src/pages/QuotationsPage.tsx:179`); reporting-currency changes are not audit-logged (`api/_routes/organizations/[id].ts:85`).
**Refuted (not bugs):** "Billing checkout currency follows the workspace reporting currency"; "The reporting-currency dialog does not say what changes; new detached transactions and rules silently switch currency". Both topics still appear as open product decisions below.

#### Decisions

- **Workspace currency semantics:** is it purely a reporting preference (the current code), or does a single-currency workspace also get an owner-only "relabel everything, no conversion" path to fix a wrong signup currency? Legacy users relied on the old relabel semantics.
- **Billing decoupling:** should billing (Dodo `billing_currency` and the pricing display) be decoupled from the reporting currency, through a separate billing preference or the country alone, so that changing reporting never changes what the card is charged in?
- **Quotation currency:** add `quotations.currency_code` defaulting to the reporting currency, with an optional picker for a business quoting a foreign prospect? Also decide what "convert to client" carries over.
- **Detached transactions and recurring rules:** keep snapshotting the reporting currency at write time, or add a per-client currency or an explicit picker?
- **Business per-client caps (`budgets`, `budget_history`):** add a pinned `currency_code`, or keep judging in the reporting currency and accept the relabel?
- **Spending budgets:** pin `currency_code` at creation and backfill the NULL rows now. Should the budget dialog also let the user pick a currency other than reporting?
- **Referral money:** per-currency balances and payouts, or convert every reward into the programme currency at credit time (storing native plus programme amounts)? And what should a programme-currency change do to existing balances?
- **Reporting currencies without historical FX (AED, SAR and other pegged or non-ECB codes):** add manual or pegged snapshots, find another historical provider, or warn/refuse in the picker?
- **Admin console money:** show per-currency groups, or convert to each org's reporting currency with excluded counts? Should super-admin ledger edits be allowed at all on account-linked, transfer or debt rows?
- **Governance of the reporting-currency change:** who may make it (owner only, or owner and admin), and must it be audit-logged and confirmed with an impact summary?

#### Existing tests

- `src/lib/billing-currency.test.ts` — the `resolveBillingCurrency` / `billingCurrencyAttempts` chain: org currency preference, India always INR, unsupported currency falls back to country, dedupe, never empty. Does not cover the coupling to the reporting currency.
- `api/_lib/quotation-pdf.test.ts` — `buildQuotationSnapshot` maps the org currency code into `amount_label`; `snapshotHash` changes when the currency changes; missing-org and invalid-currency fallbacks.
- `src/lib/quotation-pdf-history.test.ts` — `isPdfStale` and the history rules (a reporting change flips the stale flag through the hash).
- `src/lib/currencies.test.ts` — `CURRENCY_LIST`, country-to-currency mapping, and `detectDefaultCurrency` used by onboarding and org setup.
- `src/lib/api-cache.test.ts` — policy and invalidation tables, including the `/api/organizations` fanout (asserts the current narrow rule, not money invalidation).
- `src/lib/multi-currency-migration.test.ts` — 0069-0073 SQL: `reporting_currency` backfill from `currency`, currency columns declared, no amount rewrites, transfer/fee/rate constraints.
- `api/_lib/fx-rates.test.ts` — rate lookup and caching in the FX layer used by `reportingCurrencyFor` / `ensureRatesForOrg` consumers.
- `api/_lib/fx-provider.test.ts` — `CachedFxRateProvider` normalisation, coalescing, identity pairs, invalid rates.
- `api/_lib/tx-sql.test.ts` — the reporting twins (`incomeSumSqlIn` / `expenseSumSqlIn` / `missingRateCountSql`) that admin org-detail and clients should use but do not.
- `src/lib/money.test.ts` — Decimal `Money` invariants (adding mixed currencies fails).
- `api/_lib/admin-billing.test.ts` — admin billing actions (Dodo stop/cancel mirror); no currency assertions.
- `api/_lib/billing-attempts.test.ts` — `billing_attempts` updates, including the currency snapshot field.
- `api/_lib/notify-billing.test.ts` — payment notification text with the invoice amount and currency.
- `e2e/multi-currency.spec.ts` — accounts keep their native currency while the workspace reports in one; consolidated wealth conversion; cross-currency transfer and fee; reversal; scheduled transfer. It never changes the reporting currency and never exercises the onboarding currency.
- `e2e/auth.setup.ts` — first-run onboarding through `POST /api/onboarding`, hard-coded to currency `'USD'` (L166), which hides the `reporting_currency` bug.
- `e2e/smoke.spec.ts` — business-workspace smoke: quotations and clients render, and the subscription page lists plans.


### 3.12 UI money formatting

**Readiness:** partial. All 86 files under `src/` that format money or call `useCurrency()` were read. The core wealth surfaces convert correctly: the /wealth tiles, CurrencyBreakdown, ApproxBalance, AccountSelector/AccountCombobox, TransferWizard, PayCardSheet, SpaceTransferModal, the Dashboard Wealth/Spaces/Recurring/Debts cards, AlertsBanner, and the Transactions/Clients/Calendar/Analytics/Money Flow aggregates. Many other screens still print a native row, rule, card, Space or budget amount with the workspace currency. Some also add mixed currencies raw: CardsSummaryStrip, the SpacesPage headline, the money-flow split leaf, the tx-form budget hint, recurring `posted_total`, and the pre-summary fallback on /wealth and the Dashboard.

There are two ways to reach these bugs:
- **(a)** Pick a foreign account on a screen that doesn't follow the choice: the recurring dialog, the AI assistant, the debit-card wizard, the card pages, search, budget detail and the account-detail stats.
- **(b)** Change the workspace currency on /organizations. Accounts, cards, Spaces and legacy budgets keep their old currency, and every formatter that uses the workspace currency gives them the new label.

Five bugs were confirmed in the running app, in a EUR workspace with the INR account "IDFC NRO" (₹20,000):
- ⌘K search shows its Opening Balance as €20,000.00.
- For a ₹2,000 expense, the budget hint says "€1,100.00 over". The correct figure is about €881.60 left.
- The debit-card wizard lists the account at €20,000.00.
- The recurring dialog keeps a € prefix after IDFC NRO is chosen.
- `/wealth/<IDFC id>` shows "Income ₹180.60", which is really €180.60.

/wealth itself was checked and is correct. The area's unit tests pass (138 tests in 5 files), but no test checks that a component formats native values in their own currency.

#### What changes / what is affected

*Schema, Writes, Other:* this area has no touchpoints in these roles (it is a display sweep).

**Aggregates**
- `src/lib/wealth.ts` — summarizeWealth (L191-219) — ⚠️ partial — Raw signed sum of `current_balance` across currencies. It is still the pre-summary fallback on WealthPage L309 and Dashboard L576.
- `src/components/wealth/use-consolidated-wealth.ts` — availableFromSummary / liquidFromSummary / savedFromSummary — ✅ correct — Skips accounts whose `converted_balance` is null. Callers show `complete`.
- `src/components/cards/CardsSummaryStrip.tsx` — stats L67-86, money L66 — ❌ missing — Raw sum of owed/available across credit cards, whatever their currency. The next payment is labelled in the workspace currency.
- `src/pages/SpacesPage.tsx` — totalSaved L84 → L170; SpaceTile L318, L347, L350 — ❌ missing — Raw cross-currency sum of Space balances. Native balances and goals are formatted in the workspace currency (the Dashboard SpacesCard does this correctly).
- `src/components/spaces/SpacesCard.tsx` — nativeTotals L65-72 — ✅ correct — Converted when complete, otherwise shown per currency.
- `api/_lib/recurring-query.ts` — ruleStatsFields.postedTotal L79-82 — ❌ missing — `sum(t.amount)` over every posted occurrence, although PATCH can re-point a rule to an account in another currency (`api/_routes/recurring/[id].ts` L187).
- `src/components/recurring/RecurringCard.tsx` — per-currency perMonth L53-80, next L161 — ✅ correct — Groups by the rule's `currency_code`.
- `src/components/transactions/tx-form.tsx` — budgetHint / spendingHint L276-294 — ❌ missing — Adds the native `txTotal` to `budget.spent`, which is in the budget/reporting currency. Verified: ₹2,000 on IDFC NRO shows "€1,100.00 over"; the correct figure is about €881.60 left.
- `api/_routes/transactions.ts` — groupedFieldsFor.amount L109, groupedOrder L133-135 — ⚠️ partial — A mixed-currency split uses `sum(reporting_amount)`, which silently skips NULL legs, so it shows a partial total (or 0). The amount sort uses a raw `sum(amount)`.
- `src/pages/Dashboard.tsx` — KPIs L1072-1076 (sumInReporting), buckets L1102-1120, chart L1281-1296, WealthOverview L576-587, latest L546 — ⚠️ partial — The KPIs and chart convert and count excluded rows. The WealthOverview headline and health dot use the raw local sum until the summary lands. The local `formatCurrency` is 'en-US' only.
- `src/lib/money-flow.ts` — split collapse L230-238 — ❌ missing — The amount is a raw sum of the legs. The leaf keeps `legs[0].currency_code` and drops each leg's own currency.
- `src/pages/DebtsPage.tsx` — formatByCurrency L185/L251/L264, next payment L204, insights L223 — ✅ correct — Grouped by currency.
- `src/components/debts/DebtPlanner.tsx` — plannable L38-44, excluded hint L246-249 — ⚠️ partial — Correctly plans only debts in the workspace currency, but labels the excluded foreign debts with `receivablesHint` (the text about money others owe you).

**Displays**
- *Shared formatters*
  - `src/lib/wealth.ts` — formatMoney / accountCurrency / accountBalanceLabel / accountSpendableLabel / formatRate / formatApprox — ✅ correct — The canonical formatter: locale-aware, ISO minor units, CA$/A$ disambiguation. Many pages bypass it with ad-hoc 'en-US' Intl formatters.
  - `src/components/budget/budget-format.tsx` — budgetCurrency (L126) / budgetExcluded — ❌ missing — The helper exists but nothing uses it. Every budget component formats with the workspace currency instead.
  - `src/lib/debt-format.ts` — debtMoney / formatByCurrency — ✅ correct — Never converts; joins the per-currency parts.
- *Wealth*
  - `src/pages/WealthPage.tsx` — net-worth hero L520-575, AccountTile L1016, archived L694, create form L769-773 — ⚠️ partial — The tiles are native and correct, with the ≈ line and CurrencyBreakdown. The hero falls back to the raw mixed sum (local + localSaved) while `/api/wealth/summary` is missing or has errored (L309-331). `loading` waits on the account list, not the summary.
  - `src/components/wealth/CurrencyBreakdown.tsx` — CurrencyBreakdown — ✅ correct — Native per-currency totals, the ≈ reporting figure, rate and date, and a not-included notice.
  - `src/components/wealth/ApproxBalance.tsx` — ApproxBalance — ✅ correct — Hidden when the account is already in the reporting currency or has no rate. Shows a stale badge.
  - `src/pages/WealthAccountDetailPage.tsx` — stats L240-244 rendered at L383 via `fmt=formatMoney(n, accountCur)` L116 — ❌ missing — `summary.incoming/outgoing` are in the reporting currency (`api/_routes/transactions.ts` L360-379) but printed in the account's currency. Verified: IDFC NRO shows "Income ₹180.60", which is €180.60. The balance (L358) and rows (L450) are correct.
  - `src/components/AccountSelector.tsx` — optionCurrency L64-73, entryCurrency L141-143, MoneyInput symbol L283 — ✅ correct — The prefix follows the chosen account (verified: € → ₹ on IDFC NRO). A split blocks a second currency (L251-263).
  - `src/components/wealth/AccountCombobox.tsx` — balance labels L84-110 — ✅ correct — `accountCurrency` per option. Card options resolve through their ledger account.
  - `src/components/wealth/TransferWizard.tsx` — AccountPill, amount prefix L290, received/fee/rate L307-360 — ✅ correct — Each side shows its own currency, and the effective rate is shown. L178 prefills the destination with `toFixed(2)` even for 0-decimal currencies (JPY).
  - `src/components/wealth/PayCardSheet.tsx` — cardCurrency L76, fromCurrency L148 — ✅ correct — Correct when given a real WealthAccount. The CardsTab L502 fallback `accountFromCard(pay.card)` has no `currency_code`, so the sheet then uses the workspace currency.
  - `src/components/wealth/CreditCardPanel.tsx` — money L83 — ⚠️ partial — Uses its `currency` prop. That is correct from WealthAccountDetailPage L334 (accountCur) and wrong from CardDetailPage L451 (workspace currency).
  - `src/components/wealth/ScheduledTransfersPanel.tsx` — source/destination amounts L106-115 — ✅ correct — Uses `tr.source_currency` / `destination_currency`.
  - `src/components/wealth/WealthAccountDialogs.tsx` — edit/adjust symbols L56-59 — ✅ correct — The symbol follows the account being edited or adjusted.
  - `src/components/wealth/AccountQuickAddSheet.tsx` — `symbol = currencySymbol(currency)` L75, input prefix L274 — ⚠️ partial — Uses the caller's `currency`, not `accountCurrency(account)`. Correct from WealthAccountDetailPage; wrong from CardDetailPage L609 and RecurringDetailPage L601.
  - `src/components/onboarding/MoneyWizard.tsx` — symbol L90 — ✅ correct — Onboarding accounts are created in the workspace currency.
- *Cards*
  - `src/pages/CardDetailPage.tsx` — fmt L110 → L376, L380-381, L507, L568; CreditCardPanel L451; AutopayPanel L469; AccountQuickAddSheet L609 — ❌ missing — The whole page uses the workspace currency, although `ledgerAccount` (with `currency_code`) is loaded.
  - `src/components/cards/CardsTab.tsx` — currency prop (from WealthPage L717) — ❌ missing — Passes the workspace currency to every tile, strip, fan sheet and action menu. The GET /api/cards payload (`api/_lib/cards.ts` L53-62) has no account `currency_code`.
  - `src/components/cards/CardTile.tsx` — money L199 → L318-374, L464 — ❌ missing — The debit card's bank balance and the credit usage are formatted in the workspace currency.
  - `src/components/cards/CardFanSheet.tsx` — money L65 → L286-288 — ❌ missing — Same as CardTile.
  - `src/components/cards/AutopayPanel.tsx` — money L45 — ❌ missing — The next autopay amount and statement remaining are in the workspace currency.
  - `src/components/cards/CardActionsMenu.tsx` — payOffTitle L231 — ❌ missing — The close-with-debt amount is in the workspace currency.
  - `src/components/cards/wizard/BankPicker.tsx` — bank balance L232, symbol L72 — ❌ missing — Verified: IDFC NRO is listed as €20,000.00.
  - `src/components/cards/AddCardWizard.tsx` — `symbol = currencySymbol(org)` L86 — ✅ correct — A credit card's liability account is always created in the reporting currency (`api/_lib/wealth-accounts.ts` L112-118; `api/_routes/cards.ts` L124 passes no `currency_code`), so this is consistent today.
- *Spaces*
  - `src/pages/SpaceDetailPage.tsx` — L150, L185, L188, L213, L251, L440; AutoSaveModal L346 — ❌ missing — Balance, goal, suggestion, auto-save amount, transactions and delete-with-money are all in the workspace currency. The auto-save account picker isn't filtered to the Space's currency, so the server answers 409 `cross_currency_recurring_policy_required`.
  - `src/components/spaces/SpaceFormModal.tsx` — symbol L37 — ⚠️ partial — The goal prefix uses the workspace currency. There is no currency picker, so a Space is always created in the reporting currency (`api/_routes/spaces.ts` L62).
  - `src/components/spaces/SpaceTransferModal.tsx` — spaceCurrency/sourceCurrency L64-65 — ✅ correct — Cross-currency transfer that shows both native amounts.
- *Recurring*
  - `src/pages/RecurringPage.tsx` — rule amount L223 — ❌ missing — `formatMoney(rule.amount, org currency)`, although `rule.currency_code` is available.
  - `src/pages/RecurringDetailPage.tsx` — money L306 → L414, L433, L569; TransactionDetailModal L589; AccountQuickAddSheet L601 — ❌ missing — Rule amount, posted total and occurrences are in the workspace currency.
  - `src/components/recurring/RecurringRuleDialog.tsx` — `symbol = getCurrencySymbol(org)` L227 → L544, L649, L656; previewPerYear L756 — ❌ missing — Verified: the '€' prefix stays after choosing IDFC NRO (₹), and the rule posts the typed number in INR.
- *Transactions, quick add, AI, search*
  - `src/components/AppLayout.tsx` — onTxCreated L212-219 — ❌ missing — The quick-add success toast uses the workspace currency.
  - `src/components/MobileAppLayout.tsx` — quick-add toast L233 — ❌ missing — Same as AppLayout.
  - `src/components/transactions/AiQuickFill.tsx` — placeholder example L216 — — not needed — Example string only.
  - `src/components/AiAssistantConfirm.tsx` — headline L108, toasts L143/L155, rows L273/L338 — ❌ missing — Shows the workspace currency but saves to the matched or default account, which may be foreign. The user confirms "€50" and ₹50 is posted.
  - `src/components/AiVoiceAssistant.tsx` — `currency={currency}` L519 — ❌ missing — Passes the workspace currency to the confirm card.
  - `src/components/GlobalSearchDialog.tsx` — tx amount L200 — ❌ missing — Verified: the INR Opening Balance shows as €20,000.00. `api/_routes/search.ts` L44-52 does not select `currency_code`.
  - `src/components/MobileSearchOverlay.tsx` — tx amount L313 — ❌ missing — Same as the desktop palette.
  - `src/components/entity-drilldown/EntityDrilldown.tsx` — item amount L199 — ❌ missing — `api/_lib/entity-drilldown.ts` L50 returns the amount without a currency, and the UI uses the workspace currency. The amount sort (L145-152) compares native numbers across currencies.
  - `src/components/TransactionPeekModal.tsx` — amount L46 — ❌ missing — Uses its `currency` prop (Dashboard L1618 passes the workspace currency) instead of `rowCurrency(tx)`. The Dashboard list row (L546) is correct, so the list and the peek disagree.
  - `src/components/TransactionDetailModal.tsx` — fmt L71 — ✅ correct — `tx.currency_code ?? currency`.
  - `src/pages/TransactionsPage.tsx` — row fmt L102/L213, summary L511 + FxExcludedNotice L876, legs L1099 — ✅ correct — Rows are native via `rowCurrency`, and the summary is in `summary.currency`. Hard-coded 'en-US' with 2 fixed decimals: JPY shows ¥1,234.00 and INR loses lakh grouping.
  - `src/pages/TrashPage.tsx` — fmtAmount L38-39 → L194 — ❌ missing — Trashed transaction amounts are in the workspace currency. `api/_routes/trash.ts` L8-18 does not return `currency_code`.
- *Reports (calendar, analytics, flow)*
  - `src/pages/CalendarPage.tsx` — reportingCurrencyOf L79, day cells, row list L482 — ✅ correct — Aggregates are in the reporting currency with the excluded notice; rows are native.
  - `src/pages/AnalyticsPage.tsx` — formatCurrency L34, KPIs L146-151, axes L166/L189, tooltips L167/L190 — ⚠️ partial — Values are in the reporting currency. The recharts tooltip (ChartTooltipContent) shows bare numbers with no currency.
  - `src/pages/MoneyFlowPage.tsx` — Root/Group/Leaf/Timeline nodes, detail sheet L1175-1241, TxPopup L717 — ⚠️ partial — Aggregates are in the reporting currency, group balances native (`account_currency`), leaves native. The split legs (L367) use the leaf's currency for every leg.
- *Clients*
  - `src/pages/ClientsPage.tsx` — clientTotalsCurrency L100, excluded L101/L450 — ✅ correct — Uses `totals_currency` and the excluded notice.
  - `src/pages/ClientDetailPage.tsx` — totalsCurrency L225, rows L633/L869 — ✅ correct — Totals in the reporting currency, rows native.
  - `src/components/ClientDetailSheet.tsx` — fmt L37-38 — ⚠️ partial — Uses the workspace currency (equal to `totals_currency` today) and ignores `totals_currency` and `excluded_count`.
  - `src/components/ClientOverviewModal.tsx` — fmt L66-67 — ⚠️ partial — Same as ClientDetailSheet.
  - `src/pages/ClosedClientsPage.tsx` — fmt L35-36 — ⚠️ partial — Uses the workspace currency (equal to the reporting currency today). No excluded notice.
- *Budgets*
  - `src/pages/BudgetsPage.tsx` — budgetsCurrency L64, overall header L250-300 — ⚠️ partial — Uses `data.currency` (reporting) for the overall budget, but that budget is measured in its own `currency_code` (`api/_lib/spending-budgets.ts` L303). The allocation sums sibling limits whatever their currency.
  - `src/components/budget/BudgetRow.tsx` — money L80 — ❌ missing — Uses the workspace currency, not `budgetCurrency(b)`.
  - `src/components/budget/BudgetList.tsx` — money L151 → L244 — ❌ missing — Workspace currency.
  - `src/components/budget/BudgetsCard.tsx` — money L63 — ❌ missing — The Dashboard budgets card uses the workspace currency.
  - `src/pages/BudgetDetailPage.tsx` — money L59 → L142-L264, recent rows L316, audit L377 — ❌ missing — Recent rows carry the native amount, `currency_code` and `amount_in` (`api/_lib/spending-budgets.ts` L730-741), but the UI prints `r.amount` in the workspace currency.
  - `src/components/budget/BudgetAnalyticsPanel.tsx` — money L42 — ⚠️ partial — Workspace currency. Per-budget utilisation ignores the budget's currency, and the tooltip has no currency.
  - `src/components/budget/SpendingBudgetDialog.tsx` — symbol L56, childrenTotal L412 — ⚠️ partial — New budgets have `currency_code` NULL (= reporting), so the symbol is right for new rows. It is wrong when editing a legacy budget after the reporting currency changed.
  - `src/components/budget/BusinessBudgetCard.tsx` — BudgetIndicator currency L98 — ✅ correct — v1 caps are measured in the reporting currency (`api/_lib/budget-spend.ts` L69-84). The limit column shows no currency.
  - `src/components/budget/ClientBudgetsSection.tsx` — L118-158 — ✅ correct — v1 caps in the reporting currency.
  - `src/pages/ClientBudgetDetailPage.tsx` — L114-192 — ✅ correct — Reporting currency. The tooltip (L139) has no currency.
  - `src/components/budget/BudgetIndicator.tsx` — L59-70 — ✅ correct — Pure formatter; whether it is right depends on the caller.
- *Debts*
  - `src/components/debts/UpcomingPayments.tsx` — L46, L60 — ⚠️ partial — Grouped by currency, but a blank currency falls back to a hard-coded 'USD' instead of the workspace currency.
  - `src/components/debts/DebtsCard.tsx` — owed L92-93, next L137 — ✅ correct — `formatByCurrency`.
  - `src/components/debts/LinkRepaymentDialog.tsx` — L150 — ✅ correct — `debt.currency`.
  - `src/components/recurring/LinkDebtDialog.tsx` — L157 — ✅ correct — `d.currency`.
- *Alerts, notifications, quotations, admin, billing, landing*
  - `src/components/alerts/AlertsBanner.tsx` — param formatting L263-270 — ✅ correct — `alert.currency ?? org`; `api/_lib/alerts.ts` attaches the account currency.
  - `api/_lib/notify-cards.ts` — `money = n.toFixed(2)` L17 — ⚠️ partial — Card notification text has no currency at all ("1000.00 paid to Visa").
  - `src/pages/QuotationsPage.tsx` — symbol L116, fmt L179 — ⚠️ partial — Quotations have no currency column, so every quotation gets the new label when the workspace currency changes.
  - `src/pages/admin/AdminOrgDetailPage.tsx` — TransactionsTab L781/L842 — ⚠️ partial — Says "Amounts are in {org currency}", but `tx.amount` is native. `api/_routes/admin/org-detail.ts` L58/L63 sums `t.amount` raw across currencies.
  - `src/pages/SubscriptionPage.tsx` — billing prices — — not needed — Billing currency (`src/lib/billing-currency.ts`), not ledger money.
  - `src/landing/lib/format.ts` — marketing formatter — — not needed — Landing page only.

**FX**
- `src/lib/currency-context.tsx` — useCurrency() — ⚠️ partial — Returns `activeOrg.currency`, which equals the reporting currency because PATCH `/api/organizations/:id` sets both. That is only right for aggregates, yet 47 call sites use it for native values. There is no `useReportingCurrency` name to make the intent explicit.
- `src/lib/reporting-fields.ts` — rowCurrency / reportingAmountOf / sumInReporting / clientTotalsCurrency / reportingCurrencyOf / excludedCountOf — ✅ correct — Correct helpers used by Transactions, Dashboard, Clients, ClientDetail, Calendar, Analytics and Flow. No unit test file.

**Validation**
- `api/_lib/ai.ts` — loadOrgAiContext L165-196, promptRules L314 — ❌ missing — The prompt lists accounts without their currency and tells the model the amount is in the workspace currency. A stated foreign currency only lowers confidence, and the number goes into whichever account is matched.
- `src/components/debts/DebtFormSheet.tsx` — currency L134-135, account filter L152 — ✅ correct — Uses the debt's currency; accounts are filtered to the same currency.
- `src/components/debts/RecordPaymentSheet.tsx` — symbol L47, account filter L82 — ✅ correct — Only a payer in the same currency is allowed.

**API contracts**
- `src/components/transactions/AddTransactionDialog.tsx` — `onCreated({ amount: total })` L383, CreatedTxInfo L35 — ⚠️ partial — Sends no currency, so the AppLayout L215 / MobileAppLayout L233 toast formats a native amount in the workspace currency.

#### Issues in this area

"Deferred?" means the issue is a known, deliberately deferred gap.

| Severity | Title | File:line | Deferred? |
|---|---|---|---|
| high | AI assistant confirm card shows workspace currency but posts the number into a possibly foreign account | `src/components/AiAssistantConfirm.tsx:108` | no |
| high | Recurring rule dialog amount prefix stays in workspace currency when paying from a foreign account | `src/components/recurring/RecurringRuleDialog.tsx:227` | no |
| high | Account detail Income/Expenses/Net are reporting-currency figures printed with the account's currency | `src/pages/WealthAccountDetailPage.tsx:383` | no |
| high | Card pages and the Cards tab format every card figure with the workspace currency; the summary strip sums cards raw | `src/components/cards/CardsSummaryStrip.tsx:70` | yes |
| high | Spaces page headline sums Space balances across currencies; tiles and detail use workspace currency | `src/pages/SpacesPage.tsx:84` | yes |
| medium (reported high) | Recurring list and detail show rule and occurrence amounts in workspace currency | `src/pages/RecurringPage.tsx:223` | no |
| medium (reported high) | Budget detail 'recent' rows print native amounts in the budget's currency label | `src/pages/BudgetDetailPage.tsx:316` | yes |
| medium | Budget components ignore the budget's own currency (budgetCurrency helper is unused) | `src/components/budget/BudgetRow.tsx:80` | yes |
| medium | Add-transaction budget hint adds a native foreign amount to a reporting-currency budget | `src/components/transactions/tx-form.tsx:279` | no |
| medium | Global search (desktop + mobile) shows transaction amounts in workspace currency | `src/components/GlobalSearchDialog.tsx:200` | no |
| medium | Debit-card wizard bank picker lists foreign banks with the workspace symbol | `src/components/cards/wizard/BankPicker.tsx:232` | yes |
| medium | AccountQuickAddSheet amount prefix follows the caller's currency, not the locked account | `src/components/wealth/AccountQuickAddSheet.tsx:75` | no |
| medium | Dashboard transaction peek modal formats in workspace currency while the list row is native | `src/components/TransactionPeekModal.tsx:46` | no |
| medium | Wealth hero and Dashboard wealth card show a raw mixed-currency sum until (or unless) /api/wealth/summary answers | `src/pages/WealthPage.tsx:326` | no |
| medium | Grouped transaction row for a mixed-currency split shows a partial total (verified on a 1/2 vote) | `api/_routes/transactions.ts:109` | no |
| medium | Recurring posted_total sums occurrences across currencies | `api/_lib/recurring-query.ts:80` | no |
| medium | Entity drilldown lists native amounts with the workspace symbol | `src/components/entity-drilldown/EntityDrilldown.tsx:199` | no |
| medium | Trash lists trashed transactions in workspace currency | `src/pages/TrashPage.tsx:194` | no |
| low (reported medium) | Money-flow split leaf sums legs raw across currencies and loses per-leg currency | `src/lib/money-flow.ts:235` | yes |

**Low severity, not verified:**
- Quick-add success toast formats a native amount with the workspace currency (`src/components/AppLayout.tsx:215`)
- Debt planner labels excluded foreign-currency loans with the receivables hint (`src/components/debts/DebtPlanner.tsx:248`)
- Auto-save account picker offers accounts in other currencies that the server refuses (`src/pages/SpaceDetailPage.tsx:346`)
- Card notifications carry no currency (`api/_lib/notify-cards.ts:17`)
- Inconsistent ad-hoc formatters ignore locale grouping and currency minor units (`src/pages/TransactionsPage.tsx:260`)
- Chart tooltips show bare numbers without a currency (`src/pages/AnalyticsPage.tsx:167`)
- Admin org detail sums transactions raw across currencies and labels them as org currency (`api/_routes/admin/org-detail.ts:58`)
- UpcomingPayments falls back to hard-coded USD (`src/components/debts/UpcomingPayments.tsx:46`)
- getCurrencySymbol returns an ambiguous '$' for CAD/AUD in amount inputs (`src/components/recurring/RecurringRuleDialog.tsx:227`)

**Refuted:** none.

#### Decisions

- **Changing the workspace currency.** A change on /organizations makes every existing account, card, Space, rule and legacy budget "foreign" at once. Should the change be allowed freely, blocked when native data exists, or allowed with a warning that lists what stays in the old currency?
- **Account page Income/Expenses.** Should `/wealth/:id` show them in the account's currency (a native summary from the server), or in the reporting currency labelled as converted? Recommendation: native.
- **Currency pickers for Spaces and credit cards.** SpaceFormModal has no picker today, and `api/_routes/cards.ts` always creates the liability account in the reporting currency. Should both get a native-currency picker, or is "reporting currency at creation" the rule?
- **Budgets and quotations after a reporting-currency change.** Do legacy budgets (`currency_code` backfilled by 0069) keep their old currency or get re-denominated? The v1 `budgets.amount` and `quotations.amount` have no currency column: snapshot a currency, or label them with the new one?
- **Budget hint for a foreign expense.** Should the add-transaction hint convert client-side with the latest rate (marked ≈), fetch a server preview, or hide itself?
- **AI quick add and voice assistant.** Should parsing return a currency and refuse or flag a mismatch with the target account? Should the prompt list each account's currency?
- **Mixed-currency splits.** Should POST `/api/transactions/group` refuse them server-side, as the UI already does? That would remove the mixed-group code paths in `transactions.ts` and `money-flow.ts`.
- **Wealth hero before the summary loads.** On a multi-currency workspace, what should it show until `/api/wealth/summary` answers: a skeleton, per-currency parts, or nothing?
- **Ad-hoc formatters.** Should every `Intl.NumberFormat('en-US')` formatter be replaced by `formatMoney`? Existing users would see digit grouping change (for example, Indian lakh grouping).
- **Static guard.** Should a source scan (like the one in `tx-sql.test.ts`) fail the build when a component passes a native field (`tx.amount`, `rule.amount`, `current_balance`, `goal_amount`) to `formatMoney` with the bare workspace `currency`?

#### Existing tests

- `src/lib/wealth-spendable.test.ts` — which figure `accountSpendableLabel` shows (bank balance vs card available/owed) and privacy masking. EUR only, no mixed-currency case.
- `src/lib/money.test.ts` — Decimal Money/FX primitives and `transferAmounts`: same-currency amounts must match, cross-currency needs a destination amount, fee rules.
- `src/lib/money-flow.test.ts` — a split collapses into one leaf with the summed total (L123-129). Same currency only; no mixed-currency legs.
- `api/_lib/tx-sql.test.ts` — SQL shape of `reportingAmountSql` / `incomeSumSqlIn` / `expenseSumSqlIn` / `missingRateCountSql`, plus a static check that reporting routes use the `*In` helpers.
- `src/lib/alerts.test.ts` — the alert model, including the per-alert currency carried from the account.
- `src/lib/card-alerts.test.ts` — card alert derivation from native card figures.
- `api/_lib/budget-spend.test.ts` — budget spend predicates and the signed refund amount.
- `src/lib/spending-budget.test.ts` — budget window and limit math (currency-agnostic).
- `api/_lib/fx-rates.test.ts` — FX rate lookup and caching.
- `api/_lib/fx-provider.test.ts` — the FX provider contract.
- `src/lib/multi-currency-migration.test.ts` — backfill behaviour of migrations 0069 and later.
- `e2e/multi-currency.spec.ts` — covers these cases:
  - an account keeps its own currency
  - consolidated wealth converts without touching native balances
  - cross-currency transfer with rate and fee, and its reversal
  - scheduled transfer
  - /wealth tiles show ₹/€ natively with ≈ and the currency split (L375-387)


### 3.13 AI assistant, quick add, imports/exports

**Readiness:** partial. The server-side writes are currency-safe. AI quick add and the voice assistant never insert rows themselves. They post to `/api/transactions/group`, which snapshots the account's `currency_code` (`api/_routes/transactions/group.ts:164`), and to `/api/wealth/transfer`, which refuses a cross-currency transfer that has no destination amount (`src/lib/money.ts:135`). The AI layer above those routes knows nothing about currency. The parse schema has no currency field. The model is told only "the workspace currency is X" (from `organizations.currency`) and never sees each account's currency. No stated-vs-account currency check exists. In a live Gemini run against the dev EUR workspace, "spent 20 dollars on lunch" came back as amount 20 with confidence 1.0 and was prefilled or one-tap saved as €20. The voice review card and the FAB success toast show every amount in the workspace symbol, and an AI cross-currency card payment always fails with a generic toast. There is no financial CSV import or export (phase 6, deferred). The only export is the quotation PDF, which labels a quotation with the organisation's *current* currency. No corrupt ledger rows can come from this area, but a wrong-currency amount can be saved after a review screen that shows a misleading symbol.

#### What changes / what is affected

**Schema**
- No schema touchpoints are listed for this area. The missing `quotations.currency` column is recorded under Displays (`buildQuotationSnapshot`) and in the Issues table.

**Writes**
- `api/_lib/ai.ts` — fillStatementAmount (390-409) — ⚠️ partial — Fills the amount from the card's statement remaining, which is in the card's currency. The client sends it as the transfer's SOURCE `amount`. That works for a same-currency source and returns a 400 for a cross-currency one.
- `api/_lib/ai.ts` — parseAssistant quotation branch (570-580) — ⚠️ partial — Only `validAmount` is checked, so "quote for 500 dollars" is saved as 500 in the implicit workspace currency.
- `src/components/AiAssistantConfirm.tsx` — save() transfer branch (133-143) — ❌ missing — Posts `{from_account_id, to_account_id, amount}` with no `destination_amount` and has no UI to collect one. A cross-currency pair always gets a 400, and the user sees the generic `aiVoice.failed` toast (:179).
- `src/components/AiAssistantConfirm.tsx` — save() standard branch (144-155) — ⚠️ partial — The server correctly takes the currency from the account. The account comes from a name match or `defaultAccountId` and is never chosen by the stated currency. The card has no account picker.
- `src/components/transactions/AddTransactionDialog.tsx` — applyAiResult (255-339) — ⚠️ partial — Prefills the matched or default account, and the dialog shows that account's own symbol. A stated foreign currency is lost. Confidence ≥0.85 is highlighted as "high" with no warning, and transfers are dropped with a toast (:283-287).
- `api/_routes/transactions/group.ts` — POST insert (160-165) — ⚠️ partial — Correctly snapshots `currencyCode` from the account. The server does not refuse a split across currencies or an account with a null currency; the client is the only guard.
- `src/components/QuickAddModal.tsx` — quotation submit (155-166) — ⚠️ partial — The quotation amount is in the implicit workspace currency and no currency is stored.
- `api/_routes/organizations/[id].ts` — PATCH currency (72-78) — ✅ correct — Writes `currency` and `reporting_currency` together.
- `api/_routes/onboarding.ts` — POST (53-54, 70-71) — ⚠️ partial — Updates only `organizations.currency`. On a legacy org with a backfilled `reporting_currency` (0069:12), the UI and the AI prompt/PDF end up disagreeing.

**Aggregates**
- No touchpoints. No balances or sums are sent to the model, so this area has no cross-currency aggregate.

**Displays**
- `src/components/AiAssistantConfirm.tsx` — headline (106-125) — ❌ missing — `formatMoney(amount, currency)` with the workspace currency (passed from `AiVoiceAssistant` :109, :519). The symbol is wrong whenever the account, transfer source or card is in another currency.
- `src/components/AiAssistantConfirm.tsx` — amount row / quotation row / success toasts (143, 155, 271-279, 338) — ❌ missing — Every amount on the card and in its toasts uses the workspace currency. That includes the "from statement" amount, which is in the card's currency.
- `src/components/AiAssistantConfirm.tsx` — From/To pickers (208-239) — ❌ missing — Shows only `accountDisplayName`, with no currency code and no filtering of pairs the card cannot complete.
- `src/components/AppLayout.tsx` — onTxCreated (212-219) — ❌ missing — The FAB success toast uses the workspace currency: "Expense of €500.00 added" for an INR entry.
- `src/components/MobileAppLayout.tsx` — onTxCreated (230-237) — ❌ missing — Same wrong-symbol toast on mobile.
- `src/components/transactions/AiQuickFill.tsx` — AiCaptureView placeholder (216) — ✅ correct — The example amount in the workspace currency is only an illustration.
- `src/components/AccountSelector.tsx` — optionCurrency / entryCurrency (64-72, 137-143) — ✅ correct — The AI-filled allocation shows the account's own symbol, and the client does not allow a split across currencies.
- `api/_lib/quotation-pdf.ts` — buildQuotationSnapshot (80-94) — ⚠️ partial — Labels the amount with `org.currency` at render time. Quotations have no currency column (`schema.ts:661`), so a workspace currency change relabels regenerated PDFs.
- `api/_routes/quotations/[id]/pdf.ts` — POST generate (48-49) — ⚠️ partial — Passes the whole org row, so the PDF reads `currency` instead of `coalesce(reporting_currency, currency)`.
- `api/_routes/billing/invoice-pdf.ts` — invoice PDF proxy — — not needed — A Dodo-generated invoice in the billed currency, not ledger money.

**FX**
- No touchpoints.

**Validation**
- `api/_lib/ai.ts` — promptRules / accountPromptLabel (307-322) — ⚠️ partial — The only currency guard is a prompt rule ("lower the amount confidence if a different currency is stated"), and the live run ignored it (confidence 1.0). Account labels show no currency, and loan accounts are labelled "(bank)".
- `api/_lib/ai.ts` — resolveTransactionRaw (325-380) — ❌ missing — Accounts are matched by name only, with no stated-vs-account currency check. Two same-name accounts in different currencies tie, so the match abstains and falls back to the default account.
- `src/components/AiAssistantConfirm.tsx` — canSave (101-104) — ❌ missing — Ignores `response.transaction.confidence`, so a low-confidence amount can still be saved with one tap.
- `api/_lib/wealth-accounts.ts` — createTransfer (303-347) — ✅ correct — Refuses a missing currency, a source/destination currency mismatch, and a cross-currency transfer with no `destination_amount`.
- `src/lib/money.ts` — transferAmounts (110-146) — ✅ correct — Throws "Destination amount is required for a cross-currency transfer" (:135). Same-currency amounts must match.

**API contracts**
- `api/_lib/ai.ts` — TX_PROPERTIES / OUTPUT_SCHEMA / ASSISTANT_SCHEMA (269-303, 464-522) — ❌ missing — No `currency` property anywhere, so "20 euros", "$20" or "¥1,500" becomes a bare number. The quotation payload (:497-508) has no currency either.
- `api/_routes/ai/parse-transaction.ts` — POST handler (33-97) — ❌ missing — The response `{fields, confidence, …}` has no currency, so the client cannot tell a stated currency from an assumed one.
- `api/_routes/ai/assistant.ts` — POST handler (30-95) — ❌ missing — Same payload with no currency. `ai_asks` stores only the transcript and the `say` text, never money.
- `src/lib/ai-parse.ts` — AiParsedFields / AiAssistantResponse (20-59) — ❌ missing — The client type needs `currency: string | null` once the server returns it.
- `src/components/transactions/AddTransactionDialog.tsx` — CreatedTxInfo (35) / onCreated (383) — ❌ missing — `{id, type, amount}` carries no currency. `total` sums allocations that the client keeps in one currency, so the sum itself is safe.

**Other**
- `api/_lib/ai.ts` — loadOrgAiContext (165-201) — ⚠️ partial — Reads `organizations.currency` instead of `coalesce(reporting_currency, currency)`. `accountList` carries id/name/type only, with no `currency_code`. Loan and receivable accounts are included; only spaces are filtered out (:192).
- `src/components/AppLayout.tsx` — handleAssistantEdit (183-194) — ⚠️ partial — Hands the assistant's transaction to AddTransactionDialog, which discards transfers. A cross-currency card payment therefore has no working AI path.
- `src/components/transactions/tx-form-utils.ts` — defaultAccountId (34-35) — ⚠️ partial — Picks the first cash account whatever its currency. If a foreign cash wallet is ordered first, AI entries with no named account land in that currency.
- `worker/app/internal/jobs/jobs.go` — csv.export (commented placeholder, :63) — ❌ missing — No transaction or report CSV export exists. A future export must carry native amount, `currency_code`, reporting amount and an excluded flag.
- `src/pages/TransactionsPage.tsx` — handleDownload (760-776) and other attachment downloads — — not needed — File downloads only, with no money columns.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | AI parse drops a stated foreign currency and saves the number in the account's currency | `api/_lib/ai.ts:276` | no |
| medium | Voice review card labels native amounts with the workspace currency | `src/components/AiAssistantConfirm.tsx:108` | no |
| medium | AI cross-currency transfer or card payment can never be saved (generic error) | `src/components/AiAssistantConfirm.tsx:136` | no |
| medium | Voice review card ignores the amount confidence, so a currency doubt is still one tap | `src/components/AiAssistantConfirm.tsx:102` | no |
| medium | FAB quick-add success toast uses the workspace currency for a foreign-account entry (also `src/components/MobileAppLayout.tsx:233`) | `src/components/AppLayout.tsx:215` | no |
| medium | Quotations have no currency; PDF labels them with the org's current currency | `api/_lib/quotation-pdf.ts:81` | no |

**Unverified lows:**
- "Model is not told account currencies: correct foreign-account entries get flagged and same-name accounts can't be told apart" (`api/_lib/ai.ts:308`)
- "Onboarding writes organizations.currency without reporting_currency, so the AI prompt and PDF disagree with the UI" (`api/_routes/onboarding.ts:54`)
- "AI context offers debt accounts (labelled 'bank') that every AI write path silently drops" (`api/_lib/ai.ts:192`)
- "No currency-aware CSV/financial export or import exists" (`worker/app/internal/jobs/jobs.go:63`, known-deferred to phase 6)

**Refuted claims:** none in this area.

#### Decisions

- **Stated currency matches no account** ("spent $20" with no USD account). Should AI quick add:
  - (a) refuse one-tap save and ask for the charged amount in the account's currency;
  - (b) convert at today's rate and mark it estimated; or
  - (c) only flag it?

  Recommendation: (a). A card or bank charges in its own currency, and a guessed rate is never the ledger fact.
- **AI-proposed cross-currency transfers and card payments:** collect the received amount inline on the voice review card, or always hand off to the existing transfer wizard (which already supports sent/received/fee)?
- **Which amount does the user state for an AI transfer:** the SOURCE amount (what left the bank) or the DESTINATION amount (what reached the card)? This matters for "paid my Visa statement", where the looked-up figure is in the card's currency.
- **Quotations:** add a per-quotation currency snapshot (an additive column defaulting to the reporting currency)? Or keep "quotations follow the workspace currency" and block or warn on a workspace currency change while quotations exist?
- **Balances in the AI context:** should it ever include balances or spending totals (a future "how much did I spend" intent)? If so, it must use `reporting_amount()` plus `excluded_count`, never raw sums.
- **Export/import contract (none exists yet):** which columns are mandatory (native amount, `currency_code`, reporting amount, rate date, excluded flag)? Is a "native totals per currency" footer required?
- **Default account:** should AI and quick-add prefer an account in the reporting currency over the "first cash account" rule (`defaultAccountId`), now that a workspace can hold cash wallets in several currencies?

#### Existing tests

- `src/lib/ai-match.test.ts` — Client and category name resolution (`normalizeName`, `jaroWinkler`, `resolveClientName`, `resolveCategory`). The same resolver matches accounts. No test covers breaking a tie by currency.
- `src/lib/ai-schema.test.ts` — Converts the JSON schema for Gemini and OpenAI. Needs a new case once a nullable `currency` string is added.
- `src/lib/ai-credits.test.ts` — AI credit base cost and token surcharge math (credits, not money).
- `api/_lib/quotation-pdf.test.ts` — `buildQuotationSnapshot` labels amounts with the org's currency code and falls back to USD, and the hash changes when the org currency changes. This locks in today's behaviour of relabelling a quotation when the workspace currency changes.
- `src/lib/quotation-pdf-history.test.ts` — Quotation PDF generation history (no currency semantics).
- `src/lib/money.test.ts` — `transferAmounts`: a cross-currency transfer without a destination amount throws (:69). This is the server guard the AI transfer path hits. Same-currency amounts must match.
- `e2e/multi-currency.spec.ts` — Native account currency, consolidated wealth, cross-currency transfer with fee, reversal, scheduled transfer, native wealth balances. No coverage of the AI flows, the voice assistant, the quick-add toast or quotations.

### 3.14 Platform: API contracts, cache, i18n, native, mobile

**Readiness:** partial. Most of the transport layer is sound. Every new money write path (transfer create, transition, reverse and trash, account currency edits, debts, Space transfers) invalidates the full money set, including `/api/wealth/summary` and `/api/wealth/transfers`. `/api/fx/rate` is a short-lived config read that is never persisted, and `cache:check`, `i18n:check`, `i18n:hardcoded` and 94 related unit tests all pass. Response shapes only gained fields (`currency`, `excluded_count`, `reporting_currency`), so store-pinned native bundles can still parse every route.

The weak spot is the org-currency contract. Onboarding and the admin PATCH write only `organizations.currency`, but reads use `coalesce(reporting_currency, currency)`. As a result, every new personal user who picks a non-USD currency gets a USD workspace with USD-tagged accounts. A reporting-currency change also invalidates no money reads, and it silently turns a single-currency workspace into a mixed one.

The only place excluded rows are disclosed (`FxExcludedNotice`) shows the raw key `fx.excludedNotice`. The key is in no locale, and the i18n gates can't catch it because `en.json` is missing it too. Dashboard and Wealth briefly paint a raw cross-currency sum before the summary arrives. Pre-multi-currency store bundles call the production API, so they show raw sums and accept amounts typed behind the wrong currency symbol. The local android/ios bundles have not been re-synced. On mobile, the actions in a `ScheduledTransfersPanel` row get clipped at 375 px in long locales (ml/de).

#### What changes / what is affected

**Schema**
- None in this area. The column contract is covered in the org-currency rows under Writes and API contracts.

**Writes**
- `api/_routes/organizations/[id].ts` — PATCH currency (lines 72-78) — ✅ correct — writes both `currency` and `reportingCurrency`. GET returns the raw columns, not the coalesced value.
- `api/_routes/onboarding.ts` — personal/business currency update (lines 54, 71) — ❌ missing — sets `organizations.currency` only, so `reporting_currency` keeps the USD it got when the profile was created.
- `api/_routes/admin/organizations.ts` — PATCH `patch.currency` (line 145) — ❌ missing — an admin currency change updates only the legacy column, so the app keeps reporting in the old currency.
- `scripts/migrate-org-currency.ts` — `set({ currency })` (line 25) — ❌ missing — a legacy maintenance script with the same drift.
- `api/_lib/auth.ts` — `createOrgForUser` (line 109) — ✅ correct — seeds `reportingCurrency = currency`. `ensurePersonalOrg` passes `profile.currency`, whose schema default is `'USD'` (schema.ts:811).
- `api/_routes/wealth/accounts.ts` — `ensureCashAccount` (line 32) — ✅ correct — Cash in Hand takes `reportingCurrency ?? currency`, so it inherits the onboarding drift.
- `api/_lib/wealth-accounts.ts` — `transitionTransfer` catch (line 571) — ⚠️ partial — a DB raise such as `transfer_account_currency_changed` collapses into a generic 409 "could not be completed atomically".
- `api/_routes/spending-budgets.ts` — POST insert (lines 89-104) — ❌ missing — no `currency_code` snapshot. `budgetCurrency()` falls back to the current reporting currency, so a later reporting change re-denominates the limit.
- `src/components/wealth/TransferWizard.tsx` — received/fee fields, rate suggestion, `overBalance` (lines 157-205, 303-320) — ⚠️ partial — sends source/destination/fee amounts and currencies. An edited received amount goes stale but stays when the destination changes, and the insufficient-funds check ignores the fee.

**Aggregates**
- `src/lib/api-cache.ts` — `policyFor('/api/wealth/summary')`, money class — ✅ correct — not `alwaysFetch`, which is right because the route never materialises money. It can still be computed before a parallel `/api/wealth/accounts` GET finishes posting a due recurring row.
- `api/_lib/wealth-summary.ts` — `buildWealthSummary` — ✅ correct — converts at the latest rate. It returns `card_liabilities`, `debts_owed`, `debts_receivable`, `complete` and `excluded_currencies`, all as additive fields.
- `src/pages/Dashboard.tsx` — Wealth card total fallback (lines 576-582, 652) — ⚠️ partial — the summary is fetched only after the accounts arrive. Until then `total = localLiquid`, a raw cross-currency sum formatted in the reporting currency.
- `src/pages/WealthPage.tsx` — `netWorth`/`available` fallback (lines 304-331, 524) — ⚠️ partial — `local.total` (a raw sum across currencies) shows whenever the summary is missing: on load, and for good if the summary request fails.
- `src/components/wealth/use-consolidated-wealth.ts` — `useConsolidatedWealth` / `availableFromSummary` / `liquidFromSummary` / `savedFromSummary` — ✅ correct — skips null converted balances, and callers show the `complete` flag.
- `src/pages/SpacesPage.tsx` — `totalSaved` (lines 84, 170) — ❌ missing — a raw sum of every Space's `current_balance`, formatted in the org currency. Spaces become mixed-currency as soon as the reporting currency changes.

**Displays**
- `src/lib/currency-context.tsx` — `useCurrency()` — ⚠️ partial — returns the org alias (the reporting currency). Dashboard KPIs and several pages format server-converted amounts with it instead of the payload's own currency.
- `src/components/FxExcludedNotice.tsx` — `t('fx.excludedNotice')` (line 20) — ❌ missing — the key is absent from `en.json` and all 7 other locales, so the literal key renders on Dashboard, Transactions, Clients, ClientDetail, Analytics, Calendar (x2), Budgets and MoneyFlow.
- `src/lib/i18n/locales/*.json` — `wealth.*` multi-currency keys — ⚠️ partial — all ~45 new keys are present and translated in the 8 locales. `accountCountOne/Other` are not i18next plurals (Arabic dual/few/many come out wrong), and `fx.*` is missing.
- `src/lib/wealth.ts` — `moneyLocale` / `formatMoney` / `formatRate` / `formatApprox` (lines 109-172) — ⚠️ partial — ISO minor units are correct. INR lakh grouping applies only under `en` (ml-IN gives ₹1,234,567.50), and many pages hard-code en-US instead.
- `src/pages/Dashboard.tsx` — `formatCurrency` / `formatCompactCurrency` (lines 112-131) — ⚠️ partial — hard-coded en-US with 0 decimals. On iOS 15.0-15.3 WebKit, the compact formatter throws a RangeError for 3-decimal currencies.
- `src/components/wealth/CurrencyBreakdown.tsx` — `CurrencyBreakdown` — ✅ correct — shows native totals, the ≈ value, rate and date, plus a not-included notice, and is RTL-safe. Nits: the share % is not locale-formatted, and share/rate/count stay visible in privacy mode.
- `src/components/wealth/ApproxBalance.tsx` — `ApproxBalance` — ✅ correct — hidden for reporting-currency or rate-less accounts, masked in privacy mode, and wraps safely at ≤400 px.
- `src/components/wealth/ScheduledTransfersPanel.tsx` — row layout (lines 88-137) — ⚠️ partial — the `shrink-0` nowrap amount pair, the Mark done button and the kebab overflow at 375 px, and the touch targets are 36 px (the rule is ≥44 px).
- `src/pages/SpaceDetailPage.tsx` — `formatMoney(balance, currency)` (lines 150-251) — ❌ missing — formats a Space's native values in the org currency.
- `src/pages/TrashPage.tsx` — `fmtAmount` (lines 38, 194) — ❌ missing — trashed foreign-currency rows are shown with the org symbol.
- `src/components/TransactionPeekModal.tsx` — amount (line 46) — ❌ missing — the Dashboard passes the org currency (Dashboard.tsx:1618), so a EUR row peeks as "$500.00".
- `api/_lib/notify-cards.ts` — `money = n.toFixed(2)` (line 17) — ❌ missing — autopay and statement push notifications carry no currency, which is ambiguous for foreign cards.
- `src/lib/api.ts` — `apiErrorMessage` (lines 510-526) — ⚠️ partial — shows the server's `error` text verbatim. No currency error code (`currency_mismatch`, `invalid_transfer_amounts`, `currency_missing`, `account_currency_locked`, `cross_currency_recurring_policy_required`, `source_currency_mismatch`) is mapped to i18n.

**FX**
- `src/lib/api-cache.ts` — `policyFor('/api/fx/rate')` (line 157) — ✅ correct — config class: 5 min fresh, 60 min stale, never persisted, not `alwaysFetch`. The rate is only a suggestion, since the transfer stores the amounts the user actually got.
- `api/_lib/fx-rates.ts` — `reportingCurrencyFor` (line 307) — ✅ correct — reads `reporting_currency` from the DB on every call, so the auth cache can't serve a stale value.
- `api/_routes/fx/rate.ts` — GET `/api/fx/rate` — ✅ correct — auth-guarded. Returns 400 `invalid_currency` and 404 `no_rate`, and TransferWizard surfaces the `stale` flag.
- `api/_lib/fx-rates.ts` — `ensureRatesForOrg` / `ensureHistoricalRates` (lines 231-267) — ⚠️ partial — runs synchronously inside 14 GET handlers. The backfill writes one snapshot per day with sequential single-row INSERTs, up to 2196 days per pair.

**Validation**
- `scripts/check-cache-map.mjs` — write-path and side-effecting-GET audit — ✅ correct — passes (46 write paths). It only checks that a rule exists, not that the rule is complete, so it cannot catch the org-currency gap.
- `api/_routes/spaces/[id]/auto-save.ts` — `cross_currency_recurring_policy_required` (line 84) — ⚠️ partial — the server refuses correctly. The client dialog still offers every account (defaulting to `accounts[0]`) and toasts the English server message.
- `src/components/wealth/WealthAccountDialogs.tsx` — currency lock (lines 144-146) — ⚠️ partial — the client locks only on `transaction_count`, while the server also locks cards, Spaces with a goal and trashed rows. So a selector that looks enabled can still return an English 409.

**API contracts**
- `src/lib/api-cache.ts` — `PERSIST_ALLOWLIST '/api/organizations'` — ⚠️ partial — the org list, including its `currency`, is persisted and reused for 5 min with no request. Fresh server-converted amounts can therefore show the old symbol, for example after a change made on another device.
- `api/_routes/organizations.ts` — GET/POST `currency = coalesce(reporting_currency, currency)` (lines 53-54, 102-103) — ✅ correct — a compatibility alias for old clients that only holds while the two columns agree.
- `api/_routes/debts.ts` — `orgCurrency` from `organizations.currency` (line 44) — ⚠️ partial — reads the legacy column instead of calling `reportingCurrencyFor`, so it disagrees with every other route whenever the columns drift.
- `api/_routes/wealth/transfer.ts` — POST body (`amount` \| `source_amount`/`destination_amount`/`source_fee_amount`, `status`) — ✅ correct — legacy `amount` is still accepted. A cross-currency transfer without `destination_amount` gets a 400 and is never converted 1:1. Planned and completed transfers return different response shapes.
- `api/_routes/wealth/transfers.ts` — GET list (`status`, `limit`, `group_id`) — ✅ correct — read-only, and returns account names plus `reversed_by_transfer_id`.
- `api/_routes/budgets.ts` — v1 projection for personal orgs — ✅ correct — additive only (`currency`, `excluded_count`), so store-pinned bundles are unaffected.
- `api/_routes/flow.ts` / `calendar.ts` / `analytics.ts` / `clients.ts` — response shapes — ✅ correct — `balance` and the summary are kept (now converted), with `currency` and `excluded_count` added.
- `.env.android` / `.env.ios` — `VITE_API_BASE_URL=https://profitsync.net` — ⚠️ partial — the native shells always hit the production API, and nothing in `src/` or `api/` sends a client-version header or enforces a minimum version.

**Other**
- `src/lib/api-cache.ts` — FANOUT `/^\/api\/wealth\b/` (line 248) — ✅ correct — covers transfer create, transition, reverse and trash, plus account edits, and drops all of `MONEY_PREFIXES` (including `/api/wealth`, `/api/debts`, `/api/spending-budgets`, `/api/alerts`).
- `src/lib/api-cache.ts` — FANOUT `/^\/api\/(organizations|invitations|referrals)\b/` (line 291) — ⚠️ partial — an org `{currency}` PATCH drops only identity reads. Money reads stay fresh for 15 s, then are served stale-while-revalidate for 2 min.
- `api/_lib/ai.ts` — `loadOrgAiContext` `organizations.currency` (line 167) — ⚠️ partial — AI quick-add is given the legacy currency, not the selected account's currency or the reporting currency.
- `android/app/src/main/assets/public`, `ios/App/App/public` — native web bundles (built 2026-09-14) — ❌ missing — contain no multi-currency client code. `cap:sync:android` and `cap:sync:ios` are required.
- `src/test-setup.ts` — language pin — ✅ correct — pins en-US detection so formatter assertions are deterministic.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | Onboarding currency is silently ignored: new personal workspaces stay USD and accounts are tagged USD | `api/_routes/onboarding.ts:54` | no |
| high | Store-pinned (pre-multi-currency) native bundles show raw sums and accept amounts behind the wrong symbol for foreign accounts | `.env.android:1` | no |
| high | Changing the reporting currency makes a single-currency workspace mixed: the Spaces total becomes a raw sum and some screens mislabel native values | `src/pages/SpacesPage.tsx:84` | no |
| medium | FxExcludedNotice renders the raw key `fx.excludedNotice` on 9 screens | `src/components/FxExcludedNotice.tsx:20` | no |
| medium | Dashboard and Wealth paint a raw cross-currency sum until `/api/wealth/summary` arrives, and keep it if the summary fails | `src/pages/Dashboard.tsx:582` | no |
| medium | Admin org currency edit and legacy readers diverge from `reporting_currency` | `api/_routes/admin/organizations.ts:145` | no |
| medium | TransferWizard keeps a stale received amount when the destination currency changes | `src/components/wealth/TransferWizard.tsx:175` | no |
| medium | ScheduledTransfersPanel row overflows at ≤400 px in long locales; actions are clipped and smaller than 44 px | `src/components/wealth/ScheduledTransfersPanel.tsx:109` | no |
| medium | Currency refusals are shown as English server text, and Space auto-save offers accounts it will refuse | `src/lib/api.ts:510` | no |
| medium | Limits with no stored currency re-denominate on a reporting-currency change | `api/_routes/spending-budgets.ts:91` | yes |
| medium | FX backfill runs synchronously inside GETs as sequential single-row inserts (up to 6 years) | `api/_lib/fx-rates.ts:267` | no |
| medium | Native bundles are pre-multi-currency; `cap:sync` needed before release (votes 1/2) | `android/app/src/main/assets/public/index.html:1` | yes |
| medium | Foreign-currency rows are formatted with the org currency in Trash and the Dashboard peek modal | `src/components/TransactionPeekModal.tsx:46` | no |
| low | A reporting-currency change does not invalidate any money read, so old-currency figures show under the new symbol | `src/lib/api-cache.ts:291` | no |

Unverified low-severity issues: Wealth summary can race the materializing accounts GET on /wealth; Insufficient-funds warning ignores the transfer fee; Inconsistent money-formatting locale across screens (INR grouping, Arabic, hard-coded en-US); Intl RangeError on iOS 15.0-15.3 WebViews for 3-decimal reporting currencies; Card notifications carry amounts without a currency; Multi-currency i18n nits (non-plural account count, share % not localised, title tooltip not reachable by touch). No claims in this area were refuted.

#### Decisions
- **Reporting-currency change on a single-currency workspace:** relabel all accounts with no conversion (the behaviour before this branch, which users rely on to fix a wrong pick), or keep them native and convert (current behaviour)? Or offer both explicitly?
- **Old native store builds (e.g. 1.4.0) on the production API:** keep account creation limited to the reporting currency until the multi-currency native release is widely installed? Or add a client-capability or version header, and refuse or warn on writes to foreign-currency accounts from clients that don't send it?
- **Single source of truth for the org currency:** a DB trigger syncing `organizations.currency` ⇄ `reporting_currency`, a generated alias column, or one server helper with a static guard? And which column wins when repairing drifted rows?
- **Budget and per-client cap currency:** snapshot the reporting currency at creation (and convert or refuse on a later reporting change), or let limits follow the reporting currency by design?
- **FX history backfill:** keep it synchronous inside GET handlers, or move it to the worker and have GETs count excluded rows until the backfill lands?
- **Money-formatting policy:** always go through `formatMoney`/`moneyLocale`? And should INR use Indian grouping in every Indian-language UI (not just `en`)?
- **Error UX:** localize server refusals on the client by `code` (one mapping table) instead of showing the server's English `error` string?
- **Deploy order and release gate:** ship the server first, then run `cap:sync` and do a store release. Should the release gate require a mobile (≤400 px) multi-currency e2e pass?

#### Existing tests
- `src/lib/api-cache.test.ts` — freshness classes, the persistence allowlist, fanout for `/api/transactions`, `/api/wealth/transfer`, `/api/cards` and `/api/spaces/1/auto-save`, full-purge paths, and that known write paths have a rule. Nothing covers `/api/wealth/summary`, `/api/fx/rate`, `/api/wealth/transfers/*` or what an org-currency PATCH should invalidate.
- `src/lib/api-store.test.ts` — how the two-tier cache store behaves (L1/L2, stale-while-revalidate, invalidation mechanics).
- `scripts/check-cache-map.mjs` — every side-effecting GET is `alwaysFetch`, and every client write path has a fanout rule (46 mapped, green).
- `src/lib/money.test.ts` — decimal Money/FX primitives, `transferAmounts` (same- and cross-currency, fee, effective rate) and mixed-currency invariants.
- `api/_lib/tx-sql.test.ts` — reporting aggregates must go through the tx-sql helpers (`reporting_amount` and the missing-rate count).
- `api/_lib/fx-rates.test.ts` — the FX rate service: current and historical lookups, caching, and fallback provenance.
- `api/_lib/fx-provider.test.ts` — the provider-neutral contract, TTL cache and request coalescing.
- `src/lib/multi-currency-migration.test.ts` — static assertions on migrations 0069-0073: columns declared, backfills never rewrite amounts, ordering.
- `e2e/multi-currency.spec.ts` — API-level EUR/INR wallets, `/api/wealth/summary` conversion (net worth ≠ raw sum), a cross-currency transfer with fee (€500→₹51,350, fee €5, rate 102.70), reversal, and planned→completed/cancelled. Also one desktop `/wealth` screen check (₹/€ tiles, ≈ line, 'By currency'). Desktop Chromium only.
- `e2e/mobile.spec.ts` — Pixel 7 mobile shell tabs and the card fan only. No multi-currency screens.
- `e2e/prod-build.spec.ts` — the production bundle boots (chunk graph). No multi-currency behaviour.
- `scripts/check-i18n*.mjs` (`npm run i18n:check` / `i18n:hardcoded`) — locale parity with `en.json`, and no new English typed into JSX. It does **not** check that keys used in code exist in `en.json`.


### 3.15 Cascade soft-delete writers (tags, clients) and Trash

**Readiness:** partial. The balance math every cascade writer uses is multi-currency-safe: `reversalsByAccount`/`applicationsByAccount` (`src/lib/wealth-ledger.ts:58-80`) add each row's native amount per account with no FX, and the dev DB has 0 rows whose `currency_code` differs from their account's. Client DELETE, client bulk-delete and the tagged-client cascade all skip the `is_own` client. Every transfer, fee, fee-refund, debt and autopay row is anchored to that client through `ensureDefaultClient` (true for transfers since their first commit, 774c2cf), so those paths can't reach transfer rows (dev DB: 0 such rows on non-own clients). The gap is the tagged-transaction branch of `softDeleteByTag` (`api/_lib/tag-ops.ts:105-136`). It trashes own-client rows directly, never checks `transfer_id` and never calls `set_transfer_trashed`, so it can trash one leg or a lone fee row of a logical transfer. That is reachable because legs and fee rows can be tagged (`api/_routes/transactions/[id].ts:106-120`). Three things follow: balances become one-sided (net worth drops by the whole transfer), Trash restore fails with 409 `invalid_transfer_trash_state` (permanently when the transfer is reversal-linked), and a later Reverse refunds amounts that were already reversed, because `reverseTransfer` (`api/_lib/wealth-accounts.ts:577-606`) ignores trashed rows. This contradicts `docs/multi-currency/STATUS.md:24/34/51`. Separately, all three writers reverse balances before they claim the rows, in sequential statements with no batch, so a retry or a double submit reverses twice. The Trash page and the tag drilldown also format foreign rows in the workspace currency.

#### What changes / what is affected

**Schema**
- `drizzle/0071_logical_transfers.sql` — legacy header backfill (49-80) — ⚠️ partial — builds headers from legacy groups without looking at `deleted_at`, and 0073 adds `transfers.deleted_at` with no backfill. A legacy transfer trashed before deploy ends up with a live header over trashed legs, and its restore returns 409.

**Writes**
- `api/_lib/tag-ops.ts` — `softDeleteByTag` (88-147), tagged-transaction branch — ❌ missing — `taggedTx` (105-109) selects every live tagged row, including own-client transfer legs, fee and fee-refund rows, and legacy headerless legs. It reverses them through `reversalsByAccount` (125-130) and sets `deleted_at` directly (131-136). There is no `transfer_id`, reversal-chain or debt-group check and no `setTransferTrashed` delegation. Balances move before the rows are claimed, with no `dbBatch` and no audit rows.
- `api/_lib/tag-ops.ts` — `softDeleteByTag` tagged-client cascade (95-115, 137-139) — ⚠️ partial — excludes `is_own` (99), so it can't reach transfer, fee or debt rows. The native per-account reversal is correct, but it has the same non-atomic reverse-then-claim order.
- `api/_routes/clients/[id].ts` — DELETE (107-152) — ⚠️ partial — refuses the own client (115-117) and reverses per account in native amounts (correct). Balances are updated (132-137) before the rows are trashed (138-143), all in separate statements, so a race or a partial failure gives a double or partial reversal.
- `api/_routes/clients/bulk-delete.ts` — POST handler (30-79) — ⚠️ partial — excludes `is_own` (38) and reverses natively per account (correct). Same non-atomic sequence (59-70), and the clients update (72-76) does not set `updatedBy`.
- `api/_routes/trash/restore.ts` — transaction branch (23-80) — ⚠️ partial — a `kind=transfer` leg with a `transfer_id` goes to `setTransferTrashed(restore)` (31-36), which returns 409 when the header is still live over a tag-trashed leg. A fee or fee-refund row takes the group path and restores alone (46-79).
- `api/_routes/trash/restore.ts` — client branch (82-116) — ⚠️ partial — re-applies exactly the rows that share the client's `deletedAt`, natively per account (correct; no transfer legs can be here). Sequential and non-atomic (known, STATUS.md:57).
- `api/_routes/trash/purge.ts` — transaction branch (22-44) — ⚠️ partial — for a tag-trashed leg, `groupId` expands only to the trashed legs of the group (34-39). The purge hard-deletes one leg and leaves a live, completed header with a single live leg.
- `api/_routes/trash/clear.ts` — step 2 (44-51) — ⚠️ partial — same as purge: removes only the trashed leg; the header and the other leg stay live.
- `drizzle/0073_transfer_lifecycle.sql` — `set_transfer_trashed` (104-155) — ⚠️ partial — a strict state machine: restore needs header `deleted_at IS NOT NULL` (123-124) and refuses reversal-linked transfers (120-121). That is correct for its own callers, but it can't heal a live header over a trashed leg, which both the tag path and the 0071 backfill produce.
- `api/_lib/wealth-accounts.ts` — `reverseTransfer` (577-606) — ❌ missing — checks only `status=completed` and not-already-reversed. It doesn't check `transfers.deleted_at`, trashed legs or a trashed fee, so it refunds both native principals and the full fee even when a trash already reversed part of them.
- `api/_lib/wealth-accounts.ts` — `setTransferTrashed` (609-623) — ⚠️ partial — maps every DB exception to 409 `invalid_transfer_trash_state`, so the UI can't tell "reversal chain immutable" apart from "header state mismatch".
- `api/_routes/transactions/bulk-delete.ts` — transfer delegation (33-46) — ✅ correct — the reference pattern: it collects `transfer_id`s from `kind=transfer` legs, trashes each through `setTransferTrashed` and keeps their linked rows out of the standard path. `softDeleteByTag` should reuse it (via `resolveTxLegs`, `api/_lib/tx-legs.ts:40`).

**Aggregates**
- `src/lib/wealth-ledger.ts` — `reversalsByAccount` / `applicationsByAccount` (58-80) — ✅ correct — per-account native sums with system rows skipped. Nothing mixes currencies, because the key is the account and each row is in its account's currency (dev DB: 0 mismatches).
- `api/_routes/tags.ts` — `usageCounts` (19-49) — — not needed — counts only, no money.
- `api/_routes/clients/[id].ts` — GET totals (31-49) — ✅ correct — restored rows are re-read with `incomeSumSqlIn`/`expenseSumSqlIn` in the reporting currency, plus `excluded_count`.

**Displays**
- `src/pages/TrashPage.tsx` — `fmtAmount` (38-39), TxRow amount (194) — ❌ missing — every trashed row is formatted in the workspace currency with 0 decimals. `restoreFailed` is a generic toast (77) that gives no reason for the 409.
- `src/components/entity-drilldown/EntityDrilldown.tsx` — row amount (62, 197-199) — ❌ missing — `formatMoney(amount, org currency)` for every row, so foreign rows show the wrong symbol.
- `src/components/categories/TagsPanel.tsx` — `handleDelete` (126-156), `DeleteTagDialog` hint (392-398) — ⚠️ partial — N in the hint is the tag usage count only. It leaves out the untagged rows of tagged clients, which are also trashed and move balances, and "reversible" is false for transfer legs. The success toast's count does include those rows.

**FX**
- No FX touchpoints. Every writer moves native amounts per account and converts nothing.

**Validation**
- `api/_routes/transactions/[id].ts` — PATCH transfer-leg relabel (106-120, 147-155) — ⚠️ partial — explicitly allows tags on a transfer leg, including a reversal leg, and a leg-level tag is what feeds the tag cascade. Debt groups are refused (127-129), so debt rows can't be tagged.

**API contracts**
- `api/_routes/tags/[id].ts` — DELETE `?mode=with_records` (51-68) — ⚠️ partial — calls `softDeleteByTag` and then `removeTagEverywhere` (63). That also strips the tag from the rows it just trashed (no `deleted_at` filter in `tag-ops.ts:52-62`), so a restore brings them back untagged. Returns counts only.
- `api/_routes/trash.ts` — `txFields` (7-19) — ❌ missing — trashed rows come back without `currency_code`, `wealth_account_id`, `kind` or `transfer_id`, so the page can't format natively or explain a transfer leg.
- `api/_lib/entity-drilldown.ts` — `fetchTransactionItems` (39-70), `sortDrilldown` (145-154) — ❌ missing — the tag and category drilldown (the preview of what "delete with records" will trash) has no `currency_code`, and amount sort compares raw native numbers across currencies.

**Other**
- `api/_lib/auth.ts` — `ensureDefaultClient` (131-161) — ✅ correct — every transfer, fee, fee-refund, debt and autopay row is anchored to the `is_own` client, which client DELETE, bulk-delete and the tagged-client cascade exclude. Dev DB: 0 such rows on non-own clients, and nothing sets `is_own=false`.
- `src/lib/api-cache.ts` — FANOUT rules for `/api/tags`, `/api/clients`, `/api/trash` (254-271) — ✅ correct — all three drop `MONEY_PREFIXES` (including `/api/wealth` → summary, `/api/debts`, `/api/trash`), so balances repaint after a cascade.
- `api/_lib/debts.ts` — `loadPayments` liveness (168-182) — — not needed — an allocation is live while its anchor leg isn't trashed. The tag path can't reach debt rows today: PATCH refuses `debt_group` and no debt writer sets tags.
- `docs/multi-currency/STATUS.md` — lines 24, 34, 51, 114 — ⚠️ partial — claims transfer legs can't be trashed or restored independently and that transfer-linked rows are blocked. That is false for `DELETE /api/tags/:id?mode=with_records`, and fee rows can be trashed alone by design (`bulk-delete.ts:36-38`).

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | `reverseTransfer` refunds amounts a trash already reversed (checks no trashed legs, fee or header) | `api/_lib/wealth-accounts.ts:584` | no |
| high | Tag "delete with records" trashes a single transfer leg, leaving the transfer one-sided (bypasses the transfer service) | `api/_lib/tag-ops.ts:105` | no |
| high | A tag-trashed leg of a reversed transfer or of a reversal can never be restored | `drizzle/0073_transfer_lifecycle.sql:121` | no |
| high | A fee row tagged from /transactions is trashed alone by tag delete, and Reverse then refunds the fee twice | `api/_lib/tag-ops.ts:109` | no |
| medium | Trash restore of a tag-trashed transfer leg returns 409 (stuck until the user trashes the other leg) | `api/_routes/trash/restore.ts:35` | no |
| medium | Cascade writers reverse balances before claiming rows, with no batch or lock (double reversal on retry or double submit) | `api/_routes/clients/[id].ts:132` | no |
| medium | Purging or clearing a tag-trashed transfer leg leaves a live, completed header with one leg | `api/_routes/trash/purge.ts:34` | no |
| medium | Trash page shows foreign rows with the workspace currency symbol and no decimals | `src/pages/TrashPage.tsx:39` | no |
| medium | Tag drilldown (the pre-delete preview) formats every row in the workspace currency and sorts amounts across currencies | `src/components/entity-drilldown/EntityDrilldown.tsx:199` | no |
| medium | The "Delete tag & records" dialog understates what will be trashed and promises reversibility it can't deliver | `src/components/categories/TagsPanel.tsx:398` | no |
| medium | Legacy transfers trashed before 0071 get a live header over trashed legs, so their restore is stuck | `drizzle/0071_logical_transfers.sql:57` | no |

**Unverified lows:** "Tag delete-with-records strips the tag from the trashed rows and writes no audit trail" (`api/_routes/tags/[id].ts:63`); "`softDeleteByTag` doesn't exclude debt-repayment groups (currently unreachable)" (`api/_lib/tag-ops.ts:109`); "STATUS.md claims transfer legs can't be trashed outside the transfer service" (`docs/multi-currency/STATUS.md:24`); "Client-restore branch re-applies cascade rows in sequential, non-atomic statements" (`api/_routes/trash/restore.ts:90`, known-deferred). **Refuted:** none.

#### Decisions

- When a tagged row belongs to a logical transfer, should "Delete tag & records" trash the whole transfer (as DELETE on a leg does), skip the row and only strip the tag, or refuse the whole tag delete?
- Is a transfer's fee row an independent ordinary expense (the current bulk-delete policy, `transactions/bulk-delete.ts:36-38`) or part of its transfer? The answer decides whether a lone tagged or deleted fee is trashed alone or takes the transfer with it.
- What should Reverse do when the transfer, one of its legs or its fee is in Trash: refuse with 409 (recommended), or reverse only the live parts?
- Should `set_transfer_trashed(restore)` be relaxed to heal "live header, trashed leg" states (legacy 0071 data and anything the tag path has already produced), or should a one-off repair migration mark those headers trashed?
- Should transfer legs stay taggable through PATCH at all? It is harmless once the cascades delegate, but it is currently the only way into the one-sided state.
- Should "Delete tag & records" keep the tag on the trashed records so a restore brings it back, and should the dialog show the cascade count (the untagged rows of tagged clients)?

#### Existing tests

- `src/lib/wealth-ledger.test.ts` — `reversalsByAccount`/`applicationsByAccount` per-account collapse; system rows skipped on trash and restore (the pure math every cascade writer uses).
- `api/_lib/budget-spend.test.ts` — static source guard that `tag-ops.ts` selects `isSystem` (lines 121-131); a transfer-delegation guard should copy this pattern.
- `src/lib/money.test.ts` — `reversalTransferAmounts` swaps the native principals and refunds the original fee (line 78). No test for trashed-leg or trashed-fee guards.
- `src/lib/credit-card-ledger.test.ts` — model scenarios: delete and restore of a card purchase and of a card payment (both legs) re-apply exactly once.
- `src/lib/tags.test.ts` — tag name normalisation only; nothing on cascade deletes.
- `src/lib/transaction-tags.test.ts` — transaction tag cleaning and limits only.
- `src/lib/api-cache.test.ts` — FANOUT for `/api/clients`, `/api/clients/bulk-delete`, `/api/tags` and `/api/trash` writes drops the money reads.
- `e2e/multi-currency.spec.ts` — cross-currency transfer with a fee (lines 249-299); a reversal puts both native amounts back, exactly once (301-333). Cleanup relies on DELETE of a leg trashing the whole transfer. Nothing on tags, client delete or trash restore.
- `e2e/credit-card.spec.ts` — trash, restore and edit of a card purchase and a card payment through the transaction endpoints (line 441).


### 3.16 Concurrency, atomicity & DB-level currency invariants

**Readiness:** partial. The rule that a row's `currency_code` equals its account's `currency_code` is held only by app code, which reads the account currency and writes the row later. Migration 0069 adds only `^[A-Z]{3}$` format CHECKs (lines 63-77), and no FK, trigger or lock ties transactions, recurring rules or transfers to their account's currency. The account currency lock (`api/_routes/wealth/accounts/[id].ts:83-91`) counts transaction rows and then updates. It ignores recurring rules, transfers, funded cards and a non-zero balance. That leaves two ways a user can save money in the wrong currency through the normal UI, every time: a recurring rule on a relabelled account, and a relabelled account that still holds a balance. It also leaves race windows against every money writer. Completed transfers, debt payments and transfer trash/restore are atomic (`dbBatch` or plpgsql). Most other balance writers run their statements one after another, reverse the balance before claiming the row, and several never check `deleted_at`. The clearest case is `DELETE /api/transactions/:id`, which reverses an already-trashed row a second time: the dev wallet `e2e-ux4-mc-eur` is exactly +20 EUR off, which is 4 × 5 EUR fees reversed twice. The dev DB has 8 drifted accounts. Six are e2e wallets whose trashed Opening Balance rows were purged. One is the half-written legacy 'holiday' Space auto-save. One is 'Intesa sanapolo', which has 0 rows, a balance of 22,337.85 USD, and a currency that can still be changed. The dev DB has 0 currency mismatches today, so the proposed composite-FK migration would validate cleanly. `scripts/` has no reconcile or drift tool.

#### What changes / what is affected

**Schema**
- `drizzle/0069_multi_currency_foundation.sql` — `*_currency_code_check` (lines 63-77) — ⚠️ partial — Format-only CHECKs, and the columns are nullable. Nothing ties the transaction or recurring-rule currency to `wealth_accounts.currency_code`.
- `drizzle/0072_transfer_execution.sql` — same-currency principal CHECK (line 11) — ✅ correct — Checks that the transfer header agrees with itself. It cannot catch a leg whose account was relabelled, because the header still carries the old currency.

**Writes**
- `drizzle/0073_transfer_lifecycle.sql` — `complete_transfer` (lines 10-107) — ⚠️ partial — Locks the transfer row `FOR UPDATE` and re-checks the account currency (44-47). Its account SELECTs (36-39) take no `FOR SHARE`, so a concurrent currency PATCH can still commit in between.
- `drizzle/0073_transfer_lifecycle.sql` — `set_transfer_trashed` — ✅ correct — Runs as one atomic set of statements guarded by `deleted_at` state. A replay by the retrying `db.execute` only gets a harmless 409.
- `api/_routes/wealth/accounts/[id].ts` — PATCH Balance Adjustment (195-243) — ❌ missing — Writes an absolute balance from a value read several round trips earlier, so concurrent writes are lost. When the same request also changes the currency, the adjustment row is stamped with the OLD currency (line 210).
- `api/_lib/wealth-accounts.ts` — `createWealthAccount` (174-215) — ⚠️ partial — The account insert (which sets the balance) and the Opening Balance system row are separate statements. A crash in between leaves a balance with no row, and that account's currency can then be changed.
- `api/_lib/wealth-accounts.ts` — `createTransfer` (303-518) — ⚠️ partial — Writes everything in one atomic `dbBatch` (504). But the currencies are read earlier (308-312), and the balance UPDATEs (494-501) filter only by id, with no currency or `archived_at` check.
- `api/_lib/wealth-accounts.ts` — `transitionTransfer` (520-566) — ⚠️ partial — Delegates to `complete_transfer`, but turns the specific `transfer_account_currency_changed` failure into a generic 409.
- `api/_lib/wealth-accounts.ts` — `reverseTransfer` (577-606) — ❌ missing — Does not refuse a trashed original, so the money moves back twice.
- `api/_lib/wealth-accounts.ts` — `createTransferIntent` (626-671) — ✅ correct — Stores only the intent; completion re-checks the currency.
- `api/_routes/transactions.ts` — POST (412-507) — ⚠️ partial — Reads the currency at 434, stamps it at 480, and updates the balance separately at 494-502. The writes are not batched, which leaves a race window against a relabel.
- `api/_routes/transactions/[id].ts` — PATCH (89-225) — ❌ missing — Has no `deleted_at` guard (line 103) and updates balances in 3 separate statements. It also re-stamps detached rows with the current reporting currency (169-171). Skeptics refuted that re-stamping as a bug, so it is listed only as an open decision.
- `api/_routes/transactions/[id].ts` — DELETE (227-277) — ❌ missing — Has no `deleted_at` guard (229) and reverses balances before claiming the rows, so a repeated or concurrent DELETE reverses twice. Fee rows that carry a `transfer_id` go down the standard path.
- `api/_routes/transactions/group.ts` — POST split (83-187) — ⚠️ partial — Reads the currency at 83, then runs N inserts and M balance updates one after another. Accepts legs in different currencies.
- `api/_routes/transactions/bulk-delete.ts` — POST — ⚠️ partial — Reverses balances (50-59) before trashing (62-65), so concurrent duplicates reverse twice. Transfers go through the transfer service.
- `api/_routes/trash/restore.ts` — POST transaction/client — ⚠️ partial — Applies the balance (63-68) before un-trashing (69-73), so two concurrent restores apply twice.
- `api/_routes/trash/purge.ts` — POST — ⚠️ partial — Hard-deletes trashed system rows whose balance effect was never reversed. Leaves transfer headers and ungrouped fee rows behind.
- `api/_routes/trash/clear.ts` — POST — ⚠️ partial — Orphans system rows the same way (line 50). The client cascade reverses before it deletes.
- `api/_routes/clients/[id].ts` — DELETE cascade (127-148) — ⚠️ partial — Reverses first and trashes second, so concurrent duplicates reverse twice.
- `api/_routes/clients/bulk-delete.ts` — POST (55-76) — ⚠️ partial — Same reverse-then-trash pattern.
- `api/_lib/tag-ops.ts` — trash by tag (105-139) — ⚠️ partial — Same reverse-then-trash pattern.
- `api/_lib/recurring-materialize.ts` — regular occurrence (190-225) — ⚠️ partial — The `ON CONFLICT` insert is idempotent, but the balance update is a separate statement. Stamps `rule.currency_code` (199), which can differ from the account's current currency.
- `api/_lib/recurring-materialize.ts` — transfer branch (162-188) + cursor (294-303) — ❌ missing — When `createTransfer` fails, the loop `continue`s, the cursor advances and `lastError` is reset to `""`, so the occurrence is lost silently.
- `api/_routes/recurring.ts` — POST (61, 122) — ✅ correct — Snapshots the account currency when the rule is created.
- `api/_routes/recurring/[id].ts` — PATCH (187-196) — ✅ correct — Re-snapshots the currency on edit. The amount is not converted, which is expected.
- `api/_lib/debts.ts` — `recordDebtPayment` (404-700) — ✅ correct — One `dbBatch` (644) with a `currency_mismatch` guard (421-426). A counter account with a NULL currency gets past the guard.
- `api/_lib/recurring-debt.ts` — `postDebtOccurrences` — ✅ correct — Claims the anchor leg with `ON CONFLICT`, then runs the batch. The currency check goes through `linkRefusal`.
- `api/_routes/debts/[id].ts` — PATCH currency (122-145, 240-250) — ⚠️ partial — A count, then 3 sequential updates (account, rows, details). A concurrent payment can end up with its legs in different currencies, and a crash can leave the account and `debt_details` currencies different.
- `api/_routes/debts/[id].ts` — PATCH reconcile (207-238) — ✅ correct — Applies a relative delta from a fresh read. This is the pattern the account Adjust path should copy.
- `api/_routes/debts/[id]/payments/[paymentId].ts` — DELETE (31-43) — ⚠️ partial — Reverses before trashing, so concurrent duplicates reverse twice. A repeat after the first delete returns 404, which is correct.
- `api/_lib/card-autopay.ts` — `autopayStatement` — ⚠️ partial — The claim plus an atomic `createTransfer` is correct. But neither `cards.ts` nor `card-autopay.ts` checks that the funding bank and the card share a currency.
- `api/_routes/organizations/[id].ts` — PATCH currency (72-78) — ✅ correct — Changes only `reporting_currency` and its alias; native values are untouched.
- `api/_routes/admin/transactions.ts` — POST (104-114) — ✅ correct — Stamps a detached row with the reporting currency. Later edits re-stamp it (see `transactions/[id].ts` PATCH above).

**Aggregates**
- `api/_routes/transactions/[id].ts` — GET group amount (77-81) — ❌ missing — Adds up `sum(amount)` across legs in different currencies without converting. The list endpoint handles this correctly (`transactions.ts:109`).
- `api/_lib/wealth-summary.ts` — current wealth — — not needed — Only reads here. It trusts the stored `current_balance`, so any drift above goes straight into net worth.

**Displays**
- `src/components/TransactionDetailModal.tsx` — `canReverse` (88) — ⚠️ partial — Still offers Reverse from a stale modal after the transfer was trashed in another tab.

**FX**
- No touchpoints recorded for this area.

**Validation**
- `api/_lib/transaction-currency.ts` — `currencyForFinancialWrite` — ⚠️ partial — A plain read with no lock; the value goes stale if the account is relabelled before the caller writes.
- `api/_routes/wealth/accounts/[id].ts` — PATCH currency lock (76-92) — ⚠️ partial — A count, then an update, with no predicate or lock. Ignores `recurring_rules`, transfers, `cards.funding_account_id` and `current_balance`, which contradicts `ARCHITECTURE.md:117`.
- `api/_routes/spaces/[id]/auto-save.ts` — POST (83-84) — ✅ correct — Refuses a cross-currency auto-save at create time. Nothing stops a later relabel of either side.
- `src/components/wealth/WealthAccountDialogs.tsx` — Edit currency picker (126, 144) — ⚠️ partial — Locked only when `transaction_count > 0`, so it stays enabled for accounts with a balance, recurring rules or only trashed rows.

**API contracts**
- `api/_routes/wealth/accounts.ts` — GET `transactionCount` (91, 109) — ⚠️ partial — Counts live rows only, while the server lock counts all rows, so the UI and the server disagree about whether the currency is locked.

**Other**
- `src/lib/db/index.ts` — `db` (17-20) / `dbBatch` (62-63) — ⚠️ partial — Retries whole statements or batches on ambiguous network errors. A non-idempotent relative UPDATE can be applied twice, and a replayed batch fails with 23505 even though the first attempt committed.
- `src/lib/db/retry.ts` — `RETRYABLE_HINTS` (14) — ⚠️ partial — Includes errors that can occur after the query was sent: `fetch failed`, `socket hang up`, `ECONNRESET`, `connection terminated`.
- `src/lib/wealth-ledger.ts` — `reversesOnTrash` / `reversalsByAccount` / `applicationsByAccount` — ✅ correct — Pure math, tested. Because system rows are not reversed on trash, purging one leaves permanent drift.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | `DELETE /api/transactions/:id` reverses the balance again for an already-trashed row (and PATCH moves the live balance for a trashed row) | `api/_routes/transactions/[id].ts:229` | no |
| high (reported critical) | Account currency can change while a recurring rule targets the account; the materializer then posts the rule's old currency onto the relabelled account | `api/_routes/wealth/accounts/[id].ts:84` | no |
| high | A TRASHED transfer can still be reversed: money moves back twice and the original can never be restored | `api/_lib/wealth-accounts.ts:586` | no |
| high (reported medium) | A transfer fee row can be trashed or purged separately from its transfer | `api/_routes/transactions/[id].ts:232` | no |
| medium (reported high) | Relabelling is allowed on an account that holds a balance but has no rows, so the balance silently changes currency | `api/_routes/wealth/accounts/[id].ts:86` | no |
| medium (reported high) | `PATCH {currency_code, current_balance}` in one request stamps the Balance Adjustment row with the OLD currency | `api/_routes/wealth/accounts/[id].ts:210` | no |
| medium (reported high) | The currency lock checks, then writes, and so races every money writer; no DB invariant backs it (the `createTransfer` batch has no currency predicate) | `api/_lib/wealth-accounts.ts:494` | no |
| medium (reported high) | Account 'Adjust balance' writes an absolute balance from a stale read, losing concurrent money writes | `api/_routes/wealth/accounts/[id].ts:230` | no |
| medium (reported high) | Space auto-save: a failed occurrence is skipped forever and its error erased (triggered by a currency relabel) | `api/_lib/recurring-materialize.ts:182` | no |
| medium | Balance writers outside `dbBatch` leave a row without its balance effect (or the reverse) after a crash or timeout | `api/_lib/recurring-materialize.ts:214` | yes |
| medium | Trash/restore/cascade paths reverse before claiming, so concurrent duplicates apply twice | `api/_routes/trash/restore.ts:63` | yes |
| medium | DB retry replays non-idempotent money statements after ambiguous network errors, and money POSTs have no idempotency keys | `src/lib/db/retry.ts:14` | no |
| medium | Mixed-currency split accepted, and the single-transaction GET adds its legs up without converting | `api/_routes/transactions/[id].ts:80` | no |
| medium | Autopay funding bank may be in a different currency than the card, so autopay defers forever | `api/_lib/card-autopay.ts:136` | no |
| medium | No ledger↔balance reconciliation tooling; 8 drifted accounts on the dev DB | `api/_routes/transactions.ts:490` | yes |
| low (reported medium) | Debt currency change is a count plus 3 sequential updates: it races with payments and can leave the account and debt currencies different | `api/_routes/debts/[id].ts:246` | no |

- **Unverified lows:**
  - Currency picker lock hint counts live rows only, while the server lock counts trashed rows too (`api/_routes/wealth/accounts.ts:109`).
  - Purge orphans transfer headers and ungrouped fee rows (`api/_routes/trash/purge.ts:39`).
  - Concurrent auto-save materializers leave a raw duplicate-key error on the rule (`api/_lib/recurring-materialize.ts:165`).
- **Refuted (not a bug):** "Detached rows are re-denominated on any edit after a reporting-currency change" (`api/_routes/transactions/[id].ts:170`). Skeptics refuted it 1/3; the related policy question is listed under Decisions.

#### Decisions

- **Row currency vs account currency:** enforce it in the DB, or keep the app-level-only stance of `ARCHITECTURE.md:147`? Enforcing means composite FKs on `transactions`, `recurring_rules` and `transfers`, declared `DEFERRABLE INITIALLY DEFERRED` and added `NOT VALID`, then `VALIDATE`.
- **One currency-lock rule for accounts and debts:** today they differ.
  - Accounts lock on ANY row (system rows included) plus a goal or card.
  - Debts lock on non-system rows plus recurring rules.
  - `ARCHITECTURE.md:117` says: zero non-system rows and no statements, cards, transfers or rules.
  - Open questions: should a non-zero balance also lock? Should an account whose only row is its Opening Balance relabel that system row, as debts do?
- **Opening Balance / Balance Adjustment system rows:** may they be trashed or purged at all? Today trash keeps their balance effect and purge leaves that effect with no row. This caused the 6 e2e drifts and makes the currency changeable.
- **Transfer fee row:** is it part of the logical transfer (trashed and restored only with it), or an independent expense (bulk-delete's current choice)?
- **Retry policy for money writes:** stop replaying on ambiguous network errors? Add client-generated idempotency ids to `POST /api/wealth/transfer`, `/api/debts/:id/payments` and `/api/transactions`?
- **Repairing drifted accounts** (8 on dev; prod unknown):
  - Insert explanatory system rows, or rewrite stored balances?
  - Who runs the repair?
  - Add a recurring drift report (a script or a worker job)?
- **Splits across accounts in different currencies:** forbid them, or allow them with per-leg display?
- **Trashed transfers:** should one be reversible? Proposed: no.
- **Detached rows:** freeze `currency_code` once it is set and never re-derive it from the reporting currency? Proposed: yes.

#### Existing tests

- `src/lib/money.test.ts` — Decimal Money/FX. `transferAmounts`: same-currency principal equality, cross-currency requires a destination amount, fee bounds.
- `src/lib/multi-currency-migration.test.ts` — Static SQL checks for 0069-0073:
  - columns declared, backfill order and the logical transfer link;
  - fee/rate CHECKs;
  - `complete_transfer` takes a row lock and is one function.

  Nothing covers cross-row currency invariants.
- `src/lib/wealth-ledger.test.ts` — Pure `balanceDelta`, `reversalsByAccount`, `applicationsByAccount` and `reversesOnTrash` (system rows are neither reversed nor re-applied). It does not exercise the routes, so it cannot catch the double-DELETE bug.
- `src/lib/credit-card-ledger.test.ts` — In-memory card ledger simulation: purchase, payment, refund, delete/restore/purge and edit invariants. Simulation only, not route code.
- `src/lib/debt-ledger.test.ts` — In-memory debt ledger: borrowing/repayment splits, delete/restore once, multi-currency native amounts untouched. Simulation only.
- `src/lib/recurring-transfer.test.ts` — Tests `buildRecurringTransferLegs`, which is now dead code: production auto-save goes through `createTransfer`, so the materializer's transfer branch is untested.
- `src/lib/db/retry.test.ts` — Retryable-error classification and backoff. Does not assert that errors raised after a commit are NOT retried.
- `api/_lib/tx-sql.test.ts` — Static guard that reporting SQL uses the shared `tx-sql` predicates.
- `e2e/multi-currency.spec.ts` — Covers:
  - account native currency plus reporting currency, and consolidated wealth;
  - a cross-currency transfer with a fee, its reversal, and a planned transfer;
  - native balances on `/wealth`.

  No cases for concurrency, the lock, or operations run twice. Its cleanup (DELETE every row, then trash/clear) is what reproduced the fee double-reversal.
- `e2e/credit-card.spec.ts` — Card payment transfer trash/restore/edit through the transaction endpoints (delegation to `set_transfer_trashed`).


### 3.17 Refusal UX: error codes to translated messages

**Readiness:** partial

The server enforces every multi-currency guard and returns a stable `code`, but the client almost never reads it. `request()` (`src/lib/api.ts:403-406`) throws the raw body, and `apiErrorMessage` (`src/lib/api.ts:516-530`, about 30 call sites) returns the server's English `error`. As a result, every refusal toast is in English in ml, de, ar and the other locales, and two paths (`WealthAccountDialogs.tsx:94` and `RecurringRuleDialog.tsx:487`) show the raw JSON body instead. The client maps only 2 of about 17 codes (`transfer_already_reversed`, `no_rate`). Debts stop `currency_mismatch` before submit through `linkRefusal` and same-currency account filters. The i18n gates scan only `src/`, so English written on the server is never checked. Several refusals can only be reached because the UI does not filter by currency first: the Space auto-save source, the Space-delete destination, and the AI-assistant transfer, which sends only `amount` and so always fails across currencies. Three guards have gaps:
- The account-currency lock counts trashed rows that the UI does not count.
- The lock ignores recurring rules and planned transfers, so a rule can keep posting rows in the old currency (high).
- A failed Space auto-save transfer disappears without trace, because the materializer advances the cursor and clears `last_error`.

The SQL RAISE reasons from 0073 never leak into a response, but they are collapsed into generic English codes. Recurring `last_error` is stored as English text and shown as-is on `/recurring`, `/recurring/:id` and `/debts/:id`. There is also a regression: editing any transaction on an archived account now returns a misleading 409 `currency_missing`.

#### What changes / what is affected

**API contracts**
- `src/lib/api.ts` — `request()` lines 403-406 — ⚠️ partial — Throws `new Error(rawBody)`, so every consumer has to JSON-parse `err.message` to get `code`. The HTTP status is thrown away.

**Validation**
- `api/_routes/wealth/accounts/[id].ts` — `account_currency_locked` lines 83-92 — ⚠️ partial — Proposed key: `apiErrors.account_currency_locked`, or reuse `wealth.accountCurrencyLocked` (already in all 8 locales; the body must add `currency`). Today it shows as a raw JSON toast. The lock counts trashed rows (the GET count at `accounts.ts:109` does not) and ignores recurring rules, planned transfers and debt-payer references.
- `api/_lib/wealth-accounts.ts` — `invalid_transfer_amounts` lines 346, 650 — ⚠️ partial — One code carries seven English RangeError texts (`src/lib/money.ts:103-135`). Reached from:
  - the AI transfer (always fails across currencies)
  - the cross-currency move in DeleteSpaceDialog
  - 3-decimal input in SpaceTransferModal and PayCardSheet
  - Space auto-save (the failure is swallowed)

  TransferWizard is protected because its preview runs the same `transferAmounts()`.
- `api/_lib/wealth-accounts.ts` — `source_currency_mismatch` / `destination_currency_mismatch` lines 328, 331, 641, 642 — ⚠️ partial — Proposed key: `apiErrors.account_currency_changed`. Only reachable with a stale cached account list. Shows as an English toast in TransferWizard and PayCardSheet, and as English inline text in SpaceTransferModal.
- `api/_lib/wealth-accounts.ts` — `currency_missing` lines 325, 639 — — not needed — Effectively unreachable: the dev DB has 0 accounts with a NULL `currency_code`, and every insert sets it.
- `api/_routes/transactions/[id].ts` — `currency_missing` lines 159-172 — ❌ missing — **Regression vs `origin/dev`:** the account lookup filters `archived_at IS NULL`, so a PATCH on any row whose unchanged account is archived returns 409. It should fall back to `before.currencyCode`.
- `api/_routes/recurring.ts` — `currency_missing` line 62; `recurring/[id].ts` line 188 — — not needed — Unreachable: POST refuses archived accounts earlier, PATCH falls back to `rule.currencyCode`, and the dev DB has no NULL rule currencies.
- `api/_routes/spaces/[id]/auto-save.ts` — `cross_currency_recurring_policy_required` line 84 (`currency_missing` line 83) — ⚠️ partial — Proposed key with `{{currency}}`. AutoSaveModal lists every account and defaults to `accounts[0]`, which may be in another currency. Shows as an English toast.
- `api/_routes/debts.ts` — `currency_mismatch` lines 146, 173 — ✅ correct — Prevented in the UI by the DebtFormSheet filter. A proposed `apiErrors.currency_mismatch` key would need `currency` added to the body.
- `api/_routes/debts/[id].ts` — `currency_locked` line 140; `currency_mismatch` line 345 — — not needed — The edit form always sends the debt's own currency, and the repayment editor filters accounts.
- `api/_lib/debts.ts` — `recordDebtPayment` `currency_mismatch` line 425 — ⚠️ partial — The manual path is prevented (`RecordPaymentSheet.tsx:82`). On the materializer path the English message is stored in `last_error` and DebtDetailPage shows it as-is.
- `api/_routes/recurring/[id].ts` — `currency_mismatch` line 164 — ❌ missing — Picking a payer in another currency on a debt-repayment rule silently clears the debt select. Save then returns a 400 that shows as a raw JSON toast.
- `api/_lib/recurring-debt.ts` — `REFUSAL_MESSAGES` line 139 (link refusals incl. `currency_mismatch`) — ✅ correct — The client uses the same `linkRefusal` predicate (`src/lib/debt-recurring.ts:292`). The English text only surfaces through `last_error`.
- `api/_lib/wealth-accounts.ts` — `invalid_transfer_transition` lines 533, 540, 572, 586 — ⚠️ partial — The message interpolates raw status enums, and line 572 swallows the SQL reason `transfer_account_currency_changed`. English toast in ScheduledTransfersPanel.
- `api/_lib/wealth-accounts.ts` — `transfer_account_unavailable` line 545 — ⚠️ partial — Reached by Mark done on a planned transfer whose account was later archived. Archiving does not check planned transfers. English toast.
- `api/_lib/wealth-accounts.ts` — `transfer_already_reversed` line 588 — ✅ correct — Mapped to `transactions.transferAlreadyReversed` at `TransactionDetailModal.tsx:103`, translated in all 8 locales.
- `api/_lib/wealth-accounts.ts` — `transfer_reversal_conflict` line 605 — ⚠️ partial — Rare (a DB error inside `createTransfer`) and shows as an English toast. Reversing when the counter account is archived returns the uncoded 400 "Select two active accounts" (line 314).
- `api/_lib/wealth-accounts.ts` — `invalid_transfer_trash_state` lines 615-622 — ⚠️ partial — The catch merges three 0073 RAISE reasons into "Transfer cannot be trashed/restored". TrashPage shows the generic `restoreFailed`.
- `api/_routes/wealth/transfers.ts` — `invalid_transfer_status` line 45; `transfer.ts` line 46; `transfers/[id].ts` line 20 — — not needed — All UI callers send constant, valid statuses, so this is API-only.
- `api/_routes/transactions/[id].ts` — `transfer_mutation_requires_transfer_service` line 118 — ❌ missing — Unreachable from the UI: AccountQuickAddSheet always sends `kind`, so the uncoded 400 at line 113 fires first. Edit on a transfer leg is a dead end.
- `drizzle/0073_transfer_lifecycle.sql` — RAISE EXCEPTION lines 32, 42, 46, 118, 121, 124, 174, 180 — ⚠️ partial — The raw text never reaches a response because every call is wrapped in try/catch, but the specific reasons are lost. The fix is to map `e.message` to distinct codes.
- `src/components/debts/DebtFormSheet.tsx` — account filter line 152 — ✅ correct — Offers only accounts in the debt's currency, so `currency_mismatch` cannot happen from this form.
- `src/components/debts/RecordPaymentSheet.tsx` — account filter line 82 — ✅ correct — Same-currency filter, and amounts use the debt's currency symbol.

**FX**
- `api/_routes/fx/rate.ts` — `no_rate` line 36; `invalid_currency` line 32 — ✅ correct — TransferWizard (lines 163-168) catches `no_rate`, sets `rateMissing`, shows the translated `noRateYet` hint and asks for both amounts. `invalid_currency` is unreachable.

**Writes**
- `api/_lib/recurring-materialize.ts` — `setRuleError` line 325; auto-save failure lines 179-183; cursor update lines 294-303 — ❌ missing — `last_error` stores English free text. When an auto-save transfer fails, the inner `continue` lets the cursor advance and resets `lastError`, so the occurrence is lost.
- `src/components/AiAssistantConfirm.tsx` — `save()` transfer lines 133-141; catch line 179; headline lines 85-99 — ❌ missing — Sends only `amount`, so any cross-currency pair gets a 400 and the generic `aiVoice.failed`, and retrying can never succeed. The headline and toast amounts use the org currency.
- `src/pages/SpaceDetailPage.tsx` — DeleteSpaceDialog lines 409-440; AutoSaveModal lines 308-346 — ❌ missing — The delete destination and the auto-save source are not filtered to the Space's currency, so both refusals show as English toasts. `deleteWithMoney` formats the amount in the org currency.
- `src/components/wealth/AccountQuickAddSheet.tsx` — `save()` edit lines 180-190; catch line 224 — ⚠️ partial — Always sends kind, type, amount and date, so any edit of a transfer leg fails. The toast is the generic `failedToUpdateTransaction` and the reason is lost.

**Displays**
- `src/lib/api.ts` — `apiErrorMessage` lines 516-530 — ❌ missing — Returns `j.reason || j.error` (server English) and never looks `code` up in i18n. Non-JSON bodies are returned verbatim. This is the single shared root cause, used at about 30 call sites.
- `src/components/wealth/transfer-utils.ts` — `apiErrorCode` line 8 — ⚠️ partial — The code extractor exists, but only one caller uses it: `TransactionDetailModal:103`.
- `src/pages/DebtDetailPage.tsx` — `repayment.last_error` line 245; `RecurringDetailPage.tsx` line 402; `RecurringPage.tsx` line 193 — ❌ missing — Shows the stored English `last_error` as-is. The title (`recurring.blockedTitle`) is translated; the reason is not.
- `src/lib/alerts.ts` — `recurringAlerts` lines 538-548 — ✅ correct — The attention rail never interpolates `last_error`, so it stays fully translated.
- `src/components/wealth/WealthAccountDialogs.tsx` — `patchAccount` catch line 94; CurrencyCombobox disabled line 144 — ❌ missing — `toast.error(err.message)` shows the raw JSON body. The combobox is enabled or disabled from a `transaction_count` that excludes trashed rows, while the server lock counts them.
- `src/components/recurring/RecurringRuleDialog.tsx` — `handleSave` catch line 487; symbol line 227 — ❌ missing — Shows a raw JSON toast for every refusal. The amount and debt-balance prefixes use the org currency symbol even when the payer is in another currency.
- `src/components/spaces/SpaceTransferModal.tsx` — submit catch line 100 — ⚠️ partial — Cross-currency is handled, but server errors show as English inline text (for example, 3-decimal input).
- `src/components/wealth/TransferWizard.tsx` — submit catch lines 244-251 — ⚠️ partial — Amount codes are unreachable. The stale-cache currency mismatch and 402 quota reasons show in English.
- `src/components/wealth/PayCardSheet.tsx` — submit lines 150-180 — ⚠️ partial — Sends both native amounts when currencies differ. Unvalidated decimals and a stale currency give English toasts.
- `src/components/wealth/ScheduledTransfersPanel.tsx` — transition catch line 69 — ⚠️ partial — `invalid_transfer_transition` and `transfer_account_unavailable` show as English toasts.
- `src/components/TransactionDetailModal.tsx` — `reverse()` lines 93-108; Edit button line 245; `canReverse` line 88 — ⚠️ partial — One code is mapped. `canReverse` ignores an archived counter account, and Edit is offered on transfer legs, where it cannot succeed.
- `src/pages/TransactionsPage.tsx` — `handleEdit` catch line 648 — ⚠️ partial — Every code gets the same generic translated failure, including the archived-account `currency_missing` regression.
- `src/pages/TrashPage.tsx` — `handleRestore` catch line 77 — ⚠️ partial — Generic `restoreFailed`; `invalid_transfer_trash_state` is not explained.

**Other**
- `scripts/check-i18n-hardcoded.mjs` — SRC root line 29 — ❌ missing — Walks only `src/`, so English written in `api/` and new `code:` literals are never checked. No gate ties each code to an `apiErrors.<code>` key.

*(Schema, Aggregates: no touchpoints in this area.)*

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| high | Account currency can be changed while future-dated recurring rules still point at the account; the rule then posts rows in the old currency | `api/_routes/wealth/accounts/[id].ts:83` | No |
| medium | A failed Space auto-save occurrence is lost without trace: the inner `continue` lets the cursor advance and clears `last_error` | `api/_lib/recurring-materialize.ts:179` | No |
| medium | Account edit dialog shows the raw JSON body; the currency lock is reachable because the client and server count history differently | `src/components/wealth/WealthAccountDialogs.tsx:94` | No |
| medium | RecurringRuleDialog shows server refusals as raw JSON and silently drops the debt link when a payer in another currency is chosen | `src/components/recurring/RecurringRuleDialog.tsx:487` | No |
| medium | `apiErrorMessage` never translates, so every multi-currency refusal is an English toast in every non-English locale | `src/lib/api.ts:516` | **Yes** |
| medium | Regression: editing any transaction on an archived account returns 409 "Account currency migration is incomplete" | `api/_routes/transactions/[id].ts:167` | No |
| medium | An AI-assistant transfer between accounts in different currencies always fails with a generic message | `src/components/AiAssistantConfirm.tsx:135` | No |
| medium | Deleting a Space that holds money into an account in another currency fails with an English toast, and the amount is shown in the wrong currency | `src/pages/SpaceDetailPage.tsx:422` | No |
| medium | The auto-save modal offers source accounts in other currencies and defaults to the first one; the refusal is in English | `src/pages/SpaceDetailPage.tsx:308` | No |
| medium | Scheduled transfer "Mark done" after an account currency change or archive gives a misleading English error | `api/_lib/wealth-accounts.ts:572` | No |
| medium | Recurring `last_error` is stored as English text and shown as-is | `api/_lib/recurring-materialize.ts:325` | No |
| medium | Edit is offered on transfer legs but always fails; `transfer_mutation_requires_transfer_service` can never reach the UI | `src/components/TransactionDetailModal.tsx:245` | No |

**Unverified (low):**
- Reverse is offered when the counter account is archived, and the refusal is uncoded English.
- `invalid_transfer_amounts` bundles seven English RangeError texts under one code, and Decimal.js internals can leak.
- A stale cached account currency gives an English `source_currency_mismatch` / `destination_currency_mismatch`.
- Trash and delete of transfers merge their distinct reasons into one generic message.
- The recurring form labels amounts with the workspace symbol when the paying account uses another currency, and the symbol prefix is not RTL-aware.
- New multi-currency ledger descriptions are stored in English.

**Refuted:** none.

#### Decisions

- **Where translation happens:** the client maps `code` to `apiErrors.<code>` (recommended; the server keeps English for logs and API consumers), or the server localizes from `Accept-Language`.
- **Fallback when there is no code or no translation:** show the caller's translated fallback (recommended) or the server's English `error`.
- **Interpolation params in refusal bodies** (currency, account name, status), so translations can say "This debt is in {{currency}}". This needs server changes at `debts.ts:146/173`, `debts/[id].ts:345`, `debts.ts:425`, `recurring/[id].ts:164` and `accounts/[id].ts:89`.
- **Split `invalid_transfer_amounts` into sub-codes:** `destination_amount_required`, `amount_too_many_decimals`, `amount_not_positive`, `amount_too_large`, `same_currency_amounts_differ`, `fee_invalid`.
- **Storage for recurring `last_error`:** a code plus params (additive migration: `last_error_code` / `last_error_params`) or JSON inside `last_error`. Either way, legacy English rows need a fallback.
- **Account-currency lock policy:** decide whether each of these locks the currency, or whether a currency change should re-snapshot rule currencies instead:
  - trashed rows
  - active recurring rules (as payer or as auto-save destination)
  - planned/pending transfers
  - debt-repayment payers
  - card funding references
- **Cross-currency Space auto-save, Space deletion and AI transfers:** block them in the UI (same-currency pickers only), or support them with an explicit received amount / rate policy.
- **Transfer legs:** hide Edit and offer only Reverse, or allow edits to description and category only.
- **0073 RAISE tokens:** decide whether `transfer_account_currency_changed` and `reversal_linked_transfer_is_immutable` become first-class API codes.
- **CI gate:** decide whether to add a check that every `code: "…"` literal in `api/` has an `apiErrors` key that exists and is translated in all 8 locales.

#### Existing tests

- `src/lib/debt-recurring.test.ts` — `linkRefusal` returns `currency_mismatch` for a EUR payer against a USD debt (line 246). This is the client-side check that mirrors the server.
- `src/lib/money.test.ts` — `transferAmounts` throws for a missing cross-currency destination, unequal same-currency principals, more than 2 decimals, and a negative fee (lines 68-75). It asserts the English RangeError texts that become `invalid_transfer_amounts`.
- `src/lib/multi-currency-migration.test.ts` — static checks that migrations 0071-0073 declare transfers, the fee/rate constraints, and the `complete_transfer` / `transition_unsettled_transfer` / `set_transfer_trashed` functions. The RAISE-to-code mapping is not tested.
- `src/lib/alerts.test.ts` — `recurring_paused` alerts never interpolate the free-text `last_error`, so the rail stays translated.
- `e2e/multi-currency.spec.ts` — API level only, English locale only:
  - a cross-currency transfer keeps both amounts
  - a second reversal attempt returns 409 `transfer_already_reversed` (lines 301-333)
  - a scheduled transfer moves no money until it is marked done

  No UI check of any refusal message.
- `e2e/debts.spec.ts` — per-currency debt summary math. It does not cover the `currency_mismatch` or `currency_locked` refusal UX.


### 3.18 Rollout, backward compatibility & native bundles

**Readiness:** partial. Almost every API change is additive. No route was removed or renamed, `/api/organizations` still returns `currency` (now `coalesce(reporting_currency, currency)`), and the `api/_routes/budgets.ts:16` shim pattern still holds. As a result, same-currency behaviour stays compatible with the store-pinned Android/iOS 1.4.0 apps and with stale v0.14.1 PWA tabs.

The mixed-currency case is not handled for those clients. The server gets no client-version signal, there is no feature flag, and the web UI always offers a native-currency picker. Once a user creates a foreign-currency account or Space on the web, old bundles show it with the org symbol and add it raw into net worth, Spaces and dashboard totals. Old bundles also write money into that account under the org-currency label: transaction creates, splits (mixed-currency splits included), recurring rules and balance edits. The server accepts all of these.

When old clients hit a cross-currency path, the failures are safe but the messages are untranslated:
- transfers and card payments return 400 `invalid_transfer_amounts`
- leg amount/date edits return 409
- debt payments return 400 `currency_mismatch`

Three defects affect every client, not just old ones:
- onboarding ignores the chosen currency, so the reporting currency stays USD
- the account page's income/expense strip shows a reporting-currency total with the account's own symbol
- the transfer fee row is not protected from being edited or trashed on its own

Two more risks come from rollout itself. Migrations run in `vercel-build` while the old deployment is still serving, so rows written in that window, or after a rollback, get a NULL `currency_code`. Separately, rolling back once cross-currency data exists corrupts transfer state. The release therefore needs a foreign-currency gate or shim, the server fixes above, and a strict API-first, roll-forward-only plan.

Verifiers refuted two related claims: that migrations 0069–0074 would be skipped if dev's 0075 ships first, and that the post-deploy probes are a detection gap.

#### What changes / what is affected

**Schema**
- `drizzle/meta/_journal.json` — 0069–0074 `when` 1789303202114..614 — ⚠️ partial — Linear on this branch (check-migrations passes). origin/dev has 0075 at 1789383113149 directly after 0068. The skipped-migration hazard this implies was **refuted** (0/3).
- `scripts/db-migrate.mjs` — `vercel-build` migrate-then-build — ⚠️ partial — Migrations run before promotion while the old code still serves. 0069 has no DEFAULT or trigger, so old-code inserts get a NULL `currency_code` (dev DB: 69 untagged transactions written after 0069).

**Writes**
- `api/_routes/onboarding.ts` — `POST /api/onboarding` — ❌ missing — Lines 54 and 71 set only `organizations.currency`. `reporting_currency` keeps the USD it got at org creation (`api/_lib/auth.ts:109`).
- `api/_routes/admin/organizations.ts` — POST admin org edit — ❌ missing — Line 145 sets only `patch.currency`, so `reporting_currency` drifts.
- `api/_lib/wealth-accounts.ts` — `createWealthAccount` (`POST /api/wealth/accounts`) — ✅ correct — A missing `currency_code` defaults to `reporting_currency ?? currency` (lines 113-119). The new web UI shows the picker unconditionally (`WealthPage.tsx:393`), and the server has no gate.
- `api/_routes/spaces.ts` — `POST /api/spaces` — ✅ correct — Defaults to the reporting currency when `currency_code` is absent (lines 58-63). No gate on a foreign `currency_code`.
- `api/_routes/cards.ts` — `POST /api/cards` (credit liability) — ⚠️ partial — The liability account is always created in the reporting currency (line 124), even when the issuer or funding bank is EUR.
- `api/_routes/transactions/[id].ts` — `DELETE /api/transactions/:id` (transfer leg) — ✅ correct — A leg with `transfer_id` goes through `set_transfer_trashed` (line 232) and returns 204, which old `apiDelete` handles. A reversal-linked transfer returns 409 "Transfer cannot be trashed".
- `api/_routes/transactions/[id].ts` — PATCH/DELETE on the transfer FEE row (`kind=standard`, `transfer_id` set) — ❌ missing — The guards check only `kind==='transfer'` (lines 106, 232), so the fee row can be edited, moved or trashed alone. `bulk-delete.ts:41` and `trash/purge.ts:33` also bypass the transfer.
- `api/_routes/transactions/bulk-delete.ts` — `POST /api/transactions/bulk-delete` — ✅ correct — Transfer legs are trashed once per transfer through the service (lines 41-47). Compatible with old clients.
- `api/_routes/trash/restore.ts` — `POST /api/trash/restore` — ✅ correct — Restoring a transfer leg restores the whole transfer (line 31).
- `api/_routes/trash/purge.ts` — `POST /api/trash/purge` — ⚠️ partial — Hard-deletes only rows sharing a `group_id` (line 33). The fee row (no `group_id`) stays in Trash and the transfers header is orphaned.
- `api/_routes/transactions.ts` — `POST /api/transactions` — ⚠️ partial — Line 480 silently snapshots `account.currencyCode` with no client acknowledgement, so an old bundle's ₹-labelled entry lands as EUR.
- `api/_routes/recurring.ts` — `POST /api/recurring` — ⚠️ partial — Snapshots the account currency (line 61) and returns 409 `currency_missing` if the account has none. The old `RecurringRuleDialog` labels amounts with the org symbol.
- `api/_routes/wealth/accounts/[id].ts` — PATCH `current_balance` / `currency_code` — ⚠️ partial — The Balance Adjustment is written in `account.currencyCode`, and the currency locks once history exists. The old edit dialog shows the org symbol on a foreign account.
- `api/_lib/card-autopay.ts` — autopay `createTransfer` — ❌ missing — A foreign funding account makes it return 400, and the claim is released and deferred on every sync (lines 153-157), so the statement is never paid. `api/_routes/cards/[id].ts:116` accepts a funding account in any currency.
- `src/components/AiAssistantConfirm.tsx` — `save()` transfer/tx — ⚠️ partial — Line 135 posts `{amount}` only, so a cross-currency transfer returns 400. Lines 108, 143, 155 and 273 format with the org currency.
- `api/_lib/recurring-materialize.ts` — `rule.currencyCode` null check — ⚠️ partial — Lines 147-151 pause the rule with an untranslated "Currency is missing — edit and save this recurring rule" instead of healing it from the account.

**Aggregates**
- `api/_routes/transactions.ts` — `groupedFieldsFor.amount` (split rows) — ⚠️ partial — For a mixed-currency group, line 109 makes `amount` = `sum(reporting_amount)`, which silently skips NULL legs. `currency_code` switches to reporting, and no client reads `currency_count`.

**Displays**
- `api/_routes/debts.ts` — `GET /api/debts` `orgCurrency` — ⚠️ partial — Line 44 reads legacy `organizations.currency`, not `reportingCurrencyFor`. Billing (`pricing.ts:30`, `create-subscription.ts:137`) and `ai.ts:167` read the same column.
- `src/pages/WealthAccountDetailPage.tsx` — stats strip `fmt(s.value)` — ❌ missing — `fmt` is built from the account currency (line 116) but applied to a reporting-currency summary (line 383).
- `src/pages/CardDetailPage.tsx` — `fmt` / `AccountQuickAddSheet` currency — ❌ missing — Uses `useCurrency()` throughout (lines 78, 110, 609).
- `src/pages/RecurringDetailPage.tsx` — `AccountQuickAddSheet` currency — ❌ missing — Line 601 passes the org currency, so the amount-input symbol comes from `AccountQuickAddSheet.tsx:75/274`.
- `src/lib/currency-context.tsx` — `CurrencyProvider` — ✅ correct — Uses `activeOrg.currency`, which the server coalesces to the reporting currency.

**FX**
- No touchpoints in this area.

**Validation**
- `api/_routes/transactions/group.ts` — `POST /api/transactions/group` — ❌ missing — Each leg gets its account's currency (line 164), but legs in different currencies are never refused. Only the new `AccountSelector` blocks this.
- `api/_routes/spaces/[id]/auto-save.ts` — `POST /api/spaces/:id/auto-save` — ✅ correct — Cross-currency returns 409 `cross_currency_recurring_policy_required` (line 82), a safe refusal for old clients.
- `api/_lib/debts.ts` — `recordDebtPayment` / `POST /api/debts` `currency_mismatch` — ⚠️ partial — Lines 419-426 refuse cross-currency repayments. v0.14.x allowed them, so existing production rules with a foreign payer fail on every materialisation after deploy.
- `src/components/AccountSelector.tsx` — `optionCurrency` / `wrongCurrency` — ✅ correct — Labels each tile in its account currency and blocks mixed-currency splits, but only on the client.

**API contracts**
- `api/_routes/wealth/accounts.ts` — `GET /api/wealth/accounts` — ⚠️ partial — Adds `currency_code`/`color`. The old client (origin/main `wealth.ts:126` `summarizeWealth`, `WealthPage.tsx:297,498-536,651,942`, `Dashboard.tsx:572,639`) raw-sums native balances: INR 50,000 + EUR 1,000 shows ₹51,000.00 instead of about ₹1,40,000.
- `api/_routes/spaces.ts` — `GET /api/spaces` — ⚠️ partial — Native per-Space balances. Old `SpacesPage.tsx:81`, `SpacesCard.tsx:59` and `WealthPage.tsx:301` raw-sum a EUR Space into "Saved in Spaces" with ₹.
- `api/_routes/transactions.ts` — `GET /api/transactions` (non-paged, dashboard) — ⚠️ partial — Rows stay native, with `reporting_amount` added (line 58). Old `Dashboard.tsx:1048-1049` sums raw `amount`, so €100 counts as ₹100.
- `api/_routes/transactions.ts` — `GET /api/transactions?page=` summary — ⚠️ partial — Converted to reporting, with `currency`/`excluded_count` added (lines 357-379). Old `TransactionsPage` gets the symbol right but ignores `excluded_count`.
- `api/_routes/transactions.ts` — `GET /api/transactions?wealthAccountId=&page=` summary — ⚠️ partial — Now in reporting currency even when scoped to one account. The new account page mislabels it; old clients' org symbol happens to match.
- `api/_routes/analytics.ts` — `GET /api/analytics` — ⚠️ partial — Converted, with `currency`/`excluded_count` on every summary, bucket, category and client. The old page never shows excluded rows.
- `api/_routes/calendar.ts` — `GET /api/calendar` — ⚠️ partial — Converted per day, with `excluded_count`. The old `CalendarPage` silently drops it.
- `api/_routes/flow.ts` — `GET /api/flow` — ⚠️ partial — The consolidated balance is converted, but per-account opening/current and leaves stay native with `account_currency`/`currency_code` (lines 189, 481-483). Old `MoneyFlowPage` uses the org symbol.
- `api/_routes/clients.ts` — `GET /api/clients`, `GET /api/clients/:id` — ⚠️ partial — Totals are converted, with `totals_currency`/`excluded_count` added. Old pages drop excluded rows silently.
- `api/_routes/spending-budgets.ts` — `GET /api/spending-budgets`, `GET /api/budgets` (v1 shim), overview/detail — ⚠️ partial — Figures are in the budget currency, else reporting. The 0069 backfill (lines 55-59) froze legacy budgets at the org currency, so after a reporting change old clients show INR figures with €.
- `api/_routes/budgets.ts` — personal-org v1 projection (line 16) — ✅ correct — Precedent for a store-pinned shim: it adds `currency`/`excluded_count` without removing fields.
- `api/_routes/recurring.ts` — `GET /api/recurring` — ⚠️ partial — Native amounts, with `currency_code`/`account_currency` added. Old `RecurringCard` (origin/main ~55-58) sums `monthlyEquivalent` across currencies.
- `api/_lib/alerts.ts` — `GET /api/alerts` — ⚠️ partial — Each alert carries its account's `currency`. The old `AlertsBanner` formats every alert with the org symbol.
- `api/_routes/cards.ts` — `GET /api/cards`, `/api/cards/:id/summary`, `/api/wealth/accounts/:id/card` — ⚠️ partial — Native per card. The old and new `CardDetailPage` (`:78/110`) both use the org currency, so a debit card on a EUR bank shows ₹.
- `api/_routes/organizations.ts` — `GET /api/organizations` — ✅ correct — `currency` = `coalesce(reporting_currency, currency)` (lines 51-54). Persisted to L2 (`ps_apic1:`) with no shape break.
- `api/_routes/organizations/[id].ts` — GET/PATCH `/api/organizations/:id` — ⚠️ partial — PATCH syncs both columns (lines 75-78). GET returns the raw legacy `currency` (line 38), so it disagrees with the list endpoint once the columns drift.
- `api/_routes/wealth/transfer.ts` — `POST /api/wealth/transfer` — ⚠️ partial — The legacy `{amount}` body works between same-currency accounts (201, old fields kept, `transfer_id`/`fee_leg` added). Cross-currency returns 400 `invalid_transfer_amounts` (`src/lib/money.ts:133`), and more than 2 decimal places is now refused (`money.ts:103`).
- `api/_routes/transactions/[id].ts` — `PATCH /api/transactions/:id` (transfer leg) — ⚠️ partial — Relabelling is allowed. An amount/date change returns 409 `transfer_mutation_requires_transfer_service` (lines 115-119), and old bundles have no reverse UI.
- `api/_routes/search.ts` — `GET /api/search` transactions — ❌ missing — No `currency_code` in the select (lines 43-52). `GlobalSearchDialog.tsx:200` and `MobileSearchOverlay.tsx:313` use the org currency.
- `api/_routes/trash.ts` — `GET /api/trash` — ❌ missing — No `currency_code` (lines 8-18). `TrashPage.tsx:39/194` uses the org currency.
- `src/lib/api.ts` — `request()` headers — ❌ missing — Lines 396-400 send only `Authorization` and `x-org-id`. There is no client/bundle version, so the server cannot shim or gate by version and no forced-update path exists.

**Other**
- `.github/workflows/post-deploy.yml` — 401 probes — ⚠️ partial — Line 45 probes 7 routes unauthenticated only and skips the new wealth/FX/analytics routes. The detection-gap issue was **refuted** (0/2).
- `android/app/build.gradle` — `versionCode 19` / `versionName 1.4.0` — ❌ missing — Unchanged since 58a5528 (#365). iOS is also 1.4.0 (build 9), and the local android/ios public bundles (Sep 14) have no multi-currency code. The "stale shells" issue was **refuted** (0/2): sync and bump are release steps.
- `api/_lib/wealth-accounts.ts` — `setTransferTrashed` catch-all — ⚠️ partial — Line 620 maps any DB error, including a missing function, to 409 "Transfer cannot be trashed".

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | Onboarding ignores the chosen currency: only `organizations.currency` is updated, so reporting stays USD | `api/_routes/onboarding.ts:54` | no |
| high | Old native and stale PWA bundles show foreign accounts in the org currency and raw-sum them into net worth, Spaces and dashboard | `src/pages/WealthPage.tsx:297` (origin/main) | yes |
| high | Old bundles write money into foreign accounts under the org-currency label and the server accepts it | `api/_routes/transactions/group.ts:164` | no |
| high | Account page income/expense/net strip shows a reporting-currency figure with the account's symbol | `src/pages/WealthAccountDetailPage.tsx:383` | no |
| high | `organizations.currency` and `reporting_currency` can drift, and some readers use the legacy column | `api/_routes/admin/organizations.ts:145` | no |
| high | Rolling back to v0.14.1 after cross-currency data exists corrupts transfer state | `api/_routes/transactions/[id].ts:232` | no |
| medium | `POST /api/transactions/group` accepts legs in different currencies | `api/_routes/transactions/group.ts:84` | no |
| medium | Rows written by the old deployment during the build window or after a rollback get NULL `currency_code` and block transfers | `api/_lib/wealth-accounts.ts:325` | yes |
| medium | The transfer fee row can be edited, moved or trashed alone, out of step with its transfer header | `api/_routes/transactions/[id].ts:106` | no |
| medium | Cross-currency transfers/card payments from old bundles and the AI assistant fail with an untranslated refusal | `src/lib/money.ts:133` | no |
| medium | Autopay with a funding account in another currency never pays and retries forever | `api/_lib/card-autopay.ts:153` | no |
| medium | Existing production foreign-currency debts with a cross-currency payer stop posting after deploy | `api/_lib/debts.ts:423` | no |
| medium | A grouped split row's `amount` silently drops legs that have no rate | `api/_routes/transactions.ts:109` | no |
| medium | Old clients drop `excluded_count`, so partial converted totals look complete | `api/_routes/analytics.ts:1` | no |
| medium | Search and Trash return native amounts without `currency_code` and format them in the org currency | `api/_routes/search.ts:46` | no |
| medium | The server cannot tell old bundles from new ones | `src/lib/api.ts:396` | yes |

**Unverified (low):**
- "Legacy transfer-leg amount/date edits are now refused, and old bundles have no reverse flow" (known-deferred)
- "Legacy budgets are frozen in the old org currency by the 0069 backfill"
- "setTransferTrashed maps every DB error to a 409 user error"

**Refuted (not bugs):**
- "Deploy-order hazard: if dev's 0075 reaches production first, 0069–0074 are skipped silently" (0/3)
- "Post-deploy probes cannot detect a broken multi-currency deploy" (0/2)
- "The native shells are stale and not version-bumped for this branch" (0/2)

#### Decisions

- **Foreign-currency gate:** keep native-currency selection for accounts, Spaces and card banks OFF in production (server flag, 409 `multi_currency_disabled`) until native 1.5.0 is in the stores and adoption passes a threshold? Or ship now and accept that 1.4.0 users see raw-summed net worth and can write mislabelled amounts?
- **Old-client write policy:** for accounts whose currency ≠ reporting, refuse writes that carry no currency acknowledgement (409 `client_update_required`), or keep accepting them as today?
- **Client versioning:** add an `x-client-version` header and a minimum supported native version (with a forced-update screen) in this release? Without it, no future contract change can be gated per client.
- **Changing the reporting currency:** on main, fixing a mistaken workspace currency relabelled everything. Now it converts, and account currencies lock once there is history. Offer a one-time "relabel all accounts" path when every account is still in the old reporting currency and nothing is cross-currency?
- **Legacy budgets:** follow the reporting currency (`currency_code` NULL), or stay frozen at the currency stamped by the 0069 backfill?
- **Existing production cross-currency debts** (allowed on v0.14.x): grandfather them, pause them with an alert, or relabel? Needs the production audit numbers first.
- **Release order vs dev's 0075 (account colours):** ship multi-currency first, or re-stamp 0069–0074 above production's watermark at release? The related skipped-migration issue was refuted, but the ordering still needs a decision.
- **Rollback policy:** declare roll-forward-only once the first cross-currency transfer or foreign account exists in production?
- **Account-scoped `/api/transactions` summary:** native (account currency) or reporting? It is reporting today, while the account page renders native.
- **PWA:** make `UpdatePrompt` sticky (non-dismissable) for this release so v0.14.1 tabs don't linger?

#### Existing tests

- `src/lib/money.test.ts` — `transferAmounts`: native principals, rate direction, source fee outside principal FX, missing cross-currency destination rejected, >2dp and negative fee rejected, reversal swaps principals and refunds the fee.
- `src/lib/multi-currency-migration.test.ts` — Shape of the 0069–0073 SQL: currency columns declared, backfill without rewriting amounts, account backfill before org fallback, multi-cash unique index, transfer header linkage, same-currency check, row-locked completion.
- `api/_lib/tx-sql.test.ts` — Rendering of the reporting SQL (`reporting_amount`, missing-rate count) and the P&L classification helpers.
- `api/_lib/fx-rates.test.ts` — Rate caching, coalescing and snapshot storage; `reportingCurrencyFor` fallback.
- `api/_lib/fx-provider.test.ts` — Frankfurter/open.er-api provider contract and fallback.
- `src/lib/api-cache.test.ts` — Cache policy, including `/api/fx/rate` (config, not persisted) and the persist allowlist (`/api/organizations` persisted).
- `src/lib/debt-recurring.test.ts` — The `linkRefusal` predicate, including `currency_mismatch` between payer account and debt.
- `e2e/multi-currency.spec.ts` — An account keeps its own currency; consolidated wealth converts without touching native balances; cross-currency transfer with its own rate and fee; reversal; a scheduled transfer moves no money; wealth screen with native balance, ≈ value and breakdown.
- `e2e/credit-card.spec.ts` — Transfer-leg trash/restore/relabel through the transfer service (line 441); card payment as a transfer.
- `e2e/prod-build.spec.ts` — The production bundle boots (catches chunk cycles). No multi-currency assertions.
- `pwa/sw-policy.test.ts` — SW navigation deny-list and the NetworkOnly shell policy that stale-PWA recovery relies on.
- `scripts/check-migrations.mjs` — The journal is linear on this branch (77 entries, head 0076). It cannot know production's watermark.
- `.github/workflows/post-deploy.yml` — 401-not-500 probe on 7 authed routes, plus pricing/SSR/PWA artifacts, after a production deploy.


### 3.19 FX & currency operations tooling

**Readiness:** missing. Almost none of the tooling needed to run FX in production exists. Rates are fetched only as a side effect of user GET requests. `ensureRatesForOrg` has 12 call sites and every one ends in `.catch(() => undefined)`. There is no FX cron step, no FX view in /admin, no FX log line, no manual or derived rate import, and no balance or currency repair tool.

Some stored rates are also wrong:
- `storeSnapshot` uses ON CONFLICT DO NOTHING. A business day that is first requested before the ECB publishes keeps the previous day's rate for good. The dev DB has 7 such pair-days; for example, EUR/USD on 2026-09-14 is stored as 1.1592 against the ECB's 1.1551.
- `fx_rate_on` prefers a stale direct row over a newer inverse row and has no age limit. EUR/INR on 2026-09-30 returns 110.7675 from 09-14 instead of the same-day inverse, 108.81.

125 of the 155 selectable currencies (including AED, SAR, KWD, QAR, PKR and LKR) have no source for historical rates. Their rows dated before the first stored rate stay excluded permanently, and days nobody visited quietly reuse the last visited day's rate.

Onboarding is the main way a workspace ends up in the wrong currency. It writes `organizations.currency` but not `reporting_currency`, and the money wizard sends no `currency_code`, so a new user who picks INR gets a USD workspace. Nothing can repair that correctly:
- Changing the reporting currency converts every amount (about ×88 for USD to INR).
- An account's currency locks as soon as its Opening Balance row exists.

Separately, 3 of 77 dev accounts have a stored balance that does not match their ledger.

The smallest fix set:
- an upsert in `storeSnapshot` that replaces only placeholder rows;
- an FX step in the hourly `/api/cron/notifications` tick;
- an append-only manual/derived rate import for super-admins;
- an FX health block in `/api/admin/worker`;
- a balance audit script and an account relabel script, both dry-run by default;
- two lines in onboarding.

None of these tools may ever convert at 1:1 or rewrite amounts.

#### What changes / what is affected

**Schema**
- `drizzle/0070_fx_rate_snapshots.sql` — `fx_rate_snapshots` + observation_unique index — ⚠️ partial — the CHECK allows source_type `'manual'` but no code writes it. The unique key includes provider+source_type, so a correction needs a distinct provider label or DO UPDATE.

**Writes**
- `api/_routes/onboarding.ts` — `POST /api/onboarding` (L54, L71) — ❌ missing — the personal-org and existing-business branches set `organizations.currency` only. `reporting_currency` keeps the USD it got when the personal org was auto-created (auth.ts:192, profile default USD).
- `src/components/onboarding/MoneyWizard.tsx` — createWorkspace money step (L143-160) — ⚠️ partial — shows the chosen currency symbol but POSTs `/api/wealth/accounts` without `currency_code` (L146, L154). The server then defaults to `reporting_currency` (wealth-accounts.ts:117).
- `api/_routes/admin/organizations.ts` — PATCH currency (L145) — ⚠️ partial — writes `organizations.currency` only, never `reporting_currency`. POST goes through `createOrgForUser`, which sets both correctly.
- `api/_lib/auth.ts` — `createOrgForUser` / `ensurePersonalOrg` (L88-123, L166-210) — ✅ correct — sets currency and reporting_currency together. The personal org is created with the profile currency (default USD) before onboarding runs.
- `api/_routes/organizations/[id].ts` — PATCH currency (L72-79) — ✅ correct — writes both columns and never touches native currencies. It is a reporting change (it converts), so it cannot fix a mislabelled native currency.
- `api/_lib/wealth-accounts.ts` — `createAccount` (L113-117) / `createSystemTransaction` (L52-81) — ✅ correct — the default currency is `reporting_currency`. The system Opening Balance / Balance Adjustment row is the existing primitive a balance-audit "adjust" mode should reuse.
- `scripts/migrate-org-currency.ts` — `main` (L17-29) — ❌ missing — legacy script that rewrites `organizations.currency` for every org from the owner's profile and never touches `reporting_currency`. Running it now splits the two columns platform-wide. It is the only currency script in `scripts/`.

**Aggregates**
- `api/_lib/tx-sql.ts` — `missingRateSql` / `missingRateCountSql` / `accountBalanceInSql` / `missingAccountRateCountSql` (L60-90) — ✅ correct — excluded rows are counted, not zeroed. They rely entirely on rates stored by someone's earlier request.
- `api/_lib/wealth-summary.ts` — `buildWealthSummary` — ⚠️ partial — converts correctly and reports excluded_currencies/complete/as_of/stale, but inherits `currentRate`'s mislabel: a same-day placeholder is reported as today and not stale.
- `api/_routes/admin/org-detail.ts` — `counts.incomingTotal/outgoingTotal` (L57-66) — ❌ missing — raw `sum(t.amount)` across currencies, shown as "Net flow" (AdminOrgDetailPage.tsx:322). Dev org 920a6c5f shows -6 instead of -6.80 USD.
- `api/_routes/admin/clients.ts` — `totalIncoming/totalOutgoing` (L64-65) — ❌ missing — uses the unconverted `incomeSumSql`/`expenseSumSql`, a raw cross-currency sum.
- `api/_routes/debts.ts` — `orgCurrency` (L44-45) — ⚠️ partial — reads the legacy `organizations.currency`, not `reporting_currency`, so it diverges whenever onboarding or the admin PATCH splits the columns. The same applies to quotation-pdf.ts:81, ai.ts:167 and billing/pricing.ts:30.
- `api/_lib/notify-budget.ts` — `ensureRatesForOrg` call (L153) — ✅ correct — converts with the same SQL. A later rate heal or correction does not retract notifications already sent (dedupe keys).

**Displays**
- `api/_routes/admin/worker.ts` — `GET /api/admin/worker` — ❌ missing — already returns a DB-derived heartbeat even when the worker is down, which makes it the natural place for an `fx` block (per-pair freshness, per-org excluded rows). There is no FX surface anywhere in /admin.
- `src/pages/admin/AdminOrgDetailPage.tsx` — OverviewTab / ClientsTab / TransactionsTab (L227, L322, L462, L781, L842) — ❌ missing — shows the legacy `org.currency`, says "Amounts are in {currency}", and prints `tx.amount` without the row's currency. The operator's view of an FX complaint is mislabelled.
- `src/components/FxExcludedNotice.tsx` — `FxExcludedNotice` (L20) — ❌ missing — `t('fx.excludedNotice')` has no key in any locale (en.json has no `fx` namespace). The raw key is rendered on Dashboard, Transactions, Calendar, Clients, ClientDetail, Analytics, Budgets and MoneyFlow.
- `src/components/wealth/ApproxBalance.tsx` — `approxAsOf` / stale badge (L31-35) — ⚠️ partial — faithfully shows rate_date/stale from the API, which labels a placeholder rate as today and not stale.
- `src/components/wealth/CurrencyBreakdown.tsx` — `ratesFrom` / `currencyNotIncluded` (L29-37) — ⚠️ partial — shows "rates from" only when stale. The copy (en.json:1645, "...no exchange rate is available yet") promises self-healing that never happens for non-ECB history.

**FX**
- `api/_lib/fx-rates.ts` — `storeSnapshot` (L141-155) — ⚠️ partial — `onConflictDoNothing` on (base, quote, rate_date, provider, source_type). A carried-forward placeholder (`is_fallback=true`) can never be replaced by the real observation from the same provider/source, and `fetched_at` never refreshes. This is the root cause of the frozen days.
- `api/_lib/fx-rates.ts` — `currentRate` (L173-216) — ⚠️ partial — the fresh path (L179-187) ignores `is_fallback`, so a same-day placeholder comes back as rateDate=today, stale=false for 12h. L196 stores the pre-publication value under today as market with `is_fallback=true`. The note that the market-only filter and the offline path (L205-212) have no manual precedence belongs to a claim the verifiers refuted (see below).
- `api/_lib/fx-rates.ts` — `ensureHistoricalRates` (L231-270) — ⚠️ partial — coverage is `count(distinct rate_date)` (L241-245), so placeholder days count as covered and are never re-checked. The series comes only from Frankfurter/ECB (L252), so non-ECB pairs return covered:false forever. Days are inserted one at a time in a sequential loop (L263-268), and history stops at 6 years (L29 `MAX_HISTORY_DAYS`).
- `api/_lib/fx-rates.ts` — `ensureRatesForOrg` (L278-304) — ⚠️ partial — called only from request paths (analytics, calendar, flow, clients, clients/[id], transactions, budgets, budgets/overview, budgets/detail, spending-budgets ×2, notify-budget, wealth-summary). Every caller discards the returned `uncovered` list and swallows errors.
- `api/_lib/fx-rates.ts` — `FrankfurterProvider` / `OpenErApiProvider` / `ChainedProvider` (L59-130) — ⚠️ partial — Frankfurter covers the 30 ECB currencies with history. open.er-api gives current rates only (`getHistoricalRate` throws, L99-101). Chained failures are swallowed without a log (L113-115, L124-126). The env knobs `FX_DISABLED` / `FX_FRANKFURTER_HOST` / `FX_OPEN_ER_API_HOST` are not documented in CLAUDE.md.
- `api/_lib/fx-provider.ts` — `CachedFxRateProvider` — ✅ correct — 1h in-process TTL plus in-flight coalescing for current and historical quotes. `getSeries` is called on the raw `FrankfurterProvider` (fx-rates.ts:252), so parallel backfills are not coalesced.
- `drizzle/0074_fx_reporting_amount.sql` — `fx_rate_on` (L19-29) — ⚠️ partial — returns the latest rate on or before the date with no maximum age, and the direct pair is COALESCEd before the inverse, so a stale direct row beats a newer inverse one (dev: EUR/INR 2026-09-30 → 110.7675 from 09-14; the inverse gives 108.8139). Manual-first and real-over-fallback ordering on the same date are correct.
- `drizzle/0074_fx_reporting_amount.sql` — `reporting_amount` (L31-37) — ✅ correct — returns NULL when there is no rate, never 1:1. A NULL source currency passes through unchanged, so it silently follows the reporting currency.

**Validation**
- `api/_routes/wealth/accounts/[id].ts` — `account_currency_locked` (L83-91) — ⚠️ partial — counts every row, including the system Opening Balance row written at creation, so any account opened with a balance is locked immediately. Correct as a guard, but it leaves no repair path.
- `src/lib/currencies.ts` — `CURRENCY_LIST` (155 codes) — ⚠️ partial — 125 selectable codes are outside the ECB set (AED AFN … ZWL, including AED SAR KWD QAR BHD OMR PKR LKR BDT NPR EGP NGN KES), so they have no historical rate source.

**API contracts**
- `api/_routes/fx/rate.ts` — `GET /api/fx/rate` — ⚠️ partial — uses `currentRate`, and the GET also writes snapshots. The claim that a manual correction never reaches the TransferWizard suggestion was refuted.

**Other**
- `api/_routes/cron/notifications.ts` — `runNotificationTick` (L24-148) — ❌ missing — the hourly tick (Go worker app.trigger plus the 2-hourly GitHub fallback) already sweeps every org for cards (L114-129) and writes a heartbeat. It has no FX step, so rates refresh only when someone opens a report.
- `.github/workflows/notification-tick.yml` — tick + dead-scheduler alert — ❌ missing — a good place for an FX staleness alert (fail red when `fx_stale_pairs` is non-empty). Today it only watches the notification heartbeat.
- `vercel.json` — (no crons) — — not needed — scheduling belongs to the existing worker/GitHub tick.
- `worker/app/internal/jobs/jobs.go` — (no fx job) — — not needed — the worker only needs to keep POSTing `/api/cron/notifications`. FX logic belongs in the app, next to fx-rates.ts.
- `src/lib/wealth-ledger.ts` — `balanceDelta` / `reversesOnTrash` — ⚠️ partial — `current_balance` is stored. No helper derives the expected balance from the ledger, and no drift audit exists anywhere.

#### Issues in this area

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| critical | Onboarding sets `organizations.currency` but not `reporting_currency`, and the money wizard omits `currency_code`, so a new user who picks INR gets a USD workspace | `api/_routes/onboarding.ts:54` | no |
| medium | A workspace created in the wrong currency has no correct repair path (neither self-serve nor operator) | `api/_routes/wealth/accounts/[id].ts:84` | no |
| medium | Business days fetched before ECB publication are frozen at the previous day's rate forever | `api/_lib/fx-rates.ts:154` | no |
| medium | No scheduled FX refresh: rates exist only for days on which someone opened a report | `api/_lib/fx-rates.ts:278` | yes |
| medium | Non-ECB currencies (125 of 155, including AED/SAR/KWD/QAR/PKR/LKR) have no history source and no manual or derived import | `api/_lib/fx-rates.ts:252` | yes |
| medium | `fx_rate_on` prefers a stale direct row over a newer inverse row and has no age limit | `drizzle/0074_fx_reporting_amount.sql:20` | no |
| medium | Historical backfill runs inside user GETs, one INSERT per day, not coalesced across parallel requests | `api/_lib/fx-rates.ts:263` | no |
| medium | `currentRate` reports a same-day placeholder as today's non-stale rate, then re-asks the provider on every request | `api/_lib/fx-rates.ts:185` | no |
| medium | Admin currency edit writes only the legacy column, so the workspace ends up with two currencies | `api/_routes/admin/organizations.ts:145` | no |
| medium | Admin org detail and client totals add different currencies together and label them with the org currency | `api/_routes/admin/org-detail.ts:57` | no |
| medium | The excluded-rows notice renders a raw i18n key on 8 screens | `src/components/FxExcludedNotice.tsx:20` | no |
| medium | No ledger-vs-balance audit or recompute tool; 3 of 77 dev accounts have already drifted | `src/lib/wealth-ledger.ts:3` | yes |
| low | Zero FX observability: provider failures, uncovered pairs and per-org excluded rows are invisible | `api/_lib/fx-rates.ts:199` | no |

**Unverified (low):** "The legacy migrate-org-currency.ts script is now destructive" (`scripts/migrate-org-currency.ts:22`); "ECB-pair rows older than about 6 years are excluded forever" (`api/_lib/fx-rates.ts:29`); "ensureRatesForOrg repeats a full-org scan and per-currency queries on every reporting request" (`api/_lib/fx-rates.ts:280`).
**Refuted:** "Manual rate corrections would reach SQL reports but not /wealth or the transfer suggestion" (0/2).

#### Decisions

- **History policy for the 125 non-ECB currencies.** Options:
  - (a) exact derived cross-rates for USD-pegged currencies (AED 3.6725, SAR 3.75, QAR 3.64, BHD 0.376, OMR 0.3845, JOD 0.709) × the ECB USD series;
  - (b) operator-entered manual rates, daily or monthly;
  - (c) a paid historical provider.

  Until this is decided, those rows stay excluded forever.
- **Who may import or correct rates:** a new super-admin-only capability (a manual rate changes every workspace's reports platform-wide), or the grantable `settings` capability?
- **Maximum carry-forward age for `fx_rate_on`** (for example 7 days). Beyond it, a row becomes a visible exclusion instead of a silent conversion at a weeks-old rate. This affects how complete totals look.
- **Balance-drift repair per account:** "ledger wins" (UPDATE `current_balance` to the ledger sum, so the displayed balance changes) or "balance wins" (post a system Balance Adjustment, so the ledger explains the stored number)? Which is the default for unexplained drift such as b06c0468, which has no rows at all?
- **Is a native-currency relabel allowed at all?** It rewrites currency tags, never digits. Operator-only with the owner's written consent, or self-serve within limits (for example an account younger than 30 days with no cross-currency transfers)?
- **Once the hourly FX tick exists, should reporting GETs stop calling `ensureRatesForOrg`?** Read-only is faster but allows up to 1h of staleness; the alternative is to keep it as a best-effort backstop.
- **Production FX provider (STATUS phase 3):** open.er-api's free tier is rate-limited and requires attribution, and Frankfurter has no SLA. Pick the adapter and document `FX_DISABLED` / `FX_FRANKFURTER_HOST` / `FX_OPEN_ER_API_HOST` in CLAUDE.md.
- **Should a healed or corrected historical rate re-evaluate budget_warning/budget_exceeded notifications already sent?** Recommended: no, log only.
- **Where FX health lives in /admin:** extend the Worker panel (smallest change), or add a dedicated /admin/fx page with the manual import form.

#### Existing tests

- `api/_lib/fx-rates.test.ts` — Frankfurter current and series parsing; an unsupported pair (EUR/AED 404) becomes FxUnavailable, never 1; open.er-api current parsing and no history; `convertAmount` decimal rounding. It does not cover `storeSnapshot` conflict handling, `currentRate` freshness or the carry-forward fill.
- `api/_lib/fx-provider.test.ts` — `CachedFxRateProvider`: pair-only requests, TTL caching, historical cache per date, identity pair, rejection of invalid dates and rates.
- `api/_lib/tx-sql.test.ts` — static check that the reporting routes call `ensureRatesForOrg`, `reportingCurrencyFor`, `incomeSumSqlIn`/`expenseSumSqlIn` and `missingRateCountSql`, and that flow uses `accountBalanceInSql`. `admin/org-detail.ts` and `admin/clients.ts` are not in its route list, which is why their raw sums pass.
- `src/lib/multi-currency-migration.test.ts` — static assertions on migrations 0069-0073: currency columns declared, the backfill never rewrites amounts, transfer header/fee/rate provenance, the row-lock completion function. Nothing covers 0070's conflict behaviour or 0074's `fx_rate_on` precedence.
- `src/lib/wealth-ledger.test.ts` — `balanceDelta`/`reverseDelta` signs, system rows not reversed on trash, per-account reversal and application sums. No expected-balance or drift helper exists to test.
- `src/lib/money.test.ts` — decimal Money/FX primitives: adding different currencies fails, rate normalization.
- `e2e/multi-currency.spec.ts` — an account keeps its native currency; consolidated wealth converts without touching native balances; a cross-currency transfer keeps both amounts, the rate and the fee; reversal; a scheduled transfer moves no money; the wealth screen shows native plus approximate values. There is no case for stale/placeholder rates, the excluded notice, manual rates or the onboarding currency.
- `e2e/auth.setup.ts` — onboards the e2e business org through `POST /api/onboarding` with currency `'USD'` (L163-166). Because it uses USD, it hides the onboarding `reporting_currency` bug.
- `src/lib/currencies.test.ts` — `CURRENCY_LIST` integrity (codes, symbol map). It says nothing about which codes have a rate source.


### 3.20 Deterministic test harness & cross-feature e2e matrix

**Readiness:** partial

All multi-currency e2e coverage sits in one spec, `e2e/multi-currency.spec.ts`. It has 6 tests, runs in the e2e user's personal workspace and uses live Frankfurter/open.er-api rates. Because the rates move, every assertion is relational, and test 2 fails whenever a provider is down (line 228). The spec's durable fixtures also leak. A read-only check of the dev DB found 8 `e2e-ux4-mc` wallets (6 archived) and 26 transfers, including 4 reversal chains. As a result the reversal test only runs its 409 branch and never checks the balances again.

A deterministic harness is cheap because the pieces already exist. `FX_DISABLED=1` (`api/_lib/fx-rates.ts:134`) turns off provider calls, and `fx_rate_on` (0074) prefers `manual` snapshots over `market` ones for the same day. The harness needs two things:
- **A throwaway workspace per run.** It is a business workspace reporting in EUR, with an INR bank and EUR/USD/JPY/KWD cash wallets. A later MNT wallet never gets a rate. `afterAll` deletes the workspace, and the org FKs cascade.
- **Fixed rates, seeded by guarded SQL.** The seed writes into the global `fx_rate_snapshots` table on the dedicated E2E branch only. A `/api/fx/rate` preflight proves the seed is in use. `page.route` cannot stub the provider calls because they run on the server.

With fixed rates every figure is exact: net worth €2,985.50, P&L €300.00/€87.00, a Food budget at €70.00 of €100.00, and ₹2,38,840.00 after switching to INR. Run today, that matrix would fail on 14 product bugs confirmed in code. They include:
- the raw `fx.excludedNotice` key on 8 screens
- card screens and credit-card creation ignoring the native currency
- budgets never storing `currency_code`
- raw cross-currency sums on the debts hub and the Cards strip
- Dashboard/Wealth painting a raw sum before `/api/wealth/summary` answers
- the 3rd KWD decimal being rounded silently

The unit gate stays DB-free. Pure formatting, reporting-field, Money, debt-grouping, cache-policy and static-scan tests go in `src/lib/*.test.ts` / `api/_lib/*.test.ts`. Anything that runs `fx_rate_on` or `reporting_amount` belongs in e2e/API tests or throwaway SQL against the dedicated branch.

#### What changes / what is affected

**Schema**
- `drizzle/0070_fx_rate_snapshots.sql` — `fx_rate_snapshots_observation_unique` — ✅ correct — Unique on (base, quote, rate_date, provider, source_type), so the seed can upsert with provider `e2e-fixed` (`ON CONFLICT DO UPDATE SET rate, fetched_at=now()`). The table is global, not org-scoped.

**Writes**
- `api/_routes/organizations/[id].ts` — PATCH currency (72-79) — ✅ correct — Updates only `currency` + `reporting_currency` and leaves native rows alone. This is where the switch scenario starts.
- `api/_routes/organizations.ts` — POST (71-114) — ✅ correct — Accepts `{name, currency}`, so the API can create a per-run business workspace that reports in EUR (free plan: 1 bank, 1 credit card, 30 tx/client, unlimited cash wallets).
- `api/_routes/cards.ts` — POST credit → `createWealthAccount` (124-136) — ❌ missing — Passes no `currency_code`, so the liability account always gets the reporting currency.
- `api/_lib/card-autopay.ts` — `createTransfer` call (136-140) — ❌ missing — Passes only the amount, so autopay from a bank in another currency always fails with `invalid_transfer_amounts`. Card create/PATCH has no currency guard.
- `api/_routes/spending-budgets.ts` — POST insert (89-104) — ❌ missing — Never writes `currency_code`, and the `/api/budgets` personal shim (`api/_routes/budgets.ts:114-116`) doesn't either. `budgetCurrency()` (`api/_lib/spending-budgets.ts:112`) then falls back to the reporting currency at read time.

**Aggregates**
- `api/_lib/wealth-summary.ts` — `buildWealthSummary` — ✅ correct — What the exact net-worth, `by_currency`, `complete`, `excluded_currencies`, `stale` and `as_of` assertions check.
- `src/components/wealth/use-consolidated-wealth.ts` — `availableFromSummary` / `liquidFromSummary` / `savedFromSummary` — ✅ correct — Pure and correct, but untested. They can get DB-free unit tests that use a fixture summary.
- `src/lib/reporting-fields.ts` — `reportingAmountOf` / `sumInReporting` / `rowCurrency` — ⚠️ partial — The logic looks right, but there is no unit test.
- `api/_lib/recurring-query.ts` — `ruleStatsFields.postedTotal` (79-82) — ⚠️ partial — `sum(t.amount)` over a rule's rows. A rule can move to another account, and PATCH re-snapshots `currency_code`, so the total can mix currencies.
- `src/lib/debt-status.ts` — `monthObligations` (97-105) / `requiredMonthly` (164-165) — ❌ missing — Adds `paymentAmount` across debts in any currency. `api/_lib/debts.ts:264` labels the result with `orgCurrency`, and `totalRepaid` (:257) is a raw SQL sum of principal.
- `api/_routes/transactions/[id].ts` — GET split-group aggregate (74-83) — ❌ missing — Sums `amount` across legs in different accounts and currencies. The list route does this correctly at `transactions.ts:109`.
- `api/_routes/admin/org-detail.ts` — totals subqueries (58, 63) — ❌ missing — The admin console sums `t.amount` raw across all of an org's currencies.

**Displays**
- `src/lib/wealth.ts` — `formatMoney` / `formatApprox` / `formatRate` / `accountCurrency` (122-177) — ✅ correct — Correct minor units (¥20,000, KWD 10.125, ₹1,00,000.00 under English). No `wealth.test.ts` pins them.
- `src/pages/Dashboard.tsx` — total/liabilities/cardsOwed fallback (576-588) — ⚠️ partial — Shows the browser's raw sum (`useWealthSummary`, `cards.reduce`) until `/api/wealth/summary` answers, and keeps it if that request fails.
- `src/pages/WealthPage.tsx` — local fallback (309-331) — ⚠️ partial — Has the same raw-sum fallback for available, net worth and assets.
- `src/pages/TransactionsPage.tsx` — `fmt` (102) — ⚠️ partial — Uses the row's currency, which is right, but forces `minimumFractionDigits` 2. So this page shows ¥1,000.50 while the wealth tile's `formatMoney` shows ¥1,001.
- `src/components/FxExcludedNotice.tsx` — `t('fx.excludedNotice')` (20) — ❌ missing — The key is in no locale file, so 8 screens render the literal `fx.excludedNotice`. `data-testid="fx-excluded"` is a good e2e hook.
- `src/components/cards/CardsSummaryStrip.tsx` — `stats` useMemo (68-89), `money` (66) — ❌ missing — Sums owed and available across credit cards whatever their currency, then formats with the org currency. The Card payload has no account currency.
- `src/pages/CardDetailPage.tsx` — `fmt` (78, 110) — ❌ missing — Formats every card figure with `useCurrency()`.
- `src/components/budget/BudgetRow.tsx` — `money` (79-80) — ❌ missing — Uses the org currency instead of `budget.currency`. The same happens in `BudgetList.tsx:150`, `BudgetDetailPage.tsx:54-59`, `BudgetsCard.tsx:56-63` and `BudgetAnalyticsPanel.tsx:41-42`.
- `src/pages/RecurringPage.tsx` — rule amount (223) — ❌ missing — Calls `formatMoney(rule.amount, org currency)`. The same happens in `RecurringDetailPage.tsx:64/306`.

**FX**
- `api/_lib/fx-rates.ts` — `networkDisabled` (134) — ✅ correct — `FX_DISABLED=1|true` skips every provider call in `currentRate` and `ensureHistoricalRates`. It is the right e2e knob, but it is undocumented and unused.
- `api/_lib/fx-rates.ts` — `currentRate` (173-216) — ⚠️ partial — The fresh path reads only `source_type='market'` rows for today with `fetched_at` under 12 h (182-186). The stale fallback orders only by `rate_date`, so it picks arbitrarily among same-date rows and does not prefer `manual`, unlike `fx_rate_on`. The seed therefore has to write a `market` row for today with the same rate as the `manual` one.
- `api/_lib/fx-rates.ts` — `ensureRatesForOrg` (278-304) — ⚠️ partial — Handles currencies one after another. On a cold server each can wait up to 4 s for history plus 4+4 s for the provider chain, which matters against the 45 s e2e timeout. No caller uses the `uncovered` result. There is no triangulation, so after a switch to INR, USD→INR needs its own series.
- `drizzle/0074_fx_reporting_amount.sql` — `fx_rate_on` (19) / `reporting_amount` (31-36) — ⚠️ partial — `fx_rate_on` prefers manual over market on the same day and carries rates forward (`rate_date <= on`), which makes seeding deterministic. `reporting_amount` always rounds to 2 dp (35), which is wrong when the target is JPY (0 dp) or KWD (3 dp).

**Validation**
- `api/_lib/tx-sql.test.ts` — "every P&L aggregate route uses the shared expressions" (114-155) — ⚠️ partial — The static guard covers only 5 routes. It misses the raw sums at `transactions/[id].ts:80`, `recurring-query.ts:80`, `debts.ts:257` and `admin/org-detail.ts:58/63`.
- `src/lib/money.ts` — `positiveLedgerAmount` (101-107) — ⚠️ partial — Has a hard 2 dp cap, so a KWD transfer of 1.125 is refused while the same amount on a plain transaction is silently rounded.
- `api/_routes/transactions.ts` — POST amount validation (430-431, 479) — ❌ missing — There is no ISO minor-unit validation. `numeric(20,2)` (`src/lib/db/schema.ts:521`) silently rounds a 3 dp KWD amount, and fractional JPY is accepted.

**API contracts**
- `api/_routes/fx/rate.ts` — GET `/api/fx/rate` — ✅ correct — Works as the harness preflight probe: it returns `provider`, `stale` and `rate_date`, or a 404 `no_rate`.

**Other**
- `e2e/multi-currency.spec.ts` — test "consolidated wealth converts without touching native balances" (211-247) — ⚠️ partial — Asserts `s.complete===true` (228), which needs a live provider fetch. The net-worth check is relational (`toBeCloseTo` on the sum of converted balances, raw sum > 1000). Moving rates rule out an exact value.
- `e2e/multi-currency.spec.ts` — test "reversing a transfer puts both native amounts back" (301-333) — ⚠️ partial — Once any reversal exists it only asserts the 409 (313-319). The dev personal workspace already holds 4 reversal transfers, so the balance assertions at 326-327 never run.
- `e2e/multi-currency.spec.ts` — `usePersonal` / `ensureWallet` / `purgeWalletRows` (82-161) — ⚠️ partial — Keeps durable wallets in the real personal workspace and never calls `restoreWorkspace`, which breaks the rule at `helpers.ts:81-82`. Test 6 (375) depends on test 5 having switched the workspace on the server. Confirmed leftovers on dev: 8 `e2e-ux4-mc` wallets, plus 11 live completed and 6 cancelled transfers.
- `.github/workflows/e2e.yml` — `on` (19-22), job `env` (34-38) — ⚠️ partial — Sets neither `FX_DISABLED` nor `E2E_FX_SEED`. It runs only on PRs into `main` and on manual dispatch, so multi-currency PRs into `dev` never run e2e.
- `src/lib/api-cache.ts` — FANOUT organizations rule (291) — ⚠️ partial — `PATCH /api/organizations/:id` drops only identity reads. Money reads stay fresh for 15 s, and the org list is persisted to L2 (`ps_apic1:*`). UI tests that switch currency through the API must clear `ps_apic1:*` and reload.
- `e2e/helpers.ts` — (missing) mc fixture / FX seed / preflight — ❌ missing — Has only `ensureBank` and the workspace-switch helpers. It needs `createMcWorkspace()`, a guarded `seedFxRates()`, `fxPreflight()`, `deleteMcWorkspace()`, and a sweep of `mc-*` orgs in `auth.setup.ts`.
- `playwright.config.ts` — `webServer[0].env` (79), `reuseExistingServer` (73) — ❌ missing — Sets only `VITE_DISABLE_DEV_TOOLS`. Without `FX_DISABLED` the dev server fetches live rates. A reused local :5173 server can't be given the flag, which is why a preflight probe is needed.
- `e2e/auth.setup.ts` — `sweepLeftoverE2eData` (119-147) — ❌ missing — Sweeps only prefixed clients in the business org. A per-run fixture org also needs a sweep of `e2e-mc-*` orgs left by crashed runs (`DELETE /api/organizations/:id` cascades).

#### Issues in this area

"Known-deferred" means the issue is already on the deferred list.

| Severity | Title | File:line | Known-deferred? |
|---|---|---|---|
| High | Card screen formats every figure in the workspace currency | `src/pages/CardDetailPage.tsx:110` | Yes |
| High | Credit card created via `/api/cards` always gets the reporting currency | `api/_routes/cards.ts:124` | Yes |
| High | Cards strip adds owed/available across currencies | `src/components/cards/CardsSummaryStrip.tsx:71` | Yes |
| High | Budgets are created without `currency_code`, so a reporting switch reinterprets the limit | `api/_routes/spending-budgets.ts:90` | Yes |
| High | KWD 3-decimal amounts silently rounded on create, refused on transfer (raised from medium) | `src/lib/db/schema.ts:521` | Yes |
| High | Debts hub monthly totals add instalments across currencies | `src/lib/debt-status.ts:165` | No |
| High | Dashboard and Wealth show a raw cross-currency sum until `/api/wealth/summary` answers | `src/pages/Dashboard.tsx:583` | No |
| Medium | Budget rows/detail/cards label figures with the org currency, not the budget's currency | `src/components/budget/BudgetRow.tsx:80` | Yes |
| Medium | `fx.excludedNotice` key missing from every locale, so 8 screens show the raw key | `src/components/FxExcludedNotice.tsx:20` | No |
| Medium | Recurring list/detail format rule amounts with the org currency | `src/pages/RecurringPage.tsx:223` | No |
| Medium | Recurring `posted_total` sums rows across currencies after the rule's account changes | `api/_lib/recurring-query.ts:80` | No |
| Medium | GET `/api/transactions/:id` sums split legs across currencies | `api/_routes/transactions/[id].ts:80` | No |
| Medium | Card autopay from a bank in another currency can never pay | `api/_lib/card-autopay.ts:136` | No |
| Medium | Reporting-currency change does not invalidate money reads | `src/lib/api-cache.ts:291` | No |
| Medium | Durable personal-workspace fixtures pile up and the reversal test stops testing | `e2e/multi-currency.spec.ts:313` | No |
| Medium | Unsafe-sum static guard covers only 5 routes | `api/_lib/tx-sql.test.ts:118` | No |
| Low | Multi-currency e2e depends on live FX providers (lowered from medium; 1/2 votes) | `e2e/multi-currency.spec.ts:228` | No |

**Unverified (low):**
- JPY accepts fractional amounts; `reporting_amount` and `/transactions` force 2 dp (known-deferred)
- Fee assertion depends on the reporting currency's magnitude
- Spec leaks the personal workspace to later specs
- `currentRate` ignores the manual-over-market precedence that `fx_rate_on` applies
- E2E never runs for PRs into dev
- Admin org detail sums transactions across currencies

**Refuted:** none.

#### Decisions

- **Where FX seeding may run.** `fx_rate_snapshots` is global, and `manual` beats `market` on the same day. Seeding the shared dev DB, which `playwright.config.ts` loads from `.env.local`, would change every developer's reports. Proposal: seed only when `E2E_FX_SEED=1`, which is set only in `e2e.yml` against `E2E_DATABASE_URL`. Locally, the exact-value specs skip unless the developer points `DATABASE_URL` at a personal Neon branch.
- **Fixture workspace.** Choose between a throwaway business org per run (EUR reporting, deleted in `afterAll`) and the current durable wallets in the personal workspace. Proposal: throwaway. Deleting the org cascades transfers and reversal chains, quotas start fresh each run, and the personal workspace stays clean.
- **Minor-unit policy for JPY (0 dp) and KWD/BHD/OMR (3 dp).** Either widen `numeric(20,2)` and validate per ISO minor units, or refuse amounts with more than 2 dp with a clear 400 until then. Also decide whether `reporting_amount` rounds to the target currency's minor units. The expected values in the precision tests depend on this.
- **Budget currency on a reporting switch.** Either keep the authored currency (write `currency_code` at create and convert spend into it; the fixture expects "EUR 70.00 of 100.00" to survive EUR→INR), or follow the reporting currency and convert the limit too.
- **Mixed-currency list totals.** This covers the Cards strip owed/available, the debts hub `month.required`/paid/overdue/`totalRepaid`, recurring monthly totals, a rule's `posted_total` and the split-group detail. Should each show grouped native totals, or a converted total with an excluded note? The expected e2e strings depend on this.
- **Credit-card currency.** Should a card follow its linked/issuer bank, or get an explicit picker in `AddCardWizard`? And is cross-currency autopay refused outright, or supported at the rate on completion?
- **Staleness.** Should a single stale foreign rate mark the whole consolidated summary stale? The fixture deliberately leaves JPY without today's market rate, so `summary.stale=true` and `as_of` is today−1.
- **Cache.** Is a reporting-currency change a full cache purge event, like `/api/organizations/switch`?
- **Triangulation.** After a switch to INR, `fx_rate_on` only knows direct and inverse pairs. Should USD→INR be triangulated through EUR, or excluded until its series is fetched?
- **CI scope.** Should the multi-currency e2e project also run on PRs into `dev`, not only into `main`?

#### Existing tests

- `src/lib/money.test.ts` — Money invariants:
  - normalizes and rejects currency codes; Decimal arithmetic
  - adding or comparing mixed currencies throws; conversion must be explicit; rate direction
  - `transferAmounts`: both native amounts, destination-per-source rate, fee kept outside FX, more than 2 dp rejected
  - a reversal swaps the native amounts and refunds the fee
- `src/lib/multi-currency-migration.test.ts` — Static checks of migrations 0069-0073:
  - currency columns are declared, and the backfill doesn't rewrite amounts
  - backfill goes account-first; multiple cash wallets are allowed
  - `transfer_id` links, fee/rate provenance, and a row-locked completion function
- `api/_lib/fx-provider.test.ts` — `CachedFxRateProvider`: normalized pairs only, TTL cache, historical cache per date, identity pairs without a call, invalid dates and non-positive rates rejected.
- `api/_lib/fx-rates.test.ts` — Frankfurter/open.er-api parsing with a stubbed fetch; an unsupported pair raises `FxUnavailable` and never returns 1; series parsing; `convertAmount` rounding (75000 × 0.00902 = 676.5).
- `api/_lib/tx-sql.test.ts` — Reporting-currency SQL twins:
  - they render `reporting_amount(amount, currency_code, date, target)`, subtract refunds and exclude transfers
  - `missingRateCountSql`; `accountBalanceInSql` uses `current_date`
  - a static guard for the analytics, calendar, flow, transactions and clients routes
- `api/_lib/budget-spend.test.ts` — Budget spend converts into each budget's currency via `reporting_amount` and flags rows with no rate as excluded. v1 client caps convert to the reporting currency. System rows are excluded.
- `src/lib/debt-recurring.test.ts` — `linkRefusal` returns `currency_mismatch` for a EUR rule paying a USD debt (case-insensitive).
- `src/lib/debt-status.test.ts` — `owedByCurrency` groups INR separately from EUR. `monthObligations`/`requiredMonthly` are only tested with EUR-only debts, so the raw mixed-currency sum is not pinned.
- `src/lib/alerts.test.ts` — Shortfall, card and recurring alerts carry the account's native currency (INR on an INR account in a EUR workspace).
- `src/lib/currencies.test.ts` — Country→currency mapping and detection; every mapped code exists in `CURRENCY_LIST`.
- `e2e/multi-currency.spec.ts` — Live FX, personal workspace:
  - EUR/INR wallets keep their `currency_code`
  - the summary has `multi_currency` and `by_currency`, with net worth converted
  - a cross-currency transfer with a fee: both legs, the 102.70 rate, and the fee as the only expense
  - one reversal
  - planned and cancelled transfers move no money
  - `/wealth` tiles show ₹/€, ≈ and "By currency"
- `e2e/debts.spec.ts` — Lines 389-399: a net-worth check that counts only debts in the workspace currency (single-currency data).

## 4. Issues (deduplicated)

### 🔴 critical (5)

#### MC-001 — Onboarding saves the chosen currency only to `organizations.currency`, so new workspaces report in USD and their accounts are tagged USD
- **Areas:** Schema & migrations, Org, billing & admin, API, cache, i18n & native, Rollout & back-compat, FX ops tooling, AI & imports
- **Where:** `api/_routes/onboarding.ts:54`, `api/_routes/onboarding.ts:71`, `api/_lib/auth.ts:109`, `api/_routes/organizations.ts:53`, `api/_lib/ai.ts:167`
- **Scenario:** A new user in India signs up. The first `GET /api/profile` creates the personal org with `currency = reporting_currency = 'USD'` (the profile default). At /onboarding they pick INR and enter Cash 5,000 and a bank at 25,000. `POST /api/onboarding` sets only `organizations.currency='INR'` (L54, and L71 on the existing-business path), so `GET /api/organizations` still returns `coalesce(reporting_currency, currency) = 'USD'`. Cash in Hand and the bank are created as USD 5,000 and USD 25,000, and the whole app shows $. Once the accounts have rows, their currency is locked. The AI prompt and quotation PDFs read the legacy column and say INR, so they disagree with the UI. A factory reset followed by onboarding hits the same path.
- **Fix:** Write `currency` and `reporting_currency` together at L54 and L71, through one `setOrgCurrency(orgId, code)` helper. Use the same helper in `organizations/[id].ts:77-78` and in the admin PATCH. Send `currency_code` from MoneyWizard's account POSTs. Relabel an auto-provisioned Cash in Hand that has no rows. Add an API/e2e test that onboards with INR. Before deploy, audit `organizations where reporting_currency is distinct from currency`, then repair with an additive 0077 once prod data shows which column holds the user's intent.

#### MC-002 — `DELETE /api/transactions/:id` reverses the balance again for a row that is already trashed, and PATCH moves the live balance of a trashed row
- **Areas:** Concurrency & invariants
- **Where:** `api/_routes/transactions/[id].ts:229`, `api/_routes/transactions/[id].ts:25`, `api/_routes/transactions/[id].ts:103`
- **Scenario:** Cash is at 1,000. Add an expense of 10 (balance 990), then DELETE it twice, from a stale tab or a replayed request. The `before` lookup has no `deleted_at` filter, so both calls return 204 and both reverse the row: the balance ends at 1,010. This already happened on the dev DB: the e2e cleanup DELETEs a transfer's fee row after `set_transfer_trashed` has refunded it, and wallet bed91dd1 is now +20.00 off its ledger (4 fees × 5). PATCHing a trashed expense from 10 to 15 moves the live balance by −5, and restoring it later applies −15.
- **Fix:** Add `isNull(transactions.deletedAt)` to the PATCH/DELETE `before` lookup and to the ownership query, and return 404 for a row that is already trashed. Make trash claim-first and atomic: one CTE flips `deleted_at ... WHERE deleted_at IS NULL RETURNING ...` and applies the balance shift only for the rows it returned.

#### MC-003 — Transfer fee rows escape the transfer guards (they check `kind==='transfer'`, not `transfer_id`), so a fee can be edited, trashed or tag-deleted on its own, and Reverse then refunds it a second time
- **Areas:** Schema & migrations, Wealth & Spaces, Transactions, Concurrency & invariants, Rollout & back-compat, Cascade soft-delete
- **Where:** `api/_routes/transactions/[id].ts:232`, `api/_routes/transactions/[id].ts:106`, `api/_lib/tag-ops.ts:109`, `api/_routes/transactions/bulk-delete.ts:41`, `api/_routes/trash/restore.ts:31`, `api/_lib/wealth-accounts.ts:461`
- **Scenario:** An EUR bank holds €1,000. Transfer €500 → ₹51,350 with a €5 source fee: the bank drops to €495, and the fee row has kind 'standard', `transfer_id` set and `group_id` NULL. Delete the 'Transfer fee' row on /transactions. DELETE takes the ordinary path and puts €5 back (€500), while `transfers.source_fee_amount` still says 5. Then reverse the transfer. `reversalTransferAmounts` refunds the header's €5 fee again, and the bank ends at €1,005 instead of €1,000. Bulk-delete and tag 'delete with records' on a tagged fee do the same. PATCH can also change the fee's amount, account or type while the header still says 5.00.
- **Fix:** Treat every row with `transfer_id` as owned by its transfer: key the PATCH, DELETE, bulk-delete and restore guards on `transferId != null`. A fee DELETE or restore goes through `setTransferTrashed` and acts on the whole transfer. A fee PATCH may change only description, category and tags; anything else returns 409 `transfer_mutation_requires_transfer_service`. As a second guard, have `reverseTransfer` compute the fee refund from the live fee row instead of the header. Decide in tag-ops whether deleting a tagged fee takes its transfer with it.

#### MC-004 — `reverseTransfer` never checks `deleted_at`, so a trashed or partly trashed transfer can be reversed and its money moves back twice
- **Areas:** Schema & migrations, Wealth & Spaces, Concurrency & invariants, Cascade soft-delete
- **Where:** `api/_lib/wealth-accounts.ts:583`, `api/_lib/wealth-accounts.ts:584`, `api/_lib/wealth-accounts.ts:586`, `src/components/TransactionDetailModal.tsx:88`
- **Scenario:** EUR wallet A holds €1,000 and INR wallet B holds ₹0. Transfer €500 → ₹51,350, leaving A at €500 and B at ₹51,350. Trash it: `set_transfer_trashed` restores A to €1,000 and B to ₹0. A stale TransactionDetailModal in another tab, or a direct API call, then sends `POST /api/wealth/transfers/:id/reverse`. Only the status and an existing reversal are checked, so it posts B→A: A = €1,500 and B = −₹51,350. The original is now reversal-linked, so it can never be restored, and the reversal can't be trashed. The same happens when only one leg was tag-trashed (INR ends ₹9,000 short) and with the 9 dev-DB headers that are trashed with 0 legs.
- **Fix:** In `reverseTransfer`, return 409 (`transfer_trashed` / `transfer_rows_trashed`) when `original.deletedAt` is set or when any row with `transfer_id = original.id` is trashed. Re-check inside the batch, for example with a DB function that locks the transfer row as `complete_transfer` does, so a concurrent trash can't race it. Hide Reverse for a trashed leg, and show the error code in TransactionDetailModal.

#### MC-005 — Referral balances add rewards across currencies and take their label from the programme settings, so payouts are requested in the wrong amount and currency
- **Areas:** Org, billing & admin
- **Where:** `api/_lib/referral.ts:160`, `api/_lib/referral.ts:182`, `api/_routes/admin/referral-settings.ts:33`, `api/_routes/referrals/payouts.ts:31`, `api/_routes/referrals/payouts.ts:45`
- **Scenario:** A programme pays 25%. A referrer earns INR 249.75 from an Indian org (billed in INR) and USD 2.50 from a US org. `computeStats` sums `reward_amount` without regard to currency and labels the total with `settings.rewardCurrency='USD'`, so /referrals shows 'Available $252.25'. `POST /api/referrals/payouts {amount: 252.25}` passes its check and saves a USD 252.25 payout, while about USD 5.50 is actually owed: approving it pays about 46× too much. If an admin later changes Reward currency to EUR, the same balance is relabelled in EUR and new payout requests are saved in EUR.
- **Fix:** Group lifetime, eligible and outstanding balances by `referrals.reward_currency` and return one balance per currency. A payout request carries a currency and is checked against that currency's available amount. Never take a balance's currency from settings: `settings.rewardCurrency` should apply only to future fixed rewards. The alternative is to convert each reward into the programme currency when it is credited, and store the converted amount.

### 🟠 high (31)

#### MC-006 — Wealth and Dashboard heroes show an unconverted cross-currency sum until `/api/wealth/summary` answers, and keep it if the summary fails
- **Areas:** Wealth & Spaces, Reports, UI formatting, API, cache, i18n & native, Test harness, Debts
- **Where:** `src/pages/WealthPage.tsx:309`, `src/pages/WealthPage.tsx:318`, `src/pages/WealthPage.tsx:326`, `src/pages/Dashboard.tsx:580`, `src/pages/Dashboard.tsx:582`, `src/pages/Dashboard.tsx:583`, `src/pages/Dashboard.tsx:587`
- **Scenario:** A USD workspace holds EUR cash 1,000 and INR cash 75,000. Money is never persisted, so every launch is a cold load. The Dashboard starts the summary request only after the accounts load (`useConsolidatedWealth(!loading)`, L580). For the whole summary round trip, the Wealth card shows summarizeWealth's unconverted total, '$76,000', with a health dot, then jumps to about $1,99x. If the summary errors or times out (see the FX backfill item), the wrong figure stays. Net worth on /wealth also drops foreign debts without an 'excludes USD' note.
- **Fix:** When active accounts span more than one `currency_code` and no summary is available, show a skeleton or per-currency native totals (`formatByCurrency`), never summarizeWealth's total. On a summary error, show per-currency totals and an FxExcludedNotice for foreign debts. Keep the local total only for single-currency workspaces, in a pure helper with a unit test. Start the Dashboard summary request in parallel with the accounts request once the summary route materialises due recurring rows itself (see the summary-race item).

#### MC-007 — Dashboard KPIs, chart and breakdown count opening balances, balance adjustments and refunds as income
- **Areas:** Reports
- **Where:** `src/pages/Dashboard.tsx:1072`
- **Scenario:** The e2e personal org (USD) has three system incoming rows: a Balance Adjustment of $1,000, an Opening Balance of €1,000 ($1,159.20) and one of ₹75,000 ($784.50). Its only P&L rows are a €5 and a $1 expense. The Dashboard shows 'Total revenue' of about $2,943.70 and 'Net profit' of about $2,936.90. /analytics shows income $0 and expenses $6.80 for the same data. A refund (kind=refund) is also counted as income instead of as a negative expense.
- **Fix:** Classify rows with `src/lib/tx-classify.ts` (`isIncomeLeg` / `expenseContribution` skip `is_system` rows and treat a refund as a negative expense) combined with `reportingAmountOf`, in one pure helper with a unit test. Alternatively, read the totals from the server's `/api/transactions` summary once that summary excludes system rows.

#### MC-008 — The /transactions summary counts system Opening Balance and Balance Adjustment rows (including debt opening rows) as income and expense
- **Areas:** Transactions
- **Where:** `api/_routes/transactions.ts:319`
- **Scenario:** `summaryWhere` (L319-334) applies `pnlKindFilter` but has no `is_system = false`, unlike analytics.ts:58, calendar.ts:62 and flow.ts:111. On the dev DB, org 920a6c5f (USD, with EUR/INR/USD cash wallets that have opening balances) shows Income $2,943.70 where real income is $0.00. Org fee4eb71 (EUR) shows Expenses €19,846 against €1,846 real, because €17,000 comes from a loan's system opening row.
- **Fix:** Add `eq(transactions.isSystem, false)` to `summaryWhere`. Decide whether system rows should be listed at all, and badge them if they are. Add a tx-sql-style render test that the summary query filters `is_system = false`.

#### MC-009 — Account page Income, Expenses and Net show reporting-currency totals with the account's own currency symbol, and rows without a rate silently count as 0
- **Areas:** Wealth & Spaces, Transactions, UI formatting, Rollout & back-compat
- **Where:** `src/pages/WealthAccountDetailPage.tsx:241`, `src/pages/WealthAccountDetailPage.tsx:383`, `src/pages/WealthAccountDetailPage.tsx:116`, `api/_routes/transactions.ts:361`
- **Scenario:** Verified in the UI: /wealth/<IDFC NRO> is an INR account holding a ₹20,000 row in a EUR workspace, and it shows 'INCOME ₹180.60 / NET ₹180.60'. The server's summary for `?wealthAccountId=` is converted to the reporting currency (€180.60), but the page formats it with `fmt = formatMoney(n, accountCur)`. A foreign account with no stored rate shows ₹0.00 and no notice. The `?cardId=` scope has the same mismatch.
- **Fix:** For lists scoped to one account or card, return the summary in native currency, with `currency` set to the account's `currency_code`. Plain sums are safe inside one account, and an account page should show every figure natively. The alternative is to format with `summary.currency`, mark the figures ≈, and render FxExcludedNotice when `excluded_count > 0`. Add an API test for the account-scoped summary.

#### MC-010 — Transaction PATCH has no guard on account type or system rows: rows can be moved onto Spaces or debts, and a loan's system Opening Balance can be moved off the loan
- **Areas:** Transactions
- **Where:** `api/_routes/transactions/[id].ts:157`
- **Scenario:** POST and group refuse space, loan and receivable targets, but PATCH does not. The loan's system 'Opening Balance' row (an outgoing €17,000 in dev org fee4eb71, with `group_id` NULL so `touchesDebtAccount` is skipped) appears on /transactions as an expense. Edit it, pick Cash and Save: the row moves, the loan balance rises by €17,000 (the debt disappears) and Cash drops by €17,000, bypassing the debt engine.
- **Fix:** In PATCH, reject target accounts of type space, loan or receivable. Refuse edits of rows whose current account is a loan or receivable, or whose `is_system` is true, and point the user to the debt or account page instead. Consider hiding debt-account rows from the global list.

#### MC-011 — The account currency lock counts only transaction rows, so an empty account's currency can change under a recurring rule, Space auto-save, debt repayment or card autopay that still points at it
- **Areas:** Schema & migrations, Wealth & Spaces, Recurring, Cards, Debts, Alerts & notifications, Concurrency & invariants, Refusal UX & i18n
- **Where:** `api/_routes/wealth/accounts/[id].ts:83`, `api/_routes/wealth/accounts/[id].ts:84`, `api/_routes/wealth/accounts/[id].ts:85`, `api/_lib/recurring-materialize.ts:199`
- **Scenario:** Create an empty EUR bank (0 rows) and a monthly €50 expense rule on it starting next month (the rule's `currency_code` is EUR). Change the bank's currency to USD: this is allowed, because L83-91 count only transactions. On the due date recurring-materialize inserts 50 with `currency_code` 'EUR' on the USD account and moves the USD balance by −50. Reports convert that row as EUR, and the dashboard Recurring card disagrees with the alerts rail. The same gap breaks a debt repayment rule, which then fails with currency_mismatch ('This debt is in EUR — pay it from an account in EUR'). It also makes a relabelled card funder's autopay cross-currency, so autopay never pays.
- **Fix:** Extend the lock to return 409 `account_currency_locked` when the account is referenced by an active recurring rule (`wealth_account_id`, `to_account_id`, `debt_account_id`), by a card (`account_id`, `funding_account_id`) or by a planned or pending transfer, or when it pays a debt. Put this in one pure predicate that the picker also uses, like `linkRefusal`. As a second guard in the materializer, select the account's currency and call `setRuleError` and skip when `rule.currencyCode` differs from `account.currencyCode`.

#### MC-012 — Trash purge follows `group_id` only, leaving the transfer's fee row and header behind; purging one leg leaves a live header
- **Areas:** Schema & migrations, Transactions, Concurrency & invariants, Cascade soft-delete
- **Where:** `api/_routes/trash/purge.ts:33`, `api/_routes/trash/purge.ts:34`, `api/_routes/trash/purge.ts:39`
- **Scenario:** Trash a transfer that has a €5 fee, then use 'Delete forever' on one principal leg in /trash. Both legs are deleted because they share a `group_id`, but the fee row (`group_id` NULL, `transfer_id` set) stays in Trash, and the header stays trashed but linked. Restoring the fee takes the ordinary path and debits €5 again for a transfer that no longer exists. Purging a single tag-trashed leg instead leaves a live 'completed' header with only the out-leg and the fee: money that left one account and never arrived in the other. The dev DB already has 9 trashed headers with no rows.
- **Fix:** When a purged row has a `transfer_id`, delete every transactions row with that `transfer_id`, and the header, in the same statement. Refuse a single-leg purge while the header is live (409 `transfer_not_trashed`). Also give fee rows the transfer's `group_id` when they are inserted (wealth-accounts.ts:461 and :479).

#### MC-013 — Tag 'delete with records' trashes individual transfer legs directly, bypassing the transfer service: one-sided trash, stuck restores and unrestorable reversals
- **Areas:** Cascade soft-delete
- **Where:** `api/_lib/tag-ops.ts:105`, `api/_lib/tag-ops.ts:109`, `drizzle/0073_transfer_lifecycle.sql:121`, `api/_routes/trash/restore.ts:35`
- **Scenario:** MC EUR holds €1,000 and MC INR ₹10,000. Transfer €100 → ₹9,000 with a €2 fee, leaving EUR €898 and INR ₹19,000. Tag only the INR leg (PATCHing tags on a leg is allowed) and call `DELETE /api/tags/:id?mode=with_records`. `softDeleteByTag` reverses and trashes that leg alone, while the header and the EUR side stay live: EUR €898, INR ₹10,000, and net worth down about €102. Restoring the leg returns 409 `invalid_transfer_trash_state`, shown as a generic 'Couldn't restore'. If the leg belonged to a reversed transfer, it can never be restored. This is reachable through the API today; no UI edits tags on a leg.
- **Fix:** Pass tagged ids through `resolveTxLegs` (api/_lib/tx-legs.ts:40), as bulk-delete does. For rows with a `transfer_id`, call `setTransferTrashed(org, user, transferId, false)` instead of raw updates, and surface its refusal: either abort the tag delete, or skip those rows and report them. The same expansion covers debt-repayment groups. To heal existing rows, let `set_transfer_trashed(restore)` accept a live header when some rows are trashed, or run a one-off repair.

#### MC-014 — The recurring rule dialog shows the workspace currency on the amount, the new-debt inputs and the previews, while the rule is saved in the paying account's currency
- **Areas:** Recurring, Debts, UI formatting, Refusal UX & i18n
- **Where:** `src/components/recurring/RecurringRuleDialog.tsx:227`, `src/components/recurring/RecurringRuleDialog.tsx:429`, `src/components/recurring/RecurringRuleDialog.tsx:544`, `src/components/recurring/RecurringRuleDialog.tsx:649`, `src/components/recurring/RecurringRuleDialog.tsx:656`, `src/components/recurring/RecurringRuleDialog.tsx:737`, `src/components/recurring/RecurringRuleDialog.tsx:756`
- **Scenario:** Verified in the UI in a EUR workspace: on /recurring, choose Add, then Pay with 'IDFC NRO ₹20,000.00'. The amount field still shows '€'. The user types 100 meaning €100, and the rule posts ₹100 every month, because the server takes the currency from the account. With 'Create a debt for this', the balance and original inputs and the DebtPreviewCard also show €, but `POST /api/debts` sends currency INR, so a ₹100,000 loan is stored where the user meant €100,000. The per-year preview ('about $144.00 a year') is wrong too, and in Arabic the prefix is pinned left (`left-3`) instead of to the start.
- **Fix:** Derive `ruleCurrency = accountCurrency(selected account ?? card account, currency)`, or use `rule.currency_code` when editing. Use it for the amount symbol, the debt inputs, `DebtPreviewCard` (`linkedDebt?.currency ?? ruleCurrency`) and `formatMoney(schedulePreview.perYear, ruleCurrency)`. Use logical `start-3` / `ps-*` classes for the prefix.

#### MC-015 — Editing a recurring rule with no account after a workspace currency change silently switches the rule's currency
- **Areas:** Recurring
- **Where:** `api/_routes/recurring/[id].ts:187`
- **Scenario:** An INR business workspace has a rule 'Retainer' of 50,000 monthly with no account, so its `currency_code` is INR. The owner switches the workspace currency to USD. Later someone only renames the rule. PATCH calls `currencyForFinancialWrite(orgId, null)`, which returns USD, so the rule becomes USD 50,000 and every future occurrence posts in USD.
- **Fix:** When both `attributed.accountId` and `rule.wealthAccountId` are null, keep `rule.currencyCode`. Fall back to `currencyForFinancialWrite` only when `rule.currencyCode` is NULL. Apply the same rule (keep the stored currency) to every writer that re-stamps rows without an account.

#### MC-016 — AccountQuickAddSheet takes its amount symbol from the calling page's currency, so card-page purchases and rule-page edits on a foreign account are entered behind the wrong symbol
- **Areas:** Recurring, Cards, UI formatting
- **Where:** `src/components/wealth/AccountQuickAddSheet.tsx:75`, `src/pages/CardDetailPage.tsx:609`, `src/pages/RecurringDetailPage.tsx:601`
- **Scenario:** In a EUR workspace, a debit card is linked to the INR bank IDFC NRO. On /wealth/cards/<id>, 'Add purchase' opens the sheet with '€'. The user types 500 meaning €500, the server saves ₹500 in the account's currency, and the bank drops by ₹500 instead of about ₹54,400. Editing a posted payment from /recurring/:id?view= has the same problem. WealthAccountDetailPage passes the account currency and is correct.
- **Fix:** Inside the sheet, derive the symbol from the account: `currencySymbol(accountCurrency(account, currency))`, keeping the prop only as a fallback. Also pass `accountCurrency(ledgerAccount/editAccount, currency)` from CardDetailPage, RecurringDetailPage, WealthAccountDialogs and TransactionDetailModal.

#### MC-017 — The Spaces page and Space detail format every figure in the workspace currency and add Space balances of different currencies
- **Areas:** Wealth & Spaces, UI formatting, API, cache, i18n & native
- **Where:** `src/pages/SpacesPage.tsx:84`, `src/pages/SpacesPage.tsx:170`, `src/pages/SpacesPage.tsx:318`, `src/pages/SpaceDetailPage.tsx:150`, `src/components/spaces/SpaceFormModal.tsx:37`
- **Scenario:** A EUR workspace has a Space 'Trip' holding €1,000 with a €2,000 goal. The owner switches the workspace currency to INR, as users do to 'fix' a wrong currency. The Space stays in EUR, and a new Space 'Car' gets ₹200. /spaces shows 'Total saved ₹1,200.00' (the two balances added as they are), the Trip card reads '₹1,000 / ₹2,000', and /spaces/:id shows balance, goal, suggestion, auto-save and history in ₹. The dashboard SpacesCard handles the same data correctly.
- **Fix:** Reuse the SpacesCard logic: use `savedFromSummary(summary)` when `summary.complete`, otherwise per-currency native totals (`formatByCurrency`). Format tiles, detail and history with `accountCurrency(space, currency)` / `tx.currency_code`, and take SpaceFormModal's symbol from the Space being edited. Separately, decide whether changing the workspace currency should offer 'relabel all accounts' for single-currency workspaces (see the wrong-currency repair item).

#### MC-018 — New spending budgets are saved with `currency_code` NULL and follow the reporting currency, while budgets backfilled by 0069 keep theirs, so a reporting change re-denominates new limits
- **Areas:** Schema & migrations, FX core, Budgets, Org, billing & admin, API, cache, i18n & native, Test harness, Rollout & back-compat · _known deferred_
- **Where:** `api/_routes/spending-budgets.ts:89`, `api/_routes/spending-budgets.ts:90`, `api/_routes/spending-budgets.ts:91`, `api/_routes/budgets.ts:114`, `drizzle/0069_multi_currency_foundation.sql:55`
- **Scenario:** In an INR workspace, after 0069 has run, the user creates 'Overall' at ₹50,000 monthly. It is saved with `currency_code` NULL, as are budgets created through MoneyWizard and the v1 personal shim (budgets.ts:114). The owner switches the workspace to EUR. `budgetCurrency()` now reads the limit as €50,000, while this month's ₹41,000 of spending converts to about €370. The page shows '€370 / €50,000', 0.7% used, with no warning. Budgets created before 0069 stayed in INR, so two budgets entered the same way now mean different amounts of money, and the column can't be made NOT NULL.
- **Fix:** On every `spending_budgets` insert (POST and the v1 personal upsert), store `currencyCode = parent?.currency_code ?? reportingCurrencyFor(org)`, so sub-budgets inherit their parent's currency. Before any reporting change ships, backfill NULLs from `organizations.reporting_currency` in an additive migration. Then decide the policy for budgets on a reporting change (follow it or stay fixed) and apply it to legacy rows too. Add an e2e audit that no fixture budget has a NULL currency.

#### MC-019 — The budget UI formats every figure in the org/reporting currency instead of the budget's own currency (the `budgetCurrency` helper exists but is unused)
- **Areas:** Budgets, UI formatting, Test harness · _known deferred_
- **Where:** `src/components/budget/BudgetRow.tsx:80`, `src/components/budget/BudgetList.tsx:151`, `src/pages/BudgetsPage.tsx:64`, `src/pages/BudgetDetailPage.tsx:59`, `src/components/budget/BudgetsCard.tsx:63`, `src/components/budget/BudgetAnalyticsPanel.tsx:42`
- **Scenario:** 0069 fixed the existing budgets to INR (overall ₹50,000, Groceries ₹10,000). The user switches the workspace to EUR. The API still returns currency 'INR' with INR figures, but BudgetsPage formats with `data.currency` (EUR), and BudgetRow, BudgetList, BudgetDetailPage, BudgetsCard, SpendingBudgetDialog and BudgetAnalyticsPanel use `useCurrency()`. The page shows '€41,000 / €50,000', about 90× too much, and the edit dialog's prefix is €.
- **Fix:** Format each budget with `budgetCurrency(b, data.currency)` from src/components/budget/budget-format.tsx:126, through one `money(n, budget.currency)` helper. Apply it per row in BudgetRow, to the header from `overall.currency`, to the detail page from `detail.currency`, and to the dialog from the edited budget's currency (the reporting currency when creating).

#### MC-020 — Business per-client spending caps (`budgets`, `budget_history`) have no currency, so a reporting change re-denominates every cap and its history
- **Areas:** Budgets, Org, billing & admin
- **Where:** `src/lib/db/schema.ts:1174`, `src/lib/db/schema.ts:1207`, `api/_routes/budgets.ts:56`
- **Scenario:** In a USD business workspace, client Acme has a 1,000/month cap with $200 spent (20%). After switching reporting to INR, `GET /api/budgets` returns currency 'INR', amount 1000 and spent about ₹16,600: 1,660%, exceeded. Switching to EUR instead silently makes the cap €1,000. `budget_history` rows store bare amounts, so ClientBudgetDetailPage shows old dollar values with the new symbol, and `detectCreep` compares $1,000 with a later €60.
- **Fix:** Add a nullable `currency_code` to `budgets` and `budget_history` in an additive migration, backfilled from the org's current currency. Write it on every v1 POST and judge each cap in its own currency through `outgoingByClient(..., capCurrency)`. Alternatively, convert caps at the change date as a separate, audited action.

#### MC-021 — Currencies outside the ECB set (125 of the 155 selectable ones, including AED, SAR, KWD, QAR, PKR and LKR) have no source for historical rates, so their older rows are excluded for good
- **Areas:** FX core, Org, billing & admin, FX ops tooling · _known deferred_
- **Where:** `api/_lib/fx-rates.ts:252`, `api/_lib/fx-rates.ts:104`, `api/_lib/fx-rates.ts:99`
- **Scenario:** An INR-reporting workspace has an AED salary account with AED 10,000 incomes on 2026-06-01, 07-01 and 08-01, and first opens reports on 2026-09-30. Frankfurter returns 404 for AED and open.er-api has no history, so `fx_rate_on('AED','INR', …)` is NULL. /analytics leaves out all three salaries behind an 'excluded' notice that never clears. Setting the reporting currency itself to AED or SAR does the same to every past foreign row, and the picker offers these currencies without a warning.
- **Fix:** Add a history provider that covers non-ECB codes (for example the fawazahmed0 currency-api daily snapshots, or a keyed API), or compute the rate in `fx_rate_on` through EUR/USD, and record where each rate came from (derived or estimated). Add a super-admin `POST /api/admin/fx/rates` import for manual or pegged rates (AED 3.6725, SAR 3.75); it should validate input and require confirmation for more than 20% deviation. Decide whether the reporting-currency dialog warns about, or refuses, currencies without history.

#### MC-022 — Card data carries no account currency, so every card screen formats native amounts in the workspace currency
- **Areas:** Cards, Test harness, UI formatting, Recurring · _known deferred_
- **Where:** `src/pages/CardDetailPage.tsx:110`, `src/pages/CardDetailPage.tsx:376`, `src/pages/CardDetailPage.tsx:380`, `src/pages/CardDetailPage.tsx:507`, `src/pages/CardDetailPage.tsx:568`, `src/components/cards/CardTile.tsx:374`, `src/components/cards/CardFanSheet.tsx:288`, `src/components/cards/CardsSummaryStrip.tsx:70`, `src/components/cards/types.ts:84`
- **Scenario:** In a EUR workspace, a debit card is linked to the INR bank IDFC NRO, which holds ₹20,000. The tile and the phone fan show 'Available €20,000.00'. /wealth/cards/<id> shows 'Available at IDFC NRO: €20,000.00', 'Spent this month €500.00' for a ₹500 purchase, and the row as '−€500.00'. A €9.99 rule on a EUR card in a USD workspace appears under Upcoming as '−$9.99'. If `GET /api/wealth/accounts/:id` fails, PayCardSheet falls back to the workspace currency and sends a cross-currency payment without a destination amount, which fails with 400.
- **Fix:** Add `accountCurrencyCode: wealthAccounts.currencyCode` to `cardFields`/`loadCards` (serialized as `account_currency_code`) and to the Card type, and map it to `currency_code` in `accountFromCard`. Format with `accountCurrency(ledgerAccount/card, currency)` in CardDetailPage (including Upcoming, through `r.currency_code`), CardTile, CardFanSheet, CardActionsMenu, AutopayPanel, CreditCardPanel and AccountQuickAddSheet.

#### MC-023 — The Cards tab summary strip adds owed and available credit across card currencies without converting
- **Areas:** Cards, Test harness · _known deferred_
- **Where:** `src/components/cards/CardsSummaryStrip.tsx:71`, `src/components/cards/CardsSummaryStrip.tsx:74`
- **Scenario:** A EUR workspace has Visa Gold (EUR, limit 2,300, owes 1,000) and an INR card (limit 100,000, owes 50,000). /wealth?tab=cards shows 'Owed €51,000.00 · Available €51,300.00'. At INR→EUR 0.00919, the right figures are about €1,459.50 owed and €1,759.50 available. Even a single INR card on a free plan reads '€5,000.00'.
- **Fix:** Take the owed figure from `useConsolidatedWealth().summary.card_liabilities`, and render FxExcludedNotice when `summary.complete` is false. For available credit, convert per card on the server (add it to the wealth summary), or show per-currency native totals. Extract a pure `cardsStripTotals(cards)` in src/lib that groups by account currency, with a unit test.

#### MC-024 — A credit card's liability account is always created in the reporting currency, whatever the issuing bank's currency, and can never be changed
- **Areas:** Cards, Test harness · _known deferred_
- **Where:** `api/_routes/cards.ts:124`, `api/_lib/wealth-accounts.ts:117`, `src/components/cards/AddCardWizard.tsx:86`
- **Scenario:** In a EUR workspace, add a credit card issued by IDFC NRO (INR) with a limit of 1,00,000 and current debt of 25,000. `POST /api/cards` calls `createWealthAccount` without `currency_code`, so the card is created in EUR and reads '€25,000 used / €75,000 left'. `/api/wealth/summary` then reports `card_liabilities` of €25,000 instead of about €230. Funding also defaults to the INR issuing bank, so autopay can never pay.
- **Fix:** Accept `credit.currency_code` in `POST /api/cards` and in `cardCreatePayload`, defaulting to the issuing or linked bank's `currency_code`, else the reporting currency, and pass it to `createWealthAccount`. Add a CurrencyCombobox to StepCredit and use that currency's symbol for the limit, debt and statement inputs. Allow a card's currency to be corrected while it has no rows.

#### MC-025 — Card autopay can be funded from a bank in another currency (the wizard sets this up by default); it then never pays and retries on every read
- **Areas:** Cards, Alerts & notifications, Concurrency & invariants, Rollout & back-compat, Test harness
- **Where:** `api/_lib/cards.ts:280`, `api/_routes/cards/[id].ts:136`, `api/_routes/cards.ts:154`, `api/_routes/cards.ts:171`, `api/_lib/card-autopay.ts:136`, `api/_lib/card-autopay.ts:153`
- **Scenario:** A USD workspace has an EUR bank. Add a credit card with the EUR bank as issuer. The liability account is created in USD, funding defaults to the EUR bank, and autopay is allowed: neither `resolveFunding` nor the card routes compare currencies. On the due date, `payStatement` calls `createTransfer({amount})` without a destination amount and gets 400 'Destination amount is required for a cross-currency transfer'. It releases the claim and defers again on every sync. Until the due date the rail says 'Autopay has this covered — $500.00'. Afterwards the bell shows the English engine error inside a translated sentence, and the card goes unpaid.
- **Fix:** Return the funding account's currency from `resolveFunding`. In POST and PATCH `/api/cards` and in the wizard, refuse `autopay=true` and the default funding when that currency differs from the liability account's (400 `autopay_currency_mismatch`, like `autopay_liability`). As a second guard in `autopayStatement`, mark the statement failed with a stable reason code before claiming it. Include `cards.funding_account_id` in the account currency lock.

#### MC-026 — The alerts shortfall projection subtracts an autopay amount in the card's currency from a funding account in another currency
- **Areas:** Cards, Alerts & notifications
- **Where:** `src/lib/alerts.ts:361`, `src/lib/alerts.ts:363`
- **Scenario:** In a USD workspace, a JPY card owes ¥150,000, due in 5 days, with autopay from a USD bank holding $2,000. `buildAlerts` subtracts 150,000 from the USD balance, and the rail says 'Chase may not cover this — "Rakuten Visa" takes $150,000.00 in 5 days — $148,000.00 short'. The reverse also happens: a €1,000 autopay from an INR account holding ₹20,000 projects ₹19,000 left, hiding a real shortfall of about ₹108,814.
- **Fix:** Pass account currencies to `autopayEvents`. When the funding account's currency differs from `card.currency`, skip the funding leg and report the outlook as failed (or as a new `autopay_currency_mismatch` kind), since the engine refuses such a payment anyway; keep the card-side +owed leg. Convert at the latest rate only if the result is marked as an estimate. Add a mixed-currency case to alerts.test.ts.

#### MC-027 — A reversed card payment still counts as paid, so overdue and due-soon alerts and the statement status stay silent
- **Areas:** Alerts & notifications
- **Where:** `api/_lib/alerts.ts:77`, `api/_lib/credit-card.ts:127`
- **Scenario:** A EUR card's €500 statement is due in 2 days. The user pays €500 from a EUR bank, then reverses that transfer. `reverseTransfer` adds an outgoing leg on the card and leaves the original incoming leg untouched. The LATERAL paid sum (alerts.ts:77-83, the same logic as credit-card.ts:127-141) still counts the €500, so the remaining amount is 0 and no due-soon or overdue alert appears, although the card owes €500 again. Reversing an autopay does the same, because `autopay_status` stays 'paid'.
- **Fix:** Net payments in both queries: incoming transfer legs minus outgoing legs whose transfer's `reverses_transfer_id` points at a payment, or exclude legs whose transfer has `reversed_by` set. When an autopay group is reversed, clear `credit_card_statements.autopay_status` so the engine and the rail re-evaluate it.

#### MC-028 — The Debts hub's 'this month' totals and `required_monthly` add instalments across debt currencies and label the total with the workspace currency
- **Areas:** Debts, Test harness
- **Where:** `api/_lib/debts.ts:253`, `api/_lib/debts.ts:264`, `src/lib/debt-status.ts:165`, `src/pages/DebtsPage.tsx:192`, `src/components/debts/DebtsCard.tsx:111`
- **Scenario:** A EUR workspace has an INR loan at ₹5,000/month and a EUR loan at €200/month. `monthObligations` returns required = 5,200, rendered as 'Required this month €5,200.00' on /debts and on the dashboard Debts card. The right answer is ₹5,000 + €200, or about €262.50. Paid, overdue, 'still to pay' and `summary.required_monthly` are wrong in the same way (verified with a scratch run of debt-status.ts).
- **Fix:** Group `monthObligations` and `requiredMonthly` by `DebtLike.currency`, as `owedByCurrency` already does. Return `summary.month_by_currency: [{currency, required, paid, remaining, overdue}]` and render it with `formatByCurrency`. Alternatively, convert with `reporting_amount` and flag excluded rows. Add a mixed-currency case to debt-status.test.ts.

#### MC-029 — AI parsing has no currency field and doesn't know each account's currency, so a stated foreign currency is dropped and the number is saved in the account's currency
- **Areas:** Transactions, AI & imports
- **Where:** `api/_lib/ai.ts:276`, `api/_lib/ai.ts:308`, `api/_lib/ai.ts:314`
- **Scenario:** A EUR workspace has Cash in Hand (EUR) and IDFC NRO (INR). The user says or types 'spent 20 dollars on lunch'. A live Gemini parse returned `{amount: 20, account_id: null, confidence.amount: 1.0}`: the schema has no currency field, and the model ignored the prompt rule to lower confidence. AddTransactionDialog prefills €20 with a 'high' highlight. The opposite case also fails: 'spent 500 rupees from IDFC NRO' is correct but gets confidence 0.8 and a spurious 'Check: Amount'. Two accounts both named 'Revolut' (EUR and USD) can't be told apart.
- **Fix:** Add `currency: ["string","null"]` (ISO 4217, filled only when stated or printed) to `TX_PROPERTIES` and the required lists, and include each account's currency in `accountPromptLabel` ('IDFC NRO (bank, INR)'). In `resolveTransactionRaw`, normalise the currency, prefer an account in that currency (which also settles same-name ties), and never put an amount into an account whose currency contradicts the stated one. Reword the prompt: amounts are in the named account's currency, and only a currency that matches no account should be flagged.

#### MC-030 — The AI assistant's confirm card and toasts label amounts with the workspace currency while posting the number into a possibly foreign account
- **Areas:** UI formatting, AI & imports
- **Where:** `src/components/AiAssistantConfirm.tsx:108`, `src/components/AiAssistantConfirm.tsx:143`, `src/components/AiAssistantConfirm.tsx:152`, `src/components/AiAssistantConfirm.tsx:155`, `src/components/AiAssistantConfirm.tsx:273`
- **Scenario:** In a EUR workspace, the default (or AI-matched) account is IDFC NRO (INR). For 'spent 50 on groceries', the headline and amount row say '€50.00'. Save posts `{wealth_account_id: IDFC, amount: 50}`, which records ₹50 (about €0.46), and the toast 'Transaction of €50.00 saved' repeats the wrong label. For card payments ('paid my Visa Gold statement'), the card's remaining balance is filled in the card's own currency but shown with the workspace symbol.
- **Fix:** Compute `reviewCurrency = accountCurrency(isTransfer ? fromAccount : account, currency)` and use it in the headline, the amount row and the toasts; also show the destination currency when it differs. Combine this with the AI-parse fix, so that a stated currency that differs from the target account blocks Save.

#### MC-031 — Money is stored and converted with 2 decimals whatever the currency's minor units: KWD fils are rounded on create but refused on transfer, and JPY accepts fractions
- **Areas:** Test harness, Wealth & Spaces, FX core · _known deferred_
- **Where:** `src/lib/db/schema.ts:521`, `src/lib/money.ts:104`, `drizzle/0074_fx_reporting_amount.sql:35`, `api/_lib/fx-rates.ts:220`
- **Scenario:** `POST /api/transactions` on a KWD wallet with amount 1.125 returns 201, stores 1.13, adds 1.13 to the balance, and the tile shows 'KWD 1.130'. `POST /api/wealth/transfer` with `destination_amount` 1.125 into the same wallet returns 400 'Destination amount supports at most 2 decimal places'. A JPY wallet accepts ¥1,000.50: the tile shows '¥1,001' and the /transactions row '¥1,000.50'. With KWD as the reporting currency, $1 converts to 0.31 KWD.
- **Fix:** Decide the decimal-places policy (ARCHITECTURE D/J). One option is to widen the money columns (e.g. numeric(24,4) or (28,8)), validate every writer against ISO minor units in one money.ts helper, and round `reporting_amount` to the target currency's minor units. The other is to refuse more than 2 decimal places everywhere, with a clear 400, until then. Remove the forced `minimumFractionDigits` in the row formatter.

#### MC-032 — No correct repair path for a workspace created in the wrong currency: accounts are locked, and changing the workspace currency converts instead of relabelling
- **Areas:** Org, billing & admin, FX ops tooling
- **Where:** `api/_routes/wealth/accounts/[id].ts:84`, `api/_routes/wealth/accounts/[id].ts:85`, `api/_routes/organizations/[id].ts:77`
- **Scenario:** A workspace's accounts and rows are tagged USD but hold INR money, because of the onboarding bug or a user mistake. Changing the currency in org settings changes only the reporting currency, so /wealth converts 'USD 50,000' to about ₹44,00,000 and every report is inflated by the USD/INR rate. Relabelling an account returns 409 `account_currency_locked`, because even its Opening Balance row counts. Credit cards can't be changed at all, and operators have no tool either.
- **Fix:** This needs a product decision. One option is an owner-only 'Relabel workspace currency (no conversion)' action, allowed only when every account, rule, budget and transaction shares one currency. Pair it with an operator script, `scripts/relabel-account-currency.ts --org <id> --to INR [--accounts …] [--detached] [--apply]`, which is a dry run by default. It rewrites `currency_code` on wealth_accounts, transactions, recurring_rules, spending_budgets, transfers and debt_details in ONE dbBatch and writes an audit entry.

#### MC-033 — `organizations.currency` and `reporting_currency` drift apart: the admin 'Default currency' edit and scripts/migrate-org-currency.ts write only the old column, which debts, AI, PDFs and billing still read
- **Areas:** Schema & migrations, Org, billing & admin, API, cache, i18n & native, Rollout & back-compat, FX ops tooling
- **Where:** `api/_routes/admin/organizations.ts:145`, `api/_routes/debts.ts:44`, `api/_lib/ai.ts:167`, `api/_lib/quotation-pdf.ts:81`, `api/_routes/billing/pricing.ts:30`, `scripts/migrate-org-currency.ts:22`
- **Scenario:** A super-admin changes an org from USD to EUR at /admin/organizations. Only `organizations.currency` changes, and without validation ('EURO' is accepted). The owner still sees $ everywhere, because `reporting_currency` wins in the coalesce. Meanwhile the Debts hub summary, the AI quick-add prompt, quotation PDFs ('EUR 1,200.00') and pricing/checkout now use EUR, and `/api/organizations` says USD while the raw row from `/api/organizations/:id` says EUR. Running migrate-org-currency.ts splits the two columns the same way for every org whose owner changed their profile currency.
- **Fix:** Validate against `CURRENCY_LIST` and write both columns through the shared `setOrgCurrency` helper, or keep them equal with a trigger. Switch debts.ts:44 and ai.ts:167 to `reportingCurrencyFor(orgId)`; billing needs its own decision. Show `reporting_currency` in the admin org list and detail. Delete scripts/migrate-org-currency.ts.

#### MC-034 — Store-pinned native builds (1.4.0) and stale PWA builds (v0.14.1) display and write foreign-currency accounts wrongly, and the server can't tell them apart from current clients
- **Areas:** API, cache, i18n & native, Rollout & back-compat
- **Where:** `.env.android:1`, `src/pages/WealthPage.tsx:297`, `api/_routes/transactions/group.ts:164`, `src/lib/api.ts:396`
- **Scenario:** In an INR workspace, the user creates 'Revolut EUR' with €1,000 on the web. Their Android 1.4.0 app shows the Revolut tile as ₹1,000.00 and adds it unconverted into net worth, Spaces and the dashboard. Adding a ₹500 coffee there shows a ₹ prefix, but `POST /api/transactions/group` stores EUR 500, because the currency comes from the account. Revolut drops to €500 instead of about €994.50. Old recurring rules and balance edits do the same. `request()` sends no version header, so none of this can be blocked per client.
- **Fix:** Ship an `x-client-version` header, a build-time constant, in this release. Then either keep account creation in a currency other than the reporting one disabled behind a server flag on `POST /api/wealth/accounts`, `/api/spaces` and `/api/cards` new_bank (409 `multi_currency_disabled`) until native 1.5.0 is widely installed, or require new clients to send `currency_code` on every financial write. In the second case, refuse with 409 `client_update_required` when the target account's currency differs from the reporting currency and the body has no matching `currency_code`.

#### MC-035 — Rolling back to v0.14.1 after cross-currency data exists corrupts transfer state
- **Areas:** Rollout & back-compat
- **Where:** `api/_routes/transactions/[id].ts:232`
- **Scenario:** The release goes out, users record a €500 → ₹51,350 transfer with a €5 fee, and then Vercel is rolled back to v0.14.1. The old DELETE trashes only the legs that share the `group_id`: the fee stays live and the header's `deleted_at` stays NULL. After rolling forward again, `set_transfer_trashed` refuses to restore, and a trash touches only the fee, so the balances can't be reconciled. The old code also writes NULL `currency_code` and adds EUR to INR unconverted on every screen.
- **Fix:** Once any foreign account or cross-currency transfer exists in production, allow only roll-forward, and write that policy into the release checklist. Rehearse a rollback on a Neon branch before release.

#### MC-036 — Admin transaction edit and delete write ledger rows directly, bypassing the balance, transfer and debt services, and label rows in the org currency
- **Areas:** Org, billing & admin, Transactions
- **Where:** `api/_routes/admin/transactions.ts:150`, `src/pages/admin/AdminOrgDetailPage.tsx:781`
- **Scenario:** A super-admin on /admin/organizations/:id → Transactions edits a €100 expense on an EUR account (balance €900) to 150. Only `transactions.amount` changes, so the balance stays €900 while the ledger implies €850. Editing a transfer leg changes that leg only, while the header still says 300. An admin DELETE hard-deletes a leg and leaves the header 'completed' with one leg. The tab labels the EUR rows 'Amounts are in USD'.
- **Fix:** Refuse (409) rows that have a `wealth_account_id`, a `transfer_id`, a `debt_payments` anchor or `is_system` set, or delegate to the user-side PATCH/DELETE services, which already route transfer legs through the transfer service. Return `currency_code` in GET and show it on each row.

### 🟡 medium (86)

#### MC-037 — FxExcludedNotice shows the raw i18n key 'fx.excludedNotice' on every report screen
- **Areas:** FX core, Reports, API, cache, i18n & native, FX ops tooling, Test harness
- **Where:** `src/components/FxExcludedNotice.tsx:20`
- **Scenario:** A USD workspace has an AED wallet with an expense dated before the first AED rate snapshot, so `excluded_count = 1`. The Dashboard, /transactions, /analytics, /calendar, /flow, /budgets, /clients and /clients/:id all print the literal text 'fx.excludedNotice'. The key exists in no locale file (commit 46be4df never added it), and `i18n:check` only compares locales against en.json, so it passes. The only sign that totals are partial is unreadable.
- **Fix:** Add `fx.excludedNotice_one` / `_other` with `{{count}}` to en.json, for example "{{count}} entry in another currency isn't included (no exchange rate)", and translate them into all 7 other locales, including the Arabic `_zero` / `_two` / `_few` / `_many` forms. Drop 'yet' here and in `wealth.currencyNotIncluded`, because history for non-ECB currencies never fills in by itself. Add a DB-free check that every literal `t('a.b')` key used in src exists in en.json.

#### MC-038 — Changing the workspace currency doesn't invalidate cached money reads, so old-currency figures are shown under the new symbol
- **Areas:** Wealth & Spaces, Budgets, Reports, Org, billing & admin, API, cache, i18n & native, Test harness
- **Where:** `src/lib/api-cache.ts:291`
- **Scenario:** Switch the workspace from USD to EUR on /organizations and open /dashboard within 15 s. The cache rule for the PATCH drops only the identity, referrals, search and audit prefixes. The cached `/api/transactions` body, whose `reporting_amount` values are in USD, is summed and shown with `useCurrency()='EUR'`: '€6.80' for what is $6.80. /wealth, /budgets and `/api/budgets/overview` behave the same until revalidation, and other members keep the old org currency for up to 5 minutes.
- **Fix:** Add a specific rule `^/api/organizations/[^/]+$` → `[...MONEY_PREFIXES, '/api/organizations', '/api/profile', '/api/quotations', '/api/search', '/api/audit']` before the generic org rule, or use FULL_PURGE when the body carries a currency. Add an api-cache.test.ts case and update the check-cache-map expectations. Longer term, put the reporting currency in the responses (for example, use the paged response's `currency` on the Dashboard), so a label can never come from a different fetch than its numbers.

#### MC-039 — The FX history backfill runs inside user GETs as one sequential INSERT per day, per currency, repeated by parallel routes
- **Areas:** FX core, Wealth & Spaces, Budgets, Reports, Org, billing & admin, API, cache, i18n & native, FX ops tooling
- **Where:** `api/_lib/fx-rates.ts:263`, `api/_lib/fx-rates.ts:267`, `api/_lib/fx-rates.ts:295`
- **Scenario:** A USD workspace back-dates one EUR expense to 2021-01-01, or a EUR workspace switches reporting to USD. The next /dashboard load fires `/api/transactions`, `/api/analytics`, `/api/wealth/summary`, `/api/spending-budgets` and `/api/alerts` in parallel. Each awaits `ensureRatesForOrg` → `ensureHistoricalRates`, which awaits about 2,100 single-row `storeSnapshot` INSERTs one after another. At 75–79 ms per Neon round trip, that is about 2.6 minutes locally, repeated for each currency. The first request of every UTC day does it again, because today has no row yet. Reports time out, the Wealth hero falls back to the unconverted total, and the budget alert path ensures rates twice.
- **Fix:** Compute the missing dates once and write them in one chunked multi-row `INSERT … ON CONFLICT`, using the upserting storeSnapshot from the frozen-fallback fix. Run currencies in parallel, and share one in-flight backfill per currency pair within the process. Move bulk backfill off the request path (worker or cron; the request path fills at most about 30 days) and let GETs report the still-missing rows as excluded until it lands. `buildWealthSummary` needs only `currentRate` per currency. Pass the reporting currency into `listBudgets` from notify-budget.

#### MC-040 — A grouped multi-currency split's `amount` silently leaves out legs that have no FX rate (SQL sum skips NULLs)
- **Areas:** FX core, Transactions, Reports, UI formatting, Rollout & back-compat
- **Where:** `api/_routes/transactions.ts:109`, `api/_routes/transactions.ts:133`
- **Scenario:** An INR workspace has a split of INR 1,000 on an INR bank and AED 50 on an AED wallet, dated 30 days ago; the API and old clients accept it. There is no AED rate for that date. `amount = sum(reporting_amount) = 1,000` with currency INR, so the list and the Dashboard Latest card show '−₹1,000' as if it were the whole transaction. `reporting_amount` is correctly NULL, but no client reads it or `currency_count`, and the code comment claims `amount` is NULL too. When no leg has a rate, the row shows '€0.00'.
- **Fix:** Use `case when bool_or(reporting_amount is null) then null else sum(...) end` for `amount` as well. When `amount` is null or `currency_count > 1`, have the row show 'N currencies' or an excluded hint ('n/a (no rate)'). Sort grouped rows by reporting amount. For new data this matters less once group.ts refuses mixed currencies.

#### MC-041 — `GET /api/transactions/:id` omits `currency_code` and adds split legs across currencies, so deep-linked details show the wrong symbol and total
- **Areas:** Transactions, Concurrency & invariants, Test harness
- **Where:** `api/_routes/transactions/[id].ts:37`, `api/_routes/transactions/[id].ts:80`, `src/pages/TransactionsPage.tsx:454`
- **Scenario:** In a USD workspace, open the EUR 5 'Transfer fee' row from global search, Money Flow, a notification or the Dashboard peek's 'Open' (/transactions?view=<id>). The list isn't loaded yet, so the page calls `GET /api/transactions/:id`, whose select has no `currencyCode`, and the modal shows '−$5.00'. For a split of €50 + ₹1,000, it returns amount '1050.00' labelled with one leg's currency, while the list row correctly shows about €62.50.
- **Fix:** Add `currencyCode` and `reportingAmountSql(reporting)` to the GET select. For groups, compute amount and currency like `groupedFieldsFor` in transactions.ts:109: native when there is one currency, otherwise the reporting amount with the `bool_or` NULL rule. Optionally have the effect replace `viewTx` with the list row once the list loads.

#### MC-042 — `POST /api/transactions/group` accepts split legs on accounts in different currencies
- **Areas:** Schema & migrations, Transactions, Rollout & back-compat
- **Where:** `api/_routes/transactions/group.ts:84`, `api/_routes/transactions/group.ts:88`, `api/_routes/transactions/group.ts:164`
- **Scenario:** An old app build, or any API caller, posts allocations `[{HDFC INR, 600}, {Revolut EUR, 400}]` for a ₹1,000 purchase and gets 201. Revolut is debited €400 (about ₹36,000) for a ₹400 share, and the grouped row's total becomes a meaningless mix of currencies. Only the new web AccountSelector blocks this, but the API is the trust boundary.
- **Fix:** After resolving the legs, require a single non-null `currency_code` across `byId.get(leg.accountId)`; otherwise return 400 `{code: 'split_currency_mismatch'}`. This is one Set check after the byId loop. Apply the same check when a group is edited.

#### MC-043 — Editing any transaction on an archived account fails with a misleading 409 'currency migration is incomplete' (regression)
- **Areas:** Schema & migrations, Transactions, Refusal UX & i18n
- **Where:** `api/_routes/transactions/[id].ts:161`, `api/_routes/transactions/[id].ts:167`
- **Scenario:** Archive a bank that has history. On /transactions, change only the category of one of its rows and Save. PATCH resends the unchanged, archived `wealth_account_id`. The account lookup filters `archived_at IS NULL`, so `account` is undefined, and `!account?.currencyCode` returns 409 `currency_missing`. The user sees 'Failed to update transaction' (in German, 'Fehler beim Aktualisieren der Transaktion'). Editing from AccountQuickAddSheet fails the same way.
- **Fix:** When `nextAccountId === before.wealthAccountId`, keep `before.currencyCode`, or load the account without the archived filter. Return `currency_missing` only for a currency that really is NULL, and refuse only moving a row TO an inactive account.

#### MC-044 — Moving a transaction to an account in another currency keeps the number and silently changes what it means
- **Areas:** Transactions
- **Where:** `api/_routes/transactions/[id].ts:168`, `src/components/AccountSelector.tsx:165`
- **Scenario:** A €50 expense is on a EUR card. On /transactions, choose Edit and tap the INR bank tile. AccountSelector keeps '50', the symbol changes to ₹, and PATCH stores ₹50: the EUR side gets +50 back and the INR bank −50. A €50 purchase (about ₹4,700) becomes ₹50 without any prompt.
- **Fix:** On the client, when the selected account's currency differs from the original row's, clear the amount (or warn 'amount is now in INR') and require it to be entered again. On the server, when `nextCurrencyCode !== before.currencyCode`, require `amount` explicitly in the body (409 `amount_required_for_currency_change`).

#### MC-045 — Instant (optimistic) delete on /transactions subtracts native amounts from the converted summary, treats refunds as income, and never re-syncs
- **Areas:** Transactions
- **Where:** `src/pages/TransactionsPage.tsx:662`, `src/pages/TransactionsPage.tsx:808`
- **Scenario:** In a USD workspace, delete an EUR 50 expense (about $58): the Expenses figure drops by $50.00, not about $58. Delete an EUR 20 refund: Income drops by 20, although the server counted the refund as a negative expense, and Expenses is unchanged. Bulk delete rebuilds the summary as `{incoming, outgoing}` and drops `summary.currency` and `excluded_count`, so the FX notice disappears. Nothing is refetched afterwards, so the wrong figures stay.
- **Fix:** In the instant update, use `reportingAmountOf(removed, summary.currency)` and the refund rule (kind==='refund' → outgoing −= amount), and keep `currency` and `excluded_count`. After a successful delete, call `fetchPage1({silent: true})`, either always or whenever `reportingAmountOf` returns null.

#### MC-046 — Editing a split trashes the old group and creates a new one: not atomic, and restoring the old version from Trash duplicates the money
- **Areas:** Transactions · _known deferred_
- **Where:** `src/pages/TransactionsPage.tsx:611`, `src/pages/ClientDetailPage.tsx:351`
- **Scenario:** Edit a two-leg split (EUR 30 + EUR 20) and change only the category. DELETE moves both legs to Trash and `POST /group` creates new ones. /trash now lists the old legs, and Restore applies −€50 again, so the expense exists twice. If the POST fails (a frozen card, or a 402), the split simply disappears.
- **Fix:** Add `PUT /api/transactions/group/:groupId`, which replaces the legs in one dbBatch: reverse the old per-account shifts, hard-delete the old legs and insert the new ones. At minimum, purge the replaced legs instead of trashing them, and restore them if the POST fails.

#### MC-047 — Normal writers don't validate decimal places: a 3-decimal amount is rounded in the row but not in the balance change, so balance and ledger drift apart
- **Areas:** Schema & migrations · _known deferred_
- **Where:** `api/_routes/transactions.ts:479`
- **Scenario:** `POST /api/transactions {type: 'outgoing', amount: 1.235}` on an account at 100.00. The row stores 1.24 (numeric(20,2)), but the balance statement applies −1.235 and stores 98.77, while the ledger says 98.76 (checked in Postgres). This affects transactions POST and PATCH, group and the other plain writers, and KWD/BHD fils are lost.
- **Fix:** Validate or round amounts to 2 decimals in one shared money.ts helper, applied before both the insert and the balance change. Decide separately whether to widen the money columns (see the minor-units item).

#### MC-048 — Trash shows every trashed amount in the workspace currency, rounded to whole units (the trash API returns no `currency_code`)
- **Areas:** Transactions, UI formatting, Cascade soft-delete
- **Where:** `src/pages/TrashPage.tsx:39`, `src/pages/TrashPage.tsx:194`, `api/_routes/trash.ts:7`
- **Scenario:** In a USD workspace, trash a €5.00 transfer fee or a €500 → ₹51,350 transfer. /trash shows '−$5', '−$500' and '+$51,350'. In an INR workspace, a trashed €90.50 expense shows as '−₹91'.
- **Fix:** Add `currencyCode` (and `kind`, `transfer_id`, `group_id`) to `txFields` in api/_routes/trash.ts. Format with `formatMoney(Number(tx.amount), rowCurrency(tx, currency))` at 2 decimals instead of `fmtAmount`. Optionally group split and transfer legs into one trash row.

#### MC-049 — The Dashboard transaction peek shows the workspace currency while the list row it came from shows the row's own currency
- **Areas:** Transactions, UI formatting, API, cache, i18n & native
- **Where:** `src/components/TransactionPeekModal.tsx:46`, `src/pages/Dashboard.tsx:1618`
- **Scenario:** In a USD workspace, the latest transaction is €5.00. The Dashboard 'Latest' row shows '−€5.00' (using `rowCurrency`), but clicking it opens the peek with '−$5.00', because the Dashboard passes the org currency.
- **Fix:** Format with `formatMoney(Number(tx.amount), rowCurrency(tx, currency))`; the modal should use the row's `currency_code`.

#### MC-050 — Global search (desktop and mobile) shows foreign transaction amounts with the workspace symbol, because search.ts returns no `currency_code`
- **Areas:** Transactions, Reports, UI formatting, Rollout & back-compat
- **Where:** `api/_routes/search.ts:43`, `api/_routes/search.ts:44`, `api/_routes/search.ts:46`, `src/components/GlobalSearchDialog.tsx:200`, `src/components/MobileSearchOverlay.tsx:313`
- **Scenario:** Verified in the UI: in a EUR workspace, ⌘K 'Opening Balance' lists IDFC NRO's ₹20,000 opening row as '€20,000.00'. In a USD workspace, searching 'fee' shows the €5 transfer fee as '$5.00'.
- **Fix:** Select `currencyCode` in search.ts, add `currency_code` to `SearchTransaction` (src/hooks/use-global-search.ts), and format with `rowCurrency(tx, currency)` in GlobalSearchDialog and MobileSearchOverlay.

#### MC-051 — The category/tag drill-down formats native amounts with the workspace symbol and sorts amounts across currencies as plain numbers
- **Areas:** Reports, UI formatting, Cascade soft-delete
- **Where:** `api/_lib/entity-drilldown.ts:45`, `api/_lib/entity-drilldown.ts:151`, `src/components/entity-drilldown/EntityDrilldown.tsx:199`
- **Scenario:** A EUR workspace has tag #trip on a ₹9,000 row and a €100 row. On /categories?tab=tags, opening #trip (which is also the preview shown before 'Delete tag & records') shows '+€9,000.00' for the INR row. 'Amount high→low' ranks it above the €100 row, although it is worth less. In the e2e org, the 'Opening Balance' category lists '+$75,000.00' for the INR wallet.
- **Fix:** Return `currency_code` (and `reporting_amount` for sorting) from `fetchTransactionItems`, add it to `DrilldownItem`, format with `formatMoney(amount, item.currency_code ?? currency)`, and sort by `reporting_amount` (or within each currency).

#### MC-052 — Client totals include system rows (opening balances, adjustments), unlike analytics, calendar and flow
- **Areas:** Reports
- **Where:** `api/_routes/clients.ts:129`, `api/_routes/clients/[id].ts:42`
- **Scenario:** In the 'E2E Test Co' business org (USD), /clients shows the org's own client with income of $236,020.96. That is 12 USD system incoming rows (236,000) plus an INR 2,000 opening balance ($20.96). /analytics shows income $0. With multiple currencies, every foreign wallet's opening balance is converted and added to the own client's 'income'.
- **Fix:** Add `eq(transactions.isSystem, false)` to the LEFT JOIN in clients.ts (both queries) and to the where clause in clients/[id].ts, and add clients/[id].ts to the tx-sql.test.ts route list.

#### MC-053 — The closed-clients page, the client quick-view sheet and the overview modal show partial converted totals with no 'excluded' note and the current workspace symbol
- **Areas:** Reports
- **Where:** `src/pages/ClosedClientsPage.tsx:35`, `src/components/ClientDetailSheet.tsx:36`, `src/components/ClientOverviewModal.tsx:65`
- **Scenario:** A closed client has a CHF expense with no rate. /clients/closed, the quick-view sheet on /clients and the overview modal on /clients/:id show the converted total without that row and without a 'not included' note. They format with `useCurrency()` rather than `totals_currency`, so a cached response can be mislabelled after a currency change.
- **Fix:** Use `clientTotalsCurrency(client, currency)` and render `<FxExcludedNotice count={excludedCountOf(client)} />` in all three (ClosedClientsPage.tsx:35/165/198, ClientDetailSheet.tsx:36-42, ClientOverviewModal.tsx:65-98).

#### MC-054 — The currency lock ignores an account with a non-zero balance and no rows, so the stored balance is relabelled into another currency
- **Areas:** Wealth & Spaces, Concurrency & invariants
- **Where:** `api/_routes/wealth/accounts/[id].ts:86`
- **Scenario:** Dev account b06c0468 'Intesa sanapolo' is a USD bank with 0 rows and a balance of 22,337.85. The Edit picker is enabled, and saving INR turns it into INR 22,337.85 (about $268): net worth drops, with no row explaining it. The app can create this state: trash an Opening Balance system row (which doesn't reverse on trash) and then purge it. Seven dev wallets are already in this rows=0, balance≠0 state.
- **Fix:** Also return 409 `account_currency_locked` when `current_balance ≠ 0` or `opening_balance ≠ 0`, both in the server lock and in the pure check the picker uses. Separately, refuse trashing or purging Opening Balance and Balance Adjustment system rows, or have purge post an explicit reset row.

#### MC-055 — A PATCH with both `currency_code` and `current_balance` stamps the Balance Adjustment row with the old currency
- **Areas:** Wealth & Spaces, Concurrency & invariants
- **Where:** `api/_routes/wealth/accounts/[id].ts:210`, `api/_routes/wealth/accounts/[id].ts:228`
- **Scenario:** On an empty USD account, send `PATCH {currency_code: 'EUR', current_balance: 100}`. The lock passes (0 rows). L210 inserts a 'Balance Adjustment' of 100 in USD (the currency read before the change), and L228 sets the account to EUR. The result is an EUR account with a 100 EUR balance whose only row says 100 USD, and the account is now permanently locked. Only the API can do this today; the UI sends the edit and the adjustment separately.
- **Fix:** Stamp the adjustment row with the new, post-PATCH `currencyCode`, or return 400 when both fields are sent together.

#### MC-056 — 'Adjust balance' writes an absolute balance from an earlier read, not atomically, so money written in between is lost
- **Areas:** Wealth & Spaces, Concurrency & invariants
- **Where:** `api/_routes/wealth/accounts/[id].ts:195`, `api/_routes/wealth/accounts/[id].ts:230`
- **Scenario:** The balance is read at L195 as 1,000, and the user adjusts it to 1,500. Meanwhile, a parallel GET posts a due +2,000 salary, bringing the balance to 3,000. The PATCH then inserts a +500 adjustment row and sets `current_balance = 1,500`: the stored balance is 1,500 while the ledger says 3,500.
- **Fix:** Do what the debt reconcile does: compute the difference from a fresh read (FOR UPDATE, or inside a DB function) and write `current_balance = current_balance + delta` together with the adjustment insert in one dbBatch. Never write `currentBalance` as an absolute value.

#### MC-057 — Race between the account currency lock check and every money writer, with no database constraint to catch it
- **Areas:** Concurrency & invariants
- **Where:** `api/_lib/wealth-accounts.ts:494`, `api/_routes/wealth/accounts/[id].ts:84`
- **Scenario:** Account A is a fresh USD account with 0 rows. In parallel, `PATCH A {currency_code: 'EUR'}` and `POST /api/wealth/transfer` A→B are sent. `createTransfer` reads USD and computes the amounts, then waits on `ensureDefaultClient` / `getOrgPlan`. Meanwhile the PATCH counts 0 rows and commits EUR. The transfer batch then inserts a USD header and a USD leg on what is now an EUR account.
- **Fix:** Add a hand-written, additive 0077 (`when` = Date.now(), appended last) with UNIQUE (id, currency_code) on wealth_accounts and a composite, deferrable foreign key from transactions(wealth_account_id, currency_code) to wealth_accounts(id, currency_code), so a write in the wrong currency fails. Run the relabel and its checks in one batch.

#### MC-058 — Cascade and trash/restore writers change balances before claiming the rows (no batch, no lock), so a double submit applies the change twice
- **Areas:** Cascade soft-delete, Concurrency & invariants
- **Where:** `api/_routes/clients/[id].ts:132`, `api/_routes/trash/restore.ts:63`, `api/_routes/transactions/bulk-delete.ts:31`, `api/_routes/clients/bulk-delete.ts:55`, `api/_lib/tag-ops.ts:105`
- **Scenario:** Client C has a €50 expense and ₹2,000 of income on two accounts. Two `DELETE /api/clients/C` requests arrive together from two tabs. Both read the live rows before either sets `deleted_at`, and both apply the balance shifts: EUR +€100 (should be +€50) and INR −₹4,000 (should be −₹2,000). The second request returns 404, but its balance updates are already committed. Two concurrent restores of a €10 expense end at 980, while the ledger says 990.
- **Fix:** Use one statement that claims the rows first: `WITH gone AS (UPDATE transactions SET deleted_at = $now WHERE … AND deleted_at IS NULL RETURNING wealth_account_id, type, amount, is_system) UPDATE wealth_accounts … FROM (per-account shifts of the returned rows)`. Use the same shape for restore (with `deleted_at IS NOT NULL` as the condition) and in bulk-delete, debt payments, clients bulk-delete, tag-ops and purge.

#### MC-059 — Row writes and their balance updates are separate statements outside dbBatch, so a crash or timeout leaves a row without its balance change, or the other way round
- **Areas:** Recurring, Concurrency & invariants, Cascade soft-delete · _known deferred_
- **Where:** `api/_lib/recurring-materialize.ts:190`, `api/_lib/recurring-materialize.ts:214`, `api/_routes/trash/restore.ts:90`
- **Scenario:** The recurring materializer inserts an occurrence (L190-209) and commits. The balance UPDATE (L216-224) then fails on a Neon error, which the outer catch records as `last_error`. On the next run, the insert conflicts on (rule, due_date), so the balance change is never applied and the account stays off by the occurrence amount for good. Client restore un-deletes the client, then updates each account, then the rows; a failure halfway leaves a live client with trashed rows, and a retry returns 404.
- **Fix:** Fold each insert and update pair into one statement (`INSERT … ON CONFLICT DO NOTHING RETURNING` → `UPDATE wealth_accounts FROM` the returned rows), into one dbBatch, or into a DB function as transfers do (0072/0073). Start with the materializer and `POST /api/transactions`, which have the most traffic. Then do the same for transactions/[id], group, bulk-delete, trash restore and purge, clients, tag-ops, debts and accounts (STATUS.md lines 58 and 135).

#### MC-060 — The DB retry layer replays money statements after network errors that may come after the commit, and money POSTs have no idempotency keys
- **Areas:** Concurrency & invariants
- **Where:** `src/lib/db/retry.ts:14`, `src/lib/db/index.ts:17`, `src/lib/db/index.ts:62`
- **Scenario:** `RETRYABLE_HINTS` matches 'fetch failed', 'socket hang up', ECONNRESET and 'connection terminated', all of which can happen after the server has committed. The per-query wrapper then re-runs `current_balance = current_balance + x`, applying it twice. `dbBatch` replays with the same pre-generated ids, hits 23505 and returns 500 although the transfer or debt payment was saved, so the user retries and records it again.
- **Fix:** Retry only on errors that happen before the statement runs (permit or control-plane errors, failure to connect). For batches with pre-generated ids, treat a 23505 on that id as success. Optionally accept a client-generated UUID as the transfer or payment id.

#### MC-061 — No tool to audit or recompute balances against the ledger, and the shared dev DB already has accounts that drifted and orphaned transfer rows
- **Areas:** Schema & migrations, Concurrency & invariants, FX ops tooling · _known deferred_
- **Where:** `src/lib/wealth-ledger.ts:3`, `api/_routes/transactions.ts:490`, `api/_lib/wealth-accounts.ts:461`
- **Scenario:** `current_balance` is updated step by step and never checked against the ledger. On the dev DB, 8 accounts have a stored balance that differs from the sum of their live rows: for example Space d02ff2b5 is 103.00 against a ledger of 153.00, the e2e-ux4-mc wallets are 1,000 and 75,000 against 0 after their Opening Balance rows were purged, and bed91dd1 is +20 from the fee refunded twice. There are also 4 completed transfers with `source_fee_amount` 5 but no fee row, 9 trashed headers with no rows, and 25 two-leg groups with no header. The comment at transactions.ts:490 says the drift is 'repairable by recomputing from the ledger', but no script exists.
- **Fix:** Add `scripts/audit-balances.ts [--org <id>] [--apply <accountId> --mode ledger|adjust]`, a dry run by default. It reports per account, in native currency: stored, expected, drift, has_opening_row and row count. Repair by posting an explanatory system row (Opening Balance or Balance Adjustment) rather than rewriting `current_balance`. Keep the transfer-integrity audit queries as scripts/audit-currency.mjs. Run both against prod before and after deploy and before enforcing NOT NULL, and clean up the e2e-ux4 fixtures.

#### MC-062 — The account currency picker counts only live rows while the server lock also counts trashed rows, so the picker allows a change that returns 409, shown as raw JSON or English
- **Areas:** Wealth & Spaces, Concurrency & invariants, Refusal UX & i18n
- **Where:** `src/components/wealth/WealthAccountDialogs.tsx:94`, `src/components/wealth/WealthAccountDialogs.tsx:144`, `api/_routes/wealth/accounts.ts:109`, `api/_routes/wealth/accounts/[id].ts:84`
- **Scenario:** Create an EUR bank with an opening balance of 0, add one expense, then delete it. `GET /api/wealth/accounts` reports `transaction_count` 0, so the currency picker is enabled. Pick USD and Save. The server counts the trashed row and returns 409, and in ml, de or ar the toast shows the raw response: `{'error':'This account's currency cannot be changed after financial history…'}`.
- **Fix:** Return a `currency_locked` flag computed on the server with the same check as the PATCH lock, and enable the picker from it. Show errors through `apiErrorMessage(err, t('couldNotUpdate'))`, and map `account_currency_locked` to the existing `wealth.accountCurrencyLocked` key (the server adds `currency`).

#### MC-063 — `apiErrorMessage` never translates server error codes, so every multi-currency refusal appears as an English toast in all 8 locales
- **Areas:** API, cache, i18n & native, Refusal UX & i18n
- **Where:** `src/lib/api.ts:510`, `src/lib/api.ts:516`
- **Scenario:** With the UI in Arabic, set up a Space auto-save from a bank in another currency. The server returns 409 `{error: 'Automatic savings currently require accounts in the same currency', code: 'cross_currency_recurring_policy_required'}`. SpaceDetailPage calls `apiErrorMessage`, which returns the English `error` text, shown left-to-right inside a right-to-left toast. The same happens for about 30 callers and about 17 codes (`invalid_transfer_amounts`, `source_currency_mismatch`, `currency_missing`, `account_currency_locked`, `currency_mismatch`, …).
- **Fix:** Make one change in `apiErrorMessage`: read `code`, and if `i18n.exists('apiErrors.' + code)`, return `i18n.t('apiErrors.' + code, body)`, where the body carries parameters such as currency or account. Otherwise return the caller's translated fallback instead of the server's English. Add `apiErrors.*` keys in all 8 locales, and give `transfer_account_currency_changed` its own code.

#### MC-064 — Edit is offered on transfer legs but always fails, with a generic error that has no code
- **Areas:** Refusal UX & i18n
- **Where:** `src/components/TransactionDetailModal.tsx:245`, `api/_routes/transactions/[id].ts:112`, `src/components/wealth/AccountQuickAddSheet.tsx:182`
- **Scenario:** On /wealth/:id, open a cross-currency transfer leg, click Edit, change only the description and Save. AccountQuickAddSheet always sends kind 'standard', type, amount and date. transactions/[id].ts:112 returns a 400 with no code, 'A transfer leg can't change kind…', and the toast shows the generic `failedToUpdateTransaction`. A transfer leg can never be relabelled from the UI.
- **Fix:** Hide Edit for kind==='transfer' (Reverse is the way to correct a transfer), or open an editor that sends only description and category. Give the refusal a code (`transfer_leg_immutable`) and translate it.

#### MC-065 — TransferWizard keeps an outdated received amount when the destination currency changes
- **Areas:** API, cache, i18n & native
- **Where:** `src/components/wealth/TransferWizard.tsx:175`
- **Scenario:** From a EUR wallet to an INR wallet, the amount is 500. The user edits 'They receive (INR)' to 51,350, which sets `rateEdited = true`, and then switches the destination to a USD bank. The field keeps 51,350, now labelled USD, because the suggestion effect returns early while `rateEdited` is true. Step 2 shows '€500.00 → $51,350.00' and '1 EUR = $102.70', and submitting records it.
- **Fix:** Reset `destinationAmount` and `rateEdited` whenever `pairFrom` or `pairTo` changes (key the effect on the pair). Consider warning when the entered rate differs from the market rate by more than a set percentage.

#### MC-066 — ScheduledTransfersPanel rows overflow at 400 px or narrower in long-text locales; actions are cut off and smaller than 44 px
- **Areas:** API, cache, i18n & native
- **Where:** `src/components/wealth/ScheduledTransfersPanel.tsx:109`
- **Scenario:** At a 375 px viewport with the UI in Malayalam, a planned transfer reads €12,500.00 → ₹12,83,750.00. The right column doesn't shrink: it holds the amount pair and the 'mark done' button, neither of which wraps, plus a 36 px menu button, and together they are wider than the roughly 263 px available. The account names shrink to 0 px, and the list clips the menu button, so Cancel and Mark pending can't be reached. German behaves the same.
- **Fix:** Stack the row on mobile: amounts under the names below `sm:`, and actions in a full-width row; or move Mark done into the dropdown on small screens. Use `min-h-11` / `size-11` touch targets and let the amount pair wrap. Re-sync both native shells afterwards.

#### MC-067 — 'Mark done' on a scheduled transfer after an account's currency changed, or after it was archived, returns a misleading generic English error
- **Areas:** Refusal UX & i18n
- **Where:** `api/_lib/wealth-accounts.ts:572`, `drizzle/0073_transfer_lifecycle.sql:46`, `src/components/wealth/ScheduledTransfersPanel.tsx:69`
- **Scenario:** Plan a transfer of EUR 100 → USD 108 from an account with no rows, then change that account's currency to GBP; planned transfers don't lock it. Click Mark done. The SQL raises `transfer_account_currency_changed`, which is caught and returned as 409 `invalid_transfer_transition` with the text 'Transfer could not be completed atomically'. The user gets an English toast that hides the real reason. An archived account produces the same message.
- **Fix:** Map each Postgres message to its own code (`transfer_account_currency_changed`, `transfer_account_unavailable`) and translate it. Lock the account's currency while planned or pending transfers reference it (see the currency-lock item), and consider refusing to archive an account that has open planned transfers.

#### MC-068 — Planned and pending transfers skip the debt-account check, so money can reach a loan without going through the debt engine
- **Areas:** Wealth & Spaces
- **Where:** `api/_lib/wealth-accounts.ts:635`
- **Scenario:** `POST /api/wealth/transfer {status: 'planned', from: EUR bank, to: EUR loan, source_amount: 300}` returns 201, because `createTransferIntent` has no `isDebtAccountType` check. `PATCH /api/wealth/transfers/:id {status: 'completed'}` then makes `complete_transfer` post a plain €300 principal payment into the loan with no `debt_payments` allocation, so the interest never becomes an expense.
- **Fix:** Add the `isDebtAccountType` refusal to `createTransferIntent` and `transitionTransfer`, and add the same check in `complete_transfer` (refuse loan and receivable accounts).

#### MC-069 — Deleting a Space that holds money fails when the destination account is in another currency, with an English toast and the balance shown in the wrong currency
- **Areas:** Wealth & Spaces, Refusal UX & i18n
- **Where:** `src/pages/SpaceDetailPage.tsx:409`, `src/pages/SpaceDetailPage.tsx:420`, `src/pages/SpaceDetailPage.tsx:422`, `src/pages/SpaceDetailPage.tsx:440`
- **Scenario:** A EUR Space holds €200, and the default destination is the INR Cash in Hand. Delete Space → 'Move & close' posts `{from: space, to: INR account, amount: 200}` and gets 400 'Destination amount is required for a cross-currency transfer' as a raw English toast, so the Space can't be closed from this dialog. The confirmation text also shows ₹200.
- **Fix:** Limit the destination AccountCombobox to accounts in the Space's currency, or ask for the received amount (reusing SpaceTransferModal's cross-currency field) and send both source and destination amounts. Format the balance with `accountCurrency(space, currency)`.

#### MC-070 — The Space auto-save dialog offers, and pre-selects, source accounts in other currencies that the server refuses, and labels the rule in the workspace currency
- **Areas:** Wealth & Spaces, Recurring, UI formatting, Refusal UX & i18n
- **Where:** `src/pages/SpaceDetailPage.tsx:213`, `src/pages/SpaceDetailPage.tsx:308`, `src/pages/SpaceDetailPage.tsx:346`
- **Scenario:** An INR Space; the accounts are a EUR bank (listed first) and an INR bank. Open 'Set up auto-save', keep the default account, enter 50 and Save. The PUT returns 409 `cross_currency_recurring_policy_required`, shown in English even with the UI in German or Arabic, and the amount input has no currency label. For a EUR Space, an active auto-save reads 'Auto-save on: $50.00 monthly'.
- **Fix:** Offer only accounts whose `currency_code` equals `space.currency_code` (the pattern in DebtFormSheet.tsx:152), and show a translated hint when none qualify. Map the 409 code to `apiErrors.cross_currency_recurring_policy_required`, and format amounts with `space.currency_code`.

#### MC-071 — A failed Space auto-save occurrence is silently lost: the inner `continue` moves on to the next date and clears `last_error`
- **Areas:** Recurring, Concurrency & invariants, Refusal UX & i18n
- **Where:** `api/_lib/recurring-materialize.ts:179`, `api/_lib/recurring-materialize.ts:182`, `api/_lib/recurring-materialize.ts:294`
- **Scenario:** A EUR Space has a monthly €50 auto-save from EUR bank B, which has 0 rows and a future start date. B's currency is changed to USD, which the lock allows. On the due date, `createTransfer` returns 'Destination amount is required for a cross-currency transfer'. `setRuleError` runs, then `continue` resumes the loop over due dates, and L294-303 move `nextDueAt` forward and set `lastError = ''`. Nothing is posted, and /recurring shows no error.
- **Fix:** On `!transfer.ok`, set a blocked flag, break out of the due-date loop, and `continue` the outer rule loop before the next due date is advanced. The archived-account and quota branches, and the debt branch's `hold`, already work this way. Clear `lastError` only when every due occurrence has posted. Also pass `sourceCurrency: rule.currencyCode` (and `destinationCurrency`) to `createTransfer`, so an account whose currency changed is refused explicitly.

#### MC-072 — No way in the UI to create a Space or cash wallet in a foreign currency, while the server lets anyone create unlimited cash wallets
- **Areas:** Wealth & Spaces
- **Where:** `src/components/spaces/SpaceFormModal.tsx:64`, `api/_lib/quota.ts:209`
- **Scenario:** SpaceFormModal never sends `currency_code`, so every Space is created in the reporting currency. WealthPage's 'Add bank' always posts type 'bank', so a free user who already has one bank can't add an INR wallet from the UI. Meanwhile `POST /api/wealth/accounts {type: 'cash'}` has no limit for anyone (quota.ts:209-235 counts only banks), and the e2e suite relies on that.
- **Fix:** Decide the cash-wallet policy (quota or no quota). Add a currency picker to the Space form and an 'Add cash wallet' entry that asks for a currency, or document that foreign Spaces only arise from a reporting-currency change.

#### MC-073 — The recurring list and the rule detail page format rule and occurrence amounts in the workspace currency
- **Areas:** Recurring, UI formatting, Test harness
- **Where:** `src/pages/RecurringPage.tsx:223`, `src/pages/RecurringDetailPage.tsx:306`, `src/pages/RecurringDetailPage.tsx:414`, `src/pages/RecurringDetailPage.tsx:569`
- **Scenario:** A USD workspace has a €12 monthly rule on a EUR wallet. /recurring shows '−$12.00', and a ₹1,000 rule shows '−$1,000.00'. On /recurring/:id, 'Each payment' reads '−$12.00' and every posted row reads '−$12.00', although `tx.currency_code` is EUR. Clicking a row opens a modal that correctly shows €12.00.
- **Fix:** On the list, use `formatMoney(Number(rule.amount), rule.currency_code ?? rule.account_currency ?? currency)`. On the detail page, use `money = n => formatMoney(n, rule.currency_code ?? currency)`, and format rows with `rowCurrency(tx, rule.currency_code ?? currency)`. Consider respecting `useBalancePrivacy`, as RecurringCard does.

#### MC-074 — The recurring rule's 'Posted so far' adds amounts in different currencies and shows the total with the workspace symbol
- **Areas:** Recurring, UI formatting, Test harness
- **Where:** `api/_lib/recurring-query.ts:79`, `api/_lib/recurring-query.ts:80`, `src/pages/RecurringDetailPage.tsx:433`
- **Scenario:** A rule posts €12 three times on a EUR wallet, is moved to the INR wallet, and posts ₹1,000 once. `GET /api/recurring/:id` returns `posted_total` '1036.00', and the page shows '−$1,036.00' in a USD workspace instead of '€36.00 + ₹1,000.00' (or a converted figure with an excluded count). The sum also ignores direction, so a rule whose type was edited nets incoming against outgoing.
- **Fix:** Return `posted_by_currency: [{currency, total}]` (grouped by `coalesce(t.currency_code, rule currency)`) and render it with `formatByCurrency`. Optionally also return `posted_total_reporting`, the sum of `reporting_amount`, with `excluded_count`, following the pattern in transactions.ts:356-376.

#### MC-075 — Moving a recurring rule to an account in another currency silently changes what its amount means
- **Areas:** Recurring
- **Where:** `api/_routes/recurring/[id].ts:187`
- **Scenario:** 'Netflix' is €15.00 on a EUR card account and has posted 3 occurrences. On /recurring/:id, the user picks the INR bank under 'Pay with'. PATCH keeps '15.00' and switches `currency_code` to INR, so every future occurrence posts ₹15 instead of about ₹1,400. The dialog gives no hint, because its prefix is the org symbol.
- **Fix:** On the client, when the selected account's currency differs from `rule.currency_code`, show the new currency on the amount field and require the amount to be confirmed again. On the server, accept an explicit `currency_code` that must equal the account's currency, and refuse a currency change without it.

#### MC-076 — RecurringRuleDialog shows server refusals as raw JSON and silently drops the debt link when a payer in another currency is chosen
- **Areas:** Refusal UX & i18n
- **Where:** `src/components/recurring/RecurringRuleDialog.tsx:283`, `src/components/recurring/RecurringRuleDialog.tsx:487`, `api/_routes/recurring/[id].ts:164`
- **Scenario:** Open a EUR debt's repayment rule on /recurring/:id and switch the account to a USD bank. The effect at L283-291 clears the Debt field without a message, because `linkRefusal` returns currency_mismatch. Save sends a PATCH with the USD payer, the server returns 400, and the toast shows the raw response: `{'error':'A repayment for a EUR debt must come from a EUR account','code':'currency_mismatch'}`.
- **Fix:** Replace L487 with `apiErrorMessage(err, t('recurring.saveFailed'))`. For a kind='debt' rule, limit the account picker to the debt's currency, or show a translated inline hint (add `currency_mismatch` to `NEW_DEBT_HINTS`) instead of silently clearing the field.

#### MC-077 — Recurring `last_error` is stored as English text and shown word for word on the debt and recurring screens
- **Areas:** Recurring, Refusal UX & i18n
- **Where:** `api/_lib/recurring-materialize.ts:148`, `api/_lib/recurring-materialize.ts:325`, `src/pages/RecurringDetailPage.tsx:402`, `src/pages/RecurringPage.tsx:193`, `src/pages/DebtDetailPage.tsx:245`
- **Scenario:** A debt repayment rule's paying account changes currency before the rule first posts. On the due date `recordDebtPayment` fails, and `last_error` is set to 'This debt is in EUR — pay it from an account in EUR'. /debts/:id, /recurring/:id and the /recurring row tooltip show that English sentence to Malayalam and Arabic users. 'Currency is missing — edit and save this recurring rule' behaves the same.
- **Fix:** Store a code plus parameters, either as JSON `{code, params}` in `last_error` or in an additive `last_error_code` column, and render it through `t('apiErrors.' + code)`. Keep the English text only as a fallback for older rows.

#### MC-078 — Add-transaction budget hints add the entered amount in its own currency to spending measured in the budget's currency
- **Areas:** Transactions, Budgets, UI formatting
- **Where:** `src/components/transactions/tx-form.tsx:277`, `src/components/transactions/tx-form.tsx:279`, `src/components/transactions/tx-form.tsx:289`
- **Scenario:** Verified in the UI: an overall budget of €1,400 has €500 spent. In Add Transaction, choose Outgoing, IDFC NRO (INR) and 2,000. The hint reads 'Overall Budget: €1,100.00 over after this' (500 + 2,000 − 1,400), although ₹2,000 is about €18.40, which leaves about €881.60. The per-client v1 hint does the same, and so do split totals across accounts in different currencies.
- **Fix:** Pass the entry currency from AccountSelector. Convert each allocation into the budget's currency at the latest rate (from `/api/wealth/summary` `by_currency[].rate` or the cached `/api/fx/rate`) and mark the result '≈'. Hide the hint when no rate is known or when allocations are in several currencies, and format it in the budget's currency. Apply the same to the per-client v1 hint.

#### MC-079 — The budget detail 'Recent' list shows foreign amounts in their own number with the budget's or workspace's currency symbol
- **Areas:** Budgets, UI formatting
- **Where:** `src/pages/BudgetDetailPage.tsx:316`, `api/_lib/spending-budgets.ts:735`, `src/lib/types.ts:1109`
- **Scenario:** A EUR workspace has a Groceries budget of €200 and a ₹2,000 Groceries expense on IDFC NRO. /budgets/<id> Recent shows '€2,000.00'. The row carries `currency_code` INR and `amount_in` of about 18.40, but `SpendingBudgetRecentTx` doesn't declare those fields, and the page formats `Math.abs(r.amount)` with the workspace currency.
- **Fix:** Add `currency_code` and `amount_in` to `SpendingBudgetRecentTx`. Render `formatMoney(abs(amount), r.currency_code ?? budget currency)`, and for foreign rows also show '≈ amount_in' in the budget's currency, or 'no rate' when it is null.

#### MC-080 — Budget allocation, card totals and sibling totals add limits in different currencies without converting
- **Areas:** Budgets, Reports
- **Where:** `src/pages/BudgetsPage.tsx:109`, `src/components/budget/BudgetsCard.tsx:97`, `src/components/budget/SpendingBudgetDialog.tsx:177`, `api/_lib/spending-budgets.ts:330`
- **Scenario:** After a reporting change from INR to EUR, the overall ₹50,000 and Groceries ₹10,000 budgets stay in INR (0069 backfill), while Travel 20,000, created with NULL currency, now counts as EUR. The header computes `allocation(50,000, [10,000, 20,000])` and shows 'Allocated €30,000 of €50,000'. The dashboard BudgetsCard total, SpendingBudgetDialog's `childrenTotal` and `withSpend`'s `restIn` add them the same way.
- **Fix:** Make a sub-budget's currency its parent's, derived when read in `loadRecords`, as its window already is. Convert lines into the overall or reporting currency at the latest rate before computing allocation and card totals, or refuse to add them and show one total per currency.

#### MC-081 — Budgets convert spending into their own currency, but rates are fetched only into the reporting currency and `fx_rate_on` never converts through a third currency
- **Areas:** FX core, Budgets
- **Where:** `api/_lib/spending-budgets.ts:282`, `api/_lib/spending-budgets.ts:303`, `api/_lib/fx-rates.ts:278`
- **Scenario:** A EUR workspace has a budget kept in INR by the 0069 backfill. A $30 expense is recorded on a USD account. `ensureRatesForOrg` fetches only USD→EUR, and 0074 has no path through a third currency, so `fx_rate_on('USD','INR')` is NULL. The row is excluded from the INR budget permanently, or converted with whatever old rows other tenants left behind. Verified read-only: `fx_rate_on('USD','SAR','2026-09-12')` = NULL while USD/EUR resolves.
- **Fix:** In `listBudgets`, budget detail and analytics, call `ensureRatesForOrg` with each distinct budget currency as the target (or add a `targets[]` parameter). Alternatively, convert through the reporting currency in SQL: `reporting_amount` into the reporting currency, then into the budget's currency. Also fix `fx_rate_on`'s rate choice (see the precedence item).

#### MC-082 — Budget status, alerts and adherence treat partial spending (rows without a rate) as complete, so a budget_exceeded alert may never fire
- **Areas:** Budgets, Alerts & notifications
- **Where:** `api/_lib/spending-budgets.ts:342`, `api/_lib/spending-budgets.ts:672`, `api/_lib/notify-budget.ts:181`, `api/_lib/notify-budget.ts:196`, `api/_routes/budgets/detail.ts:61`
- **Scenario:** A EUR overall budget is €500/month. €300 is spent from the EUR bank, and ₹30,000 (about €320) from an INR bank on dates with no INR→EUR rate. `listBudgets` returns €300 spent with `excluded_count > 0`, `budgetAlertTier(300, 500)` is null, and no warning or exceeded notification is sent, although real spending is about €620. Analytics and the v1 adherence count the window as within budget and extend the streak. The per-client cap alert path has the same gap.
- **Fix:** Carry the missing rows into the verdicts: `excluded_count > 0` produces a distinct state, or a flag the UI shows. Windows with excluded rows aren't judged for adherence. Notifications either wait (retry on the next write) or go out marked 'incomplete', and still fire when the counted spending alone crosses a threshold.

#### MC-083 — Rows without a rate are flagged only on the /budgets list; detail, analytics, the dashboard card, client-cap screens and the add-transaction hint show partial totals as complete
- **Areas:** Budgets
- **Where:** `src/pages/BudgetDetailPage.tsx:227`
- **Scenario:** A SAR workspace (open.er-api has only current rates, no history) has a USD expense dated 10 days ago. It has no rate, so it is excluded. /budgets shows FxExcludedNotice, but /budgets/:id (hero and chart), ?tab=analytics, the dashboard BudgetsCard, ClientBudgetsSection, ClientBudgetDetailPage, BusinessBudgetCard and the tx-form hint show the partial total with no note.
- **Fix:** Add `currency` and `excluded_count` to the SpendingBudgetDetail, SpendingBudgetAnalytics (per window) and v1 Budget types, and render `<FxExcludedNotice>` on each of those screens.

#### MC-084 — The budgets 'excluded' notice counts the same row once per budget, and misses rows excluded from the Day/Week/Month/Year views
- **Areas:** Budgets
- **Where:** `src/pages/BudgetsPage.tsx:331`, `api/_routes/spending-budgets.ts:47`
- **Scenario:** One unconverted USD Groceries row falls under three budgets: the overall budget, Groceries and its 'Rice' sub-budget. `budgetsExcluded` adds each budget's count, so the notice reads '3 entries not included'. In Year view, a March USD row with no rate is left out of `spent_by_view.yearly`, but `withSpend` has no per-view excluded count, so no notice appears.
- **Fix:** Return one distinct excluded count per view window from the base query (a `count(*)` filter per window, not per budget), plus a per-budget `excluded_by_view`, and show the count for the selected view.

#### MC-085 — Budget analytics adherence and trend mix currencies: INR caps are dropped from the limit but their spending is kept
- **Areas:** Budgets
- **Where:** `api/_lib/spending-budgets.ts:642`, `api/_lib/spending-budgets.ts:671`, `src/components/budget/BudgetAnalyticsPanel.tsx:56`
- **Scenario:** A EUR workspace has no overall budget and two lines: Fun €100 and Groceries ₹20,000 (backfilled in INR). In a window with €50 of Fun and ₹18,000 (about €200) of Groceries, `budgeted_limit` is €100 because the INR cap is dropped, but `spendOf` is €250 because the INR line's spending is kept. Every window is 'over by €150' and adherence shows 0%. The overall view also plots series in mixed currencies.
- **Fix:** Count only the spending of lines included in `budgeted_limit`, or convert each line's cap into the reporting currency at the rate when the window closed. For the overall view, plot `per_budget[overall.id]` against `overall_limit` in the overall budget's currency, and return and show `analytics.currency`.

#### MC-086 — Card notifications (bell and push) show amounts with no currency
- **Areas:** Cards, Alerts & notifications, UI formatting, API, cache, i18n & native
- **Where:** `api/_lib/notify-cards.ts:17`, `api/_lib/card-autopay.ts:94`
- **Scenario:** In a EUR workspace with an INR credit card, the bell and push read 'Visa Gold •••• 4577: 1800.00 was due 2026-09-15.' (this exact text is on the dev DB) and '1000.00 paid to Visa Gold from Federal'. The notification data has no currency, so notification-ui.tsx can't reformat it. Statement ready, due soon, autopay paid/failed and utilisation notifications are the same, and autopay failure reasons are raw English engine errors.
- **Fix:** Pass the card account's `currency_code` (the AccountRow is available at every call in card-autopay.ts:94-324) and format like `formatBudgetMoney` (e.g. '₹1,800.00', with 'EUR 1,000.00' as the server fallback for push). Put `{amount, currency}` and a stable reason code in `data.i18nParams`, as notify-budget.ts:96-99 does.

#### MC-087 — After an autopay fails and is deferred, the card page keeps announcing the next autopay and hides 'Pay manually'
- **Areas:** Cards
- **Where:** `src/lib/cards.ts:438`, `api/_routes/cards/[id]/summary.ts:46`
- **Scenario:** Once a cross-currency autopay is deferred (`autopay_status` NULL, `autopay_error` set), `autopayEligible` still returns true. `/api/cards/:id/summary` returns `next_autopay = {date: 2026-10-15, amount: 1000}`, and AutopayPanel shows 'Autopay: next 15 Oct · €1,000.00' even after that date has passed. `last_autopay` is null because the summary filters on `autopay_status`, so the failure line and its 'Pay manually' button never appear.
- **Fix:** Treat `autopay_error` with a null status as 'failed' in `autopayEligible` / `autopayPreview`, the same rule `autopayOutlook` in src/lib/alerts.ts uses. Have the summary return `last_autopay` for deferred statements, with status 'failed' and a reason code.

#### MC-088 — Add-card wizard: the limit, debt and statement inputs and the bank picker use the workspace symbol for foreign accounts
- **Areas:** Cards, UI formatting · _known deferred_
- **Where:** `src/components/cards/AddCardWizard.tsx:86`, `src/components/cards/wizard/BankPicker.tsx:232`
- **Scenario:** Verified in the UI: in a EUR workspace, /wealth?tab=cards → Add card → Debit lists 'IDFC NRO … €20,000.00' for a bank holding ₹20,000. Editing an existing card whose account is in USD, in an INR workspace, shows 'Credit limit ₹' for a $2,000 limit.
- **Fix:** In BankPicker, format each bank with `formatMoney(Number(b.current_balance), accountCurrency(b, currency), balancesVisible)`. In the wizard, use the card account's `currency_code` when editing, and the chosen card currency once the credit-card currency picker exists.

#### MC-089 — The Debts 'Interest this month' insight adds interest across debt currencies and labels it with the workspace currency
- **Areas:** Debts
- **Where:** `api/_lib/debts.ts:243`, `api/_lib/debts.ts:285`, `src/pages/DebtsPage.tsx:221`
- **Scenario:** In a EUR workspace this month, a USD loan paid $100 of interest and a EUR loan €25. `interestThisMonth` is 12,500 cents, and the insight reads '€125.00 of this month's loan payments went toward interest and fees' instead of $100 + €25 (about €117 converted).
- **Fix:** Accumulate interest in a `Map<currency, cents>` keyed by the owning debt's currency (`debtCurrencyOf`), and emit the insight per currency or with `formatByCurrency`. Alternatively, sum `debt_payments` interest converted with `reporting_amount(interest, debt currency, dp.date, reporting)`.

#### MC-090 — 'Repaid in total' adds principal across debt currencies and ignores closed (archived) debts, so the debt-free hero reads €0.00
- **Areas:** Debts
- **Where:** `api/_lib/debts.ts:256`, `src/pages/DebtsPage.tsx:178`, `src/components/debts/DebtsCard.tsx:103`
- **Scenario:** (a) €2,000 repaid on an EUR loan plus $1,000 repaid on a USD loan gives `total_repaid` 3000, shown as '€3,000.00'. (b) Pay off an EUR loan (€5,000 of principal) and close it; DELETE archives it. The query only includes loans that are not archived, so it sums over a dummy uuid, and /debts shows the debt-free hero with 'Repaid in total €0.00' (the dashboard card too).
- **Fix:** Sum per debt currency (join wealth_accounts and group by `currency_code`), including archived loans. Return `total_repaid_by_currency` and render it with `formatByCurrency`.

#### MC-091 — The debt 'pressure' ratio divides minimum payments in the workspace currency by an unconverted sum of income in every currency
- **Areas:** Debts
- **Where:** `api/_lib/debts.ts:190`
- **Scenario:** A EUR workspace has a €3,000/month salary on an EUR bank and ₹300,000/month on an INR bank. `averageMonthlyIncome` returns 303,000 (the raw sum divided by 3). With €900 of EUR minimum payments, the Plan tab shows pressure of 0.3% instead of about 25%. debts.ts isn't among the routes tx-sql.test.ts scans, so the check misses it.
- **Fix:** Sum with `reportingAmountSql(reporting)` + `missingRateCountSql` after `ensureRatesForOrg`, or restrict the sum to transactions in the planner's currency and return `{currency, amount, excluded_count}`. Add api/_lib/debts.ts to the tx-sql convention test.

#### MC-092 — Net worth and 'Liabilities' on /wealth still count written-off, paid-off and refinanced debts that /debts no longer counts
- **Areas:** Debts
- **Where:** `api/_lib/wealth-summary.ts:81`, `src/pages/DebtDetailPage.tsx:166`
- **Scenario:** A loan with €4,000 outstanding is marked 'Write off', which changes only its lifecycle status and posts no balance adjustment. /debts drops it from total debt (`isOpenDebt` is false), but `buildWealthSummary` counts every loan that isn't archived. /wealth still shows €4,000 owed, and net worth is €4,000 lower than /debts implies. A written-off receivable likewise stays in assets.
- **Fix:** This needs a product decision. Either post a system 'Written off' balance adjustment when the lifecycle moves to written_off, which keeps the ledger authoritative, or join `debt_details` in wealth-summary and exclude debts that aren't open. Apply the same choice on both screens.

#### MC-093 — The Add-debt sheet always uses the workspace currency and hides foreign accounts, while /recurring can create the same debt in another currency
- **Areas:** Debts
- **Where:** `src/components/debts/DebtFormSheet.tsx:134`, `src/components/debts/DebtFormSheet.tsx:152`
- **Scenario:** An INR workspace has a USD bank. /debts → Add debt has no currency field, so the debt is always INR, and the account filter hides the USD bank from 'money arrived' and 'repay from'. The same debt can be created in USD from /recurring. After a workspace currency change, the sheet offers no accounts at all when every bank is in the old currency.
- **Fix:** Add a CurrencyCombobox (defaulting to the reporting currency, under 'More details') and filter accounts by the chosen currency, or take the currency from the chosen account, as /recurring does.

#### MC-094 — The debt Upcoming tab marks every instalment in a month as paid after a single payment, overstating the paid total
- **Areas:** Debts
- **Where:** `src/lib/debt-status.ts:80`, `src/components/debts/UpcomingPayments.tsx:37`
- **Scenario:** A weekly €100 debt is due on Sep 7, 14, 21 and 28, and one €100 payment was made in September. `upcomingSchedule` marks all 4 rows as paid with `paidAmount` 10,000 cents (verified in a scratch run), and UpcomingPayments shows 'Paid €400.00 · Remaining €0.00' while €300 is still due.
- **Fix:** Inside `upcomingSchedule`, spread the month's paid cents across that month's rows in date order, capping each row at its own amount.

#### MC-095 — The debt planner drops debts in other currencies and explains it with the receivables text; after a workspace currency change it drops every debt
- **Areas:** Debts, UI formatting
- **Where:** `src/components/debts/DebtPlanner.tsx:40`, `src/components/debts/DebtPlanner.tsx:248`
- **Scenario:** A EUR workspace is switched to USD on /organizations. Every EUR debt now fails the `d.currency === currency` check, so `plannable = []` and no plan appears. The note reads 'Car loan (EUR), Mortgage (EUR) — Money others owe you counts toward your net worth, but it is not money in hand.' (`debts.receivablesHint`), which is the wrong explanation.
- **Fix:** Add a dedicated key in all 8 locales (e.g. `debts.plannerExcludedCurrency` 'Planned separately — different currency: {{list}}'). Better: a per-currency plan switcher (currencies from `owed_by_currency`, defaulting to the largest), or conversion at the latest rate with a disclaimer. Limit the excluded list to open loans.

#### MC-096 — Deleting a debt hard-deletes its account when all its rows are in Trash, leaving those rows with no account
- **Areas:** Schema & migrations
- **Where:** `api/_routes/debts/[id].ts:273`
- **Scenario:** Trash a debt's opening-balance and repayment groups, then call `DELETE /api/debts/:id`. The row count includes only live rows, so the account is hard-deleted, and its trashed rows lose their account (FK SET NULL). Restoring the repayment group then debits the bank while the debt side goes nowhere. This matches the 39 account-less 'Loan payment from B' legs on the dev DB.
- **Fix:** Count trashed rows too, as the DELETE in wealth/accounts/[id].ts does ('Trashed rows count too').

#### MC-097 — A business day's rate fetched before ECB publication stays at the previous day's value forever, because `onConflictDoNothing` never replaces the placeholder
- **Areas:** FX core, FX ops tooling
- **Where:** `api/_lib/fx-rates.ts:154`, `api/_lib/fx-rates.ts:196`, `api/_lib/fx-rates.ts:263`, `drizzle/0070_fx_rate_snapshots.sql:24`
- **Scenario:** The first report of a UTC day before about 14:00 UTC (all of Indian working hours) runs `ensureHistoricalRates`. The series ends yesterday, so today is stored as `historical_market` with `is_fallback=true` and yesterday's rate; `currentRate` stores the same under 'market'. The next day's refill brings the real value, but it hits the unique key (base, quote, date, provider, source_type) with DO NOTHING. That business day keeps yesterday's rate in every report.
- **Fix:** In `storeSnapshot`, use `ON CONFLICT (…) DO UPDATE SET rate = excluded.rate, is_fallback = false, observed_at = excluded.observed_at, fetched_at = now() WHERE fx_rate_snapshots.is_fallback AND NOT excluded.is_fallback`. Make the coverage check count only non-fallback rows for business days, or refetch the last 7 days.

#### MC-098 — `fx_rate_on` prefers an old direct-pair rate over a newer inverse-pair rate
- **Areas:** FX core, FX ops tooling
- **Where:** `drizzle/0074_fx_reporting_amount.sql:20`, `drizzle/0074_fx_reporting_amount.sql:21`
- **Scenario:** `COALESCE(latest direct ≤ date, latest inverse ≤ date)` looks at the inverse pair only when no direct row exists at any earlier date. On the dev DB, `fx_rate_on('EUR','INR','2026-09-30')` returns 110.7675, a placeholder from 09-14, while `1/fx_rate_on('INR','EUR','2026-09-30')` is 108.8139, a real observation from the same day. A €1,000 expense is reported as ₹110,767.50 instead of about ₹108,814, with no flag. USD→INR is off by −0.8% in the same way.
- **Fix:** Replace `fx_rate_on` in a new migration: combine the direct and inverted inverse candidates with UNION ALL, and pick one with `ORDER BY rate_date DESC, manual DESC, is_fallback ASC, is_direct DESC, fetched_at DESC LIMIT 1`. Optionally add a maximum-age condition (see the rate-age item).

#### MC-099 — Rates carried forward from earlier days have no age limit and no 'estimated' marker, so reports silently convert at weeks-old rates
- **Areas:** FX core, Budgets, Reports · _known deferred_
- **Where:** `drizzle/0074_fx_reporting_amount.sql:1`, `drizzle/0074_fx_reporting_amount.sql:22`, `drizzle/0074_fx_reporting_functions.sql:19`
- **Scenario:** EUR→AED has one market row, from 2026-09-09. An AED expense on 2026-09-30 is converted at that 21-day-old rate, 4.269072, with no flag and no excluded count. `fx_rate_on('EUR','USD','2026-09-29')` returns the 09-14 rate. The same happens on every day the provider is down, and for non-ECB currencies between visits, in reports, budgets and the flow/wealth 'today' conversion.
- **Fix:** Decide a maximum rate age for reports. Return an `estimated_count` next to `excluded_count` (rows whose rate date is more than N business days before the row's date, or a fallback rate on a weekday) and show it next to FxExcludedNotice. Alternatively, treat rows beyond the maximum age as excluded.

#### MC-100 — Two definitions of 'today's rate': `currentRate` (/wealth and the transfer suggestion) and `fx_rate_on` (/flow and reports) use different sources and precedence
- **Areas:** FX core, Test harness
- **Where:** `api/_lib/fx-rates.ts:185`, `api/_lib/fx-rates.ts:205`
- **Scenario:** On the dev DB today, the INR→EUR market row (from open-er-api) is 0.009186 and the historical row is 0.00919. ₹1,00,000 therefore shows as about €918.60 on /wealth and €919.00 in the /flow balance. With a manual EUR→INR row of 80 next to a market row of 81.2, `/api/wealth/summary` converts at 81.2 while Money Flow's root uses 80. After 12 hours the market row counts as stale, but DO NOTHING never refreshes it.
- **Fix:** Use one rate source and one precedence (latest rate date first, then manual before market, non-fallback before fallback, newest fetch): have wealth-summary read `fx_rate_on(current_date)`, or make `currentRate` apply the same ordering. Upsert market rows (DO UPDATE rate and fetched_at) so the 12-hour freshness window can be met.

#### MC-101 — `currentRate` reports a same-day placeholder as today's fresh rate, and its stale flag and rate date differ between the provider and database paths
- **Areas:** FX core, FX ops tooling
- **Where:** `api/_lib/fx-rates.ts:185`, `api/_lib/fx-rates.ts:198`
- **Scenario:** At 09:00 UTC on Wednesday 2026-09-30, a USD workspace with a EUR account opens /wealth. Today's market row holds Tuesday's ECB value with `is_fallback=true`. The freshness check ignores `isFallback` and returns `{rateDate: '2026-09-30', stale: false}`, so ApproxBalance shows '≈ as of 30 Sep' and hides the stale label. After 12 hours it asks the provider again on every request. On a Monday, the provider path returns Friday's date with `stale: false` while the database path returns today's date for the same value, so 'as of' changes between page loads.
- **Fix:** In the freshness check, return `stale: fresh.isFallback` and treat a fallback row older than 1 hour as not fresh. Return the observation date the same way on both paths, and decide whether a provider date that lags behind counts as stale. With the storeSnapshot upsert, the refetched real value replaces the placeholder.

#### MC-102 — Rates for weak currencies lose precision because they are always fetched as foreign→reporting, and Frankfurter rounds cross rates
- **Areas:** FX core
- **Where:** `api/_lib/fx-rates.ts:297`
- **Scenario:** KRW→USD is stored as 0.00074; the true value is 1/1355.4 = 0.000737789, so it is +0.30% off, and up to ±0.68%. IDR→USD is stored as 5.6e-05 (+0.19%, up to ±0.9%). A USD workspace with a ₩10,000,000 account shows about $7,400.00 instead of $7,377.89, and every KRW row in analytics is off by the same factor.
- **Fix:** Always fetch EUR-based rates for both currencies (EUR is Frankfurter's native base, with 5–7 significant digits) and derive quote/base with Decimal to 14 decimal places. Alternatively, fetch the stronger direction and store its inverse computed with Decimal.

#### MC-103 — `formatRate` rounds very small rates to zero or to wrong values
- **Areas:** FX core
- **Where:** `src/lib/wealth.ts:166`, `src/components/wealth/CurrencyBreakdown.tsx:57`
- **Scenario:** Rates below 1 are shown with at most 4 decimal places. An IDR account in a USD workspace shows '1 IDR = $0.0001' (the true rate is 0.0000559, so the label is 79% off), VND shows '$0.00' and KRW '$0.0007'. The converted ≈ amounts are right; only the rate label is wrong.
- **Fix:** Use `maximumSignificantDigits` (e.g. 6) for rates below 1, or show the rate in the direction that is ≥ 1 ('1 USD = Rp17,891').

#### MC-104 — No scheduled FX refresh: rates exist only for days on which someone opened a report
- **Areas:** FX ops tooling · _known deferred_
- **Where:** `api/_lib/fx-rates.ts:278`, `api/_routes/cron/notifications.ts:114`
- **Scenario:** `ensureRatesForOrg` is called only from user GET requests. `runNotificationTick` has no FX step, there is no Vercel cron, and the worker has no FX job. Non-ECB pairs are fetched only by `currentRate` on days with traffic, so gaps are silently filled from the last day someone visited. On the dev DB, EUR/AED has a single row from 2026-09-09 that is still used, unmarked, 20 days later.
- **Fix:** Add an FX block to `runNotificationTick`, which the worker already runs hourly, with a GitHub fallback every 2 hours. It selects the distinct (currency, reporting currency) pairs once, then refreshes each pair's current and recent rates through the upserting storeSnapshot. Once it runs, request paths can skip the rate check or only read.

#### MC-105 — Cross-currency transfers and card payments sent without a destination amount can never succeed; the AI assistant (and old app builds) fail with a generic or English error
- **Areas:** AI & imports, Refusal UX & i18n, Rollout & back-compat
- **Where:** `src/components/AiAssistantConfirm.tsx:135`, `src/components/AiAssistantConfirm.tsx:136`, `src/components/AiAssistantConfirm.tsx:179`, `src/lib/money.ts:133`
- **Scenario:** In a EUR workspace, the user says 'paid 100 to Visa Gold from IDFC NRO'. The live parse gives a transfer from IDFC NRO (INR) to Visa Gold (EUR). The card says 'Preparing a €100.00 card payment…', and Save posts `/api/wealth/transfer` with only `{amount: 100}`. `transferAmounts` throws and the route returns 400 `invalid_transfer_amounts`. The catch shows `aiVoice.failed` ('Something went wrong — please try again', the same generic text in Malayalam), so retrying can never work. Older builds of TransferWizard, PayCardSheet and SpaceTransferModal hit the same refusal, shown in English as 'Destination amount is required…'.
- **Fix:** When the from and to currencies differ, show a 'Received (EUR)' input, optionally prefilled from `/api/fx/rate` and marked as an estimate, and send `source_amount` / `destination_amount` / `source_currency` / `destination_currency`. Alternatively, hand off to TransferWizard through `onEdit()`. Read the error body's `code` to show a readable message. For old builds, make the refusal actionable: 'Update the app to move money between currencies'.

#### MC-106 — The AI voice review card ignores amount confidence, so an amount in a doubtful currency is still saved with one tap
- **Areas:** AI & imports
- **Where:** `src/components/AiAssistantConfirm.tsx:102`
- **Scenario:** The prompt's only currency safeguard is to lower `confidence.amount` (e.g. to 0.4 for 'twenty pounds' in a EUR workspace). AiAssistantConfirm never reads `confidence`: `needsAmount` is only `!(amount > 0)`. The amount is shown read-only, `canSave` is true, and Save stores it. The full dialog does respect confidence (fill at 0.55, 'high' at 0.85).
- **Fix:** Treat `confidence.amount < 0.85`, or a parsed currency that differs from the account's, as `needsAmount`. Show the editable amount input with the account's currency symbol and a 'you said USD' hint.

#### MC-107 — The quick-add (+ button) success toast shows a foreign-account entry in the workspace currency
- **Areas:** UI formatting, AI & imports
- **Where:** `src/components/AppLayout.tsx:215`, `src/components/MobileAppLayout.tsx:233`, `src/components/transactions/AddTransactionDialog.tsx:35`
- **Scenario:** In a EUR workspace, tap + → Add transaction, pick IDFC NRO (INR), enter 500 and Save. The toast reads 'Expense of €500.00 added', because `CreatedTxInfo {id, type, amount}` carries no currency and `onTxCreated` formats with `useCurrency()`. MobileAppLayout.tsx:233 has the same bug.
- **Fix:** Add `currency` to `CreatedTxInfo`: the currency of the first allocation's account, which AddTransactionDialog already knows from `accounts`. Format with it in both layouts.

#### MC-108 — Quotations have no currency, so the list and regenerated PDFs relabel every quotation when the workspace currency changes
- **Areas:** Alerts & notifications, Org, billing & admin, AI & imports
- **Where:** `api/_lib/quotation-pdf.ts:81`, `src/pages/QuotationsPage.tsx:179`
- **Scenario:** In a EUR business workspace, quotation 'Website' for 12,000 was sent as a PDF reading 'EUR 12,000.00'. The owner switches to INR. QuotationsPage now shows '₹12,000', and `buildQuotationSnapshot` takes `org.currency`, now INR. Because the currency is part of `snapshotHash`, the PDF modal marks the sent PDF as out of date, and 'Regenerate' prints 'INR 12,000.00'. In a EUR workspace, the AI saves 'quote for 500 dollars' as 500 with no warning.
- **Fix:** Add a nullable `quotations.currency_code` (additive migration), set to the reporting currency when a quotation is created, including the AI and QuickAddModal paths (optionally with a picker), and backfill it from `organizations.currency`. Have the list, QuickAdd and `buildQuotationSnapshot` use the row's currency instead of the org's. Alternatively, document that quotations follow the workspace and block the change.

#### MC-109 — The pricing page and checkout take the country from different sources, so the displayed currency can differ from the one charged
- **Areas:** Org, billing & admin
- **Where:** `api/_routes/billing/pricing.ts:21`, `api/_routes/billing/create-subscription.ts:143`
- **Scenario:** A user whose profile country is IN browses from a US IP, and the org currency is USD. `GET /api/billing/pricing` uses `x-vercel-ip-country=US`, so `resolve('USD','US')` gives USD prices. `POST create-subscription` prefers the profile country, IN, so `resolve('USD','IN')` gives INR, and Dodo's hosted page charges INR.
- **Fix:** Resolve the country the same way in both routes (profile country first, then IP) through one shared helper.

#### MC-110 — The referral reward currency isn't validated, and an invalid code crashes /referrals for every user
- **Areas:** Org, billing & admin
- **Where:** `api/_routes/admin/referral-settings.ts:33`, `src/pages/ReferralPage.tsx:27`
- **Scenario:** An admin types 'US' (the input allows 3 characters) or clears the field, and saves. The server stores it after `slice(0,3).toUpperCase()`. ReferralPage's `money()` calls `Intl.NumberFormat` with currency 'US', which throws RangeError 'Invalid currency code' (verified in Node), so the page falls into the error boundary for every user.
- **Fix:** Return 400 unless the code is in `CURRENCY_LIST`. Optionally use the guarded `formatMoney` from src/lib/wealth.ts on the page.

#### MC-111 — The admin referrals 'Owed' figure adds rewards in different currencies
- **Areas:** Org, billing & admin
- **Where:** `src/pages/admin/AdminReferralsPage.tsx:93`, `src/pages/admin/AdminReferralsPage.tsx:171`
- **Scenario:** Paid rewards of ₹249.75 and $2.50 give owed = 252.25, formatted in `settings.reward_currency` as '$252.25'.
- **Fix:** Reduce into a Map keyed by `reward_currency` and show one figure per currency.

#### MC-112 — The admin org detail's 'Net flow' and client totals add amounts in different currencies, include trashed and system rows, and show no currency
- **Areas:** Org, billing & admin, FX ops tooling, UI formatting, Test harness
- **Where:** `api/_routes/admin/org-detail.ts:57`, `api/_routes/admin/org-detail.ts:58`, `api/_routes/admin/clients.ts:64`, `src/pages/admin/AdminOrgDetailPage.tsx:320`
- **Scenario:** An org reporting in USD has a USD bank that received $1,000, an EUR bank that received €1,000, and a €300 refund. `incoming_total` is '2000', an unconverted sum; outgoing ignores refunds; and the tile shows 'Net flow 2000 − x' with no currency, computed with JavaScript floating-point subtraction. The Clients tab's unconverted sums also count trashed rows and a 5,000 Opening Balance system row. Dev org 920a6c5f shows −6 where the converted value is −$6.80.
- **Fix:** Use `incomeSumSqlIn` / `expenseSumSqlIn(reportingCurrencyFor(org))` + `missingRateCountSql`, filtered to `is_system = false` and `deleted_at IS NULL`, or group by `currency_code`. Return `reporting_currency` and `excluded_count`, and render with them.

#### MC-113 — The admin Transactions tab shows foreign rows as bare numbers under an 'Amounts are in {org currency}' header
- **Areas:** Org, billing & admin
- **Where:** `src/pages/admin/AdminOrgDetailPage.tsx:781`, `src/pages/admin/AdminOrgDetailPage.tsx:842`, `api/_routes/admin/transactions.ts:11`
- **Scenario:** A €100 row on an EUR account in a USD workspace is shown as '100' under 'All transactions across every client. Amounts are in USD.' The `txFields` in admin/transactions.ts don't select `currency_code`.
- **Fix:** Select `transactions.currencyCode`, render each row with `formatMoney(amount, row.currency_code)`, and remove the claim from the header.

#### MC-114 — The 'Delete tag & records' dialog understates what will be trashed and promises it can be undone when it can't
- **Areas:** Cascade soft-delete
- **Where:** `src/components/categories/TagsPanel.tsx:398`, `api/_lib/tag-ops.ts:110`
- **Scenario:** Tag #vip is on one client that has 40 transactions on EUR and INR accounts. The dialog says 'Also move 1 tagged record to Trash (reversible)'. The cascade trashes the client and all 40 rows, changing the balances of both accounts, and the toast then says 41 records. For a tagged transfer leg, the delete can't actually be undone (see the tag-delete item).
- **Fix:** Return a dry-run count (`GET /api/tags/:id?preview=with_records` → `{transactions including the cascade, clients, quotations}`), or compute the cascaded rows in `usageCounts`, and show that count in the hint. Drop 'reversible' until transfer rows go through the transfer service. The new text needs translating in all 8 locales.

#### MC-115 — Deploy order: origin/dev ships 0075 stamped above 0069–0074, so if dev reaches a database first, those migrations are skipped silently
- **Areas:** Schema & migrations
- **Where:** `drizzle/meta/_journal.json:1`, `scripts/db-migrate.mjs`
- **Scenario:** origin/dev's journal goes from 0068 (`when` 1789303202014) straight to 0075 (`when` 1789383113149), without 0069–0074. If dev is deployed to main/production, or to any Preview or e2e DB, before this branch merges, that database's watermark becomes 1789383113149. When this branch lands, 0069–0074 (`when` 1789303202114…614) sort below the watermark and are skipped while db:migrate prints 'up to date'. 0076 then fails on the missing `currency_code`.
- **Fix:** Gate the release: merge this branch into dev before any dev→main promotion, and check the watermarks of the e2e and Preview DBs. If dev ships first, re-stamp 0069–0074 above production's watermark on a fresh branch. Add a post-migrate check in scripts/db-migrate.mjs (or a sentinel migration at the head) that fails when `transactions.currency_code` or `reporting_amount(numeric,text,date,text)` is missing.

#### MC-116 — The 0071 backfill gives legacy transfers that were trashed before the migration a live header, so restoring them from Trash returns 409
- **Areas:** Schema & migrations, Cascade soft-delete
- **Where:** `drizzle/0071_logical_transfers.sql:57`, `drizzle/0071_logical_transfers.sql:65`
- **Scenario:** Before the deploy, a production user trashed a bank→card payment, so both legs have `deleted_at` set. 0071's CTE has no `deleted_at` filter, so it inserts a 'completed' header, and 0073 adds `transfers.deleted_at = NULL` without a backfill. In /trash, Restore makes restore.ts:31 call `set_transfer_trashed(restore=true)`, which raises `invalid_transfer_trash_state` (409). The dev DB has no rows like this, but production hasn't been audited.
- **Fix:** Since 0071 hasn't run in production, add `HAVING count(distinct (t.deleted_at is null)) = 1` to the CTE. After 0073, set `transfers.deleted_at = max(leg.deleted_at)` where every linked row is trashed. Before deploy, run a read-only audit against production for mismatches (a live header with a trashed row, or a trashed header with a live row), and add the repair statement in an additive 0077 for the dev and e2e DBs.

#### MC-117 — 0076 relabels foreign debts' legs into the debt's currency without auditing existing repayments that span two currencies, and such debts stop posting after deploy
- **Areas:** Schema & migrations, Rollout & back-compat
- **Where:** `drizzle/0076_debt_account_currency.sql:25`, `api/_lib/debts.ts:423`
- **Scenario:** v0.14.x allowed a USD loan in an INR workspace, repaid by a rule from an INR bank, with the principal recorded as the same number on both legs (100 and 100). After 0076, the loan leg reads USD 100 and the bank leg INR 100: one principal payment in two currencies with no rate, so the debt falls by $100 while the bank paid ₹100. The next scheduled posting calls `recordDebtPayment`, which returns currency_mismatch, and the rule stops paying.
- **Fix:** Before deploy, run read-only production audits for: (a) debts whose currency differs from the org currency; (b) debt-linked recurring rules whose paying account's currency differs from the debt's after 0076; (c) debt groups whose legs span more than one currency. Then decide whether to leave those debts as they are, pause them with a notice, or migrate them.

#### MC-118 — Rows written by the old deployment during the build window, or after a rollback, get a NULL `currency_code`, and the affected accounts can no longer transfer
- **Areas:** Rollout & back-compat · _known deferred_
- **Where:** `api/_lib/wealth-accounts.ts:325`
- **Scenario:** vercel-build runs db-migrate (the 0069 backfill) before building, and the old v0.14.1 deployment keeps serving until the new one is promoted, and again after an instant rollback. An account created in that window gets `currency_code` NULL, because 0069 adds no DEFAULT or trigger. After promotion, every transfer or card payment involving that account returns 409 `currency_missing`, and edits to its rows fail.
- **Fix:** Add a BEFORE INSERT trigger on wealth_accounts, transactions and recurring_rules that fills a NULL `currency_code` (from the account, else the organization's `coalesce(reporting_currency, currency)`). It covers both the build window and a rollback. Alternatively, repair NULLs on the fly in `ensureCashAccount` / `GET /api/wealth/accounts`.

#### MC-119 — Old app builds ignore `excluded_count`, so partial converted totals look complete
- **Areas:** Rollout & back-compat
- **Where:** `api/_routes/analytics.ts:1`
- **Scenario:** An INR workspace has an AED account, and there are no historical AED rates. `/api/analytics`, `/calendar`, `/flow`, `/clients`, `/transactions?page=` and `/spending-budgets` leave out the AED rows and return `excluded_count > 0`. Builds from before multi-currency never show it (FxExcludedNotice is new), so they present '₹X income' as exact.
- **Fix:** Accept and document this for old builds, or limit the impact by blocking foreign-currency account creation until the new native release is widely installed (see the old-builds item). New clients already show FxExcludedNotice.

#### MC-120 — The native shells still contain the web bundle from before multi-currency; cap:sync is required before release
- **Areas:** API, cache, i18n & native · _known deferred_
- **Where:** `android/app/src/main/assets/public/index.html:1`
- **Scenario:** The local Android and iOS web bundles were built on 2026-09-14 and contain no call to `/api/wealth/summary` or `/api/fx/rate`. A native build made without re-syncing ships the old wealth UI (unconverted totals) against the new API.
- **Fix:** After the fixes, and once the API is live, run `npm run cap:sync:android` and `npm run cap:sync:ios`, bump the store versions, and check /wealth 'By currency' and the ≈ lines on the emulator and simulator.

#### MC-121 — The static check for unsafe sums (tx-sql.test.ts) covers only 5 routes, so unconverted cross-currency sums elsewhere pass
- **Areas:** Test harness
- **Where:** `api/_lib/tx-sql.test.ts:118`
- **Scenario:** Unconverted sums at api/_routes/transactions/[id].ts:80, api/_lib/recurring-query.ts:80, api/_lib/debts.ts:257 and api/_routes/admin/org-detail.ts:58/63 all pass the check, which is how several of the items above shipped.
- **Fix:** Add a DB-free test that scans `api/**/*.ts` for `sum(` over amount, current_balance or principal, and fails unless the sum is wrapped in `reporting_amount`, grouped by `currency_code`, or on an allowlist of single-account native sums (credit-card.ts:129, debts.ts:194, alerts.ts:78, alerts.ts:148).

#### MC-122 — Multi-currency e2e fixtures pile up in the permanent personal workspace, so the reversal test silently stops testing anything
- **Areas:** Test harness
- **Where:** `e2e/multi-currency.spec.ts:313`, `e2e/multi-currency.spec.ts:326`
- **Scenario:** On the dev DB, the e2e user's personal workspace holds 8 e2e-ux4-mc wallets (6 archived) and 26 transfers (11 live, 6 cancelled, 4 reversal chains). Because a reversed transfer already exists, every run takes the 409 branch, and the +505 / −51,350 assertions never run. On a free-plan branch, the 30-transactions-per-client quota is eventually hit.
- **Fix:** Create a throwaway business org for each run (`POST /api/organizations {name: 'e2e-mc-<runId>', currency: 'EUR'}`) and delete it in afterAll; the org's foreign keys cascade to accounts, transfers, reversals and debts. Remove leftover 'e2e-mc-*' orgs in auth.setup.ts.

### ⚪ low (55)

#### MC-123 — `reporting_amount` treats a row with NULL currency as already in the reporting currency, so such rows change meaning after a reporting change
- **Areas:** FX core, Reports · _known deferred_
- **Where:** `drizzle/0074_fx_reporting_amount.sql:1`, `drizzle/0074_fx_reporting_amount.sql:34`, `api/_lib/tx-sql.ts:60`, `src/lib/reporting-fields.ts:37`
- **Scenario:** `reporting_amount` returns the amount unchanged when `p_from IS NULL`, and `missingRateSql` / `reportingAmountOf` never count such rows as excluded. After a reporting switch from USD to INR, a $500 expense with no currency tag is counted as ₹500. The 69 untagged rows on the dev DB (created 2026-09-12/13) all belong to deleted orgs, so no live workspace is affected yet (see the refuted list).
- **Fix:** Finish auditing that every writer sets the currency, backfill the remaining NULLs (0069's rule for rows without an account: the org currency at the time of writing), then make the column NOT NULL. Until then, count NULL-currency rows as excluded when the reporting currency differs from the org's original currency.

#### MC-124 — Money flow adds the legs of a mixed-currency split without converting and labels them with the first leg's currency
- **Areas:** Reports, UI formatting · _known deferred_
- **Where:** `src/lib/money-flow.ts:235`, `src/pages/MoneyFlowPage.tsx:311`, `src/pages/MoneyFlowPage.tsx:367`
- **Scenario:** A split posted through the API across EUR 50 and INR 5,000 appears on /flow as one '−€5,050.00' item, and the expanded legs read '€50.00' and '€5,000.00'. Only the API or an old client can create such a split; the web AccountSelector blocks it.
- **Fix:** Keep `currency_code` on each leg in `collapseLegs`. When legs differ, use the sum of `reporting_amount` (or show per-currency parts) and format each leg in its own currency. Refusing mixed splits in group.ts removes the source.

#### MC-125 — Archived extra cash wallets can never be restored, and PATCH refuses to archive any cash wallet
- **Areas:** Wealth & Spaces
- **Where:** `api/_routes/wealth/accounts/[id].ts:135`, `api/_routes/wealth/accounts/[id].ts:155`, `api/_routes/wealth/accounts/[id].ts:288`
- **Scenario:** A workspace has Cash in Hand (INR) plus a user-created EUR cash wallet. Archiving the EUR wallet works (DELETE archives it because it has history). But Archived → Restore sends `PATCH {restore: true}`, which counts active cash wallets (at least one, the permanent Cash in Hand) and returns 400 'Cash in Hand already exists'. `PATCH {archive: true}` on the EUR wallet is refused as well.
- **Fix:** Apply both checks only when `account.bankName === DEFAULT_CASH_NAME`, as the DELETE path already does at L288.

#### MC-126 — Changing a debt's currency is a count followed by three separate updates, so it races with payments and can leave the account and the debt in different currencies
- **Areas:** Concurrency & invariants
- **Where:** `api/_routes/debts/[id].ts:131`, `api/_routes/debts/[id].ts:241`, `api/_routes/debts/[id].ts:246`, `api/_routes/debts/[id].ts:249`
- **Scenario:** The route counts non-system rows (L131-138), then updates the account's currency (L241), relabels all rows (L246) and updates `debt_details` (L249). A repayment committed between L131 and L246 has its debt-side principal leg relabelled, while the paying account's leg keeps the old currency. A crash between L241 and L249 leaves `wealth_accounts.currency_code` different from `debt_details.currency`, breaking the invariant 0076 established.
- **Fix:** Run the three updates in one dbBatch, guarded by `WHERE NOT EXISTS (non-system rows)`. This batching becomes mandatory under the proposed deferred foreign key.

#### MC-127 — No FX monitoring: provider failures, pairs with no coverage and excluded rows per org are invisible
- **Areas:** FX ops tooling
- **Where:** `api/_lib/fx-rates.ts:113`, `api/_lib/fx-rates.ts:124`, `api/_lib/fx-rates.ts:199`, `api/_lib/fx-rates.ts:253`
- **Scenario:** Every FX failure is swallowed: `catch {}` at L199 and L253, silent fallbacks to the next provider at L113 and L124, and `.catch(() => undefined)` at all 12 call sites. The `uncovered` array returned by `ensureRatesForOrg` is ignored by every caller, and fx-rates.ts, fx-provider.ts and wealth-summary.ts contain no console call. A provider outage, or a pair that never gets coverage, shows up only as 'excluded' notices in front of users.
- **Fix:** Add one `console.warn('[fx] provider failed', {pair, provider, date, message})` at each catch, never logging amounts. Add an `fx` block to `GET /api/admin/worker` (cap 'read'), shown on AdminWorkerPage, with per pair: the latest non-fallback rate date, the latest fetch time, missing weekday rates, pairs with no coverage, and excluded counts per org.

#### MC-128 — The multi-currency e2e tests depend on the live FX providers
- **Areas:** FX core, Test harness
- **Where:** `e2e/multi-currency.spec.ts:211`, `e2e/multi-currency.spec.ts:228`, `playwright.config.ts:79`, `.github/workflows/e2e.yml:34`
- **Scenario:** The 'consolidated wealth converts' test expects `complete=true` and a non-null INR rate from real Frankfurter and open.er-api calls. A slow or failing provider turns CI red: a cold server can spend 4–12 s per foreign currency against a 45 s timeout. Rates change daily, so no exact figure can be asserted, and stale, missing or fallback states can't be tested. `FX_FRANKFURTER_HOST`, `FX_OPEN_ER_API_HOST` and `FX_DISABLED` exist but no test uses them.
- **Fix:** Set `FX_DISABLED=1` in `webServer.env` and in e2e.yml, and add a guarded `seedFxRates()` (only with `E2E_FX_SEED=1`, only on the dedicated branch) that writes fixed rates with provider='e2e-fixed'. Alternatively, serve fixture rates from a local stub through the two host variables.

#### MC-129 — Hand-written money formatters bypass `formatMoney`, so number grouping, zero- and three-decimal currencies and decimal places differ between screens
- **Areas:** Schema & migrations, Org, billing & admin, UI formatting, API, cache, i18n & native · _unverified_
- **Where:** `src/pages/TransactionsPage.tsx:260`, `src/components/TransactionPeekModal.tsx:46`, `src/pages/QuotationsPage.tsx:179`, `src/lib/wealth.ts:111`
- **Scenario:** With the UI in English, ₹1,234,567.50 shows as '₹12,34,567.50' on /wealth (en-IN grouping) but '₹1,234,567.50' on the Dashboard, Transactions and ClientDetail (hard-coded en-US). A JPY row of 1,500.50 shows '¥1,500.50' in the peek and '¥1,501' elsewhere. ClientDetailSheet, ClientOverviewModal and the Quotations list force 0 decimals, so KWD 1.25 shows as 'KWD 1', and a 1,234.56 quotation shows as '$1,235' while its PDF says 'USD 1,234.56'. In Arabic, /wealth shows '‏1,234.50 US$' while the Dashboard shows '$1,235'.
- **Fix:** Replace the hand-written formatters (TransactionsPage, ClientDetailPage, Dashboard, Analytics L34, ClientsPage L103, Quotations L179, Trash L39, Calendar L40, ClientDetailSheet, ClientOverviewModal) with `formatMoney` / `moneyLocale`, plus a compact variant for chart axes and calendar cells, so locale and ISO minor units come from one place. Use Indian grouping for INR in all Indian-language UIs.

#### MC-130 — Sorting by amount compares numbers in different currencies as if they were the same
- **Areas:** Transactions, Reports · _unverified_
- **Where:** `api/_routes/transactions.ts:28`, `api/_routes/transactions.ts:133`, `src/pages/ClientDetailPage.tsx:238`
- **Scenario:** A USD workspace has a €100 expense (about $116) and a ₹5,000 expense (about $56). 'Amount: largest' lists the ₹5,000 row first. On client detail, 'Amount (high → low)' ranks ₹75,000 (about $785) above $1,000. The sort for grouped rows uses `sum(amount)` in the same way.
- **Fix:** Order by `reporting_amount` (for groups, the sum of reporting amounts) with rows lacking a rate last, at least when the org holds more than one currency.

#### MC-131 — A mixed-currency split's header shows a converted total with no 'approximate' marker (`currency_count` is never used)
- **Areas:** Transactions · _unverified_
- **Where:** `src/pages/TransactionsPage.tsx:213`
- **Scenario:** A legacy or API-created split of €50 + ₹1,000 in a USD workspace shows '−$69.xx' on the row and in the detail header, exactly like a native figure, while its legs show their own currencies. Nothing says the header is converted.
- **Fix:** When `currency_count > 1`, prefix the total with '≈' (the ApproxBalance pattern), or show one total per currency.

#### MC-132 — The server accepts a reversal of a reversal (the UI part of this report was refuted)
- **Areas:** Schema & migrations · _unverified_
- **Where:** `src/components/TransactionDetailModal.tsx:78`, `api/_lib/wealth-accounts.ts:586`
- **Scenario:** The analyst reported two things: that 'Reverse' appears on a 'Transfer reversal' leg because new legs carry `transfer_id`, and that `reverseTransfer` only blocks a second reversal of the same original, so reversing a reversal re-applies the original movement. Verifiers refuted the UI part in the sibling report (#49): list and detail payloads don't include `transfer_id`, so the modal's lookup does run. What remains, unverified, is that the server accepts a reversal of a reversal through the API.
- **Fix:** This is a policy decision (D5). If reversals of reversals are not wanted, refuse in `reverseTransfer` when `original.reversesTransferId` is set. Optionally include `reverses_transfer_id` / `reversed_by` in the transaction payload so the modal never depends on a lookup.

#### MC-133 — Reverse is offered when the other account of the transfer is archived, and the refusal has no code and is in English
- **Areas:** Refusal UX & i18n · _unverified_
- **Where:** `src/components/TransactionDetailModal.tsx:88`, `api/_lib/wealth-accounts.ts:314`
- **Scenario:** Transfer from a EUR bank to an INR bank, then archive the INR bank. Open the EUR leg and click Reverse. `createTransfer` returns 400 'Select two active accounts' with no code, shown as an English toast.
- **Fix:** Include both accounts' archived state in `canReverse` (or hide Reverse), and add the code `transfer_account_unavailable` to that failure so it can be translated.

#### MC-134 — TransferWizard's insufficient-funds warning ignores the transfer fee
- **Areas:** Wealth & Spaces, API, cache, i18n & native · _unverified_
- **Where:** `src/components/wealth/TransferWizard.tsx:199`, `src/components/wealth/TransferWizard.tsx:203`
- **Scenario:** A EUR wallet holds €100. Send €98 with a €5 fee. `overBalance` compares only 98 ≤ 100, so no warning appears, yet the source is debited €103 and ends at −€3.
- **Fix:** Compare `sourceTotal` (principal + fee) with the balance or available credit.

#### MC-135 — Chart tooltips show bare numbers without a currency
- **Areas:** Reports, UI formatting · _unverified_
- **Where:** `src/pages/AnalyticsPage.tsx:167`, `src/pages/BudgetDetailPage.tsx:280`, `src/components/budget/BudgetAnalyticsPanel.tsx:121`, `src/pages/ClientBudgetDetailPage.tsx:139`
- **Scenario:** Hovering a bar on /analytics shows '11.59' with no symbol, while the axis says '$12'. The budget detail, budget analytics and client-cap charts do the same. This predates multi-currency, but with several currencies the currency is exactly what the user needs to see.
- **Fix:** Pass `formatter={(v) => formatMoney(Number(v), currency)}` to ChartTooltipContent, as the Dashboard chart does.

#### MC-136 — The Dashboard shows the FX excluded notice only under the KPI card
- **Areas:** Reports · _unverified_
- **Where:** `src/pages/Dashboard.tsx:1191`
- **Scenario:** If the KPIs card is hidden through Customise dashboard, the chart, breakdown and flow preview still leave out rows without a rate, but no notice appears anywhere, so the partial figures look complete.
- **Fix:** Render FxExcludedNotice in the chart, breakdown and flow cards, or once at page level whenever `fxExcluded > 0`.

#### MC-137 — Calendar and flow excluded notices count the wrong rows, and per-day excluded counts are never shown
- **Areas:** Reports · _unverified_
- **Where:** `src/pages/CalendarPage.tsx:139`, `src/pages/CalendarPage.tsx:245`
- **Scenario:** In month view, a CHF row on a day from the neighbouring month (Aug 31 on the September grid) makes the notice say '1 entry not included', although that row isn't part of the September totals. A day whose only row has no rate shows $0 with no marker. The excluded counts that analytics returns per series, category and client are ignored, and the flow notice adds account-balance exclusions to row exclusions.
- **Fix:** Count only the rows in the visible period for the calendar notice. Add a marker or tooltip on day cells, bars and groups whose `excluded_count > 0`. In flow, describe excluded accounts separately from excluded rows.

#### MC-138 — `Intl` throws a RangeError in iOS 15.0–15.3 WebViews when the reporting currency has 3 decimals
- **Areas:** API, cache, i18n & native · _unverified_
- **Where:** `src/pages/AnalyticsPage.tsx:35`, `src/pages/Dashboard.tsx:126`
- **Scenario:** With KWD, BHD, OMR, JOD or TND as the reporting currency on iOS 15.0–15.3 (the deployment target is 15.0, and Intl.NumberFormat v3 arrived in 15.4), `{maximumFractionDigits: 0}` combined with the currency's default minimum of 3 throws 'maximumFractionDigits value is out of range'. `formatCompactCurrency` (maximum 1) does the same, crashing the chart and the page.
- **Fix:** Always pass `minimumFractionDigits ≤ maximumFractionDigits` explicitly, or wrap the call in try/catch as `CalendarPage.compactMoney` does.

#### MC-139 — Small multi-currency i18n problems in CurrencyBreakdown: account count isn't pluralised, the share % isn't localised, and a tooltip can't be reached by touch
- **Areas:** API, cache, i18n & native · _unverified_
- **Where:** `src/components/wealth/CurrencyBreakdown.tsx:51`, `src/pages/WealthPage.tsx:526`
- **Scenario:** In Arabic, '2 accounts' uses the plural instead of the dual form, because `accountCountOne` / `Other` aren't i18next plurals. German shows '45.3% of…' instead of '45,3 %'. The excluded-currency badge's explanation exists only in `title=`, which touch devices can't show. Excluded currencies are joined with ', ' in right-to-left text. Share, rate and account count stay visible in privacy mode.
- **Fix:** Use `t('accountCount', {count})` with `_one` / `_other` (plus the Arabic forms), format the share with `Intl.NumberFormat(uiLocale())`, move the badge explanation into visible text or a popover, and hide the share in privacy mode.

#### MC-140 — `getCurrencySymbol` returns an ambiguous '$' for CAD and AUD in amount inputs
- **Areas:** UI formatting · _unverified_
- **Where:** `src/components/recurring/RecurringRuleDialog.tsx:227`
- **Scenario:** A CAD debt (RecordPaymentSheet L47) or a CAD workspace (DebtFormSheet L135, QuotationsPage L116, MoneyWizard L90) shows '$' in the input, while `formatMoney` shows 'CA$' elsewhere.
- **Fix:** Use `currencySymbol()` from src/lib/wealth.ts, which comes from Intl ('CA$', 'A$'), for input prefixes.

#### MC-141 — UpcomingPayments falls back to a hard-coded USD
- **Areas:** UI formatting · _unverified_
- **Where:** `src/components/debts/UpcomingPayments.tsx:46`
- **Scenario:** A payment row whose debt isn't found (d is undefined), or whose debt has an empty currency, is formatted with '$' in a EUR workspace.
- **Fix:** Fall back to `useCurrency().currency` instead of 'USD'.

#### MC-142 — Debt insights rank debts by balance across currencies without converting
- **Areas:** Debts · _unverified_
- **Where:** `src/lib/debt-status.ts:129`, `src/lib/debt-status.ts:198`
- **Scenario:** There are a JPY debt of ¥50,000 (about $340) and a USD debt of $600. `smallest_clearable` picks the USD debt because 60,000 cents is less than 5,000,000, and the insight calls '$600' your smallest debt. `nextPayment` also breaks ties between debts due on the same date by comparing amounts across currencies.
- **Fix:** Compare only within one currency (the reporting currency), or convert at the latest rate before ranking.

#### MC-143 — The debt planner's 'extra' and 'lump sum' values are stored once for all workspaces and carried into workspaces with other currencies
- **Areas:** Debts · _unverified_
- **Where:** `src/components/debts/DebtPlanner.tsx:15`
- **Scenario:** In an INR workspace, set the extra monthly payment to 5,000 (₹). Switch to a USD workspace: the same localStorage key 'ps_debt_plan' is reused, so the plan assumes an extra $5,000/month and shows a far earlier debt-free date.
- **Fix:** Store it per workspace and currency: `ps_debt_plan_${orgId}_${currency}`.

#### MC-144 — The dashboard Debts card cuts off the per-currency total, hiding the other currencies on phones
- **Areas:** Debts · _unverified_
- **Where:** `src/components/debts/DebtsCard.tsx:103`, `src/components/dashboard/SummaryCard.tsx:102`
- **Scenario:** With three debt currencies, the headline is '₹900,000.00 + €24,820.00 + $10,000.00'. SummaryCard uses `block truncate`, so at 390 px only '₹900,000.00 + €24,…' is visible.
- **Fix:** Let the headline wrap (`whitespace-normal`) or show one line per currency.

#### MC-145 — The debt currency lock ignores interest-only payments, so a currency change relabels payments already recorded
- **Areas:** Debts · _unverified_
- **Where:** `api/_routes/debts/[id].ts:131`
- **Scenario:** A EUR debt has no rule. Record a payment with principal 0 and interest €50, which `normalizeSplit` allows. The only leg is on the paying bank, so the debt account has no non-system rows, and `PATCH {currency: 'GBP'}` passes the lock. The debt, its opening row and the `debt_payments` allocation now read £50 of interest, while the bank's expense leg stays €50.
- **Fix:** Also block the change when a live `debt_payments` row exists for the account, and run the three relabel updates in one dbBatch (see the debt currency race).

#### MC-146 — PayCardSheet can't record a bank or FX fee on a card payment in another currency
- **Areas:** Cards · _unverified_
- **Where:** `src/components/wealth/PayCardSheet.tsx:168`
- **Scenario:** A EUR card is paid from an INR bank that charges ₹150 for the conversion. The sheet sends only `source_amount` and `destination_amount`, so the fee must either be booked as a separate manual expense or folded into `source_amount`, which distorts the recorded exchange rate. ARCHITECTURE §I says issuer charges are fee transactions, and `createTransfer` already supports `source_fee_amount`.
- **Fix:** Show an optional 'Fee charged by <source>' field when the payment is cross-currency, and send `source_fee_amount`.

#### MC-147 — Planned transfers fix the received amount in advance; Mark done can't record the real rate and drops the debit card
- **Areas:** Wealth & Spaces · _known deferred_ · _unverified_
- **Where:** `src/components/wealth/ScheduledTransfersPanel.tsx:118`
- **Scenario:** Plan €100 → ₹10,000, prefilled at the market rate. The bank actually delivers ₹9,870, but Mark done records ₹10,000; the only fix is to cancel and re-create the transfer. A plan made with a debit card completes with no card on the outgoing leg, because `complete_transfer` gets `outCardId` only for liability sources. The buttons are 36 px.
- **Fix:** Let `PATCH status=completed` accept `destination_amount` (and a fee) for cross-currency plans, store `from_card_id` on the transfer header, and raise the touch targets to `min-h-11`.

#### MC-148 — Planned and pending transfers aren't included when the alerts rail projects shortfalls
- **Areas:** Alerts & notifications · _known deferred_ · _unverified_
- **Where:** `api/_lib/alerts.ts:201`
- **Scenario:** A planned €800 transfer out of a EUR bank holding €1,000 is dated in 3 days, and a €300 rent rule is due on day 5. No shortfall alert appears, because planned transfers have no ledger rows and `scheduledLegs` only reads transactions.
- **Fix:** When forecasting is built, add planned and pending transfers as ProjectionEvents: the source leg plus fee in the source currency, and the destination leg in the destination currency.

#### MC-149 — The budget alert de-duplication key and the budget audit trail have no currency
- **Areas:** Budgets · _unverified_
- **Where:** `api/_lib/notify-budget.ts:202`, `src/pages/BudgetDetailPage.tsx:377`
- **Scenario:** The de-duplication key is `${tier}:sb:${id}:${period}:${windowStart}:${amount}`. If a NULL-currency budget's meaning changes from ₹1,000 to €1,000 within one window, the exceeded alert is suppressed. Audit entries store bare amounts, which BudgetDetailPage formats with the current currency.
- **Fix:** Append the currency to the de-duplication key (`windowKey`), and record `currency_code` in the create and update audit entries.

#### MC-150 — A transfer fee counts as budget spending but never triggers a budget alert
- **Areas:** Budgets · _unverified_
- **Where:** `api/_lib/wealth-accounts.ts:459`
- **Scenario:** A cross-currency transfer with a ₹500 source fee posts a standard outgoing 'Transfer Fee' row, which the overall budget counts. `createTransfer` never calls `notifyIfBudgetExceeded`, so a fee that pushes the budget past 100% raises no alert until the next ordinary expense.
- **Fix:** After a successful `createTransfer` with a fee, call `notifyIfBudgetExceeded(org, clientId, user, {category: 'Transfer Fee', date})` without awaiting it, as other writers do.

#### MC-151 — Translated in-app budget notifications leave out the amounts; only the English text and push show 'X of Y'
- **Areas:** Alerts & notifications · _unverified_
- **Where:** `api/_lib/notify-budget.ts:96`
- **Scenario:** The locale texts `types.budget_exceeded.body` and `budget_warning.body` have no `{{spent}}` / `{{amount}}` placeholders, so the bell shows 'Groceries has gone over its monthly budget.' with no figures, while the push (the stored English text) shows '(€620.00 of €500.00)'.
- **Fix:** Add `{{spent}}` and `{{amount}}` to the budget notification texts in all 8 locales; `i18nParams` already carries currency-formatted strings.

#### MC-152 — `invalid_transfer_amounts` covers seven different English error texts under one code, and Decimal.js internals can leak through
- **Areas:** Refusal UX & i18n · _unverified_
- **Where:** `src/lib/money.ts:103`
- **Scenario:** In PayCardSheet or SpaceTransferModal, type 10.555 (the inputs accept 3 decimals). The server returns 400 `invalid_transfer_amounts` with 'Source amount supports at most 2 decimal places' in English. An empty amount gives '[DecimalError] Invalid argument: '. The client can't choose a translation, because every reason shares one code.
- **Fix:** Throw typed errors with sub-codes (`amount_not_positive`, `amount_too_many_decimals`, `amount_too_large`, `destination_amount_required`, `same_currency_amounts_differ`, `fee_invalid`) and return them as `code`. Validate decimals on the client with the same helper, as TransferWizard already does.

#### MC-153 — An account currency cached in another tab produces an English source/destination currency mismatch error
- **Areas:** Refusal UX & i18n · _unverified_
- **Where:** `api/_lib/wealth-accounts.ts:328`
- **Scenario:** Tab A has /wealth open. In tab B, an empty account's currency is changed from EUR to USD. In tab A, TransferWizard still sends `source_currency` 'EUR' and gets 400 'Source currency does not match the source account' in English.
- **Fix:** Translate the code as 'An account's currency changed — reopen the form', and invalidate `/api/wealth/accounts` on that code so a retry uses fresh data.

#### MC-154 — `setTransferTrashed`'s catch turns every database error into one generic 409, hiding both the real reason and outages
- **Areas:** Refusal UX & i18n, Rollout & back-compat · _unverified_
- **Where:** `api/_lib/wealth-accounts.ts:620`, `src/pages/TrashPage.tsx:77`
- **Scenario:** `set_transfer_trashed` raises `reversal_linked_transfer_is_immutable`, `transfer_not_found_or_incomplete` or `invalid_transfer_trash_state`, but the catch at L619-622 returns only 'Transfer cannot be trashed/restored'. TrashPage shows the generic `restoreFailed` and never says that a reversed transfer is permanent. If the function is missing (0073 was skipped) or the database times out, DELETE also returns 409 instead of 500, which hides the outage from logs and alerts.
- **Fix:** Map only the known P0001 error tokens to their own codes (translated as `apiErrors.reversal_linked_transfer_is_immutable` and so on) and re-throw everything else.

#### MC-155 — New multi-currency ledger descriptions are stored in English
- **Areas:** Refusal UX & i18n · _unverified_
- **Where:** `api/_lib/wealth-accounts.ts:470`, `api/_lib/wealth-accounts.ts:485`, `src/lib/wealth-ledger.ts:34`
- **Scenario:** Fee and reversal rows are written as 'Transfer fee — note', 'Transfer fee refund' and 'Transfer reversal'. A German, Malayalam or Arabic user sees English descriptions in the account ledger, and the client has no translation for system descriptions.
- **Fix:** Translate known system categories (Transfer Fee, and reversals identified through `reverses_transfer_id`) when displaying them, keeping the stored text as a fallback.

#### MC-156 — Old builds' edits to a transfer leg's amount or date are now refused, and old builds have no Reverse option
- **Areas:** Rollout & back-compat · _known deferred_ · _unverified_
- **Where:** `api/_routes/transactions/[id].ts:115`
- **Scenario:** On the old WealthAccountDetailPage, the user edits a card-payment leg from ₹5,000 to ₹4,500 and saves. The server returns 409 `transfer_mutation_requires_transfer_service` with 'Reverse the transfer and record it again', but old builds have no Reverse button. The only way is to delete it (204) and record it again; the legs stay consistent.
- **Fix:** Accept this as intended (STATUS review fix 3), but reword the message for old clients: 'Delete it and record it again'.

#### MC-157 — Creating a single transaction or a split doesn't refuse an account whose `currency_code` is NULL
- **Areas:** Transactions · _known deferred_ · _unverified_
- **Where:** `api/_routes/transactions.ts:480`, `api/_routes/transactions/group.ts:164`
- **Scenario:** For a legacy account with `currency_code` NULL (there are none on dev today), POST writes a row with a NULL currency. `reporting_amount` then treats it as already in the reporting currency forever, so its meaning silently changes after a reporting change. PATCH already returns 409 `currency_missing` in this case.
- **Fix:** Do what PATCH does: return 409 `currency_missing` when `account.currencyCode` is null, in the transactions.ts POST and in group.ts, before inserting. This is required before making the column NOT NULL.

#### MC-158 — Creating a cash wallet named 'Cash in Hand' returns 500
- **Areas:** Schema & migrations · _unverified_
- **Where:** `api/_lib/wealth-accounts.ts:175`
- **Scenario:** `POST /api/wealth/accounts {type: 'cash', bank_name: 'Cash in Hand', currency_code: 'EUR'}` while the default wallet exists violates `wealth_accounts_one_default_cash_idx` (0069), and nothing catches it, so the request returns 500. If the default wallet is archived, the new wallet becomes the permanent one and can't be deleted.
- **Fix:** Reject or rename the reserved name on create and on rename (400 `reserved_cash_name`).

#### MC-159 — Space auto-save across currencies has no rule for the rate or the received amount
- **Areas:** Recurring · _known deferred_ · _unverified_
- **Where:** `api/_routes/spaces/[id]/auto-save.ts:84`
- **Scenario:** A user with an INR salary account and a EUR savings Space can't schedule an auto-save: the PUT returns 409 `cross_currency_recurring_policy_required`. Nothing is corrupted; the feature simply isn't there.
- **Fix:** Add `destination_amount` or a `rate_policy` ('fixed destination' | 'calculate at completion') to recurring_rules and pass it to `createTransfer` (ARCHITECTURE.md lines 127 and 140).

#### MC-160 — Parallel auto-save runs leave a raw duplicate-key error on a rule that actually posted
- **Areas:** Concurrency & invariants · _unverified_
- **Where:** `api/_lib/recurring-materialize.ts:165`, `api/_lib/recurring-materialize.ts:312`
- **Scenario:** A page load fires several GET requests that each post due recurring items. Two runs both find no existing occurrence and both call `createTransfer`. The losing run fails on `transactions_recurring_once_idx`, and the rule-level catch sets `last_error` to 'duplicate key value violates unique constraint…', possibly after the winning run had cleared it. /recurring then shows an error for a rule that posted correctly.
- **Fix:** Treat a 23505 on `transactions_recurring_once_idx` as already posted, not as an error.

#### MC-161 — On /wealth, the summary request can run before the accounts request has posted due items, so net worth lags behind the account tiles
- **Areas:** API, cache, i18n & native · _unverified_
- **Where:** `src/pages/WealthPage.tsx:304`
- **Scenario:** On the first visit of the day, a rent rule is due today. `/api/wealth/accounts` (which posts the rent) and `/api/wealth/summary` (read-only) run in parallel. The summary reads balances before the rent posts, so the tiles show the balance after rent while net worth and the ≈ line show it before rent, until a later refetch.
- **Fix:** Have the summary route post due recurring items itself (call `materializeDueRecurring`) and add it to `ALWAYS_FETCH`, so both requests can run in parallel. Alternatively, start the summary only after the accounts load.

#### MC-162 — The AI context lists debt accounts (labelled 'bank') that every AI write path then silently drops
- **Areas:** AI & imports · _unverified_
- **Where:** `api/_lib/ai.ts:192`
- **Scenario:** For 'paid 300 to bank loan from Intesa', the model sees 'bank loan (bank)', and `resolveTransactionRaw` moves it to `to_account_id` because `isLiabilityType('loan')` is true. But AiAssistantConfirm's account list comes from `/api/wealth/accounts`, which excludes loans, so the destination silently becomes empty and the user may pick a credit card instead. A standard expense 'from bank loan' silently falls back to the default account.
- **Fix:** Remove loan and receivable accounts from `loadOrgAiContext.accountList`, as Spaces are removed, or return a 'debt payment' hint that links to /debts/:id.

#### MC-163 — Invoices created by an admin accept any currency text, which then crashes the org's Subscription page
- **Areas:** Org, billing & admin · _unverified_
- **Where:** `api/_routes/admin/invoices.ts:122`, `src/pages/SubscriptionPage.tsx:119`
- **Scenario:** An admin creates an invoice with currency 'EURO' or 'usd ' (a free-text field in AdminInvoicesPage). /subscription formats invoices with an unguarded `Intl` formatMoney, which throws a RangeError, so the page crashes for that org.
- **Fix:** Validate currency codes on the server, trimmed and uppercased, against `CURRENCY_LIST`.

#### MC-164 — Reporting-currency changes aren't recorded in the audit log
- **Areas:** Org, billing & admin · _unverified_
- **Where:** `api/_routes/organizations/[id].ts:85`
- **Scenario:** An admin member switches reporting from USD to INR. Every report, budget and billing currency changes, and /api/audit has no entry saying who made the change or when.
- **Fix:** Call `logAudit({entityType: 'organization', action: 'update', changes: {reporting_currency: {from, to}}})`, and consider restricting the change to the owner.

#### MC-165 — Tag 'delete with records' removes the tag from the trashed rows and writes no audit entry
- **Areas:** Cascade soft-delete · _unverified_
- **Where:** `api/_routes/tags/[id].ts:63`, `api/_lib/tag-ops.ts:52`
- **Scenario:** Delete #trip with its records, then restore a transaction from Trash: it comes back without #trip, because `removeTagEverywhere` has no `deleted_at` filter and the tag's own row is gone. /api/audit has no entries for the trashed rows or clients, unlike `DELETE /api/clients/:id`.
- **Fix:** Add `AND t.deleted_at IS NULL` (and the same for clients and quotations) to `removeTagEverywhere` when it runs after a with_records delete, and call `logAudit` for each trashed id (or write one tag-level entry listing the ids).

#### MC-166 — Rows older than about 6 years never get a rate, although ECB history goes back to 1999
- **Areas:** FX core, FX ops tooling · _unverified_
- **Where:** `api/_lib/fx-rates.ts:29`
- **Scenario:** A EUR expense dated 2019-06-01 in a USD workspace (imported or back-dated) is before the backfill's cut-off of today − 2,196 days. `fx_rate_on` returns NULL, and the row is excluded for good.
- **Fix:** Let the cron or the admin backfill tool extend the cut-off for a specific pair and date range, or fetch older ranges on demand. Keep the cut-off on the request path.

#### MC-167 — `fx_rate_on` isn't inlined by Postgres, so foreign-currency rows are expensive in aggregates
- **Areas:** FX core · _unverified_
- **Where:** `drizzle/0074_fx_reporting_amount.sql:17`
- **Scenario:** Postgres doesn't inline SQL functions that contain sub-selects. On Neon PG17, 30k `reporting_amount` calls on foreign rows take 816 ms, against 5.8 ms for same-currency rows. Aggregates call it about twice per foreign row (the sum and the excluded filter), so 20k foreign rows cost about 1 s per statement, and analytics runs several statements.
- **Fix:** Join a per-(currency, date) rate CTE (one lookup per distinct pair) instead of calling the function per row, or add a materialized daily rate table.

#### MC-168 — `ensureRatesForOrg` rescans the whole org and runs per-currency queries on every report request, even when rates are complete
- **Areas:** FX ops tooling · _unverified_
- **Where:** `api/_lib/fx-rates.ts:280`
- **Scenario:** Each of the 12 report GETs runs a GROUP BY over all of the org's foreign transactions, plus, per currency, a `count(distinct rate_date)` and a query for a fresh market rate. The Dashboard fires several of these in parallel, so a workspace with 5 currencies pays about 11 queries per route per page load before any real work starts.
- **Fix:** Once the scheduled FX refresh runs, skip the check when the pair's latest real fetch is from today (a single query), or make the request paths read-only.

#### MC-169 — `/api/fx/rate` lets any signed-in user write any currency pair into the rate table shared by all tenants
- **Areas:** FX core · _unverified_
- **Where:** `api/_routes/fx/rate.ts:35`
- **Scenario:** Any user can loop over about 158×157 pairs. Each call makes a provider request and 1–2 inserts into `fx_rate_snapshots`, which is global rather than per org, and those rows then feed other tenants' `fx_rate_on` (see the precedence item).
- **Fix:** Rate-limit per user, and allow only currencies the workspace holds.

#### MC-170 — No currency-aware CSV/financial export or import exists (phase 6, deferred)
- **Areas:** AI & imports · _known deferred_ · _unverified_
- **Where:** `worker/app/internal/jobs/jobs.go:63`
- **Scenario:** A user with EUR and INR accounts has no way to export the ledger with native currency, reporting amount or excluded rows. The only 'csv.export' is a commented-out placeholder in the worker, and STATUS lists no financial importer.
- **Fix:** When built, each exported row must include the date, native amount, `currency_code`, account currency, `reporting_amount` at the row's date, rate date and an excluded flag, plus a footer counting excluded rows. Never export a single total column that mixes currencies.

#### MC-171 — `summarizeLegs` adds amounts across currencies without converting (unused code)
- **Areas:** Transactions · _unverified_
- **Where:** `src/lib/tx-grouping.ts:20`
- **Scenario:** A future caller summarising legs of EUR 50 and INR 1,000 would get 1,050. Today only tx-grouping.test.ts imports it.
- **Fix:** Delete it, or make it return one total per currency and use it for the split detail header.

#### MC-172 — The unused helper `buildRecurringTransferLegs` builds transfer legs without a currency
- **Areas:** Recurring · _unverified_
- **Where:** `src/lib/recurring-transfer.ts:48`
- **Scenario:** Only src/lib/recurring-transfer.test.ts imports it. If it were used again, it would write legs with no `currency_code`, no transfer header and the same amount on both sides, which is wrong for cross-currency transfers.
- **Fix:** Delete the helper and its test; the materializer uses `createTransfer`.

#### MC-173 — docs/multi-currency/STATUS.md claims transfer legs can't be trashed outside the transfer service
- **Areas:** Cascade soft-delete · _unverified_
- **Where:** `docs/multi-currency/STATUS.md:24`
- **Scenario:** Lines 24, 34 and 51 say transfer legs can't be trashed or restored on their own. In fact, tag 'delete with records' trashes individual legs, and fee rows can be trashed on their own. The 'Remaining unsafe writers' list (L54-61) leaves out tag-ops.ts, clients/[id].ts and clients/bulk-delete.ts.
- **Fix:** After the fixes, correct the claim and add those three writers to the per-writer audit table.

#### MC-174 — The Debts e2e net-worth test still assumes only same-currency debts count
- **Areas:** Debts · _unverified_
- **Where:** `e2e/debts.spec.ts:389`
- **Scenario:** The e2e workspace holds a USD loan that `/api/wealth/summary` converts. The test's expected value adds account balances across currencies without converting and counts only same-currency debts, so it fails, or passes only because the workspace happens to use a single currency.
- **Fix:** Assert against `GET /api/wealth/summary` (`net_worth === assets − liabilities`, `debts_owed === Σ converted loan balances`) and add a foreign-currency debt fixture.

#### MC-175 — The multi-currency e2e fee assertion depends on how large the reporting currency's numbers are
- **Areas:** Test harness · _unverified_
- **Where:** `e2e/multi-currency.spec.ts:296`
- **Scenario:** If the personal workspace reports in INR or JPY, the €5 fee converts to about ₹550, and `toBeLessThan(10)` fails although the app behaves correctly.
- **Fix:** Assert the exact fee from the seeded rate: with EUR as the reporting currency, a €2 fee changes outgoing by exactly 2.00.

#### MC-176 — The multi-currency spec leaves the personal workspace selected for the specs that run after it
- **Areas:** Test harness · _unverified_
- **Where:** `e2e/multi-currency.spec.ts:86`, `e2e/helpers.ts:76`
- **Scenario:** `usePersonal` switches the current org on the server and never switches back. Running `npx playwright test multi-currency smoke` leaves the smoke spec in the personal workspace, where /clients is hidden. Test 6 works only because test 5 switched workspaces.
- **Fix:** Call `rememberWorkspace` in beforeAll and `restoreWorkspace` in afterAll, and switch explicitly in every test.

#### MC-177 — E2E tests never run for PRs into dev
- **Areas:** Test harness · _unverified_
- **Where:** `.github/workflows/e2e.yml:19`
- **Scenario:** This branch merges through dev, so its e2e tests, including multi-currency.spec.ts, run only on the later dev→main PR or when started manually.
- **Fix:** Add a pull_request trigger for dev limited to the multi-currency project (`npx playwright test multi-currency`), or require a manual run before merging.

## 7. Checked and cleared (refuted by the verifiers)

- **Editing a transaction re-stamps a row that has no account with the current reporting currency (#4, #275)** (`api/_routes/transactions/[id].ts:170`) — Refuted (1/3 votes each): the server path exists, but no shipped UI sends that request. The fix, keeping the stored currency, is cheap and still worth applying. The recurring-rule version (#86) was confirmed and is listed as a high item.
- **Transactions with NULL currency count 1:1 in reports and budgets and are never reported as excluded (#10, #138)** (`api/_lib/tx-sql.ts:60; drizzle/0074_fx_reporting_functions.sql:34`) — Refuted (0/2 each): all 69 NULL-currency rows belong to orgs that no longer exist, so no live workspace sees them. The underlying mechanism remains open as the low item on `reporting_amount` treating NULL currency as the reporting currency.
- **'Reverse transfer' is offered on reversal legs (#49)** (`src/components/TransactionDetailModal.tsx:77`) — Refuted (0/2): list and detail payloads don't include `transfer_id`, so the modal's lookup does run. Whether the server should accept a reversal of a reversal is a policy question, kept as the unverified low item from #16.
- **Billing checkout currency follows the workspace reporting currency (#180)** (`api/_routes/billing/create-subscription.ts:152`) — Refuted (0/2); verifiers recorded no reason. Charging checkout in the org's currency (India always INR) is the documented billing rule, so this is a product choice rather than a defect. The billing defect that did survive is the pricing-vs-checkout country mismatch (#181).
- **The reporting-currency dialog doesn't say what changes; new transactions and rules without an account silently switch currency (#189)** (`src/pages/OrganizationsPage.tsx:366`) — Refuted (0/2); verifiers recorded no reason. New rows and rules without an account taking the current reporting currency is the intended rule, and existing rows keep their stored currency (#4/#275 were refuted too). The confirmed related defect is the re-stamp on edit of recurring rules without an account (#86). The dialog wording belongs to the reporting-vs-relabel product decision.
- **Deploy-order hazard reported as critical: if dev's 0075 reaches production first, 0069–0074 are skipped silently (#306)** (`drizzle/meta/_journal.json:1`) — Refuted as a critical code defect (0/3). The same hazard is kept as the medium 'Deploy order' release-gating item (#1), because it only happens if dev is promoted before this branch.
- **Post-deploy probes can't detect a broken multi-currency deploy (#321)** (`.github/workflows/post-deploy.yml:45`) — Refuted (0/2); verifiers recorded no reason. The probe is deliberately an unauthenticated boot/401 smoke test. A skipped migration is caught by the post-migrate check proposed in the Deploy order item.
- **The native shells are stale and haven't had their version bumped for this branch (#322)** (`android/app/build.gradle:21`) — Refuted as a branch defect (0/2): stale shells and an unchanged version are expected before release. The cap:sync release step is kept as the medium 'native shells still contain the pre-multi-currency bundle' item (#244).
- **Manual rate corrections would reach SQL reports but not /wealth or the transfer suggestion (#336)** (`api/_lib/fx-rates.ts:182`) — Refuted (0/2): nothing writes manual rates yet (the admin rate import is only proposed), so the two paths can't disagree today. The underlying precedence mismatch is kept as unverified #364 in the 'two definitions of today's rate' item.


## 5. Decisions the team must make

The area analysts raised **176 product and policy questions**. Many of them were the same question asked from different screens, so this section merges them into **84 decisions** under 17 themes. Each decision has:

- the question;
- the options, with their trade-offs;
- a **recommended default**, so work can go ahead if nobody objects;
- the areas that raised it;
- where relevant, the findings that make it urgent. Findings are cited by `file:line`. **verified** means the finding survived adversarial review. **unverified** means it is low severity and was not checked.

Design references point to `docs/multi-currency/ARCHITECTURE.md` (§ = section).

### 5.0 Decide these first

Each of these either blocks other decisions, sets expected values in the e2e suite, or has to be settled before the production deploy.

| # | Decision | Why it cannot wait |
|---|---|---|
| D1 | Reporting-currency change: conversion, relabel, or both | Users hit by the onboarding bug (`api/_routes/onboarding.ts:54`, verified, critical) have no repair path today |
| D5 | One currency-lock rule for accounts and debts | Four verified findings where the lock ignores rules, funded cards or balances |
| D10 / D11 | The fee row is part of its transfer; reversal rules | Verified **critical** double-refund paths (`api/_routes/transactions/[id].ts:232`, `api/_lib/wealth-accounts.ts:584`) |
| D30 | Cross-currency autopay: refuse, or add an FX policy | Verified high: autopay is accepted, then never pays, while the alert rail says "covered" |
| D38 | Budgets: pin the currency at creation, or follow the reporting currency | Old and new budgets behave differently today, and the e2e fixture depends on the answer |
| D53 / D59 | Rate history for non-ECB currencies; where the backfill runs | Non-ECB rows are excluded forever. The backfill blocks GET requests |
| D61 | Money scale and minor units | Sets the expected values in the precision tests. 3-decimal amounts drift balances today |
| D77 / D78 | Migration order against dev's 0075; the gate for old native clients | Release blockers: migrations can be skipped silently, and 1.4.0 native clients show raw sums |

---

### 5.1 What changing the reporting currency means

#### D1. Is a reporting-currency change a conversion, a relabel, or both?

**Question.** On this branch, changing the workspace currency only changes reporting. Accounts and transactions keep their native currency and every report converts. On `main` the change was a relabel, and users relied on it to fix a wrong currency picked at signup. The onboarding bug now makes that situation common. Once an account has history its currency locks, so a user who picked the wrong currency cannot fix it. Do we add a relabel path, and who may use it? A relabel rewrites currency tags and never the digits.

**Options.**

- **A. Reporting switch only (current behaviour).**
  - For: matches ARCHITECTURE.md:115 ("changes only reporting conversions").
  - Against: no repair path. Users hit by the onboarding bug stay stuck.
- **B. Reporting switch, plus a one-time self-serve "Relabel workspace currency" for owners.**
  - Offered only when every account, rule and budget is still in the old reporting currency and no transfer crosses currencies.
  - For: fixes the common case without a support ticket.
  - Against: a second code path that rewrites currency on every table. It must be atomic and audit-logged.
- **C. Option B, but self-serve only within a time window** (for example, an account younger than 30 days with no cross-currency transfers).
  - For: limits the blast radius.
  - Against: the cutoff is arbitrary, and older wrong workspaces still need support.
- **D. Relabel by an operator only, with the owner's written consent.**
  - For: no new UI.
  - Against: support load and slow fixes.

**Recommended default:** **B** for owners, gated on "single-currency workspace, no cross-currency transfers", with no time window, and audit-logged. **D** (an operator script using the same code) covers every other case. Fix the onboarding writer first, because it is the root cause.

<sub>Raised by 5 areas: Schema & migrations, Org settings, API/platform, Rollout, FX operations. Findings: `api/_routes/onboarding.ts:54` (verified, critical); `api/_routes/wealth/accounts/[id].ts:85` (verified, high: "no way to correct a workspace created in the wrong currency"); `api/_routes/wealth/accounts/[id].ts:84` (verified, medium: no self-serve or operator repair).</sub>

#### D2. Guardrails on the change: who may make it, what they see, audit, cache

**Question.** Changing the currency turns every existing account, card, Space, rule and legacy budget "foreign" at once, and changes the currency of every report.

- Who may do it: the owner only, or the owner and admins?
- Should it be allowed freely, blocked when native data exists, or allowed after a warning that lists what stays in the old currency?
- Must it be audit-logged and confirmed?
- Does the client cache fully purge, as it does for `/api/organizations/switch`?

**Options.**

- **Allow freely.** Simple, but every figure silently shifts.
- **Block while native data exists.** Safe, but it forbids legitimate multi-currency use.
- **Allow after a warning that lists what stays behind.** One extra dialog.
- **Cache: full purge vs targeted invalidation.** Converted aggregates are keyed by path, not by reporting currency, so targeted invalidation misses some reads.

**Recommended default:**

- **Owner only**, audit-logged.
- Allowed after a **confirmation that lists what stays in the old currency**: N accounts, cards, Spaces, rules and budgets. The dialog offers the D1 relabel when the workspace qualifies.
- Treated as a **full cache purge event**, like an org switch.

<sub>Raised by 4 areas: Reports, Org settings, UI formatting sweep, Test harness. Findings: `src/lib/api-cache.ts:291` (verified, medium: cached converted aggregates survive the change); `src/pages/SpacesPage.tsx:84` (verified, high: a single-currency workspace becomes mixed).</sub>

#### D3. One source of truth for the org currency

**Question.** `organizations.currency` and `organizations.reporting_currency` can drift apart, and some readers still use the legacy column. How do we enforce one value, and which column wins when drifted rows are repaired?

**Options.**

- **A. DB trigger that syncs the two columns in both directions.**
  - For: catches every writer, including admin and legacy code.
  - Against: hidden logic, and a two-way trigger needs loop guards.
- **B. Generated alias column** (`currency` generated from `reporting_currency`).
  - For: drift becomes impossible.
  - Against: any remaining writer of `currency` fails at runtime.
- **C. One server helper (`setOrgCurrency`) plus a static guard** that forbids direct writes.
  - For: simplest and explicit. The verified onboarding fix already proposes this helper.
  - Against: protects only code in this repo, and existing drift still needs a one-off repair.

**Recommended default:** **C** plus a one-off repair.

In drifted rows, **the legacy `currency` column usually holds the user's explicit choice**: both known sources of drift (onboarding and the admin "Default currency" edit) write only that column. So:

- Do not simply copy one column over the other.
- Apply the user's choice through the D1 relabel when the workspace is single-currency.
- Otherwise set `reporting_currency` from it.

<sub>Raised by: API/platform. Findings: `api/_routes/admin/organizations.ts:145` (verified, high: drift, legacy readers); `api/_routes/onboarding.ts:54` (verified, critical).</sub>

#### D4. Separate the billing currency from the reporting currency?

**Question.** Should changing the reporting currency ever change the currency Dodo charges the card in?

**Options.**

- **A. Keep them coupled.** A reporting change moves the checkout currency. Surprising for users.
- **B. A separate billing preference.** One more setting to explain.
- **C. Billing from country only** (India is always INR), with the currency stored on the subscription at checkout.

**Recommended default:** **C.** Changing the reporting currency never changes what the card is charged in. Also make the pricing page and checkout use the same country source. This touches the Dodo-is-money model, so work through the `subscription-system` skill.

<sub>Raised by: Org settings. Findings: `api/_routes/billing/pricing.ts:21` (verified, medium: pricing and checkout use different country sources).</sub>

---

### 5.2 Account currency: creation, lock, moves

#### D5. When may an account's (or a debt's) currency change? One lock rule

**Question.** Three rules exist today, and they disagree:

- **Accounts** lock on any row (system rows included), plus a goal or a card.
- **Debts** lock on non-system rows, plus rules.
- **ARCHITECTURE.md:117** says: zero non-system rows, and no statements, cards, transfers or recurring rules.

The account lock also ignores recurring rules (as payer, card account, or auto-save source or destination), card funding, planned transfers, debt-repayment payers, and a non-zero balance with no rows.

- Should a non-zero balance lock the currency?
- Should an account whose only row is its Opening Balance relabel that system row, as debts do?
- Should a renamed "Cash in Hand" stay the permanent default? Today that is keyed on `bank_name`.

**Options.**

- **A. Lock on any currency-sensitive reference.** That means:
  - non-system rows, live or trashed;
  - statements;
  - cards the account carries or funds;
  - transfers of any status;
  - recurring rules in any role;
  - a balance not explained by the Opening Balance row.

  For: no dependent can end up in the wrong currency. Against: users must remove configuration before a legitimate fix.
- **B. Allow the change and auto-pause or disable dependents, with a visible reason.**
  - For: flexible.
  - Against: silently breaks autopay and schedules, and adds more states to surface.
- **C. Allow the change and re-snapshot dependent rule and card currencies in the same write.**
  - For: nothing pauses.
  - Against: a 100 USD rule becomes 100 EUR. It is the same relabel error, moved somewhere else.

**Recommended default:** **A**, as **one shared predicate** used by the account route, the debt route, and the edit dialog, so that client and server count history the same way.

- An account whose only history is its Opening Balance system row may change currency, and that row is relabelled in the same write, as debts do.
- A balance with no rows behind it locks, because it is drift.
- Key the permanent Cash default on `is_default` or the id, not on `bank_name`.

<sub>Raised by 6 areas: Wealth & transfers, Recurring, Cards, Alerts & notifications, Concurrency & DB invariants, Refusal UX. Findings: `api/_routes/wealth/accounts/[id].ts:84` (verified, high: ignores rules and funded cards); `api/_routes/wealth/accounts/[id].ts:85` (verified, medium: can change while funding autopay); `api/_routes/wealth/accounts/[id].ts:86` (verified, medium: non-zero balance with no rows is relabelled); `src/components/wealth/WealthAccountDialogs.tsx:94` (verified, medium: client and server count history differently); `api/_routes/debts/[id].ts:131` (low, unverified: interest-only payments ignored).</sub>

#### D6. Enforce "row currency = account currency" in the database?

**Question.** Should the database enforce this with composite foreign keys on `transactions`, `recurring_rules` and `transfers` → `(account id, currency_code)`, declared `DEFERRABLE INITIALLY DEFERRED` and added `NOT VALID` then `VALIDATE`d? Or do we keep the app-level-only stance of ARCHITECTURE.md:147?

**Options.**

- **Composite foreign keys.**
  - For: catches every bypass: admin tools, tag cascades, old clients.
  - Against: needs a unique `(id, currency_code)` on `wealth_accounts`, and the D5 currency change must update the account and its rows in one deferred transaction.
- **App-level only.**
  - For: no migration.
  - Against: this analysis found several money writers outside the services.

**Recommended default:** **Composite foreign keys**, added `NOT VALID` (additive), and validated after the D20 backfill and the D25 drift repair.

<sub>Raised by: Concurrency & DB invariants. Findings: `api/_routes/admin/transactions.ts:150` (verified, high: admin edits bypass the services); `api/_lib/tag-ops.ts:105` (verified, high: tag delete bypasses the transfer service).</sub>

#### D7. Moving a row, or re-pointing a rule, to an account in another currency

**Question.** A user edits an existing transaction or recurring rule and picks an account in a different currency. What happens to the amount?

**Options.**

- **A. Keep the number and change the currency (today).** 100 USD silently becomes 100 EUR.
- **B. Convert at the row's date (for rows) or today's rate (for rules).**
  - For: no re-entry.
  - Against: a guessed rate becomes a ledger fact, which contradicts §E: "never infer one leg later from a current market rate".
- **C. Require the amount in the new currency.** The field is prefilled with a converted estimate marked ≈.

**Recommended default:** **C.** The server refuses a cross-currency move that carries no explicit new amount.

<sub>Raised by 2 areas: Transactions, Recurring.</sub>

#### D8. Archiving or deleting an account that still holds money

**Question.** Today, archiving or deleting a bank or cash account with a non-zero balance removes that money from net worth. Spaces must be emptied first.

**Options.**

- **Keep today's behaviour.** Net worth changes silently.
- **Require zero first**, as Spaces do, offering a transfer-out or a balance adjustment.

**Recommended default:** **Require zero first**, with a transfer-out or adjustment offered in the same dialog.

<sub>Raised by: Wealth & transfers.</sub>

#### D9. Extra cash wallets in other currencies

**Question.** The API allows unlimited extra cash wallets and the UI offers none.

- Should extra wallets count toward the free-plan bank allowance, or have their own cap?
- Should the UI offer "Add cash wallet" with a currency picker?

**Options.**

- **Unlimited.** Opens a free-plan loophole.
- **Count toward the bank allowance.** One quota rule, but a free user can't have both a bank and a foreign wallet.
- **Their own cap.** One more limit to maintain.

**Recommended default:**

- Add **"Add cash wallet" with a currency picker**.
- Count wallets beyond the permanent Cash **toward the bank allowance**. That closes the uncapped API path with the rule that already exists.
- Revisit with a separate cap if free users complain.

<sub>Raised by: Wealth & transfers. Findings: `src/components/spaces/SpaceFormModal.tsx:64` (verified, medium: no UI for foreign wallets or Spaces; cash wallets uncapped server-side).</sub>

---

### 5.3 Transfers: fees, reversal, trash, tags, edits

#### D10. Is a transfer's fee row part of the transfer?

**Question.** Today the transfer header records a fee, but the fee row can be edited, trashed, purged or tag-deleted on its own. `api/_routes/transactions/bulk-delete.ts:36-38` treats it as an independent expense.

- Should every row with a `transfer_id` (principal legs, fee, fee refund) go through the transfer service?
- Or is the fee an ordinary expense, with the header and reversal kept in sync with it?

**Options.**

- **A. The fee is part of the logical transfer.**
  - Edit, trash, restore and purge of a fee on its own are refused, or cascade to the whole transfer.
  - A lone fee that is tagged and tag-deleted takes the transfer with it.
  - For: matches §E ("trash, restore and purge operate on the logical transfer and every principal/fee leg atomically"), and closes the verified double refunds.
  - Against: fixing a wrong fee means reversing the transfer.
- **B. The fee is an independent expense.**
  - Reversal must refund only the live fee, and every writer (PATCH, DELETE, bulk, tag, cascade, purge) must update the header.
  - For: flexible.
  - Against: this is exactly the class of bug the analysis found in five places.

**Recommended default:** **A.** A wrong fee is corrected by reverse-and-replace, or later by a dedicated "edit fee" operation in the transfer service.

<sub>Raised by 4 areas: Schema & migrations, Transactions, Cascade soft-delete, Concurrency & DB invariants. Findings: `api/_routes/transactions/[id].ts:232` (verified, critical: trash the fee, then reverse, and the fee is refunded twice); `api/_routes/transactions/[id].ts:106` (verified, high: fee editable via PATCH); `api/_routes/trash/purge.ts:33` (verified, high: purge leaves the fee and header behind); `api/_lib/tag-ops.ts:109` (verified, high: tag delete trashes the fee alone).</sub>

#### D11. Reversal rules

**Question.**

- May a reversal itself be reversed?
- May a trashed transfer be reversed?
- What should Reverse do when the transfer, one of its legs, or its fee is in Trash?
- Does a trashed or purged transfer keep its header?

**Options.**

- **Reversal of a reversal:** allow it as a new transfer, or refuse it. The UI already says "originals only".
- **Trashed transfer:** reversible or not.
- **Any part in Trash:** refuse with 409, or reverse only the live parts. Partial reversal is how money gets created.
- **Header:** kept while the transfer is trashed, or dropped.

**Recommended default:**

- Refuse reversal of a reversal. The user records a new transfer instead.
- A trashed transfer is **not** reversible.
- If any part is in Trash, return **409**.
- The header stays, flagged as trashed, while the transfer is in Trash, so a restore round-trips atomically. Purge deletes the header together with its legs and fee rows in one statement.

<sub>Raised by 4 areas: Schema & migrations, Wealth & transfers, Cascade soft-delete, Concurrency & DB invariants. Findings: `api/_lib/wealth-accounts.ts:584` (verified, critical: reverseTransfer refunds what a trash already reversed); `api/_lib/wealth-accounts.ts:586` (verified, high: a trashed transfer can be reversed).</sub>

#### D12. Fee refunds on reversal: which date, and do fees count against budgets?

**Question.**

- The fee refund posted by a reversal is dated at reversal time. Reports therefore convert it at a different rate from the original fee, leaving a small P&L residual, and it lands in a different budget window.
- Separately: should transfer fees (the "Transfer Fee" category) count against the overall budget and trigger alerts?

**Options.**

- **Date the refund at the original fee date.**
  - For: no residual.
  - Against: rewrites a closed budget window and past reports.
- **Date it at reversal (today).**
  - For: the ledger shows when the money came back, and closed windows stay closed.
  - Against: a small FX residual.

**Recommended default:**

- **Fees are expenses**: §E says "both count as expense" and §I says "fees contribute expense". So they count against the overall (all-spending) budget and any budget scoped to their category, and they raise alerts like any other spend.
- **Keep the refund dated at reversal**, accept the residual, and document it.

<sub>Raised by 2 areas: Wealth & transfers, Budgets. Findings: `api/_lib/wealth-accounts.ts:459` (low, unverified: a fee counts as budget spend but raises no alert).</sub>

#### D13. Tags and transfers

**Question.**

- When a tagged row belongs to a transfer, should "Delete tag & records" trash the **whole** transfer, skip it and only remove the tag, or refuse the entire tag delete?
- Should transfer legs stay taggable through PATCH? Once the cascades delegate this is harmless, but today it is the only way into the one-sided state.
- Should trashed records keep the tag so that a restore round-trips?
- Should the dialog show the full cascade count, including a tagged client's untagged rows?

**Options.**

- **Trash the whole transfer.** Consistent with DELETE on a leg.
- **Skip and strip the tag.** Surprising for the user.
- **Refuse the whole tag delete.** Blocks the user.

**Recommended default:**

- **Trash the whole transfer through the transfer service.**
- Legs stay taggable once the cascade delegates.
- **Keep the tag** on trashed records.
- **Show the full cascade count** in the dialog.

<sub>Raised by: Cascade soft-delete. Findings: `api/_lib/tag-ops.ts:105` (verified, high: trashes one leg); `drizzle/0073_transfer_lifecycle.sql:121` (verified, high: a tag-trashed leg of a reversed transfer can never be restored); `src/components/categories/TagsPanel.tsx:398` (verified, medium: the dialog understates the cascade).</sub>

#### D14. Editing transfer legs

**Question.** Should a transfer leg show Edit at all?

**Options.**

- **A. Hide Edit and offer only Reverse.** Safest, but heavy for fixing a typo in a description.
- **B. Allow edits to fields that don't move money** (description, category, tags, note), and route amount, account and date through Reverse.

**Recommended default:** **B.** The server refuses money-field edits on any `transfer_id` row with a code that points to Reverse.

<sub>Raised by: Refusal UX.</sub>

#### D15. Planned cross-currency transfers, and received amounts left untouched

**Question.**

- Does a planned cross-currency transfer freeze its received amount when it is planned, or ask for or confirm it at "Mark done" (ARCHITECTURE.md question 1)?
- In an immediate transfer, a received amount prefilled from the market rate and left untouched is stored with `rate_source='effective_transfer'`. Accept that, mark it "estimated", or require explicit confirmation?

**Options.**

- **Freeze at planning.** Simple, but it stores an invented number.
- **Confirm at completion.** Correct, but adds one step.
- **For untouched prefills:** accept as-is (a guess becomes a fact), add a third `rate_source` value (every reader must handle it), or require a confirmation tap.

**Recommended default:**

- Default to **confirm at "Mark done"**, prefilled with an estimate. Keep a frozen amount only when the user typed one; this matches ARCHITECTURE.md question 1 ("support both, defaulting to rate at completion").
- **Require an explicit confirmation of an untouched prefilled amount** before saving. No new `rate_source` value.

<sub>Raised by: Wealth & transfers. Findings: `src/components/wealth/TransferWizard.tsx:175` (verified, medium: a stale received amount is kept when the destination currency changes).</sub>

---

### 5.4 Splits, refunds and system rows

#### D16. Splits across currencies

**Question.** Should the server refuse mixed-currency splits at `POST /api/transactions/group`, as the web UI does?

**Options.**

- **A. Forbid them server-side** (`currency_mismatch`).
  - For: matches the UI and removes the mixed-group code paths in `transactions.ts` and `money-flow.ts`.
  - Against: needs a native release, because old bundles may still send them.
- **B. Support them.** Each leg is shown natively, the header shows a converted "≈", and there is never a summed native amount.
  - Against: more display paths, plus the partial-total bug to fix.

**Recommended default:** **A.**

<sub>Raised by 4 areas: Transactions, Reports, UI formatting sweep, Concurrency & DB invariants. Findings: `api/_routes/transactions/group.ts:88` (verified, medium: server accepts them); `api/_routes/transactions.ts:109` (verified, medium: partial total when a leg has no rate).</sub>

#### D17. Editing a split atomically

**Question.** Should there be one atomic server "replace" endpoint for split edits, instead of today's DELETE followed by POST?

**Options.**

- **Keep DELETE + POST.** The edit is not atomic, and it leaves the old version in Trash. Restoring it duplicates the money.
- **One replace endpoint** in a single `dbBatch`.

**Recommended default:** **Atomic replace endpoint.**

<sub>Raised by: Transactions. Findings: `src/pages/TransactionsPage.tsx:611` (verified, medium).</sub>

#### D18. Refunds in another currency, or long after the purchase

**Question.** Which date's rate converts a refund?

**Options.**

- **A. Convert at the refund's own date (current).** This matches §L, which says a refund needs its own native amount and historical conversion. A fully refunded foreign purchase then leaves a small FX difference in net expense.
- **B. Add a `refund_of` link and convert at the original purchase's rate.** Nets to zero, but adds a column and a linking UI.

**Recommended default:** **A** for this release. B is additive later if users notice the residuals.

<sub>Raised by: Transactions.</sub>

#### D19. System rows (Opening Balance, Balance Adjustment, debt opening rows)

**Question.**

- Should these rows appear in the global `/transactions` list at all? If they do, should they be read-only and badged? The summary must exclude them either way, as analytics, calendar and flow already do.
- May they be trashed or purged? Today, trash keeps their balance effect and purge orphans it. This caused the 6 e2e drifts, and it makes a locked currency changeable.

**Options.**

- **List vs hide.** Hiding them leaves account balances unexplained.
- **Trash and purge allowed vs forbidden.** Allowing them creates drift.

**Recommended default:**

- **List them read-only with a "system" badge**, and exclude them from every summary.
- **Forbid trash and purge from every user path.** These rows change only through "Adjust balance" or reconciliation.

<sub>Raised by 2 areas: Transactions, Concurrency & DB invariants. Findings: `api/_routes/transactions.ts:319` (verified, high: the summary counts system rows as income or expense).</sub>

---

### 5.5 Legacy data, repair and integrity

#### D20. Backfilling NULL currencies, and the order for `SET NOT NULL`

**Question.**

- 69 transactions have a NULL currency and no account. Should the backfill use the org's reporting currency or its legacy currency?
- Until the backfill runs, are NULL rows treated as the reporting currency or counted as excluded?
- In what order is `SET NOT NULL` applied? `wealth_accounts` and `recurring_rules` are ready now. `transactions` must wait for the backfill, and `spending_budgets` for the writer fix.

**Options.**

- **Backfill with the reporting currency.** Wrong whenever reporting ≠ legacy, which is exactly the onboarding-bug and changed-reporting cases.
- **Backfill with the legacy currency.** The currency the user actually entered.
- **Interim treatment:** treating NULL as reporting is wrong exactly when the two differ.

**Recommended default:**

- Backfill with the **legacy `currency`** now, so the interim question goes away.
- Then apply `NOT NULL` in the order given, but **only after the release and rollback window**. The old deployment still writes NULL during a build window or after a rollback.

<sub>Raised by 2 areas: Schema & migrations, Reports. Findings: `api/_lib/wealth-accounts.ts:325` (verified, medium: rows written by the old deployment get a NULL `currency_code`).</sub>

#### D21. Detached (no-account) transactions and recurring rules

**Question.** These rows and rules snapshot the reporting currency when written.

- Should that currency be frozen and never re-derived on edit?
- Should the dialog show it, or offer a picker?
- Should clients get their own currency?

**Options.**

- **Freeze at write time.**
- **Per-client currency.** A new concept.
- **Explicit picker in the dialog.** Another control.

**Recommended default:** **Freeze once set, never re-derive**, and show the currency read-only in the dialog. A per-client currency and a picker are deferred.

<sub>Raised by 3 areas: Recurring, Org settings, Concurrency & DB invariants. Findings: `api/_routes/recurring/[id].ts:187` (verified, high: editing an account-less rule after a currency change flips its currency).</sub>

#### D22. Existing cross-currency debt data

**Question.**

- After migration 0076, some pre-merge debt groups have legs in different currencies. Fix them by hand, post correcting rows, or leave them excluded from reports?
- Production foreign-currency debts with a payer in another currency (allowed on v0.14.x) stop posting after deploy. Grandfather them, pause them with an alert, or relabel them?

These need production audit numbers first.

**Options.**

- **Grandfather.** Keeps alive a path the engine now refuses.
- **Relabel.** Invents money.
- **Pause with an alert.** Honest and visible.
- **For mixed groups:** fix by hand, post correcting rows (the ledger explains the change), or leave them excluded (visible through `excluded_count`).

**Recommended default:**

- **Run the production audit query first.**
- **Pause** repayment rules whose payer is in another currency, with an alert-rail item that explains why.
- Leave mixed legacy groups **excluded and visible**, and have an operator post correcting rows case by case. Never rewrite legs.

<sub>Raised by 2 areas: Schema & migrations, Rollout. Findings: `api/_lib/debts.ts:423` (verified, medium: production foreign debts with a cross-currency payer stop posting); `drizzle/0076_debt_account_currency.sql:25` (low, unverified: cross-currency principal groups relabelled without an audit).</sub>

#### D23. Deleting a debt whose rows are all in Trash

**Question.** Should debt DELETE count trashed rows, and archive instead of hard-deleting, as account DELETE does?

**Recommended default:** **Yes.** Today a hard delete leaves legs with no account.

<sub>Raised by: Schema & migrations. Findings: `api/_routes/debts/[id].ts:273` (verified, medium).</sub>

#### D24. Transfers with a live header over a trashed leg

**Question.** Some transfers have a live header while a leg is in Trash: legacy data from migration 0071, plus anything the tag path already produced. How do we heal them?

**Options.**

- **Relax `set_transfer_trashed(restore)` so it heals these states.** Also hides new one-sided states.
- **A one-off data-repair migration** that marks those headers trashed.

**Recommended default:** **One-off additive repair migration**, plus the writer fixes from D10 and D13. Keep restore strict so any new one-sided state surfaces.

<sub>Raised by: Cascade soft-delete. Findings: `drizzle/0071_logical_transfers.sql:57` (verified, medium); `api/_routes/trash/restore.ts:35` (verified, medium).</sub>

#### D25. Repairing accounts whose balance has drifted from the ledger

**Question.** 8 accounts have drifted on dev; the production count is unknown.

- Should the repair make the ledger win (UPDATE `current_balance` to the ledger sum, so the displayed balance changes) or the balance win (post a system Balance Adjustment, so the ledger explains the stored number)?
- What is the default for drift with no rows at all, such as account `b06c0468`?
- Who runs the repair, and should there be a recurring drift report?

**Options.**

- **Ledger wins.** The user's number moves.
- **Balance wins.** Adds an adjustment row, but keeps what the user has seen.

**Recommended default:**

- **Balance wins by default**, matching the §I reconciliation model's generated adjustment transaction. That includes the no-rows case.
- **Ledger wins** only where the drift is a proven double-apply, because then the stored number is the bug.
- An operator runs a script per account, dry-run first. Add a scheduled **drift report** as a `worker/` job.

<sub>Raised by 2 areas: Concurrency & DB invariants, FX operations. Findings: `api/_routes/transactions.ts:490` (verified, medium: no reconciliation tooling; 8 drifted accounts on dev).</sub>

#### D26. Retries and idempotency for money writes

**Question.**

- Should the DB layer stop replaying non-idempotent statements after an ambiguous network error?
- Should `POST /api/wealth/transfer`, `/api/debts/:id/payments` and `/api/transactions` accept client-generated idempotency ids?

**Recommended default:** **Both.** Never auto-replay a money statement after an ambiguous error. Add an idempotency key (an additive column plus a unique index) to those three routes.

<sub>Raised by: Concurrency & DB invariants. Findings: `src/lib/db/retry.ts:14` (verified, medium).</sub>

---

### 5.6 Recurring rules and Spaces

#### D27. Space currency, cross-currency auto-save, and deleting a Space

**Question.**

- Should Spaces get a currency picker at creation, with the goal in the Space's currency?
- Should cross-currency auto-save stay refused, or get a rate policy (a fixed received amount vs "rate at completion" with an estimate)?
- What happens when a Space with money is deleted into an account in another currency?
- In the UI, block cross-currency choices (same-currency pickers only), or support them?

**Options.**

- **A. Same currency only, everywhere, for this release.**
- **B. Cross-currency with an explicit policy.** §I suggests "calculate at completion", with the estimate clearly marked.

**Recommended default:** **A.**

- Add a **currency picker at Space creation**, defaulting to the reporting currency.
- Auto-save sources and deletion destinations **only list accounts in the Space's currency**. The server already refuses the others.
- Deleting a Space into another currency goes through the transfer wizard.
- B comes later, together with a recurring FX policy.

<sub>Raised by 4 areas: Wealth & transfers, Recurring, UI formatting sweep, Refusal UX. Findings: `src/pages/SpaceDetailPage.tsx:420` (verified, medium: deleting into a foreign account fails); `src/pages/SpaceDetailPage.tsx:308` (verified, medium: auto-save offers foreign sources); `src/components/spaces/SpaceFormModal.tsx:64` (verified, medium).</sub>

#### D28. Occurrences blocked by a currency problem, then fixed

**Question.** When an occurrence is blocked by currency drift or a mismatch and the problem is later fixed, should the missed occurrences post retroactively (the current catch-up contract), or should the rule re-anchor to today, as a debt resume does?

**Options.**

- **Back-post.** Preserves the ledger's dates, but can surprise the user with a burst of rows.
- **Re-anchor.** Loses the occurrences that were due.

**Recommended default:**

- Keep **catch-up** for standard and transfer rules, and show "N occurrences posted" on the rail.
- **Re-anchor** debt rules, as resume already does.
- A blocked occurrence must never be silently skipped, which is today's verified bug.

<sub>Raised by: Recurring. Findings: `api/_lib/recurring-materialize.ts:182` (verified, medium: a failed occurrence is skipped forever and its error erased).</sub>

---

### 5.7 Cards, credit cards and autopay

#### D29. A credit card's currency

**Question.**

- Is the card's currency chosen by the user, with a default (the issuer bank's `currency_code`, else the reporting currency)?
- Or is it always the reporting currency, as today?
- Should it follow the linked or issuer bank silently?
- May it change while the card has no non-system rows and no statements? Today it is locked from birth.

**Options.**

- **Always reporting.** Wrong for a foreign card.
- **A picker with an issuer-bank default.** One extra field.
- **Silently follow the bank.** Surprising for the user.

**Recommended default:**

- A **picker in AddCardWizard**, defaulting to the issuer bank's currency, else the reporting currency.
- Changing it later follows the **D5 shared lock predicate**: allowed with no non-system rows and no statements.

<sub>Raised by 4 areas: Cards, Alerts & notifications, UI formatting sweep, Test harness. Findings: `api/_routes/cards.ts:124` (verified, high: always the reporting currency and never changeable).</sub>

#### D30. Autopay from a funding account in another currency

**Question.** Should autopay be refused when the funder's currency differs from the card's, as recurring auto-save is? Or should it get an FX policy: convert at the latest rate on the due date, record the effective rate and fee, and mark the estimated source amount for confirmation? And what should the alert rail show: "autopay can't run across currencies", or a ≈ figure in the funder's currency?

**Options.**

- **Refuse.**
  - For: simple and consistent with Space auto-save.
  - Against: users with foreign cards pay manually.
- **FX policy.**
  - For: full automation.
  - Against: a new rate policy, estimated amounts, and a confirmation flow.

**Recommended default:** **Refuse**, on both write paths (card create and PATCH) and again in the engine.

- The wizard stops creating cross-currency funding by default.
- Existing cross-currency autopay settings are switched off, with an alert.
- The rail shows the native card-currency figure and the "pay manually" reason, with **no** ≈ projection against the funder. That projection math is what is broken today.

<sub>Raised by 3 areas: Cards, Alerts & notifications, Test harness. Findings: `api/_lib/cards.ts:280` (verified, high: the wizard creates it by default, autopay defers forever, and the rail says "covered"); `api/_routes/cards/[id].ts:136` (verified, medium); `src/lib/alerts.ts:363` (verified, high: the projection subtracts across currencies).</sub>

#### D31. A fee field on cross-currency card payments

**Question.** Should PayCardSheet offer a fee field, recording an issuer or bank FX charge as a separate expense?

**Recommended default:** **Yes.** §I says "issuer conversion charges are fee transactions". Reuse the transfer service's fee support.

<sub>Raised by: Cards. Findings: `src/components/wealth/PayCardSheet.tsx:168` (low, unverified).</sub>

#### D32. Does a statement still count as "paid" after its payment is reversed?

**Question.** After a card payment transfer is reversed, should `paymentsAfter` net out the reversal legs and reset `autopay_status`? Or is the reversal treated as a new charge?

**Recommended default:** **Net the reversal legs and reset `autopay_status`.** A reversed payment is not a payment, and autopay must be able to run again.

<sub>Raised by: Alerts & notifications. Findings: `api/_lib/alerts.ts:77` (verified, high: a reversed card payment still counts as paid, so the overdue alert stays silent).</sub>

*The Cards tab "Owed / Available credit" totals are decided in D46.*

---

### 5.8 Debts and loans

#### D33. A debt's currency at creation

**Question.** Should the Add-debt sheet get a currency picker (defaulting to the reporting currency), or infer the currency from the chosen account, as `/recurring` does? Today the two creation paths disagree.

**Recommended default:** **Infer it from the receiving or paying account** when one is chosen, and show a picker only when no account is involved. Both paths call one helper.

<sub>Raised by: Debts. Findings: `src/components/debts/DebtFormSheet.tsx:134` (verified, medium: locked to the workspace currency); `src/components/recurring/RecurringRuleDialog.tsx:429` (verified, high: a debt created from Recurring is stored in the account's currency but displayed in the workspace currency).</sub>

#### D34. Debts hub totals across currencies

**Question.**

- Should the Debts hub report per-currency buckets everywhere (like `owed_by_currency`)?
- Or convert into the reporting currency: paid and interest at the payment date, required and owed at the latest rate, with an `excluded_count` and FxExcludedNotice?
- Should `/debts` also show "Total debt ≈ X", matching `/wealth` `debts_owed`?
- Should "Repaid in total" include closed (archived) debts, and be per currency?

**Recommended default:** Apply the **D46 rule**:

- a native per-currency breakdown, plus "≈ Total debt" in the reporting currency so it matches `/wealth`;
- flows convert at the row's date and stocks at the latest rate;
- **"Repaid in total" includes archived debts** and is per currency, with a ≈ figure.

<sub>Raised by: Debts. Findings: `api/_lib/debts.ts:253` (verified, high: hub figures add across currencies); `api/_lib/debts.ts:256` (verified, medium: "Repaid in total" is a raw sum and ignores closed debts); `api/_lib/debts.ts:243` (verified, medium: "interest this month" is a raw sum).</sub>

#### D35. The payoff planner and the debt-payment ratio across currencies

**Question.**

- Should the planner offer a per-currency plan switcher, convert every debt at the latest rate (with an FX-risk disclaimer), or keep excluding foreign debts with a correct message?
- Should the debt-payment ratio use income converted into the reporting currency, or only income in the planner's currency?

**Options.**

- **Convert everything.** Mixes FX risk into a multi-year plan.
- **Exclude foreign debts.** After a reporting change, every debt drops out of the plan.
- **Per-currency switcher.** A small filter, since the planner already works on a single-currency set.

**Recommended default:**

- A **per-currency switcher**, defaulting to the reporting currency if it has debts, else the currency with the most owed.
- The ratio uses **income in the plan's currency only**, so both sides are in the same unit.

<sub>Raised by: Debts. Findings: `src/components/debts/DebtPlanner.tsx:248` (verified, medium: after a currency change every debt is dropped); `api/_lib/debts.ts:190` (verified, medium: ratio divides by a raw cross-currency sum).</sub>

#### D36. A debt closed with a balance left (written off, paid off, refinanced)

**Question.** When a debt is written off, marked paid off with a balance remaining, or refinanced, should a system adjustment bring it to zero, so the ledger and net worth follow? Or should the wealth summary exclude debts that are no longer open? `/wealth` and `/debts` must agree either way.

**Options.**

- **System adjustment to zero.** Every reader follows the ledger with no new filter.
- **Exclude in the wealth summary.** The filter must be copied into every reader.

**Recommended default:** **Post the system adjustment**, and reverse it if the debt is reopened.

<sub>Raised by: Debts. Findings: `api/_lib/wealth-summary.ts:81` (verified, medium: `/wealth` still counts written-off, paid-off and refinanced debts).</sub>

#### D37. Repayments and disbursements in another currency

**Question.** Keep refusing these with `currency_mismatch`? Or support them through the transfer service, with sent and received amounts and an effective rate (principal would then be two amounts)?

**Recommended default:** **Keep refusing** in this release. This is consistent with ARCHITECTURE.md's advice to keep debts out of the first FX pass. Translate the refusal (D67, D68) and revisit with the D22 audit numbers.

<sub>Raised by: Debts.</sub>

---

### 5.9 Budget currency

#### D38. Pin a budget's currency at creation, or follow the reporting currency?

**Question.** Migration 0069 stamped a currency on legacy budgets, but new budgets are written with NULL, which means "always the current reporting currency". Old and new budgets therefore behave differently.

- Should every budget be pinned at creation, with a sub-budget taking its parent's currency and the NULL rows backfilled?
- May the user pick a budget currency other than the reporting currency?
- Must every sub-budget match its parent?

**Options.**

- **A. Pin at creation.**
  - For: §I says "budgets get an explicit currency"; this was the 0069 behaviour; the e2e fixture expects "EUR 70.00 of 100.00" to survive a switch from EUR to INR.
  - Against: spend must then convert into currencies other than the reporting one (see D54).
- **B. NULL follows the reporting currency.** A reporting change turns "EUR 500" into "INR 500" against converted spend.

**Recommended default:** **A.**

- **No picker** in this release: the currency is always the reporting currency at creation.
- **Sub-budgets must match their parent**, enforced on the server.
- Backfill the NULL rows, then apply `NOT NULL` (D20).

<sub>Raised by 8 areas: Schema & migrations, FX core, Budgets, Org settings, UI formatting sweep, API/platform, Rollout, Test harness. Findings: `api/_routes/spending-budgets.ts:90` (verified, high); `api/_lib/fx-rates.ts:278` (verified, medium: only reporting-currency pairs are fetched).</sub>

#### D39. What a reporting-currency change does to existing budgets

**Question.** When the reporting currency changes, what happens to budget limits and history?

**Options.**

- **(a) Keep each budget in its authored currency, and display it so.**
- **(b) Convert limits at the change-date rate and re-pin them, with an audit entry.** The user's round numbers become odd ones.
- **(c) Block the change, or require confirmation, while budgets exist.** Too strong.

**Recommended default:** **(a).** The D2 confirmation dialog lists the budgets that stay in the old currency. (b) can come later as an explicit per-budget "convert" action.

<sub>Raised by 4 areas: Budgets, UI formatting sweep, Rollout, Test harness.</sub>

#### D40. Currency for business per-client caps (v1) and `budget_history`

**Question.** Add a pinned `currency_code`, or keep judging caps in the reporting currency and accept the relabel?

**Recommended default:** **Pin it**, as in D38. Add an additive column, backfilled with the org's current currency.

<sub>Raised by 3 areas: Org settings, UI formatting sweep, API/platform. Findings: `src/lib/db/schema.ts:1174` (verified, high); `api/_routes/budgets.ts:56` (verified, high).</sub>

#### D41. Figures that span budgets in different currencies

**Question.** How should the overall header allocation, the dashboard "your budgets" total, and analytics `budgeted_limit` and unclaimed spend handle budgets in different currencies? After D39, a reporting change produces exactly that mix.

**Options.**

- **Convert at the latest rate**, as the wealth summary does.
- **Convert at the window-close rate.**
- **Refuse, and show per-currency totals.**

**Recommended default:**

- **Open windows** (header, allocation, dashboard) convert limits at the **latest rate**, marked ≈.
- **Closed windows** in analytics convert at the **window-close rate**, so history doesn't move. This is consistent with `limitForWindow` using the limit that was in effect at the close.

<sub>Raised by: Budgets.</sub>

#### D42. Budgets with rows that have no rate

**Question.**

- What verdict does a budget get when `excluded_count > 0`?
- Do alerts still fire on the counted spend alone?
- Does adherence skip incomplete windows?
- Is the excluded count per selected view window, or per budget in its own window?
- Do notifications fire on partial spend with an "incomplete" marker, wait until rates exist, or ignore the gap (today)?
- Should a healed or corrected rate re-evaluate notifications already sent?

**Recommended default:** Follow §I ("a missing rate makes the affected budget result incomplete and visible"):

- Show an **"incomplete" state** on the budget.
- Warning and exceeded alerts **still fire when the counted spend alone crosses the threshold**, because counted spend is a lower bound. They carry an incomplete marker. Never send "on track" on incomplete data.
- **Adherence skips incomplete windows.**
- The excluded count covers the rows in **the window whose spend is shown**: the view window on `/budgets`, the budget's own window on its detail page.
- A healed rate is **logged only, never re-notified**.

<sub>Raised by 3 areas: Budgets, Alerts & notifications, FX operations. Findings: `src/pages/BudgetsPage.tsx:331` (verified, medium: the notice over-counts and misses view windows); `src/pages/BudgetDetailPage.tsx:227` (verified, medium: excluded rows invisible outside the list).</sub>

#### D43. The add-transaction budget hint for a foreign-currency expense

**Question.** What should the hint do when the expense is in a foreign currency?

**Options.**

- **Convert on the client at the latest rate**, marked ≈.
- **Fetch a server preview.** One more request.
- **Hide the hint.**

**Recommended default:** **Hide it** for foreign-currency expenses in this release, so it never shows a wrong number. Add the ≈ version later.

<sub>Raised by: UI formatting sweep. Findings: `src/components/transactions/tx-form.tsx:279` (verified, medium: adds a native foreign amount to a reporting-currency budget).</sub>

*Budget rate age and third-currency conversion are decided in D54 and D56. How "Recent" rows display is decided in D47. Fees counting against budgets is decided in D12.*

---

### 5.10 Showing mixed-currency figures in reports

#### D44. Summaries scoped to one account

**Question.** `GET /api/transactions?wealthAccountId|cardId&page=` and the `/wealth/:id` stats return reporting totals today, while the account page renders native amounts. Should the summary be native, or in the reporting currency with a "converted" label?

**Recommended default:** **Native, in the account's currency, returned by the server.** It is the unit the page already shows.

<sub>Raised by 4 areas: Wealth & transfers, Transactions, UI formatting sweep, Rollout.</sub>

#### D45. The consolidated figure before `/api/wealth/summary` answers, or when it fails

**Question.** What should the Wealth hero and the Dashboard wealth card show in a multi-currency workspace?

**Options.**

- **A skeleton.**
- **Per-currency native totals.**
- **The last cached summary, labelled "as of".**
- **Nothing.**

**Recommended default:** **Never a raw sum across currencies.**

- **Single-currency workspace:** compute locally, as today.
- **Multi-currency workspace, loading:** paint the in-memory cached summary if one exists (stale-while-revalidate), else a skeleton.
- **Summary failed:** show per-currency native totals with "conversion unavailable".
- **Nothing goes to localStorage.** Balances are outside `PERSIST_ALLOWLIST`.

<sub>Raised by 3 areas: Wealth & transfers, Reports, UI formatting sweep. Findings: `src/pages/WealthPage.tsx:309` (verified, high); `src/pages/Dashboard.tsx:582` (verified, medium).</sub>

#### D46. Totals over lists that mix currencies (one rule for all of them)

**Question.** These screens total lists that can mix currencies:

- the Cards strip "Owed / Available credit";
- the debts hub `month.required`, `paid`, `overdue` and `totalRepaid`;
- recurring monthly totals and the dashboard Recurring card;
- the rule page's "Posted so far" (`posted_total`);
- split-group detail.

Should each show grouped native totals, a converted total with an excluded count, or both? How is "available credit" defined across currencies? The expected strings in the e2e suite depend on this answer.

**Options.**

- **Grouped native totals only.** Honest, but gives no single figure.
- **Converted only.** Hides what is native.
- **Both.**

**Recommended default:** **Both, as one rule:**

- a native per-currency breakdown, always;
- plus "≈ X" in the reporting currency when every needed rate exists, and an excluded notice when one is missing;
- **flows** (paid, posted, interest) convert at each row's date;
- **stocks** (owed, available credit, required) convert at the latest rate;
- available credit is never summed natively.

<sub>Raised by 4 areas: Recurring, Cards, Debts, Test harness. Findings: `src/components/cards/CardsSummaryStrip.tsx:74` (verified, high: owed and available added across currencies); `api/_lib/recurring-query.ts:79` (verified, medium: "Posted so far" is a raw sum).</sub>

#### D47. Amounts on individual rows: native, ≈, or both?

**Question.** Search and drilldown results, budget-detail "Recent" rows, and alert-rail items (for example "Money came in" on a foreign account): native amount only, or native plus "≈ reporting"?

**Recommended default:**

- **Always show the native amount** with its own currency.
- Add "≈ reporting" **only when the currencies differ**, following the §H account-card rule, in search, drilldown and budget "Recent" rows.
- The **alert rail stays native-only.**

<sub>Raised by 3 areas: Budgets, Reports, Alerts & notifications. Findings: `api/_routes/search.ts:44` (verified, medium); `src/pages/BudgetDetailPage.tsx:316` (verified, medium).</sub>

#### D48. Report definitions: dashboard KPIs, client totals, "Balance"

**Question.**

- Should the Dashboard's "Total revenue / expenses" use the same P&L rules as Analytics (no system rows, refunds as negative expense)? Should they be all-time, or follow the analytics window?
- Should client totals (list, detail, closed) exclude system rows, as analytics, calendar and flow do?
- The money-flow root "Balance" includes cards, loans, receivables and Spaces, while the Dashboard "Total available" excludes Spaces and debts. Which definition does each label mean?

**Recommended default:**

- **One P&L definition everywhere** (`api/_lib/tx-sql.ts`).
- Keep the Dashboard KPIs **all-time, labelled as such**. Making them follow the analytics window is a separate product call.
- **Client totals exclude system rows.**
- **Rename the flow root to "Net worth"** (everything). "Total available" stays spendable accounts only.

<sub>Raised by: Reports. Findings: `src/pages/Dashboard.tsx:1072` (verified, high: KPIs count opening balances, adjustments and refunds as income); `api/_routes/clients.ts:129` (verified, medium).</sub>

#### D49. Sorting by amount in a mixed-currency workspace

**Question.** Should "sort by amount" use the reporting amount (rows without a rate last), or keep sorting on raw native numbers?

**Recommended default:** **Sort by reporting amount, rows without a rate last.**

<sub>Raised by: Transactions. Findings: `api/_routes/transactions.ts:28` (low, unverified).</sub>

#### D50. How far to surface excluded counts

**Question.** Should excluded counts appear at page level only, or as markers on each day, bucket, group and client?

**Recommended default:** A **page-level notice everywhere** in this release, plus a marker wherever one entity's total is its own screen: client detail, budget row and detail, card, debt. Per-day and per-bucket markers come later. Old clients drop `excluded_count` entirely (`api/_routes/analytics.ts:1`, verified, medium), which D78 covers.

<sub>Raised by 2 areas: Reports, Budgets.</sub>

#### D51. Admin console money, and admin edits to the ledger

**Question.**

- Should admin money figures show per-currency groups, or convert to each org's reporting currency with excluded counts?
- Should admin transaction edits and deletes keep wealth balances and transfer headers in sync, be restricted to detached rows, or be dropped altogether for account-linked, transfer and debt rows?

**Recommended default:**

- **Per-currency groups.** Conversion adds nothing when comparing across orgs.
- Admin ledger edits are **restricted to detached rows that are not system, transfer or debt rows**. Everything else is read-only in admin and is fixed through user flows or operator scripts that call the services.

<sub>Raised by 2 areas: Transactions, Org settings. Findings: `api/_routes/admin/transactions.ts:150` (verified, high: edits bypass the balance, transfer and debt services); `api/_routes/admin/org-detail.ts:57` (verified, medium: raw sums across currencies).</sub>

---

### 5.11 FX rates: provider, history, storage, staleness, operations

#### D52. Production FX provider

**Question.** Which provider adapter runs in production (STATUS phase 3)?

**Options.**

- **open.er-api free tier.** Rate-limited, and requires attribution.
- **Frankfurter (ECB).** No SLA.
- **A paid provider.** Costs money.

**Recommended default:**

- **Frankfurter for ECB currencies.**
- **open.er-api for the rest**, with the required attribution.
- Keep the `FX_DISABLED` kill switch.
- Document `FX_DISABLED`, `FX_FRANKFURTER_HOST` and `FX_OPEN_ER_API_HOST` in CLAUDE.md.
- Re-evaluate a paid provider if D53 needs back history for floating non-ECB currencies.

<sub>Raised by: FX operations.</sub>

#### D53. Historical rates for non-ECB currencies

**Question.** 125 of the 155 selectable currencies have no history source, including AED, SAR, QAR, KWD, OMR, BHD, PKR, LKR, BDT, NPR, EGP and VND. Their older rows are excluded forever, and the reporting-currency picker still offers them.

**Options.**

- **(a) Exact cross-rates for USD-pegged currencies**, derived from the peg and the ECB USD series. Pegs per USD: AED 3.6725, SAR 3.75, QAR 3.64, BHD 0.376, OMR 0.3845, JOD 0.709.
- **(b) Rates entered by an operator**, daily or monthly.
- **(c) A paid historical provider.**
- **(d) Manual rates scoped to one workspace.**
- **(e) "Estimated at the nearest available rate".**
- **(f) A warning, or a refusal, in the reporting-currency picker.**

**Recommended default:**

- **(a) now.** It is exact and needs no provider.
- **From go-live, the scheduled tick (D59) records a daily rate for every currency in use.** Floating non-ECB currencies (PKR, LKR, BDT, NPR, EGP, VND, KWD) then build their history going forward.
- **(b) monthly operator imports** for their back history.
- **(f)**: warn in the picker when a currency has no history.
- Reject **(d)**: it conflicts with a global rate table (D55).
- Reject **(e)** beyond the carry-forward limit (D56).

<sub>Raised by 3 areas: FX core, Org settings, FX operations. Findings: `api/_lib/fx-rates.ts:252` (verified, high); `api/_lib/fx-rates.ts:104` (verified, medium: the picker offers currencies with no history).</sub>

#### D54. How rates are stored, and triangulation

**Question.**

- Keep fetching each pair in the foreign→reporting direction, or store only EUR-based ECB rates and derive every cross rate in Decimal/SQL?
- After a switch to INR, `fx_rate_on` knows only direct and inverse pairs. Should USD→INR be triangulated through EUR, or excluded until that series is fetched?
- Should budget currencies other than the reporting one convert through a third currency (reporting, EUR or USD)?

**Options.**

- **Per-pair storage (today).** Misses third-currency rows, and precision and precedence depend on the direction.
- **EUR-based canonical storage.** One model fixes precision, precedence, triangulation and budget-target coverage together.

**Recommended default:** **Store rates EUR-based and derive cross rates in SQL** (`fx_rate_on`). Sources that aren't EUR-based (pegs, open.er-api) are normalised on insert. This answers the triangulation and budget-target questions at once.

<sub>Raised by 3 areas: FX core, Budgets, Test harness. Findings: `api/_lib/fx-rates.ts:278` (verified, medium: non-reporting budgets lose third-currency rows forever).</sub>

#### D55. One global rate table, or coverage per org?

**Question.** `fx_rate_snapshots` is shared by all tenants, so one org's fetches change another org's results. Keep it global, or make rate coverage deterministic per org?

**Recommended default:** **Keep it global.** Rates are market facts. Remove the non-determinism by making the scheduled job (D59) own coverage for every currency in use, so no report depends on which org fetched first. Manual rates are platform-wide and restricted to super-admins (D60).

<sub>Raised by: FX core.</sub>

#### D56. Staleness and carry-forward

**Question.**

- How old may a carried-forward rate be before the row counts as excluded?
- Should aggregates add an `estimated_count` (rows converted with a fallback or old rate) next to `excluded_count`?
- Does a provider date that lags today (a weekend, or before ECB publishes around 14:00 UTC) count as stale for the UI badge and the TransferWizard hint?
- Does one stale foreign rate mark the whole consolidated summary stale? The fixture leaves JPY without today's rate and expects `stale=true` with `as_of` = today − 1.
- How is a stale rate shown?

**Recommended default:**

- **At most 7 calendar days of carry-forward**, which covers weekends and holidays. Beyond that the row is excluded, visibly.
- **Normal provider lag** (the latest business day, or before the ECB publish time) is **not stale**. Show "as of <date>".
- A summary is **stale if any rate it used is stale**, with `as_of` = the oldest rate. This matches the fixture.
- **Defer `estimated_count`.** ARCHITECTURE.md question 2 suggests an "estimated" marker, but the 7-day cap bounds the error. Add it if the cap is raised or D53(e) is adopted.

<sub>Raised by 5 areas: FX core, Reports, Budgets, FX operations, Test harness. Findings: `drizzle/0074_fx_reporting_functions.sql:19` (low, unverified: budgets convert at an old rate with no warning); `api/_lib/fx-rates.ts:198` (low, unverified: stale flag and rate date inconsistent).</sub>

#### D57. Upgrading a same-day fallback snapshot

**Question.** A same-day fallback snapshot is a placeholder, not an observation. May it be upgraded when the real observation arrives? That bends the "immutable snapshots" wording.

**Recommended default:** **Yes, for rows whose source is a fallback only.** Observations stay immutable. Update the wording in the docs.

<sub>Raised by: FX core.</sub>

#### D58. One definition of "current rate"

**Question.** `/api/wealth/summary` uses the JS `currentRate`. `/flow` balances use the SQL `fx_rate_on(current_date)`. Which one is the definition?

**Recommended default:** **`fx_rate_on(current_date)` for both**, so current and historical rates follow the same carry-forward rules.

<sub>Raised by: FX core.</sub>

#### D59. Where the FX backfill runs

**Question.**

- Today the backfill runs inside GET requests, inserting one row at a time sequentially, for up to 6 years of history. Should it run at write time when a foreign row is created, or in the `worker/` job queue?
- Once the hourly tick exists, should reporting GETs stop calling `ensureRatesForOrg` (read-only and faster, with up to 1 h of staleness), or keep it as a backstop?

**Options.**

- **Request path (today).** Slow first reads, and concurrent routes race each other.
- **At write time.** Still synchronous.
- **Worker.** Rows stay excluded for a few minutes until the job lands.

**Recommended default:**

- **The worker owns the backfill**: an hourly tick for current rates, plus a backfill job enqueued when a foreign row, a new account currency or a reporting change first needs a series.
- GETs are **read-only** and count excluded rows until the job lands.
- `ensureRatesForOrg` survives only as a non-blocking enqueue.

<sub>Raised by 3 areas: Reports, API/platform, FX operations. Findings: `api/_lib/fx-rates.ts:263` (verified, medium: coverage check re-inserts history row by row in the request path); `api/_lib/fx-rates.ts:267` (verified, medium: budget GETs block on the backfill).</sub>

#### D60. Rate operations: who may import or correct rates, and where FX health lives

**Question.**

- Who may import or correct rates: a new capability exclusive to super-admins, or the grantable `settings` capability? A manual rate changes every workspace's reports platform-wide.
- Does FX health live in an extended Worker panel in `/admin`, or on a dedicated `/admin/fx` page with the manual import form?

**Recommended default:**

- A **new capability exclusive to super-admins**, like `org_transactions`, and left out of `GRANTABLE_ADMIN_CAPS`.
- **Extend the Worker panel** with health and the import form. Move to `/admin/fx` only if it outgrows the panel.

<sub>Raised by: FX operations.</sub>

---

### 5.12 Precision, rounding and formatting

#### D61. Money scale and minor units

**Question.**

- Widen money columns to `numeric(20,4)`, with transactions and balances to match?
- Or enforce each currency's ISO minor units (JPY 0 decimals, KWD 3) and refuse more than 2 decimals with a clear 400 until the columns are widened?
- Or remove the 3-decimal currencies (KWD, BHD, OMR, JOD, TND) from `CURRENCY_LIST` until then?
- Does `reporting_amount` round to the target currency's minor units?

The expected values in the precision tests depend on this answer.

**Options.**

- **Widen.** Correct, but a heavy migration of every amount column.
- **Validate at the current scale.** Small, but 3-decimal currencies lose their third digit, refused explicitly.
- **Remove the currencies.** Strands workspaces that may already use them.

**Recommended default:**

- **Now:** validate decimals against each currency's ISO minor units, **capped at 2**. JPY gets 0; 3-decimal currencies are refused with the sub-code `amount_too_many_decimals` (D68).
- **Later:** a follow-up migration widens the columns.
- **Rounding:** sum unrounded values and round the total to the target's minor units at display, not per row.

<sub>Raised by 2 areas: Schema & migrations, Test harness. Findings: `api/_routes/transactions.ts:479` (verified, medium: 3-decimal amounts drift balances and KWD/BHD fils are lost); `api/_lib/fx-rates.ts:220` (low, unverified: always rounds to 2 decimals); `src/pages/AnalyticsPage.tsx:35` (low, unverified: Intl RangeError on iOS 15.0–15.3 for 3-decimal currencies).</sub>

#### D62. One formatting policy

**Question.**

- Should every ad-hoc `Intl.NumberFormat('en-US')` formatter be replaced by `formatMoney` / `moneyLocale`, accepting a visible change in digit grouping (for example Indian lakh grouping) for existing users?
- Should INR use Indian grouping in every Indian-language UI, not just `en`?

**Recommended default:** **Yes to both.** Use `formatMoney` everywhere. INR uses Indian grouping in `en`, `hi`, `ml`, `ta` and `te`. Mention the change in the release notes.

<sub>Raised by 2 areas: UI formatting sweep, API/platform.</sub>

#### D63. A build guard against formatting native amounts in the workspace currency

**Question.** Should a static guard (a source scan, like `tx-sql.test.ts`) fail the build when a component passes a native field (`tx.amount`, `rule.amount`, `current_balance`, `goal_amount`) to `formatMoney` with the bare workspace `currency`?

**Recommended default:** **Yes**, with an allowlist. The verified mislabelled screens (cards, recurring, Spaces, search, trash, drilldown, AI confirm) show that this bug keeps coming back.

<sub>Raised by: UI formatting sweep.</sub>

#### D64. How rates are labelled

**Question.** Always "1 foreign = X reporting", or always the direction that gives a number ≥ 1 ("1 USD = ₩1,355.40")?

**Recommended default:** **The direction that gives ≥ 1**, always naming both currencies. This avoids labels like "1 KRW = 0.000738 USD".

<sub>Raised by: FX core.</sub>

---

### 5.13 Quotations and referrals

*Billing is decided in D4, and admin money in D51.*

#### D65. Quotation currency

**Question.** `quotations.amount` has no currency column.

- Add `quotations.currency_code`, defaulting to the reporting currency, with an optional picker for a business quoting a foreign prospect?
- Or keep quotations following the workspace currency: freeze only the PDF label at creation, or block or warn on a workspace currency change while quotations exist?
- What does "convert to client" carry over?

**Options.**

- **A snapshot column.** Additive, and correct.
- **Freeze the PDF label only.** The list and the PDF can disagree.
- **Block or warn on the change.** Punishes the user.

**Recommended default:**

- An **additive `currency_code`**, set when the quotation is created and backfilled with the org's current currency.
- **Include the picker.** Quoting a foreign prospect is a real business case.
- The PDF and the list both use the stored currency.
- **Convert-to-client carries the amount and currency unchanged**, with no conversion.

<sub>Raised by 4 areas: Alerts & notifications, Org settings, UI formatting sweep, AI & import/export. Findings: `api/_lib/quotation-pdf.ts:81` (verified, medium: changing the reporting currency relabels every quotation PDF).</sub>

#### D66. Referral money

**Question.**

- Per-currency balances and payouts?
- Or convert every reward into the programme currency when it is credited, storing both the native and the programme amounts?
- What should a change of programme currency do to existing balances?

**Options.**

- **Per-currency balances.** Multi-currency payouts.
- **Convert at credit time.** One balance and one payout currency.
- **For a programme-currency change:** relabel (today's bug), keep a mixed balance, or convert once.

**Recommended default:**

- **Convert at credit time and store both amounts.**
- On a programme-currency change, **convert outstanding unpaid balances once at the change-date rate**, audit-logged, and leave paid history untouched.
- Validate the reward currency code.

<sub>Raised by: Org settings. Findings: `api/_lib/referral.ts:160` (verified, critical: balances add rewards across currencies and payouts are saved from that total); `api/_routes/admin/referral-settings.ts:33` (verified, medium: a programme currency change relabels balances, and an invalid code is not validated).</sub>

---

### 5.14 Error codes, notification copy and i18n

#### D67. Where server refusals get translated

**Question.**

- Does the client map the refusal `code` to `apiErrors.<code>`, with the server keeping English for logs and API consumers? Or does the server localize from `Accept-Language`?
- When a code has no translation, or there is no code, does the user see the caller's translated fallback, or the server's English `error`?

**Recommended default:** **The client maps codes.** The fallback is the **caller's translated message**, never the server's English.

<sub>Raised by 2 areas: API/platform, Refusal UX. Findings: `src/lib/api.ts:516` (verified, medium: every multi-currency refusal is an English toast in every locale).</sub>

#### D68. What a refusal carries

**Question.**

- **Interpolation parameters.** Should refusals carry currency, account name and status, so a translation can say "This debt is in {{currency}}"? That needs server changes at:
  - `api/_routes/debts.ts:146` and `:173`
  - `api/_routes/debts/[id].ts:345`
  - `api/_lib/debts.ts:425`
  - `api/_routes/recurring/[id].ts:164`
  - `api/_routes/wealth/accounts/[id].ts:89`
- **Sub-codes.** Should `invalid_transfer_amounts` split into `destination_amount_required`, `amount_too_many_decimals`, `amount_not_positive`, `amount_too_large`, `same_currency_amounts_differ` and `fee_invalid`?
- **First-class codes.** Should the 0073 RAISE tokens (`transfer_account_currency_changed`, `reversal_linked_transfer_is_immutable`) become API codes?

**Recommended default:** **Yes to all three.** They are additive fields, and old clients ignore them.

<sub>Raised by: Refusal UX.</sub>

#### D69. How a recurring rule's `last_error` is stored

**Question.** Add columns `last_error_code` / `last_error_params` (an additive migration), or store JSON inside `last_error`? Legacy English rows need a fallback either way.

**Recommended default:** **Additive columns.** Legacy rows without a code render a generic translated message.

<sub>Raised by: Refusal UX. Findings: `api/_lib/recurring-materialize.ts:325` (verified, medium: stored as English and rendered verbatim).</sub>

#### D70. A CI gate for error codes

**Question.** Should CI fail when a `code: "…"` literal in `api/` has no `apiErrors` key, or the key is not translated in all 8 locales?

**Recommended default:** **Yes.** Extend `i18n:check`.

<sub>Raised by: Refusal UX.</sub>

#### D71. Money in notifications

**Question.**

- Should card notifications carry a currency and a translatable reason code instead of bare numbers and raw English errors?
- Is the copy formatted on the server with a locale-neutral symbol ("₹1,800.00", as budget notifications do)? Or does the data carry raw `{amount, currency}` for the client to format in the reader's locale? Push would still need a server string.

**Recommended default:** **Both.**

- Store `{amount, currency, reason_code}` in the notification data, and render it in-app in the reader's locale.
- Keep a server-formatted string, with its currency, for push.
- Include the currency in the dedupe key (`api/_lib/notify-budget.ts:202`, low, unverified).

<sub>Raised by 2 areas: Cards, Alerts & notifications.</sub>

---

### 5.15 AI quick add, assistant, import and export

#### D72. The user states a currency that doesn't match the account

**Question.** The user says "spent $20" but has no USD account.

- Should parsing return a currency, and should the prompt list each account's currency?
- On a mismatch:
  - **(a)** refuse the one-tap save and ask for the amount actually charged in the account's currency;
  - **(b)** convert at today's rate and mark it estimated;
  - **(c)** only flag it?

**Recommended default:** **(a)**, which is also the raising area's recommendation. A card or bank charges in its own currency, and a guessed rate is never the ledger fact. Return the currency from parsing, and list the account currencies in the prompt.

<sub>Raised by 2 areas: UI formatting sweep, AI & import/export. Findings: `api/_lib/ai.ts:276` (verified, high: a stated foreign currency is dropped and the number saved in the account's currency); `src/components/AiAssistantConfirm.tsx:102` (verified, medium: a currency doubt is still one tap).</sub>

#### D73. Cross-currency transfers and card payments proposed by the AI

**Question.**

- Collect the received amount inline on the voice review card, or always hand off to the existing transfer wizard, which already supports sent, received and fee?
- Is the amount the user states the source amount (what left the bank) or the destination amount (what reached the card)? For "paid my Visa statement", the figure looked up is in the card's currency.

**Recommended default:**

- **Hand off to the transfer wizard**, prefilled.
- Treat a stated amount as the **source** amount, **except for card or statement payments**, where the figure is the card's (the destination).
- Prefill that side and ask for the other.

<sub>Raised by: AI & import/export. Findings: `src/components/AiAssistantConfirm.tsx:136` (verified, medium: AI cross-currency transfers can never be saved).</sub>

#### D74. Which account AI and quick add use by default

**Question.** Should the AI and quick-add defaults prefer an account in the reporting currency over the "first cash account" rule (`defaultAccountId`), now that a workspace can have cash wallets in several currencies?

**Recommended default:** **Yes.** Prefer the default account in the reporting currency, then fall back to the first cash account.

<sub>Raised by: AI & import/export.</sub>

#### D75. Balances or spending totals in the AI context

**Question.** Should the AI context ever include balances or spending totals, for a future "how much did I spend" intent?

**Recommended default:** **Not in this release.** If it is ever added, it must use `reporting_amount()` plus `excluded_count`, never raw sums.

<sub>Raised by: AI & import/export.</sub>

#### D76. The export and import contract

**Question.** No export or import exists yet. Which columns are mandatory, and is a "native totals per currency" footer required?

**Recommended default:** **Mandatory columns:** native amount, `currency_code`, reporting amount, rate date, and an excluded flag. **Plus** a footer with native totals per currency. Fix this now so the first exporter never produces a raw sum.

<sub>Raised by: AI & import/export.</sub>

---

### 5.16 Rollout, native compatibility and release order

#### D77. Migration order against dev's 0075

**Question.** Origin/dev's 0075 (account colours) is stamped above 0069–0074. If dev is promoted to main before this branch merges, production skips 0069–0074 silently. Options: ship multi-currency into dev first, or re-stamp 0069–0074 above production's watermark at release time. Who checks the watermarks of the Preview and e2e databases?

**Options.**

- **Merge this branch into dev before any dev→main promotion.** Production applies 0069–0076 in one deploy, because their `when` values sit between 0068 and 0075.
- **Re-stamp at release time.** This breaks the "never edit an existing `when`" rule, and re-applies the migrations on databases that already ran them.

**Recommended default:** **Merge into dev first; no re-stamping.** Whoever promotes dev→main runs `npm run migrations:check` and compares `max(created_at)` on the Preview and E2E databases, as a release-checklist step.

<sub>Raised by 2 areas: Schema & migrations, Rollout. Findings: `drizzle/meta/_journal.json:1` (verified, medium).</sub>

#### D78. Gating foreign currencies for old native clients

**Question.**

- Keep foreign-currency selection for accounts, Spaces and card banks **off** in production (a server flag, `409 multi_currency_disabled`) until native 1.5.0 is in the stores and adoption passes a threshold?
- Or ship it now, accepting that 1.4.0 users see a raw-summed net worth and can write amounts under the wrong currency?
- Should writes to foreign-currency accounts that carry no currency acknowledgement be refused (`409 client_update_required`)?
- Should this release add an `x-client-version` header and a minimum supported native version, with a forced-update screen?

**Options.**

- **Ship now.** 1.4.0 users see wrong numbers.
- **Server flag.** Delays the feature.
- **Refuse writes from undeclared clients.** Needs the header first.
- **Forced update.** Needs a store release that ships the screen.

**Recommended default:** **Add `x-client-version` and a minimum supported version in this release.** Without them, no future contract change can be gated per client.

- Keep foreign-currency creation **off in production**, with a per-org allowlist for beta testers, until adoption of ≥ 1.5.0 passes a threshold the team sets.
- Once it is on, refuse foreign-account writes from undeclared clients with `409 client_update_required`.

<sub>Raised by 2 areas: API/platform, Rollout. Findings: `.env.android:1` (verified, high: store-pinned bundles show raw sums and allow writes behind the wrong symbol); `src/pages/WealthPage.tsx:297` (verified, high); `api/_routes/analytics.ts:1` (verified, medium: old clients drop `excluded_count`).</sub>

#### D79. Deploy order and release gate

**Question.** The planned order is the server first, then `cap:sync` and a store release. Should the release gate require a mobile (≤ 400 px) multi-currency e2e pass?

**Recommended default:** **Yes.**

1. Deploy the server first; the migrations are additive and old clients keep working.
2. Run `npm run cap:sync:android` and `npm run cap:sync:ios`, then ship a store release.
3. Gate that release on a mobile (≤ 400 px) multi-currency e2e pass.

<sub>Raised by: API/platform. Findings: `android/app/src/main/assets/public/index.html:1` (verified, medium: the native bundles are pre-multi-currency).</sub>

#### D80. Rollback policy

**Question.** Declare the release roll-forward-only once the first cross-currency transfer or foreign account exists in production?

**Recommended default:** **Yes.** The old code raw-sums and writes NULL currencies (`api/_lib/wealth-accounts.ts:325`, verified, medium).

<sub>Raised by: Rollout.</sub>

#### D81. Making the PWA update prompt sticky

**Question.** Should `UpdatePrompt` be non-dismissable for this release, so v0.14.1 tabs don't linger?

**Recommended default:** **Yes, for this release only.** It still reloads through `updateSW(true)` and never force-activates, so the PWA rule stands.

<sub>Raised by: Rollout.</sub>

---

### 5.17 Test harness

#### D82. Where FX seeding may run

**Question.** `fx_rate_snapshots` is global, and a "manual" rate beats the market rate on the same day. Seeding the shared dev database (which `playwright.config.ts` loads from `.env.local`) would therefore rewrite every developer's reports.

**Recommended default:** **Seed only when `E2E_FX_SEED=1`**, which is set only in `e2e.yml` against `E2E_DATABASE_URL`. Locally, the exact-value specs skip unless `DATABASE_URL` points at a personal Neon branch.

<sub>Raised by: Test harness.</sub>

#### D83. A throwaway workspace per run

**Question.** Create a throwaway workspace per run (a business org with EUR reporting, deleted in `afterAll`), or keep the current long-lived wallets in the personal workspace?

**Recommended default:** **Throwaway.** Deleting the org cascades transfers and reversal chains, quotas start fresh, and the personal workspace stays clean.

<sub>Raised by: Test harness.</sub>

#### D84. Running the multi-currency e2e on PRs into dev

**Question.** Run the multi-currency e2e project on PRs into `dev`, not only into `main`?

**Recommended default:** **Yes.** `dev` is where this branch and its migrations land. Use a concurrency group, because `E2E_DATABASE_URL` is shared. This costs extra CI minutes.

<sub>Raised by: Test harness.</sub>

#### Decisions the e2e expected values depend on

The Test harness area flagged that its expected strings can't be fixed until these decisions are made.

| Harness question | Decided in |
|---|---|
| Minor units for JPY / KWD / BHD / OMR, and rounding of `reporting_amount` | D61 |
| Whether "EUR 70.00 of 100.00" survives a switch from EUR to INR | D38, D39 |
| Grouped native vs converted totals (Cards strip, debts hub, recurring, `posted_total`, split detail) | D46 |
| Credit card currency, and cross-currency autopay | D29, D30 |
| One stale JPY rate marks the summary stale (`as_of` = today − 1) | D56 |
| A reporting-currency change is a full cache purge | D2 |


## 6. Test plan

### 6.1 Existing coverage

There is one row per test file, merged from every area that cited the file. **Gap** marks what the file does not test and the multi-currency work needs.

| Area | Test file | What it covers |
|---|---|---|
| FX, Wealth, Transactions, Cards, Schema, UI, AI, Reporting, Org, Platform, Concurrency, Error codes, Cascade, Rollout, FX ops, Harness | `src/lib/money.test.ts` | Currency normalisation and rejection, Decimal add/sub/multiply, `CurrencyMismatchError` on mixed-currency add/compare, `convertMoney` direction guard, locale formatting (INR grouping, JPY with no decimals), `MAX_MONEY`. `transferAmounts`: native principals, destination-per-source rate (500 EUR → 51,350 INR = 102.7), fee kept outside principal FX, a missing cross-currency destination throws (:69), same-currency principals must match, >2 dp and negative fee rejected (lines 68-75, asserting the English `RangeError` texts). `reversalTransferAmounts` swaps principals and refunds the fee (:78). **Gap:** no trashed-leg or trashed-fee guard. The hard 2 dp cap is pinned, so KWD 3 dp is never exercised. |
| FX, FX ops, Wealth, Harness, Platform, Schema, Org | `api/_lib/fx-provider.test.ts` | `CachedFxRateProvider`: sends only the normalised pair, TTL cache, merges concurrent requests, caches historical rates per date (keeping fallback metadata), identity pair with no vendor call, rejects invalid dates and non-positive rates. |
| FX, FX ops, Wealth, Harness, Reporting, Schema, Org, Platform | `api/_lib/fx-rates.test.ts` | Frankfurter current and series parsing with a mocked fetch (only the pair in the URL). An unsupported pair (e.g. EUR/AED 404) becomes `FxUnavailable`, never 1. open.er-api current parsing and no history. `convertAmount` decimal rounding (75000 × 0.00902 = 676.5). **Gap:** `storeSnapshot` conflict semantics, `currentRate` freshness, the carry-forward fill and precision for weak currencies are untested. |
| FX, Transactions, Reporting, Wealth, UI, Platform, Schema, Org, Harness, FX ops, Debts, Concurrency | `api/_lib/tx-sql.test.ts` | Renders the P&L SQL. Income, expense and refund go through `reporting_amount(amount, currency_code, date, $n)`, refunds are negated and transfers excluded. `missingRateCountSql` (`fx_rate_on(...) is null`) counts standard and refund rows only. `accountBalanceInSql` and the missing-account-rate check use `current_date`. A convention scan (114-155) requires `analytics.ts`, `calendar.ts`, `flow.ts`, `transactions.ts` and `clients.ts` to use the `*In` helpers and `ensureRatesForOrg`. **Gap:** the scan misses `clients/[id].ts`, `api/_lib/debts.ts` (raw sum at :257), `transactions/[id].ts:80`, `recurring-query.ts:80`, `admin/org-detail.ts:58,63` and `admin/clients.ts`. |
| Budgets, FX, Transactions, UI, Harness, Cascade | `api/_lib/budget-spend.test.ts` | The seven spend predicates: `is_system`, closed client, refunds negative, transfers excluded. Spend converts through `reporting_amount` into the budget target, and the missing flag is `fx_rate_on(...) is null`. Source checks that `spending-budgets.ts` uses `budgetSpendSignedAmountIn(cur)` (never the raw sum), that v1 routes pass `reporting` and call `excludedFor`, and that `tag-ops.ts` selects `isSystem` (121-131). |
| Schema, FX, Wealth, Transactions, Budgets, Recurring, Error codes, Concurrency, Rollout, FX ops, Platform, UI, Org, Harness | `src/lib/multi-currency-migration.test.ts` | Static text checks on **0069-0073**: currency columns declared, amounts never rewritten, account-first backfill before the org fallback, multiple cash wallets vs the unique default index, `transfer_id` link and transfer header, fee/rate provenance and CHECKs, row-locked `complete_transfer`, the `transition_unsettled_transfer` and `set_transfer_trashed` functions, `reporting_currency` backfill, and the `spending_budgets.currency_code` / `recurring_rules.currency_code` column names. **Gap:** `deleted_at` in the 0071 backfill, 0070's unique-key semantics, 0074 `fx_rate_on`/`reporting_amount` behaviour, 0076, cross-row currency invariants and the RAISE → error-code mapping. |
| Wealth, Transactions, Concurrency, Cascade, Schema, FX ops | `src/lib/wealth-ledger.test.ts` | `balanceDelta`/`reverseDelta` signs, `reversesOnTrash`, and the per-account collapse in `reversalsByAccount`/`applicationsByAccount` that delete, bulk-delete, restore, purge and the cascades use. System rows are not reversed or re-applied. **Gap:** pure code only, so it cannot catch the route-level double-DELETE. There is no expected-balance or drift helper. |
| Wealth, UI | `src/lib/wealth-spendable.test.ts` | `accountSpendableLabel`: bank balance vs card available/owed, privacy masking. EUR only, no mixed-currency case. |
| Cards, Transactions, Concurrency, Cascade, Schema, Wealth | `src/lib/credit-card-ledger.test.ts` | In-memory simulation: a card purchase is an expense, a payment is a transfer (not an expense), a refund nets spending, and delete/restore/purge/edit re-apply exactly once. Single currency, simulation only. |
| Cards | `src/lib/credit-card.test.ts` | `cardDebt`, `cardCredit`, `creditUsage`, `statementView`, `debtAtClose`, `cycleActivity` and closing-date maths. Currency-agnostic numbers. |
| Cards | `src/lib/cards.test.ts` | `autopayEligible`/`autopayPlan`/`autopayAmount`/`autopayPreview`, expiry and card identity helpers. **Gap:** single currency, no deferred-failure (`autopay_error`) case. |
| Cards, Alerts, UI | `src/lib/card-alerts.test.ts` | Card alert rules (due soon, overdue, utilisation, expiry). No money currency. |
| Cards | `src/lib/card-wizard.test.ts` | Create/edit payload shapes and wizard validation. No currency field. |
| Cards | `src/lib/card-drag.test.ts`, `src/lib/card-fan.test.ts`, `src/lib/bank-cards.test.ts` | Card grid drag actions, fan model, bank-overlay relationships. No currency. |
| Alerts, Cards, Recurring, UI, Error codes, Harness | `src/lib/alerts.test.ts` | Pure rail rules: projection, as-of-today baseline, autopay outlook, shortfall, ordering. L437-468 check that alert money carries the **account's** currency (INR shortfall on an INR account in a EUR workspace, card, upcoming, posted) and that a legacy row stays null. `recurring_paused` never interpolates the free-text `last_error`. **Gap:** no cross-currency autopay funder case. |
| Alerts | `src/components/alerts/alert-dismissals.test.ts` | Snooze/dismiss persistence. No money. |
| Alerts, Budgets, Recurring | `api/_lib/notify-budget.test.ts` | `budgetAlertTier` boundaries (80% / 100%), `orgTotals`, and that every spend-changing writer calls `notifyIfBudgetExceeded`. **Gap:** no currency, excluded-count or `formatBudgetMoney` assertions. |
| Alerts, Org | `api/_lib/notify-billing.test.ts` | Which payment and subscription transitions notify, with the invoice amount and currency code. |
| Alerts | `api/_lib/push-fcm.test.ts`, `src/lib/notifications.test.ts`, `src/lib/schedule-notifications.test.ts`, `src/lib/native-reminders.test.ts`, `api/_lib/worker-jobs.test.ts` | FCM payload, notification categories, reminder/broadcast next-fire math, native reminders, worker enqueue plumbing. No money. |
| AI, Alerts, Org | `api/_lib/quotation-pdf.test.ts` | `buildQuotationSnapshot` labels `amount_label` with the **org** currency code, falls back to USD for a missing org or unknown currency, and the hash changes when the org currency changes. This locks in today's re-denomination behaviour. |
| AI, Org | `src/lib/quotation-pdf-history.test.ts` | `isPdfStale` and history rules. A reporting change flips the stale flag through the hash. |
| AI | `src/lib/ai-match.test.ts` | `normalizeName`, `jaroWinkler`, `resolveClientName`, `resolveCategory` (the same resolver matches accounts). **Gap:** no currency tie-break. |
| AI | `src/lib/ai-schema.test.ts` | JSON-schema dialect conversion for Gemini/OpenAI. **Gap:** needs a case once a nullable `currency` is added. |
| AI | `src/lib/ai-credits.test.ts` | AI credit cost and token surcharge (credits, not money). |
| Budgets, UI | `src/lib/spending-budget.test.ts` | Windows, view conversions (`perDayRate`, `limitForView`, `limitForWindow`), allocation, `tightestBudget`, `limitAt`/`amountAt`/`lastChangedAt`. No currency cases. |
| Budgets | `src/lib/budget-history.test.ts`, `src/lib/budget.test.ts` | v1 adherence, creep, evolution, `seriesState`, `periodStart`. Currency-blind. |
| Debts, Harness | `src/lib/debt-status.test.ts` | `derivedStatus`, `isOpenDebt`, `progressPct`, `upcomingSchedule` (monthly only), `monthObligations`/`requiredMonthly` (EUR-only fixtures), `nextPayment` (mixed EUR/INR, date only), `owedByCurrency` keeping EUR and INR apart, `debtInsights` with EUR only. **Gap:** the raw mixed-currency sum is not pinned. |
| Debts | `src/lib/debt-math.test.ts`, `src/lib/debt-planner.test.ts`, `src/lib/debt-preview.test.ts` | Amortisation, payment split, interest, strategy ranking, rollover, affordability, create preview. Currency-agnostic cents. |
| Debts, Recurring, Error codes, Rollout, Harness | `src/lib/debt-recurring.test.ts` | `linkRefusal`/`isLinkable` including `currency_mismatch` (245-250: EUR payer vs USD debt refused, case-insensitive, null/unknown tolerated), `payoffCappedAmount`, `periodsPerYearForRule`, `repaymentCursor`. |
| Debts, Concurrency, Schema | `src/lib/debt-ledger.test.ts` | In-memory borrow/repay/interest ledger, delete/restore once, "multi-currency: native amounts are never touched by a display currency" (:109). Simulation only. |
| Recurring | `src/lib/recurring.test.ts`, `src/lib/recurring-preview.test.ts` | Occurrence schedule math, catch-up cap, month-end clamping, end dates, preview flags. No currency. |
| Recurring, Wealth, Concurrency, Schema | `src/lib/recurring-transfer.test.ts` | `buildRecurringTransferLegs`, which is dead code. Production auto-save goes through `createTransfer`, so **the materializer's transfer branch is untested**. |
| Wealth | `src/lib/spaces.test.ts`, `api/_lib/spaces.test.ts` | Space goal math (currency-agnostic). `parseGoal`/`parseTargetDate` incl. `MAX_MONEY`. |
| Transactions, Reporting | `src/lib/tx-classify.test.ts` | A refund is incoming and nets against expense. Transfers and system rows are neither. `refundShapeValid`. The Dashboard does not use these rules. |
| Transactions | `src/lib/tx-grouping.test.ts` | `summarizeLegs` raw sum and account count, `isSplitTx`. Currency-agnostic. |
| Reporting, UI | `src/lib/money-flow.test.ts` | Flow graph builder and `collapseLegs` (L123-129), same-currency splits only. |
| Cascade | `src/lib/tags.test.ts`, `src/lib/transaction-tags.test.ts` | Tag name normalisation, tag cleaning/limits. Nothing on cascade deletes. |
| Platform, Reporting, Org, Recurring, Cascade, Rollout | `src/lib/api-cache.test.ts` | Freshness classes, the persist allowlist (`/api/organizations` persisted to L2), `/api/recurring` `ALWAYS_FETCH`, fanout for `/api/transactions`, `/api/wealth/transfer`, `/api/cards`, `/api/spaces/1/auto-save`, `/api/clients`, `/api/clients/bulk-delete`, `/api/tags`, `/api/trash`, and full-purge paths. **Gap:** nothing for `/api/wealth/summary`, `/api/fx/rate` or `/api/wealth/transfers/*`. The `/api/organizations` rule is asserted as the current narrow (identity-only) rule. |
| Platform | `src/lib/api-store.test.ts` | L1/L2 store, SWR and invalidation mechanics. |
| Concurrency | `src/lib/db/retry.test.ts` | Retryable-error classification and backoff. **Gap:** does not assert that post-commit errors are *not* retried. |
| FX ops, Org, Harness | `src/lib/currencies.test.ts` | `CURRENCY_LIST` integrity, the symbol map, country → currency mapping, `detectDefaultCurrency`. Says nothing about which codes have a rate source. |
| Org, Schema | `src/lib/billing-currency.test.ts` | `resolveBillingCurrency`/`billingCurrencyAttempts`: org preference, India always INR, unsupported-currency fallback, dedupe, never empty. **Gap:** no test of the coupling to the reporting currency. |
| Org | `api/_lib/admin-billing.test.ts`, `api/_lib/billing-attempts.test.ts` | Dodo stop/cancel mirror (no currency). `billing_attempts` updates including the currency snapshot. |
| Rollout | `pwa/sw-policy.test.ts` | SW navigation deny-list and the NetworkOnly shell policy that stale-PWA recovery relies on. |
| Schema, Rollout | `scripts/check-migrations.mjs` | Journal/file agreement, contiguous numbering, strictly increasing `when`, no future stamps (77 entries, head 0076). **Gap:** cannot know production's watermark. |
| Platform | `scripts/check-cache-map.mjs` | Every side-effecting GET is `alwaysFetch` and every client write path has a fanout rule (46 mapped). |
| Platform, Error codes | `scripts/check-i18n*.mjs` (`i18n:check`, `i18n:hardcoded`) | Locale parity with `en.json`, no new JSX English. **Gap:** does not verify that keys used in code exist in `en.json`, which is how `fx.excludedNotice` slipped through. |
| Rollout | `.github/workflows/post-deploy.yml` | 401-not-500 probe on 7 authed routes plus pricing, SSR and PWA artifacts after a prod deploy. |
| All areas | `e2e/multi-currency.spec.ts` | 6 tests in the e2e user's **personal** workspace (USD, durable `e2e-ux4-mc-eur` / `-mc-inr` wallets), **live** Frankfurter/open.er-api, desktop Chromium, English only. Covers: an account keeps its native currency; `/api/wealth/summary` converts (`multi_currency`, `by_currency`, net worth ≠ raw sum, `complete` needs a live INR rate, :228); cross-currency transfer €500 → ₹51,350 with a €5 fee (rate 102.70, the fee is the only expense, 249-299); reversal restores both natives once, second attempt 409 `transfer_already_reversed` (301-333); planned → completed/cancelled moves money only on completion; `/wealth` tiles show ₹/€, the ≈ line and "By currency" (375-387). **Gaps:** relational assertions only. The reversal test only takes its 409 branch because dev already holds reversal chains. It leaks the personal workspace. Nothing on cards, budgets, debts, recurring, analytics/calendar/flow/clients/search, AI, alerts, tags, trash, onboarding, a reporting-currency change, stale/placeholder rates, the excluded notice, mobile or other locales. |
| Org, FX ops | `e2e/auth.setup.ts` | Onboards the e2e business org through `POST /api/onboarding` with currency hard-coded to `'USD'` (L163-166), which **hides the onboarding `reporting_currency` bug**. `sweepLeftoverE2eData` (119-147) sweeps only prefixed clients. |
| Cards, Transactions, Cascade, Concurrency, Schema, Wealth, Rollout | `e2e/credit-card.spec.ts` | Card with a statement, owed/available, purchase, partial/full payment, refund/fee, overpay. Card-payment transfer legs trash/restore/edit through the transfer service (:441). Single currency. |
| Cards, Transactions | `e2e/cards.spec.ts` | Debit-card wizard, attribution chip on `/api/transactions/group`, freeze, bank overlay, drag handle. Bulk-delete plus trash clear as cleanup. Single currency. |
| Debts, Reporting, Schema, Harness, Error codes | `e2e/debts.spec.ts` | Borrow as transfer, schedule, split and auto-split payments, delete/restore payment, hub tabs, partial disbursement, `/api/search` debts group (no amounts), recurring repayment, receivable, paid off/close. The net-worth check at 389-399 counts only debts in the workspace currency (the old rule). No `currency_mismatch`/`currency_locked` UX. |
| Debts, Recurring | `e2e/recurring-debt.spec.ts` | Debt from the recurring dialog, rhythm round trip, category rules, draft persistence. Single currency. |
| Budgets | `e2e/budgets.spec.ts` | Dialog create, an expense moving the figure, view toggle without a request, sub-budgets, close/reopen cascade, reorder, analytics tab, 44 px targets at 430 px, business client caps. No foreign-currency or missing-rate case. |
| Alerts, Cards, Recurring | `e2e/alerts.spec.ts` | Rail shows, orders and mirrors state, including recurring-derived alerts. Single currency. |
| Org, Transactions, Reporting, Recurring | `e2e/smoke.spec.ts` | Business smoke: quotations/clients render, create a transaction, client delete cascade + purge, calendar opens a day, `/recurring` loads, subscription plans listed. No money assertions. |
| Platform | `e2e/mobile.spec.ts` | Pixel 7 shell tabs and card fan only. No multi-currency screens. |
| Platform, Rollout | `e2e/prod-build.spec.ts` | The production bundle boots (chunk graph). No multi-currency behaviour. |

**Clear gaps across the suite**

- No committed test executes `fx_rate_on` or `reporting_amount`. Precedence, carry-forward, fallback healing and NULL handling are only asserted as SQL text.
- The only multi-currency e2e depends on live FX, so no figure can be exact. Stale, placeholder, missing-rate and excluded states cannot be produced.
- No route-level test covers trashed-row guards (double DELETE, reverse after trash, fee-row mutations) or cascade writers (tag delete with records, client delete/bulk-delete).
- Nothing checks that an i18n key used in code exists, or that API error codes are translated.
- There is no multi-currency coverage for cards, budgets, debts, recurring, reports, AI, alerts, mobile or non-English locales. Onboarding is only tested with USD.
- The static raw-sum guard covers 5 routes. Migration tests stop at 0073. Nothing models the production migration watermark.
- `e2e.yml` runs only on PRs into `main` and on dispatch, so multi-currency PRs into `dev` never run e2e. _(Unverified, low.)_

### 6.2 Test infrastructure first

These must exist before the multi-currency matrix can assert exact values.

**1. Deterministic FX, with no live provider**

- **Kill switch.** `FX_DISABLED=1|true` (`api/_lib/fx-rates.ts:134`, `networkDisabled`) skips every provider call in `currentRate` and `ensureHistoricalRates`. It is undocumented and unused. Set it in `playwright.config.ts` `webServer[0].env` (L79) and in `.github/workflows/e2e.yml` job env (L34-38). `page.route` cannot stub provider calls, because they happen server-side.
- **Seeded `fx_rate_snapshots`, not the provider.** Add a guarded `seedFxRates()` in `e2e/helpers.ts`, run only when `E2E_FX_SEED=1`. Set that variable only in `e2e.yml`, against `E2E_DATABASE_URL` (the dedicated Neon branch). `fx_rate_snapshots` is **global, not org-scoped**, and `fx_rate_on` (0074) prefers `manual` over market on the same day and carries rates forward (`rate_date <= on`). Seeding the shared dev DB that `playwright.config.ts` loads from `.env.local` would therefore rewrite every developer's reports. Locally, the exact-value specs skip unless `DATABASE_URL` points at a personal Neon branch.
  - Seed procedure: delete `provider='e2e-fixed'` rows, then insert `source_type='manual'` rows for every day from today−40 to today+1 with `generate_series`. The 0070 unique key `(base, quote, rate_date, provider, source_type)` allows `ON CONFLICT DO UPDATE SET rate, fetched_at=now()`.
  - Pairs: INR→EUR 0.01 up to today−10, then 0.0125. USD→EUR 0.8. JPY→EUR 0.005 up to today−1 only. KWD→EUR 2.5. EUR→INR 100/80. USD→INR 80/64. JPY→INR 0.5/0.4 up to today−1. KWD→INR 250/200.
  - Also write a `source_type='market'` row for **today** with the same rate and `fetched_at=now()` for every pair except JPY. `currentRate`'s fresh path reads only market rows for today younger than 12 h (`fx-rates.ts:182-186`), and its stale fallback orders by date only and does not prefer `manual`. JPY deliberately has no market row for today, which exercises `stale` and `as_of = today−1`. MNT never gets any row, which exercises the missing-rate path.
- **Alternative for provider-path tests.** `FX_FRANKFURTER_HOST` / `FX_OPEN_ER_API_HOST` exist but are unused. Pointing them at a local fixture server (e.g. EUR/USD 1.1616 on 2026-09-10, no AED history, a 503 for the stale badge) is how the provider, fallback and stale-badge paths get tested (see E2E case 23). Document all three env knobs in CLAUDE.md.
- **Preflight probe.** `fxPreflight()` runs first in the mc project after seeding. Locally, `reuseExistingServer` (`playwright.config.ts:73`) can reuse a `:5173` server that was started without the flag, and only a probe of `GET /api/fx/rate` can prove the seed is in use (expected values in API case 24).

**2. Fixture workspaces (throwaway, never the personal workspace)**

- **Matrix fixture: EUR reporting.** This is the harness proposal that every exact figure below uses. `createMcWorkspace()` calls `POST /api/organizations {name:'e2e-mc-<runId>', currency:'EUR'}` (`api/_routes/organizations.ts` POST 71-114). Free plan limits: 1 bank, 1 credit card, 30 tx/client, unlimited cash wallets.
  - Accounts: INR bank ₹100,000; EUR cash €1,000; USD $500; JPY ¥20,000; KWD 10; later an MNT wallet ₮100,000 with no rate.
  - Client `e2e-mc client`. Dates: D1 = today−20, D2 = today−5.
  - Rows: T1 INR out 1000 Food D1; T2 INR out 2000 Food D2; T3 USD out 50 Food D2; T4 JPY out 3000 Travel D2; T5 EUR in 200 Sales D2; T6 INR in 8000 Sales D2; T7 INR refund 400 Food D2. Transfer EUR→INR 100 → 8000 with fee 2, today.
  - Baseline: net worth €2,985.50, P&L €300.00 / €87.00, Food budget €70.00 of €100.00, and ₹2,38,840.00 after switching to INR.
- **USD-reporting fixture with EUR/INR wallets.** Most area cases assume the shape of today's `multi-currency.spec.ts`: a USD workspace with `e2e-ux4-mc-eur` / `e2e-ux4-mc-inr` wallets, e.g. API cases 44 and 48 and E2E cases 5, 11 and 14. Rebuild it the same way, as a throwaway org with `currency:'USD'` plus EUR and INR cash wallets, instead of durable wallets in the personal workspace. Dev already holds 8 `e2e-ux4-mc` wallets (6 archived) and 26 transfers including 4 reversal chains. Because of those, the reversal test only takes its 409 branch and never re-checks balances, and a free-plan branch eventually hits the 30-tx/client quota.
- **Onboarding in another currency.** Replace the hard-coded `'USD'` in `e2e/auth.setup.ts` (L163-166) with a second project or case that onboards in INR, so the onboarding `reporting_currency` bug is visible.

**3. Cleanup and isolation**

- **Delete the fixture org in `afterAll`** (`deleteMcWorkspace()`). Org FKs cascade to accounts, transfers, reversal chains and debts, and there is no immutability trigger. Add an `e2e-mc-*` org sweep to `sweepLeftoverE2eData` in `auth.setup.ts` (119-147) for runs that crashed.
- **Never reverse on durable data.** Reversal chains are immutable and pile up. Reverse only inside a throwaway org.
- **Restore the workspace.** Use `rememberWorkspace` in `beforeAll` and `restoreWorkspace` in `afterAll` (the `helpers.ts:81-82` rule), and switch explicitly in every test. Today `usePersonal` leaks the personal workspace into later specs _(unverified, low)_.
- **Clear the L2 cache after API-level switches.** `PATCH /api/organizations/:id` drops only identity reads, and the org list is persisted to L2. After an API-level org or currency switch, clear `ps_apic1:*` from localStorage and reload before asserting UI.
- **Throwaway SQL stays off the shared dev DB when it writes.** Use a scratch schema, a scratch Neon branch or the dedicated E2E branch. Migration-order and backfill checks need a Neon branch copied from prod (watermark 0068).

**4. The DB-free unit rule (CLAUDE.md)**

- Never commit a test that opens a DB connection. `vite.config.ts` `test.env` provides a placeholder `DATABASE_URL` that only constructs the client and never connects. Anything that executes `fx_rate_on`, `reporting_amount` or a route belongs in e2e/API or in a throwaway `*.test.ts` run with `node -r dotenv/config node_modules/.bin/vitest run <file> dotenv_config_path=.env.local`, deleted before commit.
- To keep the new logic unit-testable, extract pure helpers first:
  - `reporting-fields` (`reportingAmountOf`/`sumInReporting`/`rowCurrency`)
  - `cardsStripTotals`
  - the wealth-fallback guard
  - the dashboard totals helper
  - the tx-form budget-hint helper
  - `fillDailySeries`
  - `isFreshMarket`
  - `expectedBalance`
  - `accountCurrencyChangeRefusal`
  - `validateManualRate`
  - `ruleDisplayCurrency`
  - `reviewCurrency`
  - exported `resolveTransactionRaw`
  - the materializer cursor decision
  - the org-currency update helper
- Static guards follow the existing style: render SQL with `.toSQL()` or scan source text, as in `tx-sql.test.ts` and `budget-spend.test.ts:121`.
- `src/test-setup.ts` pins en-US detection, so formatter assertions are deterministic. Tests that need another locale call `changeLanguage` explicitly.

**5. CI wiring**

- Add `FX_DISABLED=1` and `E2E_FX_SEED=1` to `e2e.yml`.
- Add a `pull_request` trigger for `dev`, scoped to the mc project (`npx playwright test multi-currency`), or require a `workflow_dispatch` before merge.
- Mobile checks must live in a file named `*mobile.spec.ts` so the Pixel 7 project picks them up.

**6. Decisions that fix expected values**

Several expected values below say "per the decision". These are the open decisions:

- Minor-unit policy (JPY 0 dp, KWD/BHD/OMR 3 dp), and whether `reporting_amount` rounds to the target's minor units.
- Whether a budget keeps its authored currency across a reporting switch.
- Grouped native totals vs converted-with-excluded for each mixed list total: cards strip, debts hub, recurring monthly totals, `posted_total`, split-group detail.
- A credit card's currency (issuer bank or a picker), and whether cross-currency autopay is refused.
- Whether one stale rate marks the whole summary stale.
- Whether a reporting change is a full cache purge.
- Triangulation after a switch.

### 6.3 Needed tests

Labels: _Fails today_ means the analysts reproduced the wrong behaviour. _Regression guard_ means current behaviour is correct and should be pinned. _Unverified, low_ means the "today" behaviour comes from a low-severity finding that skeptics did not verify. A case built on a **refuted** finding is written only as a guard, never as a bug.

#### Unit (pure, DB-free)

1. **Static guard: organization currency writes.** Scan `api/**` and `scripts/**` for `.update(organizations).set({` blocks that assign `currency` without `reportingCurrency`. — Fails today on `api/_routes/onboarding.ts:54`, `:71` and `api/_routes/admin/organizations.ts:145`. Passes after the fix.
2. **Shared org-currency update helper (to be extracted), given `'eur'`.** — Returns `{currency:'EUR', reportingCurrency:'EUR'}`. Throws or rejects `'EURO'`, `''` and `'US'`.
3. **Static guard: trashed-row filters.** — The `before` lookups in `transactions/[id].ts` PATCH and DELETE include `isNull(transactions.deletedAt)`, and `reverseTransfer` checks `deletedAt`. The test fails if either filter is removed.
4. **Static guard on `api/_lib/tag-ops.ts`** (and any shared trash helper it calls), in the style of `budget-spend.test.ts:121`. — It must reference `setTransferTrashed` or filter `transfer_id`, and must not set `deleted_at` on rows it has not resolved through `resolveTxLegs`. Fails on the current `tag-ops.ts` (no `transferId` reference). Passes after delegation.
5. **Pure bulk-delete partition helper** (if extracted from `transactions/bulk-delete.ts:39-46`). Rows: `{a, transfer, T1}`, `{b, transfer, T1}`, `{f, standard, T1}`, `{x, standard, null}`. — `transferIds = ['T1']`; standard rows = `[x]`. With only `f` selected, `T1` is not in `transferIds` and `f` is standard (or goes with `T1` if the fee policy changes).
6. **Referral stats grouping (after the fix).** Rewards: `{INR 249.75 paid, qualifying past}`, `{USD 2.50 paid, qualifying past}`, no payouts. — Available = `[{INR, 249.75}, {USD, 2.50}]`, never 252.25. A payout request `{USD, 3}` returns 400 `exceeds`. `{USD, 2.50}` is accepted with currency `'USD'`.
7. **Pure `accountCurrencyChangeRefusal({rows, balance, rules, transfers, fundedCards, isCard, goal})`**, shared by the server lock and the picker. — `{rows:0, balance:'22337.85'}` → `balance_nonzero`. `{rows:0, balance:'0', rules:1}` → `has_rules`. `{rows:0, balance:'0', fundedCards:1}` → `funds_card`. `{rows:1}` → `has_history`. All zero → `null`.
8. **Migration-order guard.** Feed `check-migrations` a simulated production watermark equal to 0075's `when` (1789383113149). — Reports that 0069-0074 would be skipped, so the release script fails instead of deploying.
9. **Extend `multi-currency-migration.test.ts`.** — Asserts that the 0071 CTE handles `deleted_at`, that 0076 contains its 5 guarded statements, and that 0074's NULL handling matches the decided policy. The assertions fail if the `deleted_at` handling is removed.
10. **Static SQL test for 0077** (same style). — It declares `UNIQUE (id, currency_code)` on `wealth_accounts`. It adds composite FKs on `transactions(wealth_account_id, currency_code)`, `recurring_rules(wealth_account_id, currency_code)`, `transfers(source_account_id, source_currency)` and `(destination_account_id, destination_currency)`. Each is `DEFERRABLE INITIALLY DEFERRED NOT VALID` and is preceded by `DROP CONSTRAINT IF EXISTS` and a statement-breakpoint.
11. **Shared amount parser in `money.ts`:** `'1.23'`, `'1.235'`, `'-0.001'`, `'1e3'`. — `'1.23'` is accepted. `'1.235'` raises `RangeError` (or rounds to 1.24 consistently for both the row and the balance delta). `'-0.001'` is rejected. `'1e3'` → 1000.00.
12. **Minor units in `money.ts` (after the policy decision).** — `transferAmounts({sourceAmount:'10', destinationAmount:'1.125', sourceCurrency:'EUR', destinationCurrency:'KWD'})`: KWD 1.125 is accepted and preserved as `'1.125'`. A JPY `'1000.5'` amount is rejected with `RangeError 'JPY supports 0 decimal places'` (the JPY half is _unverified, low_).
13. **Wealth fallback guard: never paint a raw cross-currency sum** (pure helper deciding whether the local sum may be shown). — `[USD 10, USD 5]` → local 15 allowed. The following have no summary and must return `null`/pending (skeleton), `mixed:true` or per-currency buckets, never the raw sum:
    - `[EUR 1000, INR 75000]` → never 76,000; per-currency `{EUR:1000, INR:75000}` is acceptable.
    - `[EUR 100, INR 20000]` → never `'€20,100.00'`.
    - Dashboard headline with `[EUR 395, INR 136350, USD 22337.85, USD 896]` and `summary=undefined` → never 159,978.85.

    _Fails today._
14. **Pure `cardsStripTotals` / cards-strip aggregator.**
    - Grouped: INR card (limit 50,000, balance −5,000) and EUR card (limit 2,000, balance −100) → owed `[{INR 5000}, {EUR 100}]`, available `[{INR 45000}, {EUR 1900}]`, never 5,100.
    - Converted: EUR card debt 1,000 / limit 2,300 and INR card debt 50,000 / limit 100,000 at INR→EUR 0.00919 → owed ≈ €1,459.50, available ≈ €1,759.50. With no INR rate → owed €1,000, excluded `['INR']` plus a notice. Never 51,000.

15. **New pure predicate `autopayCurrencyRefusal(cardCurrency, fundingCurrency)`.** — `('EUR','INR')` → `'currency_mismatch'`. `('EUR','EUR')` → `null`. `('EUR', null legacy)` → `null`, or `'currency_missing'` per the decision.
16. **Alerts: cross-currency autopay funder.**
    - `buildAlerts`: a USD bank (`balanceToday` 2,000) funds a JPY card (`currentBalance` −150,000, statement remaining 150,000 due today+5, autopay on, `autopaySince` earlier). Expected: no `charge_shortfall` on the USD bank for 150,000 labelled USD. The card slide is not `card_autopay_scheduled` ('pending'); it is `card_payment_due_soon`/`overdue` (or a new `autopay_currency_mismatch` kind) with currency `'JPY'`. _Fails today:_ shortfall of $150,000.00 / $148,000.00 short.
    - `autopayEvents`: a EUR card owing €1,000, funded by an INR account with `balanceToday` 20,000. Expected: no −1,000 event on the INR account (or a converted, estimate-flagged event). `projectShortfalls` never subtracts a EUR figure from an INR balance.

17. **`autopayPreview` / `autopayEligible` with a deferred failure.** Statement `{autopay_status:null, autopay_error:'currency_mismatch', remaining:1000, due_date:'2026-10-15'}`. — Not eligible, and the preview returns `null` (or a 'failed' marker), agreeing with `src/lib/alerts.ts` `autopayOutlook = 'failed'`.
18. **`autopayEvents` with a same-currency funder** (EUR card €500, EUR bank €100, due today+5). — Two events: −500 on the bank and +500 on the card. `projectShortfalls` → short 400, amount 500. `shortfallAlerts` currency `'EUR'`. _Regression guard._
19. **Debts `monthObligations` / `requiredMonthly` with mixed currencies.**
    - EUR debt paying 30,000 cents and INR debt paying 500,000 cents, both due and paid this month → EUR `{required 30000, paid 30000, remaining 0}`, INR `{required 500000, paid 500000, remaining 0}`. Never a single 530,000.
    - INR ₹5,000 (500,000 cents) and EUR €200 (20,000 cents) → `[{INR: 500000}, {EUR: 20000}]` (or the chosen grouped shape). Never 520,000.

    _Fails today._
20. **`debtInsights` `interest_this_month`** with 10,000 cents of USD interest and 2,500 cents of EUR interest. — Two insights (USD 100, EUR 25), or one whose params carry both currencies. Never `{amount:125, currency:'EUR'}`.
21. **`debtInsights` `smallest_clearable`** with ¥50,000 and $600 debts in a USD reporting context. — Not ranked by raw cents across currencies. It picks within one currency or converts before ranking. _(Unverified, low.)_
22. **`upcomingSchedule`** for a weekly €100 debt (Sep 7/14/21/28) with `paidByMonth['w:2026-09'] = 10000`. — Row 1: `paid=true`, `paidAmount=10000`. Rows 2-4: `paid=false`, `paidAmount=0`. Paid cents across rows total 10,000.
23. **Budgets `loadRecords` / `withSpend`:** parent `currency_code 'INR'`, child NULL, reporting EUR. — The child resolves to INR (inherited, like its window). `other_spent` = parent − child in INR, not the parent's full spend.
24. **`analyticsFor` fold with no overall budget.** Lines: Fun €100 (EUR) and Groceries ₹20,000 (INR). Window spend: €50 Fun and ₹18,000 (≈ €200) Groceries. — The window is judged within budget (each line against its own cap, or caps converted). _Fails today:_ judged over by €150 with a 0% rate.
25. **`withSpend` state and `budgetAlertTier` input when `excluded_count > 0`** (amount 200, counted spend 190, one excluded row). — The response flags the budget incomplete, adherence does not judge the window, and the alert copy says it is incomplete. _Fails today:_ state `'warn'` and no flag.
26. **`budgetsExcluded` / page notice** for one unconverted Groceries row, with the overall budget, Groceries and a Groceries sub-budget. — Count 1. _Fails today:_ 3.
27. **Tx-form budget hint (`spendingHint`, extracted helper).**
    - INR budget at 9,000 of 10,000, allocation 50 on a USD account, rate 83 → `'₹3,150 over'` (or hidden with no rate). _Fails today:_ `'₹950 left after this'`.
    - Budget `{amount:1400, spent:500, EUR}`, entry 2,000 INR, rate INR→EUR 0.0092 → remaining 1400 − 500 − 18.40 = 881.60 → `'Overall Budget: €881.60 left after this'`. With no rate the hint is suppressed (`null`).

28. **Extend `api/_lib/tx-sql.test.ts` static guards.**
    - Scan `api/**/*.ts` for `sum(` over `amount`, `current_balance` or `principal` that is not wrapped in `reporting_amount` and not grouped by `currency_code`, with a single-account allowlist. It flags `transactions/[id].ts:80`, `recurring-query.ts:80`, `debts.ts:257` and `admin/org-detail.ts:58,63` today. Allowlist: `credit-card.ts:129`, `debts.ts:194`, `alerts.ts:78`, `alerts.ts:148`.
    - Add `api/_lib/debts.ts` (`averageMonthlyIncome`) to the convention scan. It fails while it uses a raw `sum(amount)` and passes once it uses `reportingAmountSql`/`missingRateCountSql` or filters to one currency.
    - Add `api/_routes/clients/[id].ts` to the convention list. If decided, assert that `clients.ts` and `clients/[id].ts` use `incomeSumSqlIn`/`expenseSumSqlIn`/`missingRateCountSql` and exclude system rows (`isSystem` false).

29. **New `src/lib/reporting-fields.test.ts`: `reportingAmountOf` / `sumInReporting` / `rowCurrency`.** Across all vectors, a foreign row without a usable `reporting_amount` is never counted 1:1.
    - `reportingAmountOf({amount:5, EUR, reporting_amount:null}, 'USD')` → `null`. `({amount:5, EUR}, 'USD')` → `null`. `({amount:'7', EUR}, 'USD')` → `null`. `({amount:'10', EUR}, 'USD')` → `null`. With `reporting_amount '11.20'` → 11.2. Untagged `{amount:'10'}` → 10.
    - `sumInReporting([USD 10, EUR 5 rep '5.80', AED 50 rep null], 'USD')` → `{total: 15.80, excluded: 1}`.
    - `sumInReporting([usd 10, eur 5 (no rate), eur rep 5.6], 'USD')` → `{total: 15.6, excluded: 1}`.
    - Reporting USD: `[EUR 100 rep '115.92', EUR 50 rep null, 20 currency null, USD 30 (no field)]` → `{total: 165.92, excluded: 1}`.
    - Reporting EUR: `[EUR 100, INR 2000 rep 18.4, USD 50 rep null, 7 currency null]` → `{total: 125.4, excluded: 1}`. The INR row without `reporting_amount` → `null`.
    - Reporting EUR: `[INR 1000 rep '12.50', USD 50 rep null, EUR 20, null 5, INR 300 (no field)]` → `{total: 37.5, excluded: 2}`. `reportingAmountOf` of the EUR row = 20 and of the null-currency row = 5.
    - `rowCurrency({currency_code:null}, 'EUR')` = `'EUR'`. `excludedCountOf({excluded_count:-3})` = 0. `clientTotalsCurrency({totals_currency:null}, 'EUR')` = `'EUR'`.

30. **Dashboard totals helper (to be extracted).** Rows:
    - standard incoming USD 100 (rep 100)
    - refund incoming EUR 10 (rep 11.59)
    - `is_system` incoming INR 75,000 (rep 784.50)
    - standard outgoing EUR 5 (rep 5.80)
    - standard outgoing JPY 1,000 (rep null)

    Expected: income 100, expense 5.80 − 11.59 = −5.79, excluded 1. The system row counts nowhere.
31. **`money-flow` `collapseLegs` with a mixed-currency split.**
    - Legs `[{g, 50, EUR}, {g, 5000, INR}]` → no collapsed leaf of 5,050 under one currency. Each leg keeps its `currency_code`, and the collapsed amount is `null`/`'mixed'` or reporting-converted.
    - With `reporting_amount` 50 and 46 → the leaf is 96 EUR (the reporting sum) or carries per-currency parts. Never 5,050.

    _(Unverified, low.)_
32. **`api-cache` `invalidationFor('/api/organizations/<id>')`** (a reporting-currency PATCH). — Returns `{kind:'all'}`, or prefixes including `/api/transactions`, `/api/wealth` (so `/api/wealth/summary`), `/api/analytics`, `/api/calendar`, `/api/flow`, `/api/clients`, `/api/spending-budgets`, `/api/budgets`, `/api/debts`, `/api/cards` and `/api/organizations`. `invalidationFor('/api/organizations/<id>/members')` does **not** include money prefixes. _Fails today_ (identity-only).
33. **`api-cache` fanout and policy for the new routes.** — Writes to `/api/wealth/transfers/1` and `/api/wealth/transfers/1/reverse` drop `/api/wealth/summary` and `/api/wealth/transfers`. `policyFor('/api/fx/rate?from=EUR&to=INR')` → cls `'config'`, persist false, alwaysFetch false. `policyFor('/api/wealth/summary')` → cls `'money'`, alwaysFetch false, canPersist false.
34. **`buildWealthSummary` with mocked rates.** USD workspace; accounts USD 1,000, INR 100,000 (rate 0.01043), AED 5,000 (no rate), loan USD −2,000. — `accounts[INR].converted_balance = 1043.00`, `excluded_currencies = ['AED']`, `complete = false`, `debts_owed = 2000`, `net_worth = 1000 + 1043 − 2000 = 43.00`.
35. **`use-consolidated-wealth` helpers** (`availableFromSummary` / `liquidFromSummary` / `savedFromSummary`). Loans, receivables and accounts with a null `converted_balance` never add.
    - Accounts `[bank EUR conv 1,100; card conv −200; space conv 300; loan conv −1,000; receivable conv 400; bank INR conv null]` → available 900, liquid 1,100, saved 300.
    - Fixture summary (EUR 1,098 cash, INR bank converted 1,417.5, USD 360, JPY 85, KWD 25, a space 50, a loan −2,625, an MNT account with `converted_balance` null) → available 2,985.5, liquid 2,985.5, saved 50.

36. **`accountFromCard`** with `account_currency_code 'INR'`. — The returned `WealthAccount.currency_code === 'INR'`. _(Unverified, low.)_
37. **RecurringCard summary (extracted pure function).** Active rules: EUR 12/month outgoing, INR 1,200/quarter outgoing (interval 3), USD 3,000/month incoming; one paused EUR rule. — `outPerMonth = [{EUR,12}, {INR,400}]`, `inPerMonth = [{USD,3000}]`, the paused rule is excluded, and the rendered string is `'€12.00 + ₹400.00'`, never `'412'`.
38. **Pure `ruleDisplayCurrency(rule, orgCurrency)`**, used by the list, detail page and dialog. — `{currency_code:'EUR'}` in a USD org → `'EUR'`. `{currency_code:null, account_currency:'INR'}` → `'INR'`. Both null → `'USD'`. `formatMoney(12, 'EUR')` renders €.
39. **Materializer cursor decision (extracted pure helper):** occurrences `[d1, d2, d3]` where d1 fails. — The cursor stays at d1, and `lastError` is kept (not reset to `""`).
40. **`ensureHistoricalRates` write volume (mocked db).**
    - 730 existing days for EUR/USD with today missing → exactly 1 insert (today) and 0 conflicting inserts. _Fails today:_ 737 sequential inserts.
    - A 1,000-day range → at most `ceil(1000/chunk)` bulk insert statements, not 1,000 sequential inserts. Concurrent calls for the same pair share one backfill.

41. **`ensureRatesForOrg` targets.** Org reporting USD, one budget with `currency_code 'INR'`, EUR transactions since 2026-06-01. — Ensures EUR→USD and EUR→INR (and USD→INR) from 2026-06-01.
42. **`FrankfurterProvider` precision.** Mock `/latest?base=EUR` → `{USD:1.1355, KRW:1539.06}`, then `getCurrentRate('KRW','USD')`. — Rate ≈ 0.000737789 (≥ 10 significant digits), not `'0.00074'`.
43. **`storeSnapshot` conflict clause**, rendered with `.toSQL()`. — The SQL contains `on conflict ("base_currency","quote_currency","rate_date","provider","source_type") do update set "rate" = excluded.rate, "is_fallback" = false` with `where "fx_rate_snapshots"."is_fallback" and not excluded.is_fallback`. There is no unconditional `DO UPDATE`.
44. **Pure `fillDailySeries(series, from, to)`** (extracted from `ensureHistoricalRates`). `series = {'2026-09-11':'1.1592', '2026-09-14':'1.1551'}`, from `'2026-09-12'`, to `'2026-09-14'`. — Returns `[{d:'2026-09-12', rate:'1.1592', fb:true}, {d:'2026-09-13', rate:'1.1592', fb:true}, {d:'2026-09-14', rate:'1.1551', fb:false}]`. With the 09-14 entry removed (before publication), 09-14 → `{rate:'1.1592', fb:true}`. A day before the first observation within the −7 lookback is omitted, never 1.
45. **Pure `isFreshMarket(row, now)`**, used by `currentRate`. — `{isFallback:true, fetchedAt:now−2h}` → not fresh. `{isFallback:false, fetchedAt:now−11h}` → fresh. `{isFallback:false, fetchedAt:now−13h}` → not fresh. A fresh placeholder is returned with `stale:true`.
46. **`currentRate` `rate_date` consistency.** The provider returns Friday 2026-09-11 on Monday 2026-09-14, then a second call hits the fresh DB row. — Both calls return the same `rate_date` (the observation date) and the same stale value. _(Unverified, low.)_
47. **Pure `expectedBalance({openingBalance, hasOpeningRow, legs})`** in `wealth-ledger.ts`, using the dev shapes.
    - `(23000, false, [])` → 23,000, so a stored 22,337.85 gives drift −662.15.
    - `(1000, false, [out 500 transfer, in 500 reversal])` → 1,000.
    - `(0, false, [in 100, in 50, in 1, in 1, in 1])` → 153, so a stored 103 gives drift −50.
    - A trashed non-system leg is ignored. A trashed system leg still counts.

48. **`validateManualRate({base, quote, date, rate}, nearestStored)`.** — Rejects `rate <= 0`, `base === quote`, a non-ISO code and a date after today. Rejects USD/AED 36.725 against a nearest stored 3.6725 unless `confirm:true`. Accepts 3.6725.
49. **Relabel precondition checker** over the transfers touching the account set. — Refuses when a transfer has `source_amount != destination_amount` (e.g. EUR 500 → INR 51,350). Allows equal-amount same-currency transfers and relabels both sides.
50. **`buildQuotationSnapshot` with a quotation currency** (after adding the column). The hash never changes when only the org's reporting currency changes.
    - Quotation `{amount:'1200', currency_code:'EUR'}`, org `{currency:'INR'}` → `amount_label 'EUR 1,200.00'`, currency `'EUR'`. `snapshotHash` is identical before and after the org currency change.
    - Quotation `currency:'INR'`, org `{currency:'EUR'}` → `amount_label === 'INR 1,200.00'`, currency `'INR'`.

51. **Billing independence (after the decision).** The billing resolver gets reporting currency EUR for profile country DE with billing preference EUR, then reporting changes to USD. — The billing currency stays EUR. _Regression guard:_ the finding that checkout follows the reporting currency was **refuted**.
52. **Export `resolveTransactionRaw`** (pure given `ctx`). `ctx.accountList = [{cash, Cash, cash, EUR}, {chase, Chase, bank, USD}]`.
    - `raw = {outgoing, standard, amount:20, currency:'USD', account_name:null, confidence.amount:1}` → `account_id === 'chase'`, `currency === 'USD'`, `confidence.amount === 1`.
    - Add an 'IDFC NRO' INR bank. `raw = {amount:500, currency:'INR', account_name:'Cash'}` (the stated currency contradicts the named EUR account) → `account_id === null` (or kept but flagged), `confidence.amount <= 0.5`, `currency === 'INR'`.
    - `raw = {amount:500, currency:null, account_name:'IDFC NRO'}` → `account_id === 'idfc'`, confidence unchanged (no penalty), `currency === null`.
    - Two accounts named 'Revolut' (EUR `r1`, USD `r2`), `raw = {account_name:'Revolut', currency:'USD'}` → `account_id === 'r2'` (currency breaks the tie). _Today it abstains to null (unverified, low)._

53. **Pure `reviewCurrency(tx, accounts, fallback)`** (extracted from `AiAssistantConfirm`).
    - A standard tx on the IDFC NRO (INR) account in a EUR workspace → `'INR'`, headline `'Creating outgoing transaction of ₹500.00'`.
    - A card payment Revolut EUR → Visa Gold EUR in an INR workspace → `'EUR'`, `'€250.00'` (not ₹).

54. **`toGeminiSchema` / `toOpenAiSchema` on `OUTPUT_SCHEMA`** once `currency: ['string','null']` is added. — Gemini: `{type:'string', nullable:true}`. OpenAI: `currency` listed in `required` with a type array.
55. **`apiErrorMessage` / `apiErrorCode`.**
    - `apiErrorMessage(new Error('{"error":"This account\'s currency cannot be changed…","code":"account_currency_locked","currency":"EUR"}'), 'fallback')` under `de` → the German `apiErrors.account_currency_locked` text with `'EUR'` interpolated. The result never contains `'cannot be changed'` or `'{'`.
    - Unknown code `{"error":"X","code":"zzz"}` and non-JSON `'FUNCTION_INVOCATION_FAILED'` → the translated fallback argument (policy decision), not `'X'` and not the Vercel text.
    - `apiErrorCode` on raw JSON → `'account_currency_locked'`. On a non-JSON string → `null`. On a non-Error → `null`.

56. **`transferAmounts` sub-codes**, after splitting `invalid_transfer_amounts`. — `{sourceAmount:'500', sourceCurrency:'EUR', destinationCurrency:'INR'}` throws with `.code === 'destination_amount_required'`. `'1.001'` gives `'amount_too_many_decimals'`.
57. **i18n coverage of the canonical multi-currency error codes** in all 8 locales. Codes: `currency_missing`, `invalid_currency`, `currency_mismatch`, `currency_locked`, `account_currency_locked`, `source_currency_mismatch`, `destination_currency_mismatch`, `invalid_transfer_amounts`, `invalid_transfer_transition`, `transfer_reversal_conflict`, `transfer_account_unavailable`, `invalid_transfer_trash_state`, `transfer_mutation_requires_transfer_service`, `cross_currency_recurring_policy_required`. — Each `apiErrors.<code>` exists and is non-empty in en, it, de, hi, ml, ta, te and ar, differs from en in the 7 others (per the `i18n:check` rule), and keeps its `{{currency}}` placeholders.
58. **Static scan of every `code: "<x>"` literal under `api/**/*.ts`.** — Each `<x>` has an `apiErrors` key or is in an explicit allowlist. The scan fails on a new code without one.
59. **i18n used-keys gate plus `FxExcludedNotice` render.**
    - Every literal `t('…')` key in `src/**/*.tsx` resolves in `en.json` (namespace-aware, `fallbackNS=translation`, `_one`/`_other` plurals). _Fails today_ with exactly one miss: `fx.excludedNotice` (`src/components/FxExcludedNotice.tsx`). It passes once the key is added, after which `i18n:check` enforces the 7 translations.
    - Render (react-dom/server) with count 3 in en: the text contains `'3'` and not `'fx.excludedNotice'`. Count 0 renders `null`.
    - `fx.excludedNotice_one` / `_other` exist in all 8 locales.

60. **`notifyPaymentDueSoon` / `Overdue` / `AutopayPaid` / `UtilizationHigh` body** for an INR card with remaining 1,800. — The body contains `'₹1,800.00'` (or `'INR 1,800.00'`), and `data` carries `{amount:1800, currency:'INR'}`. _Today `'1800.00'` (unverified, low)._
61. **`emitBudgetAlert`**: spent 300 EUR, amount 500 EUR, `excluded_count` 2. — Per the chosen policy: either no 'fine' decision (deferred) or a notification with `data.incomplete === true`. It must not silently return `null` because spend is partial.
62. **`formatBudgetMoney(1234.5, 'JPY')` and `(1234.5, 'INR')`.** — `'¥1,235'` (0 decimals) and `'₹1,234.50'`.
63. **New `src/lib/wealth.test.ts`: `formatMoney` / `formatApprox` / `formatRate` / `accountCurrency`**, with en pinned by `test-setup`.
    - JPY: `formatMoney(1234,'JPY')` = `'¥1,234'`; `(1234.5,'JPY')` = `'¥1,235'`; `(20000,'JPY')` = `'¥20,000'`.
    - INR: `(1234567.5,'INR')` = `'₹12,34,567.50'`; `(100000,'INR')` = `'₹1,00,000.00'`.
    - KWD: `(1.2345,'KWD')` = `'KWD 1.235'`; `(10.125,'KWD')` = `'KWD 10.125'`; `(1234.5,'KWD')` = `'KWD 1,234.500'`.
    - Others: `(5,'CAD')` = `'CA$5.00'`; `(5,'EUR',false)` = `'€ *****'`.
    - `formatApprox(1417.5,'EUR')` = `'≈ €1,417.50'`.
    - `formatRate('INR','EUR','0.0097')` = `'1 INR = €0.0097'`; `('INR','EUR','0.0125')` = `'1 INR = €0.0125'`; `('EUR','INR','102.7')` = `'1 EUR = ₹102.70'`; `('EUR','INR','80')` = `'1 EUR = ₹80.00'`.
    - `accountCurrency({currency_code:null}, 'EUR')` = `'EUR'`.
    - After `changeLanguage('de')`: `formatMoney(1234567.5,'INR')` = `'1.234.567,50 ₹'`.

64. **`formatRate` with tiny rates:** `('IDR','USD','0.0000558940')` and `('VND','USD','0.0000379')`. — Neither renders `'$0.0001'` or `'$0.00'`. At least 4 significant digits are shown (e.g. `'1 IDR = $0.00005589'`), or the inverted `'1 USD = Rp17,891'`.
65. **Static guards on UI money formatting.** — Scan `src/**/*.tsx` for `formatMoney(Number(<x>.amount|current_balance|goal_amount), currency)` and `new Intl.NumberFormat(..., {currency})` where `<x>` is a row, rule, space, card or leg. Expect 0 matches outside an allowlist of reporting-aggregate sites, with each allowlisted line annotated. Also assert that `TransactionsPage`, `Dashboard` and `ClientDetailPage` no longer build their own `'en-US'` currency formatters _(ad-hoc formatter finding: unverified, low)_.

#### SQL

Throwaway checks against a scratch schema, a scratch Neon branch or the dedicated E2E branch. They are never committed, and they never write to the shared dev DB.

1. **Release-gate integrity audits (read-only).** Run on dev and prod before and after deploy, and before `VALIDATE CONSTRAINT`.
   - NULL `currency_code` per table.
   - A transaction whose currency differs from its account's; a rule whose currency differs from its account's; a `debt_details.currency` that differs from its account's; a card whose funding account currency differs from its card account currency.
   - A completed transfer whose row count, amount or currency differs from its header; a completed transfer with ≠ 2 `kind='transfer'` rows; a header with no rows.
   - A live header with a trashed linked row, or a trashed header with a live row.
   - A group with more than one distinct currency.
   - An organization whose `currency` differs from `reporting_currency`.
   - Balance drift: `current_balance` vs Σ(incoming ? amount : −amount) over rows `WHERE deleted_at IS NULL OR is_system`, per account.
   - Accounts with NULL `currency_code`.

   Expected: all 0 on prod. On dev 2026-09-30: transaction/rule/card-funding mismatches 0/0/0, 0 NULL accounts, 69 NULL-currency detached rows (skipped by the FK), 8 balance drifts (6 e2e wallets, Intesa sanapolo, the holiday Space), 4 fee-less fee transfers, and 9 orphaned trashed headers with 0 legs (i.e. purged), all left by earlier iterations. Any other transfer row is a stuck, one-sided transfer to repair. Make this a release gate.
2. **Recurring currency invariant.** Create an EUR account (opening 0), `POST /api/recurring` with `start_date=tomorrow` on it, `PATCH` the account `currency_code='USD'`, then run `select r.id from recurring_rules r join wealth_accounts wa on wa.id=r.wealth_account_id where r.active and r.currency_code is distinct from wa.currency_code`. — 0 rows. _Fails today:_ the PATCH returns 200 and the query returns the rule (EUR vs USD). After the fix the PATCH returns 409 `account_currency_locked`.
3. **0071 backfill of trashed legacy transfers** (Neon branch at 0068). Create a two-leg legacy transfer 100/100 with both legs `deleted_at` set, run 0069-0076, then `POST /api/trash/restore` on one leg. — `transfers.deleted_at IS NOT NULL` right after migration. The restore returns 200 with both legs live, and source −100 / destination +100 compared with before the restore.
4. **`set_transfer_trashed(restore)` on a live header with one trashed leg** (scratch schema). — Today it raises `invalid_transfer_trash_state`. If relaxed, it re-applies only the trashed leg (+9,000 INR) and leaves the header live.
5. **Deploy-window simulation** (scratch Neon branch). `INSERT INTO wealth_accounts` without `currency_code` (as the v0.14.1 code does), then `createTransfer` from it. — With a `BEFORE INSERT` trigger: `currency_code` = the org's reporting currency and the transfer returns 201. Without it: 409 `currency_missing` (today's behaviour).
6. **`fx_rate_on` precedence: the newest observation across directions wins.**
   - Rows USD/INR 2026-09-10 = 95.11 and INR/USD 2026-09-30 = 0.01043. `fx_rate_on('USD','INR','2026-09-30')` → ≈ 95.8773. _Today 95.11._
   - Direct EUR/INR 2026-09-14 = 110.7675 (fallback) plus inverse INR/EUR 2026-09-30 = 0.00919 (real). `fx_rate_on('EUR','INR','2026-09-30')` → 108.8139… (1/0.00919). _Today 110.7675._

7. **Fallback upgrade / upsert heal** (scratch pair, deleted after). Insert `historical_market` EUR/USD 2026-09-10 = 1.1652 `is_fallback=true`. Then run `ensureHistoricalRates` with a mocked series containing 2026-09-10 = 1.1616 (or insert the real 1.1616 directly). Then insert a real 1.2000. — After the real value: 1.1616 with `is_fallback=false`. After 1.2000: still 1.1616 (a real value is never overwritten). `reporting_amount(10000,'EUR','2026-09-10','USD')` = 11616.00 and `reporting_amount(1000, …)` = 1161.60.
8. **Manual rates beat the provider on the same day and carry forward.**
   - INR→EUR `market` 0.0130 and `manual` 0.0125 on day D → `fx_rate_on('INR','EUR',D)` = 0.0125. D+1 carries 0.0125. With only INR→EUR stored, `fx_rate_on('EUR','INR',D)` = 80. `reporting_amount(1000,'INR',D,'EUR')` = 12.50.
   - Manual USD/AED 3.6725 dated 2020-01-01 with an AED row dated 2026-09-01 → `reporting_amount(367.25,'AED','2026-09-01','USD')` = 100.00, and `missingRateSql` is false for that row.
   - Manual EUR/USD 2026-09-10 = 1.1600 → `reporting_amount(1000,'EUR','2026-09-10','USD')` = 1160.00.

9. **Missing rate and transfer legs.**
   - No AED rows: `reporting_amount(100,'AED','2026-06-01','INR')` → NULL, and `missingRateCountSql` = 1 (excluded and counted, never 1:1).
   - A CHF standard outgoing with no rate counts 1. A CHF transfer leg with no rate counts 0.

10. **Stored-rate conversion and NULL currency.**
    - `reporting_amount(5,'EUR','2026-09-14','USD')` = 5.80 and `reporting_amount(75000,'INR','2026-09-14','USD')` = 784.50 (at the stored 1.1592 and 0.01046).
    - `fx_rate_on('CHF','USD','2026-09-01')` with no CHF snapshots → NULL.
    - `reporting_amount(10, NULL, '2026-09-01', 'USD')` = 10 and `reporting_amount(5, NULL, D, 'EUR')` = 5 (identity for a NULL currency, as documented).
    - After a reporting switch, `reporting_amount(500, NULL, '2026-09-14', 'INR')` follows whichever policy is chosen: identity today (500), or counted as excluded, or impossible once a tagged backfill lands.

    _Pin, not a bug:_ the findings that NULL-currency rows count 1:1 were **refuted** (a duplicate is unverified, low).
11. **Budget spend conversion** (`listBudgets`, throwaway on the dev DB). INR reporting, Groceries ₹10,000 monthly, a USD account with a $50 Groceries expense on 2026-09-10, stored USD→INR 83.00.
    - Groceries spent = 4,150.00, `excluded_count` 0, `spent_by_view.monthly` = 4,150.00, and the overall budget includes the 4,150.
    - Add a $20 refund in Groceries the same day → spent = 4150 − 1660 = 2,490.00.
    - No USD/INR rate stored on or before 2026-09-10 → spent 0, `excluded_count` 1, and the list response's distinct excluded count is 1 (not added up across the overall budget and Groceries).
    - EUR reporting, a budget with `currency_code 'INR'`, a $30 USD expense, only USD→EUR rates stored. After the fix (rates ensured into budget currencies, or conversion via the reporting currency) this gives the converted INR amount with excluded 0. _Today:_ `excluded_count` 1, which documents the missing cross-rate.

12. **`/transactions` summary excludes system rows.** Render the summary query (extract `summaryWhere` into a helper). — The SQL contains `"is_system" = false` alongside `kind in ('standard','refund')`, so the income sum never sees system rows.
13. **Grouped split amount is null-propagating.**
    - Render `groupedFieldsFor('INR').amount`: the SQL contains `bool_or(reporting_amount(...) is null)`, so a group with one unconvertible leg yields NULL, not a partial sum.
    - Run `groupedRows` on legs INR 1,000 + EUR 50 on a date with no EUR rate: amount NULL or flagged incomplete, and `reporting_amount` NULL. _Today:_ `amount='1000.00'` with `currency_code` INR, a silent drop.

14. **`posted_by_currency` for a rule.** Rows: EUR 12 × 3 (2026-06..08), INR 1,000 × 1 (2026-09), plus one trashed EUR 12. — `[{EUR, 36.00}, {INR, 1000.00}]`, with the trashed row excluded. The reporting variant (USD org, no INR rate) returns total = converted EUR only, with `excluded_count` 1.
15. **Admin org-detail totals.** Incoming $1,000 (USD account) and €1,000 (EUR account), EUR→USD 1.10 on that date, plus a trashed $500 row and an Opening Balance system row of 5,000. — `incoming_total` = 2,100 USD with `excluded_count` 0 (or grouped `{USD:1000, EUR:1000}`). Trashed and system rows are excluded. Never 2,000 or 7,500.

#### API

Committed cases run in the e2e API project against the dedicated branch. "Throwaway" cases use a dotenv test that is deleted before commit.

1. **Onboarding writes both currency columns.** A fresh profile's personal org is created as USD (by `GET /api/profile`), then `POST /api/onboarding {account_type:'personal', currency:'INR'}`.
   - `GET /api/organizations` (active/personal row) and `GET /api/organizations/:id` → `currency 'INR'` and `reporting_currency 'INR'`.
   - The first `GET /api/wealth/accounts` → Cash in Hand `currency_code 'INR'`.
   - `POST /api/wealth/accounts {type:'bank', opening_balance:20000}`, or `{bank_name:'HDFC', opening_balance:50000}`, with no `currency_code` → the account and its Opening Balance row are `'INR'`.
   - Business onboarding that reuses an existing non-personal USD org, with `'EUR'` → that org has `currency 'EUR'` and `reporting_currency 'EUR'`, and `useCurrency` on reload is EUR.

   _Fails today:_ USD / USD / USD.
2. **Admin org currency PATCH.** `PATCH /api/admin/organizations {organization_id, currency:'eur'}`, then `{currency:'EURO'}`.
   - The first call sets both `currency` and `reporting_currency` to `'EUR'`. The owner then sees both as EUR via `GET /api/organizations`, and `/api/debts` and `/api/wealth/summary` both report in EUR.
   - `'EURO'` → 400 `Invalid currency code` and the DB is unchanged. The admin POST with `'EURO'` also returns 400, not 500.

3. **Deleting a transfer's fee row on its own, then reversing.** EUR cash 1,000.00. `POST /api/wealth/transfer` EUR cash → INR cash, source 500, destination 51,350, fee 5. Then `DELETE /api/transactions/:feeRowId`, then `POST /api/wealth/transfers/:id/reverse`.
   - The DELETE returns 409 `transfer_mutation_requires_transfer_service` (or trashes the whole transfer). Never EUR cash 500.00 with a live header.
   - If the delete is allowed, the reversal posts no fee refund. EUR cash ends at exactly 1,000.00 (its pre-transfer value), never 1,005.00. INR cash returns to its original value, and the net fee expense is €0.

   _Fails today (critical)._
4. **Editing a transfer fee row.** `PATCH /api/transactions/<fee row> {amount:50}` and `{wealth_account_id:<INR account>}`. — 409 `transfer_mutation_requires_transfer_service` for both. The row, both balances and the header are unchanged (`source_fee_amount` stays 5.00 EUR). _Today:_ the amount PATCH returns 200, the source drops a further 45, and the header still reads 5.00.
5. **Fee double reversal through cleanup** (throwaway). EUR wallet 1,000; transfer 500 + fee 5 to INR (→ 495); `DELETE` the out leg (→ 1,000); then `DELETE` the fee row id. — 409/404, and EUR stays 1,000. _Today 1,005._
6. **Reversing a trashed transfer.** Trash a completed transfer (`DELETE /api/wealth/transfers/:id`, or `DELETE /api/transactions/<leg>`), then `POST /api/wealth/transfers/:id/reverse`. — 409 `transfer_trashed`, and both balances stay at their post-trash values. _Today:_ 201, A +100 / B −100, and money moves again.
7. **Trashed-row idempotency** (throwaway).
   - Double `DELETE` of a single expense of 10 on Cash 1,000 → the first returns 204 (→ 1,000) and the second 404 (→ 1,000). _Today:_ 204 and 1,010.
   - `PATCH` a trashed expense 10 → 15, then restore → the PATCH returns 404, and after restore the balance is 990. _Today 985._
   - `Promise.all([restore X, restore X])` for a trashed expense of 10 on 1,000 → balance 990 and exactly one 200. _Today it can be 980._

8. **Purging a transfer with a fee.** Trash a transfer with fee 5, then `DELETE /api/trash/purge` one principal leg. — 0 transactions left with that `transfer_id` (both legs and the fee are purged). The header is deleted or stays trashed, and no 'Transfer fee' row remains in `GET /api/trash`.
9. **Tag "delete with records" on transfer legs** (throwaway). EUR wallet 1,000.00, INR wallet 10,000.00. `POST /api/wealth/transfer` 100 EUR → 9,000 INR with fee 2. `PATCH` the INR incoming leg `{tags:['#mcleg']}`, then `DELETE /api/tags/:id?mode=with_records`.
   - After the fix: `transfers.deleted_at` NOT NULL, all 3 linked rows trashed, EUR 1,000.00, INR 10,000.00. _Today:_ EUR 898.00, INR 10,000.00, header live, 1 row trashed.
   - Then `POST /api/trash/restore {type:'transaction', id:<INR leg>}` → 200, `restoredLegCount` 3, EUR 898.00, INR 19,000.00. _Today:_ 409 `invalid_transfer_trash_state`.
   - Tag-trash one leg, then reverse → 409 with a trashed-rows code, and both balances unchanged. _Today:_ 201 with INR at 1,000.00 (9,000 short).
   - Tag only the fee row (`#mcfee`), delete with records, then reverse → EUR 900.00 after the tag delete. The reverse returns 409, or EUR 1,000.00 with no fee refund row. _Today:_ EUR 1,002.00 plus a −2 EUR 'Transfer fee refund'.
   - Reversal chain: reverse T, tag one leg of the reversal R, delete the tag with records → 409 or the leg is skipped, and no balance moves. _Today:_ the leg is trashed, INR +9,000, and it can never be restored.

10. **Client delete cascade across currencies** (business org). Client C has a 50.00 EUR expense on the EUR wallet and 2,000.00 INR income on the INR wallet.
    - `DELETE /api/clients/C` → EUR +50.00, INR −2,000.00, and 2 rows with `deleted_at` = `client.deleted_at`. `POST /api/trash/restore {type:'client'}` → back to the exact starting balances.
    - Concurrency: `Promise.all` of two `DELETE /api/clients/C` (and of two `POST /api/clients/bulk-delete {ids:[C]}`) → balances shift exactly once (EUR +50.00, INR −2,000.00), and the loser gets 404 or `deleted:0`. _Today:_ shifted twice.
    - `POST /api/clients/bulk-delete` with C1 (−30 EUR) and C2 (−20 EUR) on the same EUR wallet, plus C2 (+500 INR) → EUR +50.00 in one collapsed update, INR −500.00. An `is_own` client in `ids` is ignored.

11. **Account currency lock.** `PATCH /api/wealth/accounts/:id {currency_code}` must return 409 `account_currency_locked` whenever a later posting could carry the old currency.
    - An empty (0-row) account that a recurring rule starting tomorrow/next month uses as its account or payer: a standard rule, a USD rule on a 0-row bank switching to EUR, or the payer of a debt rule. _Today 200_ (throwaway reproduces the critical issue). The alternative is that the rule's `currency_code` becomes the new currency. There must never be a later occurrence in EUR on a USD account. If a mismatch already exists, the materializer skips with `lastError` and posts no row.
    - A bank funding an autopay card, with 0 rows → 409, or 200 with the card's autopay switched off and audited (per decision). Never a silent cross-currency autopay.
    - A wallet whose Opening Balance was trashed and purged (0 rows, balance €1,000 or 50) → 409, and `currency_code` stays EUR. _Today 200._
    - An EUR account whose only transaction is in the trash → 409, AND `GET /api/wealth/accounts` reports history (`transaction_count > 0` or `has_history=true`) so the UI disables the picker.
    - Plan a transfer from a 0-row account, `PATCH` that account's currency, then `PATCH /api/wealth/transfers/:id {status:'completed'}` → 409 with a distinct code (`transfer_account_currency_changed`), or the currency PATCH itself is refused. No legs are created.

12. **Currency-lock races** (throwaway, 50 iterations on a fresh USD wallet).
    - `Promise.all([PATCH {currency_code:'EUR'}, POST /api/transactions 10])` → `SELECT count(*) FROM transactions t JOIN wealth_accounts wa ON wa.id=t.wealth_account_id WHERE t.currency_code<>wa.currency_code` = 0, and the loser gets 409. _Today mismatches appear._
    - The same race with `POST /api/wealth/transfer` A→B vs a PATCH of A's currency → no transfer leg or header in a currency different from its account, and the loser gets 409.

13. **Materializer drift guard.** A rule with `currency_code` USD on an account whose `currency_code` is EUR, due today; call `materializeDueRecurring`. — No transaction is inserted, the account balance is unchanged, `last_error` is set and `next_due_at` is unchanged.
14. **Cross-currency Space auto-save: refused up front, and a failed run keeps its cursor.**
    - `PUT /api/spaces/:id/auto-save` with a source whose currency differs from the Space → 409 `cross_currency_recurring_policy_required`, and no `recurring_rules` row is created.
    - A transfer rule from a EUR source to a USD Space, due today, then `materializeDueRecurring` → `created = 0`, `next_due_at` stays today, and `last_error` is non-empty (the destination-amount error or a translated code).
    - Same via the API: an auto-save rule due today whose source currency no longer matches the Space (set up by a currency change on a 0-row source), then `GET /api/transactions` → `next_due_at` unchanged, `last_error` non-empty (or carrying a code), no transfer rows, and the Space balance unchanged.
    - Auto-save B→S in the same currency, relabel B, force the rule due (`PATCH start_date` to yesterday), then `GET /api/spaces` → no transfer posted, `next_due_at` not advanced, and `last_error` non-empty.

    _Today:_ the cursor advances and `last_error = ''`.
15. **Re-pointing a rule to another currency.** Rule EUR 15 on the EUR account; `PATCH {wealth_account_id:<INR account>}` without a `currency_code`. — After the fix: 409 `currency_changed`, or a response that requires confirmation. _Today:_ 200 with `currency_code` INR and amount 15.00.
16. **Account-less rule after an org currency change.** Org INR; a rule without an account, amount 50,000 (currency INR). `PATCH` the org currency to USD, then `PATCH` the rule `{name:'Retainer 2'}`. — The rule's `currency_code` stays `'INR'` and the amount stays `'50000.00'`. _Fails today._
17. **Debt repayment rule paid from another currency.** EUR debt, rule paying from the EUR wallet; `PATCH /api/recurring/:id {wealth_account_id:<INR wallet or USD bank>}`. — 400 `currency_mismatch` with a `currency: 'EUR'` param, and the rule is unchanged. _Regression guard._
18. **Cross-currency card autopay is refused.**
    - `PATCH /api/cards/:visaGold {funding_account_id:<INR bank>}` then `{autopay:true}` (card account EUR).
    - `PATCH /api/cards/:id {funding_account_id:<INR bank>, autopay:true}` for a USD card.
    - `PATCH /api/cards/:id {autopay:true}` on any card whose liability currency differs from its funding bank.
    - `POST /api/cards {kind:'credit', funding_account_id:<INR bank>, autopay:true}`.
    - `POST /api/cards kind=credit` with `account_id` = a EUR bank in a USD workspace and `autopay:true`. Either the liability account is created in EUR (currency follows the issuer), or the call is refused.

    Expected: 400 (or 409) with one agreed code. The analysts proposed `autopay_currency_mismatch`, `autopay_cross_currency` and `currency_mismatch`. The card keeps `autopay=false`, and a USD card is never auto-funded by EUR. _Today:_ accepted, and every due date defers with `autopay_error='Destination amount is required for a cross-currency transfer'` and `autopay_status` NULL on every sync, so the statement is never paid.
19. **`syncCards` on a legacy cross-currency autopay card** (throwaway DB script). Seed a card with `autopay=true`, cross-currency funding and a due statement. — 0 transactions and 0 transfers are created. The statement gets `autopay_status 'failed'` with a stable code, and exactly 1 `card_autopay_failed` notification is sent. A second `syncCards` run performs no UPDATE on that statement.
20. **A credit card's currency follows its issuer.**
    - EUR workspace: `POST /api/cards {kind:'credit', account_id:<INR issuer bank>, credit:{credit_limit:100000, current_debt:25000, statement_closing_day:25, payment_due_day:5}}` → the liability account's `currency_code` is `'INR'` (issuer default, or an explicit `credit.currency_code`), and the Opening Balance system row is INR 25,000.
    - Fixture: a debit card on the INR bank (`{kind:'debit', account_id:INR bank, last4:'4242', network:'visa'}`) with a ₹1,500 'Shopping' purchase carrying `card_id`, plus a credit card `{credit_limit:50000, current_debt:5000, statement_closing_day:5, payment_due_day:25}` → the liability is `'INR'` (_today 'EUR'_), wealth `card_liabilities` is 62.50 (_today 5,000_), and the INR bank balance is 111,900.00.

21. **Card payloads carry the account currency.** `GET /api/cards` and `GET /api/cards/:id/summary`. — Every card row includes `account_currency_code`: EUR for the Visa Gold/Revolut/Federal/Intesa cards and INR for a debit card linked to IDFC NRO. The summary identifies its currency (`card.account_currency_code`). _Fails today._
22. **Paying a EUR card from an INR bank.** `POST /api/wealth/transfer {from_account_id:<INR bank ₹20,000>, to_account_id:<EUR card owing €1,000>, source_amount:9300, destination_amount:100, source_currency:'INR', destination_currency:'EUR'}`.
    - 201. The card's `current_balance` goes −1000.00 → −900.00 and the bank 20000.00 → 10700.00. `transfers.effective_rate = '0.01075268817204'`, `rate_source 'effective_transfer'`. The EUR 100 in-leg is `kind transfer` and carries the `card_id`; the out-leg is INR 9,300. `paymentsAfter(card, lastClose)` grows by 100 when dated after the close.
    - The same call without `destination_amount` → 400 `invalid_transfer_amounts` (never posted 1:1), and both balances are unchanged.

23. **Reversed card payment brings the alert back.** Pay a EUR card's €500 statement from a EUR bank, `POST /api/wealth/transfers/:id/reverse`, then `GET /api/alerts`. — The card slide reappears (`card_payment_due_soon` or overdue) with `money.amount` 500 and currency `'EUR'`, and `GET /api/cards/:id/summary` shows the statement unpaid again.
24. **Deterministic matrix: preflight** (first in the mc project, after seeding). `GET /api/fx/rate` for `INR→EUR`, `JPY→EUR` and `MNT→EUR`.
    - INR: `Number(rate)` = 0.0125, provider `'e2e-fixed'`, stale false, `rate_date` = today.
    - JPY: stale true, `rate_date` = today−1, rate 0.005.
    - MNT: 404 `{code:'no_rate'}`.
    - Any other provider → `test.skip('dev server must run with FX_DISABLED=1 on the seeded E2E branch')`.

25. **Matrix baseline** (fixture in 6.2).
    - Native balances: EUR `'1098.00'`, INR `'113400.00'`, USD `'450.00'`, JPY `'17000.00'`, KWD `'10.00'`.
    - `GET /api/transactions?page=1` summary: `{incoming 300, outgoing 87, currency 'EUR', excluded_count 0}`.
    - `/api/wealth/summary`: `net_worth` 2985.50, `complete` true, `stale` true (JPY), `as_of` today−1, INR converted 1417.50, shares EUR 36.8 / INR 47.5 / USD 12.1 / JPY 2.8 / KWD 0.8.
    - `/api/analytics`: Food 70, Travel 15, Transfer Fee 2.

26. **Matrix budget.** `POST /api/spending-budgets {name:'e2e-mc Food', amount:100, period:'once', start_date:D1, end_date:today, categories:['Food']}`. — The row has currency `'EUR'` and `currency_code 'EUR'` (_fails today: null_), spent 70, remaining 30, `excluded_count` 0.
27. **Matrix: historical immutability.** Change today's INR→EUR seed rows (market and manual) to 0.02, re-read, then restore. — Wealth INR `converted_balance` 2268.00 and `net_worth` 3836.00. P&L unchanged (300/87), budget spend unchanged (70), and the INR native balance unchanged at 113400.00.
28. **Matrix: missing rate.** Add an MNT cash wallet (₮100,000) and an MNT expense of ₮5,000 Food on D2. — The transactions summary is still `{300, 87}` with `excluded_count` 1. The budget spend is 70 with `excluded_count` 1. Wealth `complete` false, `excluded_currencies ['MNT']`, `net_worth` still 2985.50. No MNT row is ever treated as 1:1.
29. **Matrix: reporting switch EUR → INR** (`PATCH /api/organizations/:id {currency:'INR'}`).
    - MUST STAY: every native balance, amount and `currency_code`; the transfer source 100.0000 / destination 8000.0000 / `effective_rate` 80; the budget currency `'EUR'` with 70 of 100.
    - MUST CHANGE: summary `{incoming 24000, outgoing 7160, currency 'INR', excluded_count 1}`; wealth reporting `'INR'`, `net_worth` 238840.00, excluded `['MNT']`.
    - _Today_ the budget shows 5,800 of 100 in INR.

30. **Matrix: switch back INR → EUR.** — Byte-identical to the EUR baseline: `net_worth` 2985.50, summary 300/87 with excluded 1, budget 70.
31. **Matrix: currency snapshot audit** (end of suite). Read-only `SELECT` on the fixture org for `currency_code IS NULL` across `transactions`, `wealth_accounts`, `recurring_rules` and `spending_budgets`. — All four counts are 0. _Fails today_ on `spending_budgets`: the POST never writes `currency_code`.
32. **Budgets store their currency at create.**
    - `POST /api/spending-budgets {name:'Food', amount:500, period:'monthly', categories:['Food']}` in a EUR workspace → `currency_code='EUR'`. After the reporting currency changes to INR, the list shows the budget as 500 EUR with spend in EUR (e.g. 400, 80%), not ₹500 / 7,200%.
    - Personal v1 shim `POST /api/budgets {amount:300, period:'monthly'}` in a USD personal workspace → the created `spending_budgets` row has `currency_code='USD'`. In a EUR workspace → `'EUR'`.
    - `POST /api/spending-budgets` in an INR workspace, then a sub-budget under it after the org switches to EUR → both rows are stored with `currency_code 'INR'`, and the 201 body has currency `'INR'`. _Today:_ the column is NULL and the child resolves to EUR.
    - A USD workspace with a 500/month budget (`currency_code` null), then `PATCH` the org currency to EUR, then `GET /api/spending-budgets` → after the decision, the budget stays `'USD'` (limit 500) or is converted explicitly. _Today:_ currency `'EUR'` with amount 500 (re-denominated).

33. **Budget detail and v1 caps convert per row.**
    - `GET /api/spending-budgets/:id` for a $50 USD Groceries expense in an INR workspace → `recent[0] = {amount:50, currency_code:'USD', amount_in:4150}`, `excluded_count` 0, and `excluded_count` on every series point.
    - Business `GET /api/budgets/overview` with a client cap of ₹5,000 and a $50 USD expense for that client (rate 83) → spent 4150, currency `'INR'`, `excluded_count` 0. With no rate: spent 0 and `excluded_count` 1.
    - Client Acme with a cap of 1,000/month in a USD workspace and $200 spent. Switch reporting to INR, then `GET /api/budgets` → the cap is reported in USD (1,000, 20%), or in INR with the amount converted and the currency pinned. Never amount 1,000 labelled INR at 1,660%.

34. **Debt currency must match the paying or receiving account.**
    - `POST /api/debts {currency:'USD', current_balance:1000, disbursement_account_id:<EUR bank>}` → 400 `{code:'currency_mismatch'}`, and no `wealth_accounts`, `debt_details` or `transactions` rows are created.
    - `POST /api/debts {currency:'USD', repayment:{from_account_id:<EUR bank>, amount:100, frequency:'monthly', start_date:today}}` → 400 `currency_mismatch`.
    - `POST /api/debts/:usdDebt/payments {from_account_id:<EUR bank>, amount:100}` → 400 `currency_mismatch`, and balances unchanged.
    - Positive: a USD debt of 1,000 paid from a USD bank with `{amount:100, interest:10}` → 201. All legs are USD, the bank drops by 100, the debt goes −1000 → −910, and the interest leg is 10 USD, standard outgoing.

35. **Debt currency lock.** `PATCH /api/debts/:id {currency:'GBP'}`.
    - With one hand-recorded principal payment → 409 `{code:'currency_locked'}`.
    - With only the opening balance → 200. `wealth_accounts.currency_code`, `debt_details.currency` and the opening row's `currency_code` all become `'GBP'`, and amounts are unchanged.
    - After an interest-only payment (principal 0, interest 50) → 409 `currency_locked`. _Today 200._

36. **Debts hub and wealth summary with foreign debts.**
    - `GET /api/debts` in a EUR workspace with an EUR loan (300 paid today) and a USD loan (500 paid today) → `summary.owed_by_currency` has 2 entries. Month figures are per currency (`{EUR:300}`, `{USD:500}`), or converted with an excluded count. Never `month.paid = 800` labelled EUR.
    - Fixture: an INR loan `{currency:'INR', current_balance:50000, payment_amount:5000, monthly}` and a EUR loan `{currency:'EUR', current_balance:2000, payment_amount:200}` → hub `owed_by_currency [{INR 50000}, {EUR 2000}]`. `month.required` is grouped per currency or converted to 262.50 (_today 5,200_). Wealth `debts_owed` 2625.00, `net_worth` 360.50. A payment on the INR loan from the EUR cash wallet → 400 `currency_mismatch`; from the INR bank → 201.
    - `GET /api/wealth/summary` with a USD loan owing 10,000 in an EUR workspace and a stored USD→EUR rate of 0.9 → `debts_owed` 9000, `liabilities` includes 9,000, and `net_worth` drops by 9,000. With no rate: `excluded_currencies ['USD']`, `complete` false.

37. **Deleting a debt whose rows are all in Trash.** `DELETE /api/debts/:id` when the opening and repayment rows are all trashed. — The debt is archived (200), not hard-deleted, and its rows keep their account.
38. **Admin transaction tools respect the ledger.**
    - `PATCH /api/admin/transactions {transaction_id:<account-linked outgoing 100 on a balance-900 EUR account>, amount:150}` → 409 (refused), or the account `current_balance` becomes 850 with `currency_code` staying `'EUR'`. The balance must never stay 900 with the row at 150.
    - Admin `DELETE /api/admin/transactions` on a transfer leg (`transfer_id` set) → 409 (e.g. `transfer_mutation_requires_transfer_service`), and both legs, the header and both balances are unchanged.

39. **Mixed-currency splits.** `POST /api/transactions/group` with allocations on a EUR account (30 / 50 / 400) and an INR account (70 / 1,000 / 600). — If that policy is chosen: 400 `split_currency_mismatch` (also written `mixed_currency_split`), no rows inserted and balances unchanged. _Today:_ 201 with legs INR 600 and EUR 400, and Revolut −400.
40. **Split and fee-row detail reads.**
    - If mixed splits stay allowed: €50 on EUR cash + ₹1,000 on the INR bank, then `GET /api/transactions/:id` for one leg → the detail carries a converted group amount of 62.50 EUR (or per-currency legs), never `'1050.00'`. The list row shows 62.50.
    - A split with EUR €30 + AED 100 legs (no AED rate) in a USD workspace → the group amount / `reporting_amount` is null or flagged partial, never 34.85 labelled USD.
    - `GET /api/transactions/<eur fee row id>` → `body.currency_code = 'EUR'` with `reporting_amount` present. For a split, the amount equals the grouped list row's amount.

41. **Amount precision.**
    - `POST /api/transactions {type:'outgoing', amount:1.235}` on an account at 100.00 → 400 (at most 2 decimal places), or a row of 1.24 with balance 98.76. The balance must equal the ledger sum.
    - Per the minor-unit policy: `POST /api/transactions` KWD 1.125 is stored as `'1.125'` on the transaction, and `POST /api/wealth/transfer` EUR 10 → KWD 1.125 is stored as `'1.125'` on the transfer (_today `'1.13'` and 400_). JPY 1000.5 → 400 (_today 201 `'1000.50'`, unverified, low_).

42. **Editing a row on an archived account.** Archive a bank that has rows, then `PATCH /api/transactions/:rowId {category:'Food'}` (or `{description:'x', wealth_account_id:<archived id>}`). — 200, `currency_code` unchanged, balance unchanged (same as origin/dev). _Today:_ 409 `currency_missing`.
43. **PATCH account-type and currency guards on transactions.**
    - `PATCH` a standard row `{wealth_account_id:<space or loan account>}` → 400 (same messages as POST). A PATCH on a loan's system Opening Balance row → 400/409.
    - `PATCH` a EUR 50 row to an INR account without resending the amount (`{wealth_account_id: inr}`) → 409 `amount_required_for_currency_change` (or the decided policy). Nothing is re-denominated silently.

44. **`/transactions` summary in a foreign-wallet workspace.** USD workspace; EUR wallet with an opening EUR 1,000 system row plus a EUR 5 expense; `GET /api/transactions?page=1`. — `summary.incoming` = 0, `summary.outgoing` ≈ 5.80 (EUR 5 at the row-date rate), currency `'USD'`, `excluded_count` 0.
45. **Account-scoped summary uses the account's currency.** `GET /api/transactions?wealthAccountId=<foreign account>&page=1`. The response states its currency (`summary.currency`) and the UI formats with it.
    - EUR wallet in a USD workspace → `summary.currency 'EUR'`, incoming 0.00, outgoing 5.00 (native).
    - USD account in a EUR workspace with $1,000 of income → if native is chosen: incoming 1,000, currency `'USD'`.
    - IDFC NRO (INR) in the EUR workspace → `summary.currency 'INR'` with native incoming 20,000 (if system rows count), or the UI formats with `summary.currency`. _Today_ `{incoming:180.6, currency:'EUR'}`. The page must never show `'₹180.60'`.
    - EUR account in an INR workspace with a €100 outgoing on 2026-09-28 (stored EUR→INR 90) → `{outgoing:100, currency:'EUR'}`, and the page shows 'Expenses €100.00'. _Today_ `{outgoing:9000, currency:'INR'}`, rendered as €9,000.00.

46. **Legacy (old-client) transfer bodies.**
    - Cross-currency `POST /api/wealth/transfer {from:<EUR/INR account>, to:<INR/EUR account>, amount:100 | '500'}` (the AI assistant and v0.14.1 body) → 400 `{code:'invalid_transfer_amounts', error:'Destination amount is required for a cross-currency transfer'}` (or `destination_amount_required` after the split). No transfers or transactions rows are written, and both balances are unchanged.
    - The same with `destination_amount: 1.05` (IDFC NRO INR → Visa Gold EUR, amount 100) → 201. The transfers row has `source_amount` 100.00 INR / `destination_amount` 1.05 EUR, `effective_rate` 0.0105, and the legs' `currency_code` is INR and EUR.
    - Same-currency legacy body `{from: HDFC INR, to: SBI INR, amount:100}` → 201 with `group_id`, `attach_to`, `from_leg.amount '100.00'`, `to_leg.amount '100.00'`, `transfer_id` non-null, `fee_leg` null. HDFC −100, SBI +100.
    - Old leg edit: `PATCH /api/transactions/<card-payment leg> {amount:4500, date: unchanged}` → 409 `transfer_mutation_requires_transfer_service` with balances unchanged. Then `{description:'Rent card'}` → 200 with only the description changed.

47. **Wealth summary edge cases.**
    - EUR €1,000 + INR ₹75,000 wallets, reporting USD, `FX_DISABLED=1` and no stored INR→USD rate → `complete=false`, `excluded_currencies=['INR']`, `net_worth` = the converted EUR only, `accounts[INR].converted_balance=null`, and `by_currency` lists INR with `converted_net` null.
    - A EUR workspace with a loan (EUR, balance −2,000), a receivable (EUR +300), a card (EUR −150) and a bank €1,000 → assets 1,300, liabilities 2,150, `card_liabilities` 150, `debts_owed` 2,000, `debts_receivable` 300, `net_worth` −850.
    - The same INR account converted in `GET /api/wealth/summary` and in `GET /api/flow?mode=timeline` (current balance) → identical converted value for the same moment.
    - The first `GET /api/wealth/summary` for a workspace with a foreign row dated 700 days ago (fresh snapshot table) → responds within the function budget (target < 3 s) and still returns correct current-rate conversions.

48. **Reports convert at the row-date rate** (personal USD workspace).
    - Record a EUR standard outgoing of 10.00 dated D = 2026-09-10 on the EUR wallet and read its `reporting_amount` R from `GET /api/transactions?clientId=…`. Then `GET /api/analytics?from=2026-09-01&to=2026-09-30` → `summary.expense` rises by exactly R (≈ 11.6), not by 10, with currency `'USD'` and `excluded_count` unchanged. The `/api/calendar` day-D outgoing and the `/api/flow` root expense rise by R too.
    - `GET /api/flow?groupBy=account` → the EUR wallet group has `account_currency 'EUR'` and its native `current_balance` (e.g. 395), with income/expense in USD. `root.balance` equals the sum of today's converted balances, never the raw native sum.
    - Business org `GET /api/clients?page=1` and `/api/clients/:ownId` → `totals_currency 'USD'` with `excluded_count` present. After the scope decision, own-client income equals analytics `by_client` income (no system rows).
    - Admin org detail for org 920a6c5f (EUR 5.00 + USD 1.00 outgoing, USD reporting) → `outgoing_total '6.80'` with currency `'USD'` and `excluded_count` 0 (not the raw `'6.00'`).

49. **List payloads carry `currency_code`.**
    - `GET /api/trash` after trashing a EUR 5 row → `transactions[0].currency_code = 'EUR'`, with `kind` and `transfer_id` present. After trashing a ₹2,000 INR expense → `'INR'`.
    - `GET /api/tags/entities?tag=…` → each transaction item carries `currency_code` (`'INR'` for the transfer leg, `'EUR'` for the fee).
    - `GET /api/categories/entities` (category 'Transfer Fee') → `currency_code 'EUR'`. For the INR expense → `'INR'`.
    - `GET /api/search?q=<EUR tx description>` → `currency_code 'EUR'`. `GET /api/search?q=Opening` in the EUR workspace → the IDFC NRO row carries `currency_code 'INR'` and amount `'20000.00'`.

    _Fails today._
50. **Recurring posted totals by currency.**
    - A rule re-pointed from a EUR account (3 × 100 posted) to an INR account (2 × 100 posted) → `GET /api/recurring/:id` gives posted totals by currency `[{EUR:300}, {INR:200}]` (or a reporting sum plus an excluded count), not `'500'`.
    - Fixture: a daily $10 rule on the USD wallet anchored today−3 → `currency_code 'USD'`, 4 posted rows each `'USD'`, `posted_total` 40.00 labelled USD. After PATCHing the rule's account to EUR cash, `posted_total` is still reported as $40 (grouped), never `'€40'`.

51. **Shortfall alert in the account's currency.** `GET /api/alerts` for a USD workspace with an INR bank (₹12,000) and an outgoing INR rule of ₹15,000 due in 5 days. — One `charge_shortfall` item: money `{amount:15000, short:3000}`, currency `'INR'`, severity `'warning'`, `params.days` 5.
52. **Balance writes stay equal to the ledger.** 20 × `Promise.all([PATCH A {current_balance:500}, POST +50 on A])`. — After each iteration the stored balance equals Σ ledger (the drift query returns 0 rows).
53. **Currency change plus balance adjustment in one PATCH.** `PATCH {currency_code:'EUR', current_balance:100}` on a clean USD wallet. — 400, OR the adjustment row has `currency_code 'EUR'`. _Today 'USD' (unverified, low)._
54. **Wealth lifecycle guards.**
    - Archive a non-default INR cash wallet that has history, then `PATCH {restore:true}` → 200, `archived_at` null, and Cash in Hand untouched.
    - `POST /api/wealth/transfer {status:'planned', to_account_id:<loan>}` → 400 code `debt_account`. `PATCH completed` on an existing plan into a loan → 409/400. The loan balance is unchanged.
    - Reverse transfer T, then `POST /api/wealth/transfers/<R>/reverse` (R = the reversal) → 409 if the product decides reversals are final, and no new transfer row. _Decision-dependent:_ the "server reverses a reversal" finding was **refuted** once and is unverified (low) in a duplicate.

55. **Billing and referral currency.**
    - `GET /api/billing/pricing` vs `POST /api/billing/create-subscription` for profile country IN, IP header US, org currency USD (stub mode) → both resolve INR: pricing `local_pricing.currency='INR'` and `billing_attempts.currency='INR'`.
    - `PATCH /api/admin/referral-settings {reward_currency:'US'}` and `{reward_currency:''}` → 400 for both, and the settings row keeps `'USD'`.
    - Programme currency change USD → EUR with an existing $40 available balance → `GET /api/referrals` still reports 40 in USD, and a new payout request is in USD.

56. **FX endpoints and operations tooling.**
    - `GET /api/fx/rate?from=EUR&to=EUR` → 200 `{rate:'1', provider:'identity', stale:false}`. `?from=BTC&to=USD` → 400 `invalid_currency`. With `FX_DISABLED=1`: `?from=SEK&to=NOK` (no rows) → 404 `no_rate`, and `?from=EUR&to=USD` (last row 2026-09-14) → 200 `{rate:'1.1592', rate_date:'2026-09-14', stale:true}`.
    - `POST /api/cron/notifications` with the service token after 15:00 UTC on a weekday, for an org with a EUR account → 200 with an fx block `{fx_pairs>=1, fx_failed:0}`. The `fx_rate_snapshots` market row for (EUR, reporting, today) has `is_fallback=false`, and weekday placeholder rows in the last 10 days are replaced by real values. Without a token → 401.
    - `GET /api/admin/worker` (read cap) → the fx block lists each pair's `latest_real_date`, `last_fetch` and `placeholder_weekdays_30d` (dev today: EUR/USD 2, EUR/INR 2, INR/EUR 1, INR/USD 1, USD/INR 1), plus orgs with excluded > 0 and their `first_excluded`. A non-admin gets 403.
    - `POST /api/admin/fx/rates` as a non-super admin → 403. As a super admin with USD/AED rows → 201, stored as `source_type='manual'` with provider `'manual:<adminId>:<ts>'`. The AED org's `/api/transactions` summary `excluded_count` drops to 0, and the converted total rises by the AED rows' USD value.

57. **Detached rows keep their currency on edit.** An org reporting EUR has a row with no account (`currency_code 'EUR'`), or an admin-created detached row of 100 USD. Change the org currency (to USD, or to EUR for the USD row), then `PATCH` only the description. — 200, and the `currency_code` stays as it was (`'EUR'` / `'USD'`). _Regression guard:_ the re-stamp finding was **refuted**.

#### E2E (Playwright)

1. **Onboarding in INR through the UI.** Use a fresh Clerk dev user (`+clerk_test`, code 424242) and choose INR with Cash 5,000 (a variant of `auth.setup.ts` or a new spec). — `/organizations` shows INR. `/wealth` shows '₹5,000.00' Cash in Hand and its account currency label is INR. The dashboard balance figures render with ₹, no '$' is visible anywhere, and `GET /api/wealth/accounts` returns `currency_code 'INR'` for every account. Replace the hard-coded `'USD'` in `e2e/auth.setup.ts` with a second, non-USD project or case.
2. **Trashing the fee, then reversing, restores exactly the original balance** (in `multi-currency.spec`, inside a throwaway org). — EUR cash returns to 1,000.00.
3. **The hero never paints a raw cross-currency sum.**
   - `page.route` delays `/api/wealth/summary` (3-5 s), then returns 500 or aborts. Load `/wealth` and `/dashboard` with mixed wallets (EUR €1,000 + INR ₹75,000, or the e2e personal set, or the matrix fixture). Sample the "Total available" text every 250 ms.
   - The headline never shows 76,000, '$159,978.85' or '€131,958.00'. It shows a skeleton, '—' or per-currency figures while waiting, then the summary figure (about $25,1xx in the personal workspace, '€2,985.50' in the fixture) followed by the 'Excludes' or complete state. If the request is aborted it stays '—' plus a note.

   _Fails today._
4. **Reporting switch through the UI, without a manual reload** (matrix fixture). `/organizations` → edit → currency INR → save, then `/transactions`, `/wealth`, `/budgets`. Also navigate to `/dashboard` within 5 s of the change.
   - Totals '₹24,000.00' / '₹7,160.00' and net worth '₹2,38,840.00'. The budget row stays '€70.00 of €100.00'.
   - The KPI and Wealth headline symbols match `GET /api/wealth/summary.reporting_currency`, and the values equal the server figures (no pre-change bodies).
   - A EUR number never appears under a ₹ label at any point.

5. **Reporting currency round trip** (personal USD workspace, USD bank 1,000.00 plus an EUR wallet 100.00). Set reporting to EUR on `/organizations`, check `/wealth`, then set it back to USD. — Native balances stay $1,000.00 and €100.00 throughout. With EUR reporting, net worth ≈ 1000 × USD→EUR + 100, the USD bank shows '≈ €…', and there is no excluded notice when rates exist. After reverting, net worth ≈ 1000 + 100 × EUR→USD. No account or transaction `currency_code` changed (check via `GET /api/wealth/accounts`).
6. **Screen sweep after a currency change.** Throwaway business workspace in EUR with a bank, a Space (€100), a credit card (€1,000 owed), a rule (€50) and a budget (€500); change the currency to USD on `/organizations`. — `/spaces` headline '€100.00' (not $). `/wealth?tab=cards` strip owed '€1,000.00'. `/recurring` '−€50.00'. `/budgets` row labelled € (or re-denominated per the decision). `/wealth` net worth converts EUR→USD with ≈ lines.
7. **Budgets with a foreign expense.**
   - INR workspace: create a USD account, add a $50 Groceries expense today, open `/budgets`, then `/budgets/:groceries`. The row shows about ₹4,150 of ₹10,000 with no $ in it. The detail's Recent row shows $50.00 (optionally ≈ ₹4,150), not ₹50.00.
   - Change the workspace currency INR → EUR in `/organizations`, then open `/budgets` and `/budgets?tab=analytics`. Per the chosen policy: no '€50,000' re-denominated limit, no € symbol on INR figures, and allocation is not added up across currencies.

8. **Cards in a foreign currency.**
   - EUR workspace with an INR bank (₹20,000) and a debit card on it: the `/wealth?tab=cards` tile, the phone fan and `/wealth/cards/:id` show '₹20,000.00' everywhere. After adding a ₹500 purchase via 'Add purchase' (amount field prefixed ₹), the row reads '−₹500.00' and 'Spent this month ₹500.00'.
   - Pay a EUR credit card from the INR bank via the Pay sheet: 'Amount leaving <bank> (INR)' appears, and the rate line reads '1 INR = €0.0108' for 100/9300. After saving, the card shows €900.00 owed and the bank ₹10,700.00.
   - Reporting switch USD → INR on a workspace with a USD credit card (limit $2,000, owes $500): the card tile, card page and credit panel keep '$500.00 used / $1,500.00 left'. The Cards strip 'Owed' equals `/api/wealth/summary` `card_liabilities` (≈ ₹47,939 at INR→USD 0.01043).

9. **Tag delete with records, through the UI.** Extend `multi-currency.spec`: `/categories?tab=tags` delete-with-records, the `/trash` restore button and `/wealth` balances. — After the delete: MC EUR 1,000.00 EUR, MC INR 10,000.00 INR. After restore: 898.00 / 19,000.00, with a success toast. Do not reverse in e2e (reversal chains are immutable and pile up).
10. **Debts.**
    - Rework the `/wealth` net-worth test in `e2e/debts.spec.ts` to read `/api/wealth/summary` and add a USD loan fixture. The net-worth text equals `summary.net_worth`, and the 'Liabilities' chip equals `summary.debts_owed` formatted in `reporting_currency`.
    - From `/recurring`, create a payment from a USD bank in an EUR workspace plus a new debt of 10,000. The balance input prefix is '$' and preview amounts are in $. The created debt has currency USD, and `/debts/:id` shows $10,000.00.

11. **Recurring rules show the paying account's currency.**
    - USD personal workspace: create 'MC Netflix', 12 monthly, paid from `e2e-ux4-mc-eur`, starting 2 months ago (backdated). The dialog prefix is '€' and the preview reads '€144.00' a year. The toast says 3 transactions were created. The `/recurring` row reads '−€12.00'. `/recurring/:id` shows Each payment '−€12.00', Posted so far '−€36.00' (3 payments) and rows '−€12.00'. The dashboard Recurring card headline includes '€12.00'.
    - Re-point the same rule to `e2e-ux4-mc-inr` through the edit dialog. The dialog shows ₹ and asks to confirm the amount. After save, `GET /api/recurring/:id` has `currency_code 'INR'`. Posted so far shows per-currency parts, never a single '$' figure.
    - `/recurring` → Add recurring → Pay with IDFC NRO. The amount prefix is '₹', the preview line is in ₹, and a ₹1,500 rule's row shows '−₹1,500.00'.

12. **Spaces in a foreign currency.**
    - An EUR Space of €200 (goal €500) in a workspace switched to INR, on `/spaces` and `/spaces/:id`. The card, detail balance and history rows show €, the goal reads '€200 / €500', and total saved is not '₹200'.
    - Delete a EUR Space holding €200 when the default destination is INR. The dialog asks for the received ₹ amount (or offers only EUR accounts) and closes the Space without a raw English error.

13. **AI quick add and the voice assistant.**
    - Desktop, EUR workspace with an INR account. `page.route('**/api/ai/parse-transaction')` returns `{fields:{type:'outgoing', kind:'standard', amount:500, account_id:<IDFC id>, …}, confidence:{amount:0.9, account:1, …}, remaining:100}`. Open Add transaction → ✨ → type → send. The allocation shows IDFC NRO with ₹ and 500. After Save the toast reads 'Expense of ₹500.00 added'. _Today €500.00 (unverified, low)._
    - Mobile project with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. `page.route('**/api/ai/assistant')` returns an `add_transaction` payload on IDFC NRO, amount 500. Tap the orb and stop recording. The review card headline reads 'Creating outgoing transaction of ₹500.00' and the amount row ₹500.00.
    - Same stub, but a transfer from IDFC NRO (INR) to Visa Gold (EUR), amount 100. The card asks for the received EUR amount (or offers the transfer wizard) and never shows the generic 'Something went wrong'. Save posts `destination_amount`.
    - Assistant stub with `fields.currency='USD'` while the only accounts are EUR (after the fix). The amount renders as an editable input with a 'you said USD' hint, and Save is disabled until confirmed.

14. **The transactions list keeps native rows and converts the strip.**
    - USD workspace: a EUR 5 expense. The row shows −€5.00. The strip Expenses shows the converted $ value, and after a delete it drops by that converted value (matching a reload).
    - INR workspace: a back-dated AED expense (60 days ago) on an AED wallet. The row shows the native AED amount, `data-testid=fx-excluded` is visible with count 1, and the strip totals exclude it.

15. **The excluded notice is translated text, never the raw key.** Triggers: `page.route` mocking `/api/analytics` with `excluded_count: 2`; an AED wallet expense dated 2025-01-15 (before any AED snapshot) in a USD workspace; or the MNT row in the fixture. Check `/transactions` and `/analytics`. — `[data-testid=fx-excluded]` is visible, contains the count ('2' or '1') and the localised sentence (en: '1 entry in another currency is not included (no exchange rate yet)'), and never contains `'fx.excludedNotice'`. Repeat with `profitsync-language` = `ar`, `ml` and `de` (German translation). _Fails today._
16. **Wealth screen natives vs approximations** (matrix fixture). — INR tile '₹1,13,400.00' + '≈ €1,417.50'. JPY tile '¥17,000' + 'stale'. KWD 'KWD 10.000'. Net worth '€2,985.50', with 'By currency' listed.
17. **Dashboard and Analytics agree.** Set the Analytics custom range to cover all data. — Dashboard 'Total revenue' equals Analytics 'Total income', and 'Total expenses' equals 'Total expense'. _Today:_ $2,943.70 vs $0 in the e2e personal workspace.
18. **Shortfall alert in the account's currency.** Extend `multi-currency.spec`: an INR account in a USD workspace plus an INR rule that creates a shortfall; open `/dashboard`. — `[data-alert=charge_shortfall]` contains '₹15,000.00' and '₹3,000.00' and no '$'. With balance privacy on it shows '₹ *****'.
19. **Tx-form budget hint in a foreign currency.** `/transactions` → Add Transaction → Outgoing → IDFC NRO → 2000 (Groceries). — The hint shows ≈ €881.60 left, not '€1,100.00 over'.
20. **TransferWizard re-suggests after a destination change.** EUR → INR, amount 500, edit received to 51,350, then switch the destination to a USD account. — The received field is cleared or re-suggested at the EUR→USD rate. Step 2 never shows '$51,350.00'.
21. **Currency picker is disabled when locked.** Extend `multi-currency.spec` with a wallet that has a recurring rule, a non-zero balance, or only trashed rows. — The combobox has the `disabled` attribute, and the localised `accountCurrencyLocked` hint is visible.
22. **Refusals are translated.**
    - Set `profitsync-language='ar'`, reload, then trigger `account_currency_locked` through the edit dialog (trashed-history setup). The toast matches the ar translation of the lock message, contains no `'{'` or `'"code"'`, and is not English. `<html dir='rtl'>`.
    - Language ml: in `TransactionDetailModal` on a transfer leg there is no Edit button (or a description-only edit succeeds). A second reverse shows the ml `transferAlreadyReversed` text.

23. **FX via a fixture provider server.** Point `FX_FRANKFURTER_HOST` / `FX_OPEN_ER_API_HOST` at a fixture server with EUR/USD 1.1616 on 2026-09-10 and no AED history. — A €100 expense dated 2026-09-10 shows $116.16. An AED expense dated 2026-06-01 shows the translated excluded notice on `/transactions` and `/analytics`. A fixture 503 shows the stale badge on `/wealth`.
24. **Old-bundle project.** Build origin/main (v0.14.1) and serve it against the branch API, on a workspace with HDFC ₹50,000 and Revolut €1,000 created by the new UI. — This documents the degradation: `/wealth` net worth ₹51,000.00, the Revolut tile ₹1,000.00, and a HDFC → Revolut transfer shows the 'Destination amount is required…' toast. With the gate on, creating Revolut in EUR from the new UI is refused instead.
25. **Mobile layout.**
    - 375 × 667, lang=ml: create a planned transfer €12,500 → ₹12,83,750 via the API and open `/wealth`. The row's Mark done button and ⋮ menu have a `boundingBox` inside the viewport and are ≥ 44 px tall. `document.documentElement.scrollWidth <= window.innerWidth`. Account names are visible (width > 40 px).
    - Pixel 7, in a file named `*mobile.spec.ts`: `/wealth`, `/budgets`, `/transactions` and `/debts` in the fixture org. `scrollWidth <= clientWidth` on every page. Long strings ('₹1,13,400.00', '≈ €1,417.50 · as of …') wrap or truncate. Touch targets are ≥ 44 px.

#### Manual

1. **Rollout 1: check the production watermark before deploying** (read-only on prod). Run `select max(created_at) from drizzle.__drizzle_migrations`. — It must equal 1789303202014 (0068), and dev's 0075 must not have shipped. If it is higher, stop and re-stamp 0069-0074 before deploying.
2. **Deploy rehearsal.** On a Neon branch copied from prod (watermark 0068), run origin/dev's migrations (adds 0075), then this branch's. — Shows the silent skip (`transactions.currency_code` missing). With the post-migrate sentinel, `db:migrate` exits non-zero.
3. **Rollout 2: prod audit** (read-only). Count debts with currency ≠ org currency, debt-linked `recurring_rules` whose payer currency ≠ the debt currency, legacy `kind='transfer'` groups the 0071 backfill will skip, and orgs where `currency` ≠ `reporting_currency` after migration. — Record the counts and make a decision for every non-zero bucket before release.
4. **Rollout 3: after the Vercel deploy.** Run the extended post-deploy probes plus an authed smoke with a prod test account: `GET /api/wealth/summary`, `GET /api/transactions?page=1`, and `POST /api/wealth/transfer` same-currency with the legacy `{amount}` body. — Summary 200 with `complete=true`, transactions 200 with `summary.currency` set, transfer 201 with `group_id`/`attach_to`. The finding that the existing probes cannot catch this was refuted; this step is a smoke test, not a fix for it.
5. **Rollout 4: native, once the API is live.** Run `npm run cap:sync:android` and `npm run cap:sync:ios`, bump Android `versionCode` 20 / `versionName` 1.5.0 and iOS build 10 / `MARKETING_VERSION` 1.5.0, install on the emulator/simulator against prod, and repeat the wealth/transfer checks. — The native app shows €1,000.00 with the ≈ ₹ value, and the cross-currency TransferWizard works. Nothing is submitted to the stores before the API deploy.
6. **Rollout 5: rollback drill** (Neon branch). Apply 0069-0076, create a cross-currency transfer with a fee, run the v0.14.1 API against it, delete one leg, then roll forward. — Confirms the header/fee inconsistency, which justifies a written roll-forward-only policy.
7. **Store 1.4.0 on a real device** against a staging deploy of this branch, with a foreign account created on the web. — The degradations match the compatibility matrix (raw net worth, ₹ labels, transfer refusal). With the gate/ack shim, the old app gets 'update the app' errors instead of writing EUR under a ₹ label.
8. **Real-day check of the recurring stale-currency bug.** Create a rule starting tomorrow on an empty EUR account, switch the account to USD today, and open `/recurring` tomorrow. — After the fix, the currency switch is refused. Before the fix, the posted row shows 'EUR' on the USD account page, which is the bug.
9. **Run the e2e multi-currency suite twice, then the drift query.** — `e2e-ux4-mc-eur` drift stays 0. _Today it grows by 5 per deleted fee transfer._
10. **`scripts/audit-balances.ts` (dry run) against the dev DB.** — Exactly 3 drifted accounts are listed: b06c0468 USD −662.15 (no ledger rows), d02ff2b5 USD −50.00, and bed91dd1 EUR +20.00 (archived). Zero writes (check that fx and wealth `updated_at` are unchanged).
11. **`scripts/relabel-account-currency.ts --org <scratch org> --to INR`**, dry run then `--apply`. — The dry run prints per-currency native totals before and after, with identical digits. Apply updates the currency tags on `wealth_accounts`, `transactions`, `recurring_rules`, `debt_details` and `transfers` in one batch, writes one `audit_logs` row per account, and leaves every amount unchanged. It refuses when a cross-currency transfer touches the account.
12. **First request of a UTC day** for a workspace with 2 years of EUR and INR history: time `GET /api/transactions`. — Under 2 s (only missing days written). _Today about 2 × 730 × RTT (≈ 115 s locally at 79 ms RTT)._
13. **Change the reporting currency USD → EUR** on `/organizations`, immediately open `/dashboard` and `/analytics`, then revert. — No figure is ever labelled € while holding USD values, and no USD figures remain after the change.
14. **Change the workspace currency EUR → USD with only EUR debts**, then open the `/debts` overview, Plan and Upcoming. — Month stats and insights stay in € (or per currency). The planner explains foreign debts with a correct message, or plans them per currency.
15. **Budget alert when a USD expense pushes an INR Groceries budget over.** — The bell shows 'Groceries has gone over its monthly budget (₹10,4xx of ₹10,000)' in INR.
16. **Bell and push for card notifications in a multi-currency workspace:** a statement on an INR card in a EUR workspace, and a card due-soon push (FCM/web push) on a phone. — The amount carries its currency ('₹50,000.00', e.g. 'Visa •••• 4577: ₹1,800.00 due …'), not a bare '50000.00'. _(Unverified, low.)_
17. **Quotation PDF after a reporting change** (S3 and worker configured). A EUR quotation of 12,000 with a generated PDF; switch reporting to INR and open the PDF modal. — The PDF is not marked stale and still reads 'EUR 12,000.00'. The list still shows €12,000.
18. **AI currency handling.**
    - Voice/AI assistant: 'spent 50 on groceries' with IDFC NRO as the default/matched account. The confirm card shows '₹50.00' and names IDFC NRO. If the user says '50 euros', Save is blocked or the account switches to a EUR one.
    - Live Gemini parse (read-only, via a scratch script calling `parseTransaction` on the EUR dev org) of 'spent 20 dollars on lunch', 'spent 500 rupees on lunch from IDFC NRO' and 'paid 100 to Visa Gold from IDFC NRO'. After the fix the currencies come back as USD / INR / null (or INR), and the USD entry is not auto-assigned to a EUR account. _Today:_ `{20, conf 1.0, no account}`, `{500, IDFC, conf 0.8}`, `{100 transfer INR→EUR}`.

19. **Native parity after the fixes.** Run `npm run cap:sync:android` and `cap:sync:ios`, then run the emulator and simulator against a server with this branch (fixture org). — `/wealth` shows the 'By currency' section and ≈ lines on foreign tiles. `/wealth/cards/:id` shows ₹ on the INR card with the translated excluded notice. The TransferWizard shows received and fee fields. `/transactions` and `/trash` show the same native symbols and converted strip as web, with no horizontal scroll at 360 px. Running the old store build against the same server documents the raw-sum and mislabel behaviour, which feeds the gating decision.
20. **Run the i18n gates after adding error codes for the currency-blocked states.** — `npm run i18n:check` and `i18n:hardcoded` pass, and the ml and ar screens show translated blocked-rule reasons.

