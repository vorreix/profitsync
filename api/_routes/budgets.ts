import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { budgetHistory, budgets, clients } from "../../src/lib/db/schema.js"
import { canWrite, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import { isBudgetPeriod, type BudgetPeriod } from "../../src/lib/budget.js"
import { budgetChangeAction } from "../../src/lib/budget-history.js"
import { outgoingByClient, spentFor, type PeriodSums } from "../_lib/budget-spend.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const personal = isPersonalAccount(ctx)

  if (req.method === "GET") {
    const now = new Date()
    const [rows, byClient] = await Promise.all([
      db.select().from(budgets).where(eq(budgets.organizationId, orgId)),
      outgoingByClient(orgId, now),
    ])
    // Org-wide totals (used for the personal budget's spend — a personal org has a
    // single anchor client, so this is just its spend).
    const orgTotals: PeriodSums = { daily: 0, weekly: 0, monthly: 0, lifetime: 0 }
    for (const s of byClient.values()) {
      orgTotals.daily += s.daily; orgTotals.weekly += s.weekly
      orgTotals.monthly += s.monthly; orgTotals.lifetime += s.lifetime
    }

    const out = rows.map((b) => {
      const period = (isBudgetPeriod(b.period) ? b.period : "monthly") as BudgetPeriod
      let spent: number | null
      if (b.clientId) {
        spent = spentFor(byClient.get(b.clientId), period)
      } else if (personal) {
        spent = orgTotals[period] // personal budget = whole-workspace spend
      } else {
        spent = null // business default is a template (per-client spend isn't one number)
      }
      return { ...serialize(b), spent }
    })
    return res.json({ budgets: out, account_type: ctx.accountType })
  }

  // POST = upsert a budget for (org, client_id). amount <= 0 clears it. This is the
  // single endpoint the budget dialog calls (set / change / remove), so the client
  // never has to track the budget row id.
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
