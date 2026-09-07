import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { spendingBudgets } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { amountAt, budgetWindow, todayUtc, windowsBack } from "../../../src/lib/budget.js"
import {
  checkRelations,
  historyFor,
  isSiblingNameClash,
  loadRecords,
  nextPosition,
  parseBudgetInput,
  recentFor,
  seriesFor,
  SERIES_BACK,
  toRecord,
  withSpend,
  type SpendingBudgetRecord,
} from "../../_lib/spending-budgets.js"

const AUDITED = ["name", "amount", "period", "start_date", "end_date", "categories", "status", "parent_id", "icon"]

/**
 * GET    /api/spending-budgets/:id — the detail screen: the budget and its
 *        sub-budgets with live figures, the spend-vs-limit series over past
 *        windows, the latest transactions in it, and its change history.
 * PATCH  /api/spending-budgets/:id — any subset of the fields. A sub-budget's
 *        window is always its parent's (resolved on read), so a period change
 *        on a main budget needs no second write.
 * DELETE /api/spending-budgets/:id — gone, sub-budgets included (FK cascade).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const id = req.query.id as string
  const today = todayUtc()

  const all = await loadRecords(orgId)
  const current = all.find((r) => r.id === id)
  if (!current) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    const family = all.filter((r) => r.id === id || r.parent_id === id)
    const window = budgetWindow(current.period, current, today)
    const [views, series, recent, history] = await Promise.all([
      withSpend(orgId, family, today, all),
      current.status === "active" ? seriesFor(orgId, current, windowsBack(current.period, SERIES_BACK[current.period], today)) : Promise.resolve([]),
      recentFor(orgId, current, window),
      historyFor(orgId, id),
    ])
    const budget = views.find((v) => v.id === id)!
    const children = views.filter((v) => v.parent_id === id)
    const parent = current.parent_id ? all.find((r) => r.id === current.parent_id) ?? null : null
    return res.json({
      budget,
      children,
      parent: parent ? { id: parent.id, name: parent.name } : null,
      // Each past window is judged against the limit in effect when it closed,
      // so lowering the limit today does not repaint last month.
      series: series.map((p, i) => {
        const end = windowsBack(current.period, SERIES_BACK[current.period], today)[i]?.endExclusive ?? today
        return { ...p, amount: amountAt(history, `${end}T00:00:00.000Z`, current.amount) }
      }),
      recent,
      history,
      today,
    })
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const parsed = parseBudgetInput(req.body, true)
    if (!parsed.ok) return res.status(400).json({ error: parsed.error })
    const v = parsed.value

    const parentId = v.parent_id !== undefined ? v.parent_id : current.parent_id
    if (parentId === id) return res.status(400).json({ error: "parent_is_self" })
    const parent = parentId ? all.find((r) => r.id === parentId) : null
    if (parentId && !parent) return res.status(404).json({ error: "parent_not_found" })

    // A sub-budget's window is its parent's, resolved on read; its own row
    // carries the period for readability and never any dates. A main budget
    // stores what was sent, with dates dropped the moment it stops being `once`.
    const period = parent ? parent.period : (v.period ?? current.period)
    const startDate = !parent && period === "once" ? (v.start_date !== undefined ? v.start_date : current.start_date) : null
    const endDate = !parent && period === "once" ? (v.end_date !== undefined ? v.end_date : current.end_date) : null

    const next: SpendingBudgetRecord = {
      ...current,
      name: v.name ?? current.name,
      icon: v.icon ?? current.icon,
      period,
      start_date: startDate,
      end_date: endDate,
      amount: v.amount ?? current.amount,
      categories: v.categories ?? current.categories,
      parent_id: parent?.id ?? null,
      status: v.status ?? current.status,
    }
    const rel = checkRelations(next, all, { creating: false })
    if (!rel.ok) return res.status(rel.status).json({ error: rel.error, ...(rel.detail ?? {}) })

    const movedSibling = next.parent_id !== current.parent_id
    try {
      const [row] = await db
        .update(spendingBudgets)
        .set({
          name: next.name,
          icon: next.icon,
          period: next.period,
          startDate: next.start_date,
          endDate: next.end_date,
          amount: String(next.amount),
          categories: next.categories,
          parentId: next.parent_id,
          status: next.status,
          ...(movedSibling ? { position: await nextPosition(orgId, next.parent_id) } : {}),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(spendingBudgets.id, id), eq(spendingBudgets.organizationId, orgId)))
        .returning()

      // A sub-budget's period/dates are its parent's on both sides of the diff
      // (`current` carries the derived values), so they never show as changed.
      const nextForDiff = parent ? { ...next, period: current.period, start_date: current.start_date, end_date: current.end_date } : next
      // Closing a budget closes what is inside it: an active sub-budget of a
      // closed parent would vanish from the page while still counting and still
      // alerting. Reopening brings them back the same way.
      if (!next.parent_id && next.status !== current.status) {
        await db
          .update(spendingBudgets)
          .set({ status: next.status, updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(spendingBudgets.parentId, id), eq(spendingBudgets.organizationId, orgId)))
      }

      const changes = diffFields(
        { ...current, categories: JSON.stringify(current.categories) },
        { ...nextForDiff, categories: JSON.stringify(next.categories) },
        AUDITED,
      )
      if (Object.keys(changes).length) {
        if (changes.categories) changes.categories = { from: current.categories, to: next.categories }
        await logAudit({ orgId, entityType: "budget", entityId: id, action: "update", actorId: userId, changes })
      }
      // The derived window for a sub-budget is its parent's, which is in hand.
      const stored = toRecord(row)
      const record = parent ? { ...stored, period: parent.period, start_date: parent.start_date, end_date: parent.end_date } : stored
      const fresh = all.map((r) => (r.id === id ? record : r))
      const [view] = await withSpend(orgId, [record], today, fresh)
      return res.json(view)
    } catch (err) {
      if (isSiblingNameClash(err)) return res.status(409).json({ error: "name_taken" })
      throw err
    }
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    await db.delete(spendingBudgets).where(and(eq(spendingBudgets.id, id), eq(spendingBudgets.organizationId, orgId)))
    await logAudit({ orgId, entityType: "budget", entityId: id, action: "delete", actorId: userId, changes: {
      name: { from: current.name, to: null },
      amount: { from: current.amount, to: null },
    } })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
