import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { budgets, budgetHistory, clients } from "../../../src/lib/db/schema.js"
import { requireAuth, isPersonalAccount } from "../../_lib/auth.js"
import { spendForWindows } from "../../_lib/budget-spend.js"
import { isBudgetPeriod, type BudgetPeriod } from "../../../src/lib/budget.js"
import {
  adherence,
  buildSeries,
  detectCreep,
  evolution,
  periodBoundaries,
  type BudgetAction,
  type HistoryRow,
} from "../../../src/lib/budget-history.js"

// How many past periods the spend-vs-budget chart covers, per cadence.
const LOOKBACK: Record<BudgetPeriod, number> = { lifetime: 0, monthly: 6, weekly: 8, daily: 14 }

// GET /api/budgets/detail?client_id=<id>  (omit / "default" = the org-level budget)
// Full per-budget view: change timeline + spend-vs-budget series + adherence + creep.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { orgId } = ctx
  const personal = isPersonalAccount(ctx)

  const raw = (req.query.client_id as string | undefined)?.trim()
  const clientId = raw && raw !== "default" ? raw : null

  const [budgetRow] = await db
    .select()
    .from(budgets)
    .where(and(eq(budgets.organizationId, orgId), clientId ? eq(budgets.clientId, clientId) : isNull(budgets.clientId)))

  const [clientRow] = clientId
    ? await db.select({ name: clients.name, isOwn: clients.isOwn }).from(clients).where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    : [undefined]

  // A per-client budget for a client that doesn't exist in this org (or was trashed)
  // is not viewable here — its history/spend shouldn't surface.
  if (clientId && !clientRow) return res.status(404).json({ error: "Client not found" })

  const historyRows = await db
    .select()
    .from(budgetHistory)
    .where(and(eq(budgetHistory.organizationId, orgId), clientId ? eq(budgetHistory.clientId, clientId) : isNull(budgetHistory.clientId)))
    .orderBy(asc(budgetHistory.createdAt))

  const history: HistoryRow[] = historyRows.map((h) => ({
    amount: Number(h.amount),
    period: (isBudgetPeriod(h.period) ? h.period : "monthly") as BudgetPeriod,
    action: h.action as BudgetAction,
    createdAt: (h.createdAt ?? new Date(0)).toISOString(),
  }))

  // Nothing ever set for this budget.
  if (!budgetRow && history.length === 0) {
    return res.status(404).json({ error: "No budget" })
  }

  const period = (isBudgetPeriod(budgetRow?.period) ? budgetRow!.period : history[history.length - 1]?.period ?? "monthly") as BudgetPeriod

  // Series only makes sense when there's a real, periodic spend stream: a per-client
  // budget, or the personal org's whole-workspace budget. The business default
  // (null client) is a template with no single spend → timeline only.
  const tracksSpend = period !== "lifetime" && (clientId !== null || personal)
  let series: ReturnType<typeof buildSeries> = []
  if (tracksSpend) {
    const windows = periodBoundaries(period, LOOKBACK[period], new Date())
    const spentByStart = await spendForWindows(orgId, clientId, windows)
    series = buildSeries(windows, spentByStart, history)
  }

  return res.json({
    key: clientId ?? "default",
    client_id: clientId,
    client_name: clientRow?.name ?? null,
    is_own: clientRow?.isOwn ?? false,
    is_default: !clientId,
    current: budgetRow ? { amount: Number(budgetRow.amount), period } : null,
    timeline: history.map((h) => ({ amount: h.amount, period: h.period, action: h.action, created_at: h.createdAt })),
    has_series: tracksSpend,
    series,
    adherence: adherence(series),
    evolution: evolution(history),
    creep: detectCreep(history),
  })
}
