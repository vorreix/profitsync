import type { VercelRequest, VercelResponse } from "@vercel/node"
import { db } from "../../src/lib/db/index.js"
import { spendingBudgets } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../_lib/auth.js"
import { logAudit } from "../_lib/audit.js"
import { todayUtc } from "../../src/lib/budget.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import {
  checkRelations,
  isSiblingNameClash,
  listBudgets,
  loadRecords,
  nextPosition,
  parseBudgetInput,
  toRecord,
  withSpend,
  type SpendingBudgetRecord,
} from "../_lib/spending-budgets.js"

/**
 * GET  /api/spending-budgets — every budget of the workspace with its live
 *      spend for the current window (flat; the client nests by parent_id).
 * POST /api/spending-budgets — create one. A `parent_id` makes it a sub-budget,
 *      which inherits the parent's period and dates.
 *
 * GET materialises due recurring rows first (like /api/calendar), so the month's
 * rent is in this month's figure even when this is the first screen opened
 * today — which is why the path sits in ALWAYS_FETCH.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const today = todayUtc()

  if (req.method === "GET") {
    await materializeDueRecurring(orgId)
    // No `?view=` parameter on purpose: every budget carries its spend for all
    // four view windows, so the page's toggle is a re-render, the dashboard and
    // the detail page share this one cache entry, and nothing refetches.
    return res.json({ budgets: await listBudgets(orgId, today), today })
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const parsed = parseBudgetInput(req.body, false)
    if (!parsed.ok) return res.status(400).json({ error: parsed.error })
    const v = parsed.value

    const all = await loadRecords(orgId)
    const parent = v.parent_id ? all.find((r) => r.id === v.parent_id) : null
    if (v.parent_id && !parent) return res.status(404).json({ error: "parent_not_found" })

    // A sub-budget lives in its parent's window, whatever the body said: its
    // period is copied for readability, its dates are never stored — both are
    // resolved from the parent on every read (loadRecords).
    const period = parent ? parent.period : (v.period ?? "monthly")
    const startDate = !parent && period === "once" ? (v.start_date ?? null) : null
    const endDate = !parent && period === "once" ? (v.end_date ?? null) : null

    const draft: SpendingBudgetRecord = {
      id: "new",
      organization_id: orgId,
      parent_id: parent?.id ?? null,
      name: v.name!,
      icon: v.icon ?? "",
      period,
      start_date: startDate,
      end_date: endDate,
      amount: v.amount!,
      categories: v.categories ?? [],
      status: "active",
      position: 0,
      created_by: userId,
      updated_by: userId,
      created_at: null,
      updated_at: null,
    }
    const rel = checkRelations(draft, all, { creating: true })
    if (!rel.ok) return res.status(rel.status).json({ error: rel.error, ...(rel.detail ?? {}) })

    try {
      const [row] = await db
        .insert(spendingBudgets)
        .values({
          organizationId: orgId,
          parentId: draft.parent_id,
          name: draft.name,
          icon: draft.icon,
          period: draft.period,
          startDate: draft.start_date,
          endDate: draft.end_date,
          amount: String(draft.amount),
          categories: draft.categories,
          status: "active",
          position: await nextPosition(orgId, draft.parent_id),
          createdBy: userId,
          updatedBy: userId,
        })
        .returning()
      await logAudit({ orgId, entityType: "budget", entityId: row.id, action: "create", actorId: userId, changes: {
        name: { from: null, to: row.name },
        amount: { from: null, to: Number(row.amount) },
        period: { from: null, to: row.period },
        categories: { from: null, to: draft.categories },
      } })
      // A sub-budget's window is its parent's (resolved on read); build the
      // 201 body the same way so it never reports an all-time figure.
      const stored = toRecord(row)
      const record = parent ? { ...stored, period: parent.period, start_date: parent.start_date, end_date: parent.end_date } : stored
      const [created] = await withSpend(orgId, [record], today, [...all, record])
      return res.status(201).json(created)
    } catch (err) {
      if (isSiblingNameClash(err)) return res.status(409).json({ error: "name_taken" })
      throw err
    }
  }

  return res.status(405).json({ error: "Method not allowed" })
}
