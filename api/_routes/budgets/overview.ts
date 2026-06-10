import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { budgets, budgetHistory, clients } from "../../../src/lib/db/schema.js"
import { requireAuth, isPersonalAccount } from "../../_lib/auth.js"
import { outgoingByClient, spentFor } from "../../_lib/budget-spend.js"
import { isBudgetPeriod, type BudgetPeriod } from "../../../src/lib/budget.js"
import { detectCreep, seriesState, type BudgetAction, type HistoryRow } from "../../../src/lib/budget-history.js"

const KEY = (clientId: string | null) => clientId ?? "default"

// GET /api/budgets/overview — the Budgets page list + cross-budget summary. Current
// spend is derived per budget; the creep flag is computed from each budget's history.
// (Full per-period series + adherence live in /api/budgets/detail, lazy per budget.)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { orgId } = ctx
  const personal = isPersonalAccount(ctx)
  const now = new Date()

  const [rows, clientRows, historyRows, byClient] = await Promise.all([
    db.select().from(budgets).where(eq(budgets.organizationId, orgId)),
    db.select({ id: clients.id, name: clients.name, isOwn: clients.isOwn }).from(clients).where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt))),
    db.select().from(budgetHistory).where(eq(budgetHistory.organizationId, orgId)),
    outgoingByClient(orgId, now),
  ])

  const nameById = new Map(clientRows.map((c) => [c.id, c.name]))
  const ownById = new Map(clientRows.map((c) => [c.id, c.isOwn]))

  // Whole-workspace per-period spend (the personal org's single budget tracks this).
  const orgTotals = { daily: 0, weekly: 0, monthly: 0, lifetime: 0 }
  for (const s of byClient.values()) {
    orgTotals.daily += s.daily; orgTotals.weekly += s.weekly
    orgTotals.monthly += s.monthly; orgTotals.lifetime += s.lifetime
  }

  // History grouped per budget (key by client id, "default" for the null budget),
  // ascending by created_at, mapped to the pure-lib shape for detectCreep.
  const histByKey = new Map<string, HistoryRow[]>()
  for (const h of historyRows) {
    const k = KEY(h.clientId)
    const list = histByKey.get(k) ?? []
    list.push({
      amount: Number(h.amount),
      period: (isBudgetPeriod(h.period) ? h.period : "monthly") as BudgetPeriod,
      action: h.action as BudgetAction,
      createdAt: (h.createdAt ?? new Date(0)).toISOString(),
    })
    histByKey.set(k, list)
  }
  for (const list of histByKey.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const out = rows.map((b) => {
    const period = (isBudgetPeriod(b.period) ? b.period : "monthly") as BudgetPeriod
    const amount = Number(b.amount)
    // Spend: per-client → that client; personal org-level (null) → whole workspace;
    // business default template (null) → null (no single spend number).
    const spent = b.clientId ? spentFor(byClient.get(b.clientId), period) : personal ? orgTotals[period] : null
    const ratio = spent !== null && amount > 0 ? spent / amount : null
    const creep = detectCreep(histByKey.get(KEY(b.clientId)) ?? [])
    return {
      key: KEY(b.clientId),
      client_id: b.clientId,
      client_name: b.clientId ? nameById.get(b.clientId) ?? null : null,
      is_own: b.clientId ? ownById.get(b.clientId) ?? false : false,
      is_default: !b.clientId, // personal budget OR business default/template
      period,
      amount,
      spent,
      state: spent !== null ? seriesState(spent, amount) : "none",
      ratio,
      creep_flagged: creep.flagged,
    }
  // Drop budgets whose client was soft-deleted (trashed) — they aren't in nameById.
  }).filter((b) => !b.client_id || nameById.has(b.client_id))

  // Cross-budget aggregate — over budgets that have a real spend number + amount.
  const tracked = out.filter((b) => b.spent !== null && b.amount > 0)
  const totalBudget = tracked.reduce((s, b) => s + b.amount, 0)
  const totalSpent = tracked.reduce((s, b) => s + (b.spent ?? 0), 0)
  const onTrack = tracked.filter((b) => (b.spent ?? 0) <= b.amount).length
  const ranked = [...tracked].filter((b) => b.ratio !== null).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
  const lite = (b: (typeof out)[number]) => ({ key: b.key, client_name: b.client_name, is_default: b.is_default, ratio: b.ratio })

  return res.json({
    budgets: out,
    account_type: ctx.accountType,
    aggregate: {
      total_budget: totalBudget,
      total_spent: totalSpent,
      on_track: onTrack,
      total: tracked.length,
      worst: ranked.length ? lite(ranked[0]) : null,
      best: ranked.length ? lite(ranked[ranked.length - 1]) : null,
    },
  })
}
