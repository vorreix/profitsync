import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { budgetHistory, budgets, clients, spendingBudgets } from "../../src/lib/db/schema.js"
import { canWrite, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import { isBudgetPeriod, todayUtc, type BudgetPeriod } from "../../src/lib/budget.js"
import { budgetChangeAction } from "../../src/lib/budget-history.js"
import { outgoingByClient, spentFor } from "../_lib/budget-spend.js"
import { logAudit } from "../_lib/audit.js"
import { listBudgets, primaryBudget, toV1Period, fromV1Period } from "../_lib/spending-budgets.js"

/**
 * The v1 budgets API — per-client spend CAPS for business workspaces, with the
 * response shape store-pinned native bundles expect: `{ budgets, account_type }`.
 *
 * A PERSONAL workspace no longer has a `budgets` row (its single v1 budget
 * became its first spending budget in migration 0067). An old bundle still
 * asks here for it, so on a personal org this route PROJECTS the primary
 * spending budget — top level, all spending — into the v1 row, and a v1 write
 * upserts that same spending budget. Two clients, one row, no drift.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const personal = isPersonalAccount(ctx)

  if (req.method === "GET") {
    if (personal) {
      const primary = primaryBudget(await listBudgets(orgId, todayUtc()))
      return res.json({
        budgets: primary
          ? [{
              id: primary.id,
              organization_id: orgId,
              client_id: null,
              period: toV1Period(primary.period),
              amount: primary.amount,
              spent: primary.spent,
              created_at: primary.created_at,
              updated_at: primary.updated_at,
            }]
          : [],
        account_type: ctx.accountType,
      })
    }

    const now = new Date()
    const [rows, byClient] = await Promise.all([
      db.select().from(budgets).where(eq(budgets.organizationId, orgId)),
      outgoingByClient(orgId, now),
    ])
    const out = rows.map((b) => {
      const period = (isBudgetPeriod(b.period) ? b.period : "monthly") as BudgetPeriod
      // A per-client cap carries that client's spend; the NULL-client row is the
      // default-for-new-clients template and has no single spend figure.
      const spent = b.clientId ? spentFor(byClient.get(b.clientId), period) : null
      return { ...serialize(b), spent }
    })
    return res.json({ budgets: out, account_type: ctx.accountType })
  }

  // POST = upsert a budget for (org, client_id). amount <= 0 clears it. This is the
  // single endpoint the budget dialog calls (set / change / remove), so the
  // client never has to track the budget row id.
  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { client_id, period, amount } = req.body as { client_id?: string | null; period?: string; amount?: number }

    // Personal orgs have no visible clients — their budget is always org-level.
    const clientId = personal ? null : (client_id ?? null)
    if (period !== undefined && !isBudgetPeriod(period)) {
      return res.status(400).json({ error: "period must be lifetime, monthly, weekly or daily" })
    }
    const resolvedPeriod: BudgetPeriod = isBudgetPeriod(period) ? period : "monthly"
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: "amount must be a non-negative number" })
    if (amountExceedsLimit(amt)) return res.status(400).json({ error: "Amount is too large" })

    // A personal workspace's "budget" IS its primary spending budget.
    if (personal) {
      const primary = primaryBudget(await listBudgets(orgId, todayUtc()))
      if (amt === 0) {
        if (primary) {
          await db.delete(spendingBudgets).where(and(eq(spendingBudgets.id, primary.id), eq(spendingBudgets.organizationId, orgId)))
          await logAudit({ orgId, entityType: "budget", entityId: primary.id, action: "delete", actorId: userId, changes: { amount: { from: primary.amount, to: null } } })
        }
        return res.json({ ok: true, removed: true })
      }
      const v3 = fromV1Period(resolvedPeriod)
      if (primary) {
        const [row] = await db
          .update(spendingBudgets)
          .set({ amount: String(amt), period: v3, startDate: null, endDate: null, status: "active", updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(spendingBudgets.id, primary.id), eq(spendingBudgets.organizationId, orgId)))
          .returning()
        await logAudit({ orgId, entityType: "budget", entityId: primary.id, action: "update", actorId: userId, changes: {
          ...(primary.amount !== amt ? { amount: { from: primary.amount, to: amt } } : {}),
          ...(primary.period !== v3 ? { period: { from: primary.period, to: v3 } } : {}),
        } })
        return res.json({ ...serialize(row), client_id: null, period: resolvedPeriod, amount: amt, spent: primary.spent })
      }
      const [row] = await db
        .insert(spendingBudgets)
        .values({ organizationId: orgId, name: "", period: v3, amount: String(amt), categories: [], createdBy: userId, updatedBy: userId })
        .returning()
      await logAudit({ orgId, entityType: "budget", entityId: row.id, action: "create", actorId: userId, changes: { amount: { from: null, to: amt }, period: { from: null, to: v3 } } })
      return res.status(201).json({ ...serialize(row), client_id: null, period: resolvedPeriod, amount: amt, spent: 0 })
    }

    // Validate the client belongs to the org (when targeting a specific client).
    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      if (!client) return res.status(403).json({ error: "Forbidden" })
    }

    const where = and(
      eq(budgets.organizationId, orgId),
      clientId ? eq(budgets.clientId, clientId) : isNull(budgets.clientId),
    )
    const [existing] = await db.select().from(budgets).where(where)

    // Append-only history snapshot (best-effort — like logAudit, a failure here must
    // never block the budget save). Keyed by (org, client) so it survives a remove.
    const recordHistory = (amount: string, period: string, action: string) =>
      db.insert(budgetHistory)
        .values({ organizationId: orgId, clientId, amount, period, action, changedBy: userId })
        .catch((err) => { console.error("budget history insert failed", err) })

    // amount 0 → remove the budget (a clean "no budget" state).
    if (amt === 0) {
      if (existing) {
        await db.delete(budgets).where(eq(budgets.id, existing.id))
        await recordHistory("0", existing.period, "remove")
      }
      return res.json({ ok: true, removed: true })
    }

    const prevSnap = existing
      ? { amount: Number(existing.amount), period: existing.period as BudgetPeriod }
      : null
    const action = budgetChangeAction(prevSnap, { amount: amt, period: resolvedPeriod })

    const values = { period: resolvedPeriod, amount: String(amt), updatedBy: userId, updatedAt: new Date() }
    const [row] = existing
      ? await db.update(budgets).set(values).where(eq(budgets.id, existing.id)).returning()
      : await db
          .insert(budgets)
          .values({ organizationId: orgId, clientId, createdBy: userId, ...values })
          .returning()
    if (action) await recordHistory(String(amt), resolvedPeriod, action)
    return res.status(existing ? 200 : 201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
