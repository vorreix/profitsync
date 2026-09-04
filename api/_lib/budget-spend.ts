import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import type { PeriodWindow } from "../../src/lib/budget-history.js"

export type PeriodSums = { daily: number; weekly: number; monthly: number; lifetime: number }

/**
 * The inclusion predicates EVERY budget-spend query must share:
 * org-scoped, not trashed, **not a system balance-defining row**, and one of
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
    isNull(transactions.deletedAt),
    inArray(transactions.kind, ["standard", "refund"]),
    or(eq(transactions.type, "outgoing"), eq(transactions.kind, "refund"))!,
    eq(transactions.isSystem, false),
  ]
}

/** +amount for an expense row, −amount for a refund row (the SQL twin of tx-classify.expenseContribution). */
export const budgetSpendSignedAmount = sql<string>`case when ${transactions.kind} = 'refund' then -${transactions.amount}::numeric else ${transactions.amount}::numeric end`

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
export async function outgoingByClient(orgId: string, now: Date): Promise<Map<string, PeriodSums>> {
  const today = periodStart("daily", now)!
  const weekStart = periodStart("weekly", now)!
  const monthStart = periodStart("monthly", now)!
  const rows = await db
    .select({
      clientId: transactions.clientId,
      daily: sql<string>`coalesce(sum(${budgetSpendSignedAmount}) filter (where ${transactions.date} >= ${today}), 0)`,
      weekly: sql<string>`coalesce(sum(${budgetSpendSignedAmount}) filter (where ${transactions.date} >= ${weekStart}), 0)`,
      monthly: sql<string>`coalesce(sum(${budgetSpendSignedAmount}) filter (where ${transactions.date} >= ${monthStart}), 0)`,
      lifetime: sql<string>`coalesce(sum(${budgetSpendSignedAmount}), 0)`,
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
    })
  }
  return map
}

export const spentFor = (sums: PeriodSums | undefined, period: BudgetPeriod): number => (sums ? sums[period] : 0)

/**
 * OUTGOING spend bucketed into the given period windows, for a budget's spend-vs-budget
 * chart. Scoped to one client when `clientId` is set; when null it sums the whole
 * workspace (the personal org's single budget). Returns { windowStart: spent }.
 */
export async function spendForWindows(
  orgId: string,
  clientId: string | null,
  windows: PeriodWindow[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const w of windows) out[w.start] = 0
  if (!windows.length) return out

  const first = windows[0].start
  const lastEnd = windows[windows.length - 1].endExclusive
  const conds = [
    ...budgetSpendPredicates(orgId),
    gte(transactions.date, first),
    lt(transactions.date, lastEnd),
  ]
  if (clientId) conds.push(eq(transactions.clientId, clientId))

  const rows = await db
    .select({ date: transactions.date, amount: budgetSpendSignedAmount })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...conds))

  for (const r of rows) {
    for (const w of windows) {
      if (r.date >= w.start && r.date < w.endExclusive) {
        out[w.start] += Number(r.amount)
        break
      }
    }
  }
  return out
}
