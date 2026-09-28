# Ledger export & statement import

> Design for **MC-170**: a currency-aware CSV export of the ledger and a CSV
> bank-statement import into one account. **Status: proposal, nothing is built
> yet.** Companion to the future `src/lib/csv.ts` (pure reader/writer),
> `src/lib/import-map.ts` (pure column mapping) and `api/_lib/ledger-export.ts`
> (the export query). The multi-currency model it relies on is
> `docs/multi-currency/ARCHITECTURE.md`; the open decision it closes is D76 in
> `docs/multi-currency/IMPACT_ANALYSIS.md`.

**An export is a statement of native facts. Reporting figures are annotations
on each row, never a total that mixes currencies. An import writes native facts
into ONE account, in that account's currency, through the same guards as every
other write.**

---

## 1. Why this is a feature, not a fix

Nothing exists to repair. There is no ledger export and no importer anywhere in
`api/`, `src/` or `worker/`. The only trace is a commented-out
`r.Register("csv.export", …)` in `worker/app/internal/jobs/jobs.go:63`, and
`docs/multi-currency/STATUS.md` records "No active financial importer". The
fix waves (1–7) only repaired code that existed, so MC-170 stayed a requirement
for whoever builds the feature: *never one total column that mixes currencies;
every row carries its native amount, currency, reporting amount, rate date and
an excluded flag; a footer counts what could not be converted.*

It also cannot be done as an edit to existing code: the **rate date** that the
contract asks for is produced by nothing today (§3).

## 2. What already exists that the feature stands on

| Need | Already in the codebase | Gap |
|---|---|---|
| Per-row reporting amount | `reportingAmountSql`, `fxRatesFor` / `fxFor` / `withFx` (`api/_lib/tx-sql.ts`) — one `fx_rate_on` per distinct (currency, date), ~95 ms at 30k rows | none |
| "Excluded" definition | `missingRateSql` per row, `missingRateCountSql` for P&L rows (`api/_lib/tx-sql.ts`) | the export must say which of the two its footer counts |
| Rate date of each conversion | — | **missing**: `fx_rate_on()` returns only the rate (`drizzle/0078_fx_rate_lookup.sql`) |
| Filters | the `/api/transactions` where-builder (`api/_routes/transactions.ts`) | inline in the route; its `clientId` branch silently drops every other filter |
| Download headers | `setDownloadHeaders` (`api/_lib/attachments.ts`) — attachment disposition, `nosniff`, sandbox CSP, `csv → text/csv` | none |
| Web download | fetch → blob → `<a download>` (`src/lib/pdf-open.ts`) | none |
| Native download | `Browser.open` on a presigned S3 URL (quotation PDFs only) | **no way to save an app-generated file** — see §6 |
| Atomic multi-row write with balance moves | writable CTE + `balanceShiftSql(ledgerMovesSql(…))` (`api/_lib/tx-legs.ts`), as POST `/api/transactions` and the recurring materializer do | no bulk create route |
| Idempotent insert | `transactions_recurring_once_idx` + `onConflictDoNothing` in the materializer | no import key on `transactions` |
| Amount rules per currency | `moneyRefusal` / `AmountProblem` codes (`src/lib/money.ts`) | sign not enforced (§10) |
| Row currency = account currency | deferred FK `transactions_account_currency_fk` (0081) + fill triggers (0082) | none |
| CSV parsing / writing | — | no library installed; a small pure helper is less code than a dependency |

## 3. The rate date — migration first

`fx_rate_on(from, to, on)` picks the newest observation within 10 days up to
`on`, in either direction, with a fixed tie order (manual, non-fallback,
strong side, direct, newest fetch), and throws away which row it chose. An
export that prints "the rate used" next to a different rate date than the one
actually used is worse than no column, so the date must come from the **same
rule**, not a TypeScript copy of its `ORDER BY`.

Migration **0083** (hand-written, additive, journal entry appended last with
`when = Date.now()` — the `migrations` skill):

- `fx_rate_observation(p_from text, p_to text, p_on date) RETURNS TABLE(rate numeric, rate_date date, source_type text, provider text, is_fallback boolean)` — 0078's candidate set and `ORDER BY`, `LIMIT 1`.
- `fx_rate_on(...)` redefined as `SELECT rate FROM fx_rate_observation(...)`, so there is ONE rule. Measure first: if the table function is measurably slower per call, keep 0078's body and pin the two together in a test instead.
- `api/_lib/tx-sql.test.ts` pins the text of 0078; the pin moves to 0083.
- In the export, the rate CTE is `fxRatesFor`'s, selecting `rate_date`, `source_type` and `is_fallback` as well (export-only; aggregates keep the scalar).

## 4. Export

### 4.1 Rows

**One row per ledger leg, flat.** The global transaction list collapses split
groups (`groupedRows`) and, for a mixed-currency split, reports one amount in
the reporting currency — an export built on the list would be exactly the
mixed total MC-170 forbids. The export selects legs.

Included by default: standard rows, refunds, transfer legs, transfer fee and
fee-refund rows, and system rows (Opening Balance, Balance Adjustment) — they
are part of the ledger and are told apart by `pnl_class`. Excluded: trashed
rows. Closed clients follow the list's `includeClosed`. Debt accounts follow the
list (their rows are visible there today).

### 4.2 Column contract

Header names are **stable English `snake_case`**, defined once in a shared
constant: they are a data contract (and the import's round-trip format), not UI
copy. Only the dialog around the download is translated.

| Column | Meaning |
|---|---|
| `date` | the row's date, ISO `YYYY-MM-DD` (zone-free, as stored) |
| `transaction_id` | the row's id |
| `type` | `incoming` / `outgoing` |
| `kind` | `standard` / `refund` / `transfer` |
| `pnl_class` | `income` / `expense` / `refund` / `transfer` / `system` — the `src/lib/tx-classify.ts` rules |
| `account`, `account_type` | the account's display name and type |
| `account_currency` | `wealth_accounts.currency_code` (blank only for a legacy row without an account) |
| `card_last4` | the paying card, if any |
| `client` | business workspaces; always present, empty in a personal workspace (stable schema) |
| `category`, `tags`, `description` | as stored |
| `amount` | **native**, signed from the account's point of view (incoming +, outgoing −), dot decimal, no grouping, `moneyDecimals(currency_code)` places |
| `currency_code` | the row's own currency — never blank: a legacy NULL is written as its account's (or the workspace's) currency, never as an implied reporting currency (MC-123) |
| `reporting_currency` | the workspace's reporting currency at export time |
| `reporting_amount` | the row converted at its own date; blank when excluded; `moneyDecimals(reporting_currency)` places |
| `fx_rate` | the native→reporting multiplier actually used, full precision (so `amount × fx_rate` reproduces `reporting_amount` to the cent); `1` for a same-currency row |
| `fx_rate_date` | the observation date of that rate (§3) — may be up to 10 days before `date` |
| `fx_rate_source` | `identity` / `market` / `historical_market` / `manual` / `fallback` |
| `excluded` | `true` when the row is foreign and no rate exists for its date |
| `group_id`, `transfer_id` | ledger grouping |
| `transfer_role` | `out` / `in` / `fee` / `fee_refund` for rows of a logical transfer |
| `counterpart_account` | the other side of a transfer leg |
| `transfer_effective_rate` | the rate the bank actually gave (transfer header), beside the market `fx_rate` |
| `reverses_transfer_id` | set on a reversal's rows |

Not exported, ever: account/routing numbers, client email/phone/notes,
attachments, Clerk user ids.

### 4.3 Footer

After the data rows, **one blank line, then `key,value` lines** (the importer
stops at the first blank line):

- `generated_at`, `rates_as_of` (a manual rate or a backfill can change a past conversion; the export states its moment), `reporting_currency`, the filters used, `rows`.
- **Per currency, native**: `income_<CUR>`, `expense_<CUR>` (refunds net against expense), `transfers_in_<CUR>`, `transfers_out_<CUR>`.
- **Reporting**: `income_reporting`, `expense_reporting` over P&L rows that converted.
- `excluded_pnl_rows` — the same definition as the screens' `excluded_count` (standard + refund, non-system), so the file and the dashboard agree — and `excluded_rows` (every leg without a rate, transfers included).

Never a single total over mixed currencies. The footer is summed **in
TypeScript with Decimal over the streamed rows**, so no new SQL `sum(` is added
and the MC-121 allowlist in `api/_lib/tx-sql.test.ts` stays as it is.

### 4.4 Format

UTF-8 **with BOM** (Excel shows Malayalam and Arabic correctly), comma
delimiter, RFC 4180 quoting, CRLF line ends. Numbers never go through
`formatMoney` / `moneyLocale` — no grouping, no locale decimals, no bidi marks.

**Formula injection:** any TEXT cell (`description`, `category`, `tags`,
`account`, `client`, `counterpart_account`) that, after leading whitespace,
starts with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'` and quoted.
Number cells are never touched — they come from a formatter that can only
produce `^-?\d+(\.\d+)?$`, safe by construction. One pure helper in
`src/lib/csv.ts`, one test file.

Filename: `profitsync-<workspace-slug>-<from>_<to>-<REPORTING>.csv`.

### 4.5 Route

`GET /api/transactions/export` — a static route registered before
`["transactions", ":id"]`.

1. `requireAuth`; every role may export (a viewer can already read every row through the list). `rateLimit("export:" + userId, 10, 60_000)` → 429 `rate_limited`.
2. `materializeDueRecurring` + `syncCards`, as the list does, so a due rent appears in the file. This makes it a side-effecting GET; the `/api/transactions` prefix already puts it in `ALWAYS_FETCH`, which keeps `cache:check` green.
3. `reportingCurrencyFor` + `ensureRatesForOrg`. Rows older than the request fill window (31 days) depend on the daily FX refresh; the dialog says so when `uncovered` is not empty.
4. Filters: the **same parameter names as the list** (`search`, `type`, `category`, `tag`, `from`, `to`, `includeClosed`, `wealthAccountId`, `cardId`, `clientId`), through a where-builder extracted from `api/_routes/transactions.ts` into a shared helper — so the list and the export can never disagree, and every filter applies in every scope. UUID-shaped params are validated.
5. Read in keyset chunks on `(date, created_at, id)` (Neon HTTP has no cursors) and `res.write` each chunk; one rate CTE per chunk scoped to that chunk.
6. A hard row cap sized to the platform's response limit (~20k rows): above it, 413 `export_too_large` with "choose a shorter date range". The cap — not a guess — is what would justify an async worker job (§9).
7. `?dryRun=1` answers JSON `{ rows, excluded_pnl_rows, excluded_rows, uncovered }` for the dialog, without the file.
8. `logAudit({ entityType: "export", entityId: orgId, action: "export", changes: { filters, rows, excluded_pnl_rows } })` — never row contents. The audit unions in `api/_lib/audit.ts` gain the two values; the columns are plain text, no migration.

Plans: **free on every plan.** The privacy policy already promises an export
right (`src/pages/PrivacyPolicyPage.tsx`); charging for portability is a trust
and legal risk.

## 5. Import

### 5.1 Scope

A CSV bank (or card) statement into **one existing account**. The account
decides the currency of every row; a currency column in the file is only a
check. The import never creates accounts, transfers, debts, Spaces or system
rows.

### 5.2 Flow (client)

A wizard on the `AddCardWizard` shell (bottom sheet on mobile, dialog on
desktop, `useBackClose`, mounted closed then opened):

1. **Account** — `AccountCombobox`; Spaces, loans/receivables and archived accounts are not offered. Shows the currency and, on a free plan, the remaining transaction headroom.
2. **File** — `<input type="file" accept=".csv,text/csv">` (works in both native shells). Parsed client-side by `src/lib/csv.ts`: BOM, delimiter detection (`,` `;` TAB), RFC 4180, and stripping of U+200E/U+200F/U+061C, NBSP and U+202F.
3. **Map** — which column is the date, the amount (or debit + credit), the description, optionally category, reference and currency. **Decimal separator and date format are confirmed by the user**, pre-filled from the UI language (`de`/`it`: `;` and comma decimals). An ambiguous date (`03/04`) is never guessed. Mappings are remembered per account in `localStorage` (a convenience, not state).
4. **Preview** — every row with a status: `ok`, `duplicate` (already imported), `possible match` (an existing row that looks the same — §5.4), or an error code. Amounts are normalised to a positive value plus `type`; a bank's signed value is never passed through.
5. **Confirm** — posts in chunks; shows `{ created, skipped_duplicates, excluded_rate_rows }` and an **Undo this import** action.

Parsing and mapping are pure (`src/lib/csv.ts`, `src/lib/import-map.ts`), so
they are unit-tested DB-free like every other `src/lib` model.

### 5.3 Route

`POST /api/transactions/import` — static, before `["transactions", ":id"]`;
the existing `FANOUT` rule for `/api/transactions` already invalidates the
right reads.

Body: `{ wealth_account_id, client_id?, import_id, rows: [{ date, amount, type, kind, description, category, reference?, key }] }`,
at most **500 rows per request** (well under the request-body and bind-parameter
limits); the client chunks larger files.

Checks, before anything is written:

- `canWrite(role)` → 403; `rateLimit("import:" + userId, 5, 60_000)` → 429.
- The account: in the org, not archived, not a Space or debt account, currency present, a frozen/closed credit card refused (`attributeCard` once for the account).
- Business workspaces: `client_id` required, in the org, **not closed**.
- Per row: `date` is a real calendar date (`date_invalid`); `amount` passes `moneyRefusal(account.currencyCode, …)` **and is positive** (`amount_not_positive`); `kind` is `standard` or `refund` (`kind_not_allowed`); a refund is incoming; a mapped currency equal to the account's (`currency_mismatch`). The answer lists `{ index, code }` per refused row; every code gets an `apiErrors.<code>` translation.
- Quota: ONE check, `current + rows.length > limit`, counting non-system rows like `checkTransactionQuota` → 402 for the whole chunk. Never a partial chunk. (A free personal workspace holds 30 rows in total, so in practice an import there is a few rows; the wizard says so in step 1 instead of adding a new plan flag.)

Write: **one atomic statement** — the rows travel as one JSON parameter:

```sql
with created as (
  insert into transactions (...)
  select ... from jsonb_to_recordset($1::jsonb) as r(...)
  on conflict (wealth_account_id, import_key) where import_key is not null do nothing
  returning id, wealth_account_id, type, amount, is_system
), moved as (<balanceShiftSql(ledgerMovesSql("created", "create"), userId)>)
select id from created
```

All-or-nothing, no bind-parameter ceiling, and **only rows actually inserted
move the balance** — so a retried chunk is safe. `currency_code` comes from the
account; the deferred FK still guards a currency change mid-request (→ the
central 409 mapping in `api/index.ts`).

After the write: one audit entry (`entityType: "import_batch"`, `entityId:
import_id`, `changes: { account, rows, skipped }`), one
`notifyIfBudgetExceeded`, and for a foreign account a best-effort
`ensureHistoricalRates(currency, reporting, minDate)` so back-dated rows stop
showing as excluded sooner.

### 5.4 Duplicates

Migration **0084** (additive): `transactions.import_key text`,
`transactions.import_id uuid`, a partial unique index
`(wealth_account_id, import_key) WHERE import_key IS NOT NULL`, and an index on
`import_id`.

- `import_key` = the bank's reference when one is mapped; otherwise
  `sha256(account | date | amount at moneyDecimals | type | normalised description | ordinal)`,
  where the ordinal numbers identical tuples within the file — two coffees on
  the same day are two rows, and re-importing the same file still matches both.
- A trashed row keeps its key, so a re-import skips it. Deliberate: what the
  user deleted stays deleted.
- **Soft matches**: rows the import did not create (a materialized recurring
  payment, an autopay transfer, a hand-entered row) are found by a read-only
  probe — same account, same amount and type, ±3 days, no `import_key` — and
  shown as "possible match". Default: skip. **Never merged automatically**
  (`docs/multi-currency/ARCHITECTURE.md`: propose a match, never silently merge).

`import_id` is what **Undo this import** trashes, through the claim-first
`setRowsTrashed` (`api/_lib/tx-trash.ts`), gated by `canDelete` — not
bulk-delete, whose 200-id cap a statement exceeds.

### 5.5 Credit cards and transfers

- A card statement imports into the card's liability account: purchases, fees and interest are outgoing `standard` rows (`attributeCard` adds `card_id`); merchant credits are incoming `refund`s.
- **Payment lines are not imported as rows.** A card payment is a transfer from a bank, which needs the other account; the preview marks them and offers to record each through the transfer flow, warning when autopay already posted that payment.
- Lines that look like a transfer between the user's own accounts are marked the same way. Automatic pairing of two imported legs is deferred.
- A back-dated purchase into a cycle whose statement is already filed does not change the filed `statement_balance` (filed statements are snapshots — `docs/credit-cards/CREDIT_CARDS.md`).

### 5.6 Categories

`transactions.category` is free text. The wizard maps a category column when
there is one; otherwise it suggests, deterministically, the category the
workspace used before for the same normalised description, then the
`categories` list. **No AI call per row** (5 credits a row against a 500-credit
free grant); one optional AI call to map columns from the header and a few
sample rows is deferred.

## 6. Native apps

Blob-anchor downloads do nothing in the Capacitor WebViews (no
`DownloadListener` on Android, no `WKDownloadDelegate` on iOS — the note at the
top of `src/lib/pdf-open.ts`), and `Browser.open` cannot send an
`Authorization` header. The quotation PDF works only because the worker
uploads the file to S3 and the app opens a presigned URL; the app itself holds
read credentials and cannot upload an export.

**Proposed:** add `@capacitor/filesystem` and `@capacitor/share`. On native the
client fetches the CSV with the usual headers (`fetch` runs over
`CapacitorHttp`), writes it to the cache directory and opens the share sheet
(Files, Drive, mail…). Feature-detected with `Capacitor.isPluginAvailable`; the
Export entry is simply absent on a build without the plugins. Every build that
shows the new button is a new build anyway (the store is the only native update
path), so the plugins cost nothing extra in reach. `npm run cap:sync:android`
and `npm run cap:sync:ios` plus a store release.

The same two plugins fix today's native downloads of attachments and invoice
PDFs (§10), which use the blob-anchor pattern.

Alternative considered: a short-lived, single-purpose signed export link opened
with `Browser.open`. No plugins, but a second, token-authenticated route that
the route-guard sweep (`scripts/check-route-guards.mjs`) would have to exempt,
and a signing secret to manage. Rejected unless plugins are ruled out.

Import needs nothing native: a file input works in both shells.

## 7. UI

- `/transactions`: an overflow menu (`MoreVertical` in a `DropdownMenu`, ≥44 px on mobile) beside Add, with **Export CSV** and **Import statement**. The toolbar row stays as it is — it already has to fit search and filters at phone width.
- **Export dialog**: the filters that will apply (the page's current ones, sent with the same names it sends to the list), the date range, then the `dryRun` counts: "1,204 rows · 3 couldn't be converted", plus a line when old history is still waiting for rates. Download.
- **Account detail and card pages**: Export scoped to that account/card (the list already scopes there by `wealthAccountId` / `cardId`).
- **Delete account / Reset data dialogs**: a "Download your data first" link to the export.
- All UI copy in `transactions.export.*` / `transactions.import.*`, every locale (the i18n gates); the CSV headers and footer keys are NOT translated (§4.2).

## 8. Invariants (tests)

1. **No mixed-currency total anywhere in the file** — `ledger-export.test.ts` builds a file from EUR + INR rows and asserts every amount in the footer is per currency or explicitly reporting.
2. **The column contract is pinned** — header snapshot in `csv.test.ts`; changing a column name is a deliberate, versioned change.
3. **`fx_rate_date` comes from the same rule as the conversion** — `api/_lib/tx-sql.test.ts` pins 0083: `fx_rate_on` is `fx_rate_observation`'s rate.
4. **`amount × fx_rate` reproduces `reporting_amount`** to the reporting currency's places for every non-excluded row.
5. **`excluded_pnl_rows` equals the list summary's `excluded_count`** for the same filters.
6. **Formula injection** — every dangerous prefix neutralised in text cells; a negative number cell never prefixed.
7. **Import is all-or-nothing per chunk, idempotent on retry** — the same chunk twice creates its rows once and moves the balance once.
8. **Import never writes a row in another currency than its account**, and never a negative or zero amount.
9. **The import key is deterministic** and distinguishes identical lines by ordinal.
10. **The MC-121 allowlist does not grow** — the footer is summed in TypeScript.

All DB-free (pure helpers and pinned SQL); live checks run as throwaway
scripts against a throwaway workspace, as in the multi-currency waves.

## 9. Deferred

A full account export (clients, quotations, accounts, attachments) for data
portability is a larger, separate scope. Other formats (XLSX, OFX, QIF, CAMT.053),
an AI column-mapping assist, automatic pairing of transfer legs, scheduled
exports, and creating an account inline from the import are all left out. An
async `csv.export` worker job is built only if the synchronous row cap (§4.5)
is actually hit: the worker never reads the app database and cannot run the FX
functions, so it would need an internal paged rows endpoint with a per-export
capability, a `ledger_exports` table, a callback and an S3 retention rule —
none of which a CSV the app can write in well under a second justifies today.

## 10. Found while designing (existing defects, not part of this feature)

- **`POST /api/transactions` accepts a negative amount.** `moneyRefusal` calls
  `ledgerAmount(…, positive = false)`, and a negative outgoing row is applied as
  `-(−x)`, raising the balance. There is no `amount > 0` CHECK on
  `transactions`. Fix: refuse `amount_not_positive` on every transaction write.
- **No date validation on transaction writes.** `date ?? today` reaches
  Postgres as given; a malformed date is a 500. Fix: validate a real calendar
  date and refuse `date_invalid`.
- **Native downloads of attachments and invoice PDFs do nothing** (blob anchor
  in a WebView; `window.open` on a blob for invoices). Fixed by §6's plugins.
- **The group write's free-plan quota counts system rows**, while
  `checkTransactionQuota` does not, so the two create paths disagree near the
  limit.

## 11. Open questions

1. Footer as a trailing `key,value` section (proposed) or a separate summary file?
2. Signed `amount` (proposed — what spreadsheets and bank files use) or unsigned plus `type`?
3. Native strategy: plugins + share sheet (proposed) or a signed link?
4. Should import on the free plan be offered at all, given the 30-row ledger?
