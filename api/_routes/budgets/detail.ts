import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { budgets, budgetHistory, clients } from "../../../src/lib/db/schema.js"
import { requireAuth, isPersonalAccount } from "../../_lib/auth.js"
import { spendForWindows } from "../../_lib/budget-spend.js"
import { amountAt, isBudgetPeriod, todayUtc, windowsBack, type BudgetPeriod } from "../../../src/lib/budget.js"
import { historyFor, listBudgets, primaryBudget, seriesFor, SERIES_BACK, toV1Period } from "../../_lib/spending-budgets.js"
import {
  adherence,
  buildSeries,
  detectCreep,
  evolution,
  periodBoundaries,
  seriesState,
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

  // A personal workspace's budget is its primary spending budget; keep the old
  // bundle's detail page truthful with the current figure, the past windows and
  // a timeline read from the budget's audit trail.
  if (personal) {
    const today = todayUtc()
    const primary = primaryBudget(await listBudgets(orgId, today))
    if (!primary) {
      return res.json({ key: "default", client_id: null, client_name: null, is_own: false, is_default: true, current: null, timeline: [], has_series: false, series: [], adherence: adherence([]), evolution: null, creep: detectCreep([]) })
    }
    const period = toV1Period(primary.period)
    const windows = windowsBack(primary.period, SERIES_BACK[primary.period], today)
    const [points, audit] = await Promise.all([seriesFor(orgId, primary, windows), historyFor(orgId, primary.id, 100)])
    const history: HistoryRow[] = [...audit]
      .reverse()
      .filter((h) => h.changes.amount && typeof h.changes.amount.to !== "undefined")
      .map((h) => {
        const to = Number(h.changes.amount.to ?? 0)
        const from = Number(h.changes.amount.from ?? 0)
        const action: BudgetAction = h.action === "delete" ? "remove" : h.action === "create" ? "set" : to > from ? "raise" : to < from ? "lower" : "period_change"
        return { amount: to, period, action, createdAt: h.created_at ?? new Date(0).toISOString() }
      })
    const series = windows.map((w, i) => {
      const spent = points[i]?.spent ?? 0
      const budget = amountAt(audit, `${w.endExclusive}T00:00:00.000Z`, primary.amount)
      return { start: w.start!, spent, budget, state: seriesState(spent, budget) }
    })
    return res.json({
      key: "default",
      client_id: null,
      client_name: null,
      is_own: false,
      is_default: true,
      current: { amount: primary.amount, period },
      timeline: history.map((h) => ({ amount: h.amount, period: h.period, action: h.action, created_at: h.createdAt })),
      has_series: windows.length > 0,
      series,
      adherence: adherence(series),
      evolution: evolution(history),
      creep: detectCreep(history),
    })
  }

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

  // No budget yet for a valid client (or the default) is fine — the detail page is
  // also where you *set* one, so return an empty-but-valid payload (current: null)
  // instead of 404. (An invalid/trashed client was already rejected above.)
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
