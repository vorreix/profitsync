import { inArray, sql, type SQL } from "drizzle-orm"
import type { PgSelect } from "drizzle-orm/pg-core"
import { clients, transactions } from "../../src/lib/db/schema.js"

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

/**
 * Income / expense in the rows' OWN currency, for a scope that holds one — an
 * account's rows all post in its currency, so its own page shows them natively
 * instead of as an approximation in the reporting currency (MC-009).
 * `currency` is NULL when the rows span several currencies (or a legacy row
 * carries none); the sums mean nothing then and must not be shown.
 */
export const nativeSummarySql = {
  incoming: incomeSumSql,
  outgoing: expenseSumSql,
  currency: sql<string | null>`case when count(distinct ${transactions.currencyCode}) = 1 and count(${transactions.currencyCode}) = count(*) then max(${transactions.currencyCode}) end`,
}

/** The kinds a client may submit when creating/editing a transaction (transfers only come from the transfer endpoint). */
export const USER_KINDS = ["standard", "refund"] as const

// ── Reporting-currency twins ─────────────────────────────────────────────────
// The same definitions with every row converted AT ITS OWN DATE into the
// workspace's reporting currency by reporting_amount() (mig 0074, lookup
// rewritten in 0078): identity for rows already in that currency, NULL when no
// rate observed within 10 days before that day is stored. A NULL is EXCLUDED
// from the sum (SQL sum skips it) — so every caller must also select
// `missingRateCountSql(reporting)` and surface the count as "excluded", never
// present a partial total as complete.
//
// A row with a NULL currency_code (written before currency tagging) is taken
// as ALREADY in the target currency and is never counted as excluded (MC-123,
// a deliberate decision, not an accident): every writer stamps a currency now
// and the only untagged rows left on the dev DB belong to deleted orgs, so
// guessing a currency for them would change more than it fixes. If untagged
// rows ever matter, backfill them (the org currency at the time of writing)
// and make the column NOT NULL — do not reinterpret them here.
//
// The `*In(target)` helpers take the TARGET currency: the workspace's reporting
// currency for every report, a budget's own currency for its spend.

/**
 * `amount` converted at `on` into `target`, or NULL when the rate is unknown.
 * The general form — the transactions-row shorthand is `reportingAmountSql`.
 * NOT for today's account balances: those are valued by buildWealthSummary
 * (currentRate), the one current-valuation path (MC-100).
 */
export const convertedSql = (amount: SQL | typeof transactions.amount, currency: SQL | typeof transactions.currencyCode, on: SQL | typeof transactions.date, target: string) =>
  sql<string>`reporting_amount(${amount}::numeric, ${currency}, ${on}, ${target})`

// ── One rate lookup per (currency, day), not per row (MC-167) ────────────────
// Postgres never inlines fx_rate_on (it reads a table), so converting row by
// row costs one function call per foreign row — twice in an aggregate (the sum
// and the excluded count): ~23 µs each, ≈1 s per statement at 20k foreign rows.
// `fxRatesFor` resolves each DISTINCT (currency_code, date) pair of the scanned
// rows ONCE, in a subquery the aggregate left-joins; the helpers below then
// read the joined rate instead of calling the function. Same meaning as
// reporting_amount() to the cent: identity for the target currency and for a
// NULL currency (MC-123), round(amount × rate, 2) per row, NULL when no rate →
// skipped by the sum and counted as excluded. Measured on the dev DB at 30k
// rows: with foreign rows ~10× faster (≈950 ms → ≈95 ms a statement); with
// NONE the join is pure cost — the subquery's second scan of the scope finds
// nothing to convert (+7..23 ms a statement, 1.3–2× slower). So the routes
// gate it on the workspace's own currencies (`fxFor`, below), and a
// single-currency workspace keeps the per-row form, which then calls
// fx_rate_on for no row at all. Results identical either way.
// ponytail: the budget and cap aggregates join ungated (they convert into budget
// and cap currencies too: 4–17× faster when any differ). When none does, the
// join costs +4..8 ms on the budgets aggregate at 30k rows. Gating it needs
// ensureRatesInto to return each target's `currencies`.
//
//   const org = await ensureRatesForOrg(orgId, reporting).catch(() => undefined)
//   const fx = fxFor(reporting, where, org)
//   withFx(db.select({ income: incomeSumSqlIn(fx), excluded: missingRateCountSql(fx) })
//     .from(transactions).innerJoin(clients, …).$dynamic(), fx).where(where)
//
// `scope` must select EVERY row the aggregate converts — pass the aggregate's
// own WHERE: a row whose pair the subquery never saw reads as "no rate". It may
// reference only `transactions` and `clients` (plus whatever `join` adds) — the
// subquery's own FROM. The rates live in a MATERIALIZED CTE: computed once
// into a tuplestore, whatever join the planner picks. A plain subquery is not
// enough — on a small ledger the planner nests the join and re-runs the
// subquery's projection (fx_rate_on) once per OUTER row, and a pulled-up one
// runs per joined row again. A per-row read (a list page, one detail row)
// keeps the plain string target: one call per row is all it makes.

/** Joined per-(currency, date) rates into a target currency. */
export type FxRates = {
  /** The target currency: a bound code, or a per-row expression (a client's cap currency). */
  readonly target: SQL
  /** The rate subquery, aliased — `.leftJoin(fx.table, fx.on)`. */
  readonly table: SQL
  readonly on: SQL
  /** The joined rate (NULL: same currency, or no rate stored for that day). */
  readonly rate: SQL
}

/** A target currency (one fx_rate_on call per row) or joined rates (one call per distinct pair). */
export type FxTarget = string | FxRates

/**
 * Rates into `target` for the (currency, date) pairs `scope` selects, each looked
 * up once. `target` is a currency code, or a never-NULL per-row expression over
 * the subquery's tables (then `join` adds what it reads, e.g. the client's cap).
 * Two joins in one statement need distinct aliases.
 */
export function fxRatesFor(target: string | SQL, scope: SQL | undefined, opts: { alias?: string; join?: SQL } = {}): FxRates {
  const a = sql.identifier(opts.alias ?? "fx")
  // Typed: a bare parameter in the DISTINCT list would otherwise be of unknown type.
  const to = typeof target === "string" ? sql`${target}::text` : target
  const where = scope ? sql`${transactions.currencyCode} <> ${to} and ${scope}` : sql`${transactions.currencyCode} <> ${to}`
  return {
    target: to,
    table: sql`(with r as materialized (select p.cur, p.day, p.tgt, fx_rate_on(p.cur, p.tgt, p.day) as rate from (select distinct ${transactions.currencyCode} as cur, ${transactions.date} as day, ${to} as tgt from ${transactions} inner join ${clients} on ${clients.id} = ${transactions.clientId}${opts.join ? sql` ${opts.join}` : sql``} where ${where}) p) select * from r) ${a}`,
    on: sql`${a}.cur = ${transactions.currencyCode} and ${a}.day = ${transactions.date} and ${a}.tgt = ${to}`,
    rate: sql`${a}.rate`,
  }
}

/**
 * Joined rates only when the workspace holds a currency other than `target`:
 * `org` is ensureRatesForOrg(orgId, target)'s answer, whose `currencies` are
 * every OTHER currency its rows (trashed too) and accounts carry. None → the
 * per-row string, which is identity on every row and skips the join's second
 * scope scan. `org` undefined (the check failed) → the join. Cannot change a
 * figure: both forms are exact, and a foreign row written after the check is
 * still converted — per row.
 */
export const fxFor = (target: string, scope: SQL | undefined, org: { currencies: readonly string[] } | undefined): FxTarget =>
  org && org.currencies.length === 0 ? target : fxRatesFor(target, scope)

/**
 * `.leftJoin(fx.table, fx.on)` when `fx` is joined rates; the query unchanged for
 * a per-row target. Pass a `$dynamic()` builder. The cast is sound: the rate set
 * is a nameless SQL join, so the selection's result type does not change.
 */
export function withFx<T extends PgSelect>(q: T, fx: FxTarget): T {
  return typeof fx === "string" ? q : (q.leftJoin(fx.table, fx.on) as unknown as T)
}

/** A transaction row's `amount` in the target currency, or NULL when the rate is unknown. */
export const reportingAmountSql = (target: FxTarget) =>
  typeof target === "string"
    ? convertedSql(transactions.amount, transactions.currencyCode, transactions.date, target)
    : sql<string>`(case when ${transactions.currencyCode} is null or ${transactions.currencyCode} = ${target.target} then ${transactions.amount}::numeric else round(${transactions.amount}::numeric * ${target.rate}, 2) end)`

/**
 * "this row could not be converted": tagged with a foreign currency and no rate
 * stored for its day. Pair with the count below, or use directly to flag one row.
 */
export const missingRateSql = (target: FxTarget) =>
  typeof target === "string"
    ? sql<boolean>`(${transactions.currencyCode} is not null and ${transactions.currencyCode} <> ${target} and fx_rate_on(${transactions.currencyCode}, ${target}, ${transactions.date}) is null)`
    : sql<boolean>`(${transactions.currencyCode} is not null and ${transactions.currencyCode} <> ${target.target} and ${target.rate} is null)`

/** Reported income in the target currency (rows without a rate are skipped — count them). */
export const incomeSumSqlIn = (target: FxTarget) =>
  sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' and ${transactions.kind} = 'standard' then ${reportingAmountSql(target)} else 0 end), 0)`

/** Reported expense in the target currency, net of refunds (rows without a rate are skipped — count them). */
export const expenseSumSqlIn = (target: FxTarget) =>
  sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' and ${transactions.kind} = 'standard' then ${reportingAmountSql(target)} when ${transactions.kind} = 'refund' then -${reportingAmountSql(target)} else 0 end), 0)`

/**
 * How many P&L rows in the aggregate could NOT be converted (foreign currency,
 * no stored rate for that day). Only standard + refund rows are counted — a
 * transfer leg is in no total, so its missing rate excludes nothing.
 */
export const missingRateCountSql = (target: FxTarget) =>
  sql<number>`count(*) filter (where ${transactions.kind} in ('standard', 'refund') and ${missingRateSql(target)})::int`
