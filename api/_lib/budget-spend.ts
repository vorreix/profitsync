import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import type { PeriodWindow } from "../../src/lib/budget-history.js"
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
// Every figure is in `reporting` (the workspace's reporting currency), each row
// converted at its own date; rows with no rate are skipped and counted in
// `excluded` per window so a cap is never judged against a silently partial total.
export async function outgoingByClient(orgId: string, now: Date, reporting: string): Promise<Map<string, PeriodSums>> {
  const today = periodStart("daily", now)!
  const weekStart = periodStart("weekly", now)!
  const monthStart = periodStart("monthly", now)!
  const signed = budgetSpendSignedAmountIn(reporting)
  const missing = budgetSpendMissingRate(reporting)
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
 * OUTGOING spend bucketed into the given period windows, for a budget's spend-vs-budget
 * chart. Scoped to one client when `clientId` is set; when null it sums the whole
 * workspace (the personal org's single budget). Returns { windowStart: spent } in
 * the reporting currency plus { windowStart: excludedCount } for the rows no rate
 * could convert.
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
    .select({ date: transactions.date, amount: budgetSpendSignedAmountIn(reporting) })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
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
