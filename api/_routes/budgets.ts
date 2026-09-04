import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { budgetHistory, budgets, clients } from "../../src/lib/db/schema.js"
import { canDelete, canWrite, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import { isBudgetPeriod, type BudgetPeriod } from "../../src/lib/budget.js"
import { budgetChangeAction } from "../../src/lib/budget-history.js"
import { outgoingByClient, spentFor, type PeriodSums } from "../_lib/budget-spend.js"
import { applyV1Write, noteAdapterRead, projectPlanToV1 } from "../_lib/budget-v1-adapter.js"
import { loadPlan } from "../_lib/budget-engine.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const personal = isPersonalAccount(ctx)

  if (req.method === "GET") {
    // v1 CONTRACT, PRESERVED. When this org has a Budget v2 plan, project it down
    // to the v1 shape rather than changing this path's response — the Android and
    // iOS apps run a store-pinned bundle and cannot be pushed a fix (spec §11.1).
    const projected = await projectPlanToV1(orgId, role, ctx.accountType)
    if (projected) {
      const [plan] = [await loadPlan(orgId)]
      if (plan) noteAdapterRead(orgId, plan.id)
      // `projected` IS the v1 envelope — { budgets, account_type } — so it is
      // returned as-is. Wrapping it again would nest budgets inside budgets and
      // give every store-pinned native bundle an empty list, which is exactly
      // the breakage this adapter exists to prevent.
      return res.json(projected)
    }

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

    // v1 WRITE, PRESERVED. An old client editing a workspace budget is routed to
    // the v2 plan's catch-all envelope. amount <= 0 PAUSES the plan rather than
    // deleting it: deleting a v2 plan from a v1 client would silently destroy
    // envelopes, commitments and funds the old client cannot even see (§11.1).
    //
    // PERSONAL ONLY — the same rule as projectPlanToV1 (§23, HANDOFF §3): a
    // business workspace's `budgets` rows ARE its per-client caps and its
    // client_id=NULL row is the company default template, so a stray plan on a
    // business org must never capture that write. Without this guard GET reads
    // the v1 tables while POST writes somewhere GET never shows.
    const v2Plan = personal ? await loadPlan(orgId) : null
    if (v2Plan) {
      // `clientId` is always null for a personal org (see above).
      // §18.2: pause/resume is owner/admin. The v1 adapter must not be a looser
      // path to the same state change than PATCH /api/budgets/v2 { status }.
      // loadPlan() never returns an archived plan, so status is active | paused.
      const changesStatus = amt <= 0 || v2Plan.status === "paused"
      if (changesStatus && !canDelete(role)) return res.status(403).json({ error: "Forbidden" })
      const result = await applyV1Write({ orgId, plan: v2Plan, period, amount: amt, actorUserId: userId })
      // A lifetime cap has no period and cannot become a per-period target
      // (§13.4) — tell the old client instead of silently re-denominating it.
      if (result.rejected) return res.status(409).json({ error: result.rejected })
      return result.paused ? res.json({ ok: true, removed: true }) : res.json({ ok: true })
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
