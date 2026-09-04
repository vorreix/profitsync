import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { db, dbBatch } from "../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetEnvelopes,
  budgetEvents,
  budgetPeriods,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import {
  checkReallocation,
  reallocationPreservesTotal,
  remaining,
  round2,
  type BudgetSection,
} from "../../../../src/lib/budget-math.js"
import { buildBudgetView, loadPlan } from "../../../_lib/budget-engine.js"

/**
 * POST /api/budgets/v2/reallocate — move planned money between two envelopes,
 * or cover an overspend from unallocated.
 *
 * Body: { from_envelope_id?, to_envelope_id, amount, allow_cross_section? }
 *   from_envelope_id omitted ⇒ the money comes from UNALLOCATED (§8.10), which
 *   raises total planned rather than moving it, and is therefore a separate,
 *   explicitly named action rather than a silent fallback.
 *
 * The invariant this route exists to protect: a move between envelopes leaves
 * plan-wide total planned UNCHANGED, so safe-to-spend does not move (§8.5.2).
 * It is asserted here after the write, not merely intended.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId, orgId, role, accountType } = ctx
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })
  if (plan.status !== "active") return res.status(409).json({ error: "plan_paused" })

  const body = req.body as {
    from_envelope_id?: string | null
    to_envelope_id?: string
    amount?: number
    allow_cross_section?: boolean
  }

  const toId = String(body.to_envelope_id ?? "")
  if (!toId) return res.status(400).json({ error: "to_envelope_id is required" })
  const fromId = body.from_envelope_id ? String(body.from_envelope_id) : null

  const amount = round2(Number(body.amount))
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be positive" })
  if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })

  const [open] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(desc(budgetPeriods.start))
    .limit(1)
  if (!open) return res.status(409).json({ error: "no_open_period", message: "Sync the plan first" })

  const ids = fromId ? [fromId, toId] : [toId]
  const envelopes = await db
    .select()
    .from(budgetEnvelopes)
    .where(
      and(
        eq(budgetEnvelopes.planId, plan.id),
        eq(budgetEnvelopes.organizationId, orgId),
        // A soft-removed envelope keeps its allocation row for history but is
        // excluded from buildBudgetView, so touching it would move planned
        // money the view no longer counts and break §8.5.2.
        ne(budgetEnvelopes.status, "removed"),
        inArray(budgetEnvelopes.id, ids),
      ),
    )
  const to = envelopes.find((e) => e.id === toId)
  const from = fromId ? envelopes.find((e) => e.id === fromId) : null
  if (!to || (fromId && !from)) return res.status(404).json({ error: "Envelope not found" })

  const allocs = await db
    .select()
    .from(budgetAllocations)
    .where(and(eq(budgetAllocations.periodId, open.id), inArray(budgetAllocations.envelopeId, ids)))
  const toAlloc = allocs.find((a) => a.envelopeId === toId)
  const fromAlloc = fromId ? allocs.find((a) => a.envelopeId === fromId) : null
  if (!toAlloc || (fromId && !fromAlloc)) {
    return res.status(409).json({ error: "no_allocation", message: "Sync the plan first" })
  }

  const num = (v: unknown) => (v == null ? 0 : Number(v))
  const toPlanned = round2(num(toAlloc.plannedAmount))

  // ── the two shapes of this action ─────────────────────────────────────────
  if (from && fromAlloc) {
    // Narrowed for the compiler: inside this branch the source is definite.
    const srcId: string = from.id
    // A MOVE. The source may only give away what it has not already committed:
    // planned minus what is spent and pending against it. Anything else would
    // be moving money that is already gone.
    const view = await buildBudgetView(orgId, role, accountType)
    const sections = view.sections as Record<string, { envelopes?: { id: string; spent_net: number; pending: number }[] }> | null
    const live = Object.values(sections ?? {}).flatMap((s) => s.envelopes ?? [])
    const fromLive = live.find((e) => e.id === srcId)
    // The ALLOCATION is what the write touches; what may be given away is the
    // EFFECTIVE planned figure the card shows — allocation + rollover (§8.8).
    // Rollover is untouched on both legs, so Σ(allocation + rollover) stays
    // invariant exactly when Σ allocation does.
    const fromPlanned = round2(num(fromAlloc.plannedAmount))
    const fromEffective = round2(fromPlanned + num(fromAlloc.rolloverIn))
    const fromAvailable = Math.max(
      0,
      remaining(fromEffective, fromLive?.spent_net ?? 0, fromLive?.pending ?? 0),
    )

    const check = checkReallocation({
      fromId: srcId,
      toId,
      amount,
      fromSection: from.section as BudgetSection,
      toSection: to.section as BudgetSection,
      fromAvailable,
      allowCrossSection: Boolean(body.allow_cross_section),
    })
    if (!check.ok) {
      const status = check.reason === "insufficient_source" ? 409 : 400
      return res.status(status).json({ error: check.reason, available: check.available ?? fromAvailable })
    }

    const nextFrom = round2(fromPlanned - amount)
    const nextTo = round2(toPlanned + amount)

    // Assert the invariance the UI promises BEFORE writing.
    if (!reallocationPreservesTotal({ fromPlanned, toPlanned }, { fromPlanned: nextFrom, toPlanned: nextTo })) {
      return res.status(500).json({ error: "reallocation_would_change_total" })
    }

    // ONE statement, so it is atomic — both legs and the audit row land
    // together or not at all — AND race-safe: the debit is a compare-and-set on
    // the source figure this request validated against, the credit is RELATIVE
    // and gated on the debit, and the event on the credit. Two concurrent moves
    // out of one source (two tabs, a double-tapped dialog) can therefore never
    // both succeed and raise total planned (invariant 2); the loser gets a 409
    // and the client reloads.
    const detail = {
      from: { id: srcId, name: from.name, was: fromPlanned, now: nextFrom, rollover_in: num(fromAlloc.rolloverIn) },
      to: { id: toId, name: to.name, was: toPlanned, now: nextTo },
      cross_section: from.section !== to.section,
    }
    const moved = await db.execute(sql`
      with debit as (
        update ${budgetAllocations}
           set planned_amount = ${String(nextFrom)}::numeric, updated_at = now(), updated_by = ${userId}
         where period_id = ${open.id} and envelope_id = ${srcId}
           and planned_amount = ${String(fromPlanned)}::numeric
         returning id
      ), credit as (
        update ${budgetAllocations}
           set planned_amount = planned_amount + ${String(amount)}::numeric, updated_at = now(), updated_by = ${userId}
         where period_id = ${open.id} and envelope_id = ${toId}
           and exists (select 1 from debit)
         returning planned_amount
      ), ev as (
        insert into ${budgetEvents}
          (organization_id, plan_id, period_id, envelope_id, related_envelope_id, action, amount, detail, actor_user_id)
        select ${orgId}, ${plan.id}, ${open.id}, ${toId}, ${srcId}, 'reallocated', ${String(amount)}::numeric, ${JSON.stringify(detail)}::jsonb, ${userId}
         where exists (select 1 from credit)
        returning id
      )
      select (select count(*)::int from debit) as debited, (select planned_amount::text from credit) as to_planned
    `)
    const outcome = ((moved as unknown as { rows?: { debited?: number; to_planned?: string }[] }).rows ?? [])[0]
    if (!outcome?.debited) {
      return res.status(409).json({
        error: "stale_source",
        message: "That category changed while you were deciding — reload and try again",
      })
    }
    const creditedTo = outcome.to_planned == null ? nextTo : round2(Number(outcome.to_planned))

    return res.json({
      moved: amount,
      from: { id: srcId, planned: nextFrom },
      to: { id: toId, planned: creditedTo },
      total_planned_unchanged: true,
    })
  }

  // ── COVER FROM UNALLOCATED ────────────────────────────────────────────────
  // This RAISES total planned, so it is only allowed up to what the period has
  // genuinely not committed. Letting it exceed unallocated would let the plan
  // claim capacity the period never had.
  const view = await buildBudgetView(orgId, role, accountType)
  const money = view.money as { unallocated_available?: number } | null
  const room = round2(money?.unallocated_available ?? 0)
  if (amount > room) {
    return res.status(409).json({ error: "insufficient_unallocated", available: room })
  }

  const nextTo = round2(toPlanned + amount)
  await dbBatch([
    // RELATIVE credit: two concurrent covers into one envelope cannot lose one.
    db
      .update(budgetAllocations)
      .set({ plannedAmount: sql`${budgetAllocations.plannedAmount} + ${String(amount)}::numeric`, updatedAt: new Date(), updatedBy: userId })
      .where(and(eq(budgetAllocations.periodId, open.id), eq(budgetAllocations.envelopeId, toId))),
    db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: open.id,
      envelopeId: toId,
      action: "covered_from_unallocated",
      amount: String(amount),
      previousAmount: String(toPlanned),
      detail: { to: { id: toId, name: to.name, was: toPlanned, now: nextTo }, unallocated_before: room },
      actorUserId: userId,
    }),
  ])

  return res.json({
    moved: amount,
    from: null,
    to: { id: toId, planned: nextTo },
    total_planned_unchanged: false,
  })
}
