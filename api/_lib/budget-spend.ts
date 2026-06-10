import { and, eq, gte, isNull, lt, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { periodStart, type BudgetPeriod } from "../../src/lib/budget.js"
import type { PeriodWindow } from "../../src/lib/budget-history.js"

export type PeriodSums = { daily: number; weekly: number; monthly: number; lifetime: number }

// Per-client OUTGOING (expense) spend for each current budget window, in ONE grouped
// query, so a budget of any period just reads its column. Spend is derived here — the
// budgets table only stores the target + cadence. Excludes transfers (kind!=standard)
// and trashed clients/transactions.
export async function outgoingByClient(orgId: string, now: Date): Promise<Map<string, PeriodSums>> {
  const today = periodStart("daily", now)!
  const weekStart = periodStart("weekly", now)!
  const monthStart = periodStart("monthly", now)!
  const rows = await db
    .select({
      clientId: transactions.clientId,
      daily: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.date} >= ${today}), 0)`,
      weekly: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.date} >= ${weekStart}), 0)`,
      monthly: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.date} >= ${monthStart}), 0)`,
      lifetime: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)`,
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(
      and(
        eq(clients.organizationId, orgId),
        isNull(clients.deletedAt),
        isNull(transactions.deletedAt),
        eq(transactions.type, "outgoing"),
        eq(transactions.kind, "standard"),
      ),
    )
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
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    isNull(transactions.deletedAt),
    eq(transactions.type, "outgoing"),
    eq(transactions.kind, "standard"),
    gte(transactions.date, first),
    lt(transactions.date, lastEnd),
  ]
  if (clientId) conds.push(eq(transactions.clientId, clientId))

  const rows = await db
    .select({ date: transactions.date, amount: transactions.amount })
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
