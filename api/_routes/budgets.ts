import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { budgets, clients, transactions } from "../../src/lib/db/schema.js"
import { canWrite, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import { isBudgetPeriod, periodStart, type BudgetPeriod } from "../../src/lib/budget.js"

type PeriodSums = { daily: number; weekly: number; monthly: number; lifetime: number }

// Per-client outgoing (expense) totals for each window, in ONE grouped query, so a
// budget of any period just reads the matching column. Spend is derived here — the
// budgets table only stores the target + cadence.
async function outgoingByClient(orgId: string, now: Date): Promise<Map<string, PeriodSums>> {
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

const spentFor = (sums: PeriodSums | undefined, period: BudgetPeriod): number => (sums ? sums[period] : 0)

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

    // amount 0 → remove the budget (a clean "no budget" state).
    if (amt === 0) {
      if (existing) await db.delete(budgets).where(eq(budgets.id, existing.id))
      return res.json({ ok: true, removed: true })
    }

    const values = { period: resolvedPeriod, amount: String(amt), updatedBy: userId, updatedAt: new Date() }
    const [row] = existing
      ? await db.update(budgets).set(values).where(eq(budgets.id, existing.id)).returning()
      : await db
          .insert(budgets)
          .values({ organizationId: orgId, clientId, createdBy: userId, ...values })
          .returning()
    return res.status(existing ? 200 : 201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
