import { inArray, sql, type SQL } from "drizzle-orm"
import { transactions, wealthAccounts } from "../../src/lib/db/schema.js"

// The SQL twins of src/lib/tx-classify.ts — the ONE definition of how a
// transaction row counts as income or expense in every aggregate (analytics,
// money flow, calendar, the transactions summary, client totals). Keep the two
// files in lockstep; tx-sql.test.ts renders these to SQL and asserts the rules.
//
//   income  = Σ amount  where type='incoming' and kind='standard'
//   expense = Σ amount  where type='outgoing' and kind='standard'
//           − Σ amount  where kind='refund'          (a refund reverses spending)
//
// Transfers (kind='transfer') — including credit-card payments — contribute to
// neither, so a card purchase is counted exactly once, when it happens, and the
// payment that later settles it is never a second expense. System
// balance-defining rows are excluded by the caller's `is_system = false`
// predicate (kept as a separate, greppable condition — see budget-spend.test.ts).

/** Reported income: standard incoming rows only (refunds and transfers are not income). */
export const incomeSumSql = sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' and ${transactions.kind} = 'standard' then ${transactions.amount}::numeric else 0 end), 0)`

/** Reported expense: standard outgoing rows, net of refunds. Can go negative in a window that only saw refunds. */
export const expenseSumSql = sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' and ${transactions.kind} = 'standard' then ${transactions.amount}::numeric when ${transactions.kind} = 'refund' then -${transactions.amount}::numeric else 0 end), 0)`

/** Rows that take part in P&L at all (drop transfers). Pair with `eq(transactions.isSystem, false)`. */
export const pnlKindFilter = inArray(transactions.kind, ["standard", "refund"])

/** The kinds a client may submit when creating/editing a transaction (transfers only come from the transfer endpoint). */
export const USER_KINDS = ["standard", "refund"] as const

// ── Reporting-currency twins ─────────────────────────────────────────────────
// The same definitions with every row converted AT ITS OWN DATE into the
// workspace's reporting currency by reporting_amount() (mig 0074): identity
// for rows already in that currency (or rows that predate currency tagging),
// NULL when no rate is stored for that day. A NULL is EXCLUDED from the sum
// (SQL sum skips it) — so every caller must also select
// `missingRateCountSql(reporting)` and surface the count as "excluded", never
// present a partial total as complete.
//
// The `*In(target)` helpers take the TARGET currency: the workspace's reporting
// currency for every report, a budget's own currency for its spend.

/**
 * `amount` converted at `on` into `target`, or NULL when the rate is unknown.
 * The general form — the transactions-row shorthand is `reportingAmountSql`,
 * and `accountBalanceInSql` converts an account balance at today's rate.
 */
export const convertedSql = (amount: SQL | typeof transactions.amount, currency: SQL | typeof transactions.currencyCode, on: SQL | typeof transactions.date, target: string) =>
  sql<string>`reporting_amount(${amount}::numeric, ${currency}, ${on}, ${target})`

/** A transaction row's `amount` in the target currency, or NULL when the rate is unknown. */
export const reportingAmountSql = (target: string) =>
  convertedSql(transactions.amount, transactions.currencyCode, transactions.date, target)

/**
 * "this row could not be converted": tagged with a foreign currency and no rate
 * stored for its day. Pair with the count below, or use directly to flag one row.
 */
export const missingRateSql = (target: string) =>
  sql<boolean>`(${transactions.currencyCode} is not null and ${transactions.currencyCode} <> ${target} and fx_rate_on(${transactions.currencyCode}, ${target}, ${transactions.date}) is null)`

/** Reported income in the target currency (rows without a rate are skipped — count them). */
export const incomeSumSqlIn = (target: string) =>
  sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' and ${transactions.kind} = 'standard' then ${reportingAmountSql(target)} else 0 end), 0)`

/** Reported expense in the target currency, net of refunds (rows without a rate are skipped — count them). */
export const expenseSumSqlIn = (target: string) =>
  sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' and ${transactions.kind} = 'standard' then ${reportingAmountSql(target)} when ${transactions.kind} = 'refund' then -${reportingAmountSql(target)} else 0 end), 0)`

/**
 * How many P&L rows in the aggregate could NOT be converted (foreign currency,
 * no stored rate for that day). Only standard + refund rows are counted — a
 * transfer leg is in no total, so its missing rate excludes nothing.
 */
export const missingRateCountSql = (target: string) =>
  sql<number>`count(*) filter (where ${transactions.kind} in ('standard', 'refund') and ${missingRateSql(target)})::int`

/**
 * A wealth account's stored balance in the target currency AT TODAY'S rate
 * (ensureRatesForOrg files today's market rate under today's date), or NULL
 * when none is stored. Sum these for a consolidated balance and count the NULLs.
 */
export const accountBalanceInSql = (target: string) =>
  sql<string>`reporting_amount(${wealthAccounts.currentBalance}::numeric, ${wealthAccounts.currencyCode}, current_date, ${target})`

/** How many accounts in the aggregate have no rate into the target currency today. */
export const missingAccountRateCountSql = (target: string) =>
  sql<number>`count(*) filter (where ${wealthAccounts.currencyCode} is not null and ${wealthAccounts.currencyCode} <> ${target} and fx_rate_on(${wealthAccounts.currencyCode}, ${target}, current_date) is null)::int`
