import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { budgets, clients, transactions } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import type { PeriodWindow } from "../../src/lib/budget-history.js"
import { isCurrencyCode, normalizeCurrencyCode } from "../../src/lib/money.js"
import { missingRateSql, reportingAmountSql } from "./tx-sql.js"

export type PeriodCounts = { daily: number; weekly: number; monthly: number; lifetime: number }
export type PeriodSums = PeriodCounts & {
  /** Rows in each window that could NOT be converted into the target currency (no rate for their day). */
  excluded?: PeriodCounts
}

/**
 * The inclusion predicates EVERY budget-spend query must share:
 * org-scoped, client neither trashed nor closed, row not trashed, **not a
 * system balance-defining row**, and one of
 *   • a standard OUTGOING (an expense — incl. a credit-card purchase), or
 *   • a REFUND (an incoming that gives money back for an earlier expense).
 * Transfers — including credit-card payments — never match: paying the card is
 * not spending, the purchase already was. Rows are summed with
 * `budgetSpendSignedAmount` so a refund SUBTRACTS from the window it lands in.
 *
 * Exported so the committed (DB-free) suite can assert the `is_system`
 * exclusion via generated SQL — that filter was missing and let "zero this
 * account" register as budget spend, so it must not be able to regress
 * silently.
 */
export function budgetSpendPredicates(orgId: string) {
  return [
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    // A CLOSED client is out of every report (analytics, calendar, the list),
    // so it is out of the budgets too — the two must agree for one window.
    isNull(clients.closedAt),
    isNull(transactions.deletedAt),
    inArray(transactions.kind, ["standard", "refund"]),
    or(eq(transactions.type, "outgoing"), eq(transactions.kind, "refund"))!,
    eq(transactions.isSystem, false),
  ]
}

/** +amount for an expense row, −amount for a refund row (the SQL twin of tx-classify.expenseContribution) — NATIVE, unconverted. */
export const budgetSpendSignedAmount = sql<string>`case when ${transactions.kind} = 'refund' then -${transactions.amount}::numeric else ${transactions.amount}::numeric end`

/**
 * The same signed amount converted AT THE ROW'S DATE into `target` (a budget's
 * own currency, or the workspace's reporting currency for the v1 client caps).
 * NULL when no rate is stored for that day — a sum skips it, so every caller
 * also counts `budgetSpendMissingRate(target)` rows and reports them.
 */
export const budgetSpendSignedAmountIn = (target: string) =>
  sql<string>`case when ${transactions.kind} = 'refund' then -${reportingAmountSql(target)} else ${reportingAmountSql(target)} end`

/** "this spend row could not be converted into `target`" — for the excluded counts. */
export const budgetSpendMissingRate = (target: string) => missingRateSql(target)

// ── v1 per-client caps keep their currency ───────────────────────────────────
// A cap is authored AND judged in `budgets.currency_code` (mig 0077): the
// reporting currency when it was first set. A later reporting change converts
// the spend into the cap's currency; it never relabels the cap (a $1,000 cap
// must not become ₹1,000 or €1,000). A legacy NULL — or a client with no cap —
// falls back to the workspace's reporting currency.

/** The currency a v1 cap is judged in. */
export const capCurrency = (cap: { currencyCode: string | null } | null | undefined, reporting: string): string =>
  cap?.currencyCode && isCurrencyCode(cap.currencyCode) ? normalizeCurrencyCode(cap.currencyCode) : reporting

/**
 * Per row: the currency of the cap on the row's client (needs the `budgets`
 * left join `capJoin` adds), else `fallback`. The SQL twin of `capCurrency`.
 */
const capTargetSql = (fallback: string) => sql<string>`coalesce(${budgets.currencyCode}, ${fallback})`
const capConvertedSql = (fallback: string) =>
  sql<string>`reporting_amount(${transactions.amount}::numeric, ${transactions.currencyCode}, ${transactions.date}, ${capTargetSql(fallback)})`

/** The signed spend of a row converted at its date into ITS CLIENT's cap currency (NULL = no rate). */
export const capSpendSignedAmount = (fallback: string) =>
  sql<string>`case when ${transactions.kind} = 'refund' then -${capConvertedSql(fallback)} else ${capConvertedSql(fallback)} end`

/** "this row could not be converted into its client's cap currency" — the excluded count. */
export const capSpendMissingRate = (fallback: string) =>
  sql<boolean>`(${transactions.currencyCode} is not null and ${transactions.currencyCode} <> ${capTargetSql(fallback)} and fx_rate_on(${transactions.currencyCode}, ${capTargetSql(fallback)}, ${transactions.date}) is null)`

/** Join each spend row to its client's cap (at most one: budgets_org_client_unique). */
export const capJoin = (orgId: string) => and(eq(budgets.organizationId, orgId), eq(budgets.clientId, transactions.clientId))

/**
 * Whether a history snapshot belongs to a cap's timeline in `currency`. A cap
 * removed and set again after a reporting change starts over in the new
 * currency; comparing $1,000 with a later €60 would read as a 94 % cut, so
 * creep/evolution/series only ever see one currency. A legacy NULL snapshot is
 * the cap's own.
 */
export const inCapCurrency = (snapshotCurrency: string | null, currency: string): boolean =>
  !snapshotCurrency || snapshotCurrency.toUpperCase() === currency

/**
 * The currency a v1 cap write is saved in — or null when the amount was typed
 * against another one. An existing cap keeps its own; a new one is born in the
 * currency the caller showed (`shown`, the reporting currency when it names
 * none — what every dialog that predates kept caps labels the input with). A
 * $1,000 cap edited through a dialog that says ₹ must be refused (409
 * currency_mismatch), never saved as $50,000 because the user typed rupees.
 */
export const capWriteCurrency = (
  existing: { currencyCode: string | null } | null | undefined,
  reporting: string,
  shown: string | null,
): string | null => {
  const typedIn = shown ?? reporting
  const saveIn = existing ? capCurrency(existing, reporting) : typedIn
  return saveIn === typedIn ? saveIn : null
}

// Per-client OUTGOING (expense) spend for each current budget window, in ONE grouped
// query, so a budget of any period just reads its column. Spend is derived here — the
// budgets table only stores the target + cadence.
//
// Excluded: transfers (kind != 'standard'), trashed clients/transactions, and
// SYSTEM entries (is_system) — "Opening Balance" and "Balance Adjustment" rows
// *define* what an account balance IS at a point in time (see
// src/lib/wealth-ledger.ts reversesOnTrash); they are not spending. Without this
// filter, zeroing a wallet registered as an expense and silently consumed the
// budget. `api/_lib/quota.ts` already excludes them for the same reason.
//
// Each client's figures are in ITS CAP's currency (`capCurrency`; `reporting`
// when it has no cap or a legacy NULL one), each row converted at its own date;
// rows with no rate are skipped and counted in `excluded` per window so a cap is
// never judged against a silently partial total.
export async function outgoingByClient(orgId: string, now: Date, reporting: string): Promise<Map<string, PeriodSums>> {
  const today = periodStart("daily", now)!
  const weekStart = periodStart("weekly", now)!
  const monthStart = periodStart("monthly", now)!
  const signed = capSpendSignedAmount(reporting)
  const missing = capSpendMissingRate(reporting)
  const rows = await db
    .select({
      clientId: transactions.clientId,
      daily: sql<string>`coalesce(sum(${signed}) filter (where ${transactions.date} >= ${today}), 0)`,
      weekly: sql<string>`coalesce(sum(${signed}) filter (where ${transactions.date} >= ${weekStart}), 0)`,
      monthly: sql<string>`coalesce(sum(${signed}) filter (where ${transactions.date} >= ${monthStart}), 0)`,
      lifetime: sql<string>`coalesce(sum(${signed}), 0)`,
      exDaily: sql<number>`count(*) filter (where ${transactions.date} >= ${today} and ${missing})::int`,
      exWeekly: sql<number>`count(*) filter (where ${transactions.date} >= ${weekStart} and ${missing})::int`,
      exMonthly: sql<number>`count(*) filter (where ${transactions.date} >= ${monthStart} and ${missing})::int`,
      exLifetime: sql<number>`count(*) filter (where ${missing})::int`,
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .leftJoin(budgets, capJoin(orgId))
    .where(and(...budgetSpendPredicates(orgId)))
    .groupBy(transactions.clientId)

  const map = new Map<string, PeriodSums>()
  for (const r of rows) {
    map.set(r.clientId, {
      daily: Number(r.daily),
      weekly: Number(r.weekly),
      monthly: Number(r.monthly),
      lifetime: Number(r.lifetime),
      excluded: {
        daily: Number(r.exDaily),
        weekly: Number(r.exWeekly),
        monthly: Number(r.exMonthly),
        lifetime: Number(r.exLifetime),
      },
    })
  }
  return map
}

export const spentFor = (sums: PeriodSums | undefined, period: BudgetPeriod): number => (sums ? sums[period] : 0)
/** Rows the window's spend could not include (no rate) — 0 when everything converted. */
export const excludedFor = (sums: PeriodSums | undefined, period: BudgetPeriod): number => sums?.excluded?.[period] ?? 0

/**
 * OUTGOING spend bucketed into the given period windows, for a cap's spend-vs-budget
 * chart. Scoped to one client when `clientId` is set (the only caller today: the
 * business detail page); when null it sums the whole workspace. Returns
 * { windowStart: spent } in the client's CAP currency (`reporting` without one)
 * plus { windowStart: excludedCount } for the rows no rate could convert.
 */
export async function spendForWindows(
  orgId: string,
  clientId: string | null,
  windows: PeriodWindow[],
  reporting: string,
): Promise<{ spent: Record<string, number>; excluded: Record<string, number> }> {
  const spent: Record<string, number> = {}
  const excluded: Record<string, number> = {}
  for (const w of windows) {
    spent[w.start] = 0
    excluded[w.start] = 0
  }
  if (!windows.length) return { spent, excluded }

  const first = windows[0].start
  const lastEnd = windows[windows.length - 1].endExclusive
  const conds = [
    ...budgetSpendPredicates(orgId),
    gte(transactions.date, first),
    lt(transactions.date, lastEnd),
  ]
  if (clientId) conds.push(eq(transactions.clientId, clientId))

  const rows = await db
    .select({ date: transactions.date, amount: capSpendSignedAmount(reporting) })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .leftJoin(budgets, capJoin(orgId))
    .where(and(...conds))

  for (const r of rows) {
    for (const w of windows) {
      if (r.date >= w.start && r.date < w.endExclusive) {
        if (r.amount === null || r.amount === undefined) excluded[w.start] += 1
        else spent[w.start] += Number(r.amount)
        break
      }
    }
  }
  return { spent, excluded }
}
