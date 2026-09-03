import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, ne } from "drizzle-orm"
import { db, serialize } from "../../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetCommitments,
  budgetEnvelopes,
  budgetEvents,
  budgetPeriods,
} from "../../../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../../src/lib/money.js"
import {
  categoryConflicts,
  isCarryPolicy,
  isPriority,
  isTargetCadence,
  normalizeMatchKeys,
  normalizeTarget,
  periodDays,
  round2,
  type TargetCadence,
} from "../../../../../src/lib/budget-math.js"
import { loadPlan } from "../../../../_lib/budget-engine.js"

// PATCH  /api/budgets/v2/envelopes/:id — rename, retarget, recategorise
// DELETE /api/budgets/v2/envelopes/:id — remove (SOFT: status = removed)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const id = String(req.query.id ?? "")
  if (!id) return res.status(400).json({ error: "Missing id" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  // Scoped by BOTH plan and org: an id from another workspace must 404, never
  // leak that the row exists.
  const [envelope] = await db
    .select()
    .from(budgetEnvelopes)
    .where(
      and(eq(budgetEnvelopes.id, id), eq(budgetEnvelopes.planId, plan.id), eq(budgetEnvelopes.organizationId, orgId)),
    )
  if (!envelope || envelope.status === "removed") return res.status(404).json({ error: "Envelope not found" })

  const [open] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(desc(budgetPeriods.start))
    .limit(1)

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

    const body = req.body as {
      name?: string
      target_amount?: number
      target_cadence?: string
      match_keys?: string[]
      carry_policy?: string
      carry_cap?: number | null
      priority?: string
      reimbursable?: boolean
      auto_fund?: boolean
      status?: string
      position?: number
      icon?: string
    }

    const patch: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return res.status(400).json({ error: "name is required" })
      if (name.length > 80) return res.status(400).json({ error: "name is too long" })
      patch.name = name
    }

    let newTarget: number | null = null
    if (body.target_amount !== undefined) {
      newTarget = Number(body.target_amount)
      if (!Number.isFinite(newTarget) || newTarget < 0) {
        return res.status(400).json({ error: "target_amount must be zero or more" })
      }
      if (amountExceedsLimit(newTarget)) return res.status(400).json({ error: "Amount is too large" })
      patch.targetAmount = String(round2(newTarget))
    }
    if (body.target_cadence !== undefined && isTargetCadence(body.target_cadence)) {
      patch.targetCadence = body.target_cadence
    }

    if (body.match_keys !== undefined) {
      // The catch-all claims "everything not claimed"; giving it explicit keys
      // would make it both the specific and the general case at once.
      if (envelope.isCatchAll) {
        return res.status(400).json({ error: "The catch-all envelope tracks whatever is left over, so it has no categories" })
      }
      const keys = normalizeMatchKeys(body.match_keys)

      // Same rule as create: a spending category with no categories tracks
      // nothing. Refusing here matters more than on create, because emptying an
      // existing envelope would silently stop counting spend it had been
      // counting yesterday and hand it to the catch-all instead.
      if (envelope.section === "flexible" && !keys.length) {
        return res.status(400).json({
          error: "categories_required",
          message: "Keep at least one category, otherwise this would stop tracking anything",
        })
      }

      if (keys.length) {
        const others = await db
          .select({ id: budgetEnvelopes.id, name: budgetEnvelopes.name, matchKeys: budgetEnvelopes.matchKeys })
          .from(budgetEnvelopes)
          .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
        const conflicts = categoryConflicts(
          keys,
          others
            .filter((o) => o.id !== envelope.id) // its OWN keys are not a conflict
            .map((o) => ({ id: o.id, name: o.name, matchKeys: (o.matchKeys as string[] | null) ?? [] })),
        )
        if (conflicts.length) {
          return res.status(409).json({
            error: "category_claimed",
            message: `Already tracked by ${conflicts.map((c) => c.envelopeName).join(", ")}`,
            conflicts,
          })
        }
      }
      patch.matchKeys = keys
    }

    if (body.carry_policy !== undefined && isCarryPolicy(body.carry_policy)) patch.carryPolicy = body.carry_policy
    if (body.carry_cap !== undefined) {
      patch.carryCap = body.carry_cap == null ? null : String(round2(Number(body.carry_cap)))
    }
    if (body.priority !== undefined && isPriority(body.priority)) patch.priority = body.priority
    if (body.reimbursable !== undefined) patch.reimbursable = Boolean(body.reimbursable)
    if (body.auto_fund !== undefined && envelope.section === "savings") patch.autoFund = Boolean(body.auto_fund)
    if (body.status !== undefined && (body.status === "active" || body.status === "paused")) patch.status = body.status
    if (body.position !== undefined && Number.isFinite(Number(body.position))) {
      patch.position = Math.trunc(Number(body.position))
    }
    if (body.icon !== undefined) patch.icon = String(body.icon).slice(0, 40)

    let updated
    try {
      ;[updated] = await db.update(budgetEnvelopes).set(patch).where(eq(budgetEnvelopes.id, envelope.id)).returning()
    } catch (err) {
      if (violates(err, "budget_envelopes_plan_name_unique")) {
        return res.status(409).json({ error: "name_taken", message: "You already have an envelope with that name" })
      }
      throw err
    }

    // Re-plan the OPEN period when the target changed. Rollover is preserved:
    // it is money the previous period actually left behind and retargeting must
    // not silently confiscate it (§8.12).
    if (newTarget != null && open) {
      const days = periodDays({ start: open.start, endExclusive: open.endExclusive })
      const cadence = (patch.targetCadence ?? envelope.targetCadence) as TargetCadence
      const planned = normalizeTarget(round2(newTarget), cadence, days)
      await db
        .update(budgetAllocations)
        .set({
          plannedAmount: String(planned),
          authoredAmount: String(round2(newTarget)),
          authoredCadence: cadence,
        })
        .where(and(eq(budgetAllocations.periodId, open.id), eq(budgetAllocations.envelopeId, envelope.id)))
    }

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: open?.id ?? null,
      envelopeId: envelope.id,
      action: newTarget != null ? "envelope_retargeted" : "envelope_updated",
      amount: newTarget != null ? String(round2(newTarget)) : null,
      previousAmount: newTarget != null ? String(round2(Number(envelope.targetAmount))) : null,
      detail: { fields: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt") },
      actorUserId: userId,
    })

    return res.json({ envelope: serialize(updated) })
  }

  // ── REMOVE ────────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

    // The catch-all is what gives the plan a ceiling at all: without it,
    // safe-to-spend degrades to cash-only and stops being a budget (§8.5).
    if (envelope.isCatchAll) {
      return res.status(400).json({ error: "catch_all_required", message: "The leftover envelope cannot be removed" })
    }

    // A commitment envelope still holding active commitments would orphan them.
    const active = await db
      .select({ id: budgetCommitments.id, name: budgetCommitments.name })
      .from(budgetCommitments)
      .where(and(eq(budgetCommitments.envelopeId, envelope.id), eq(budgetCommitments.status, "active")))
    if (active.length) {
      return res.status(409).json({
        error: "has_commitments",
        message: `Move or remove ${active.length} bill(s) first`,
        commitments: active,
      })
    }

    // SOFT removal. Allocations, occurrences and closed snapshots keep
    // referencing it, so history stays readable — the v1 lesson (defect #12).
    const [removed] = await db
      .update(budgetEnvelopes)
      .set({ status: "removed", updatedBy: userId, updatedAt: new Date() })
      .where(eq(budgetEnvelopes.id, envelope.id))
      .returning()

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: open?.id ?? null,
      envelopeId: envelope.id,
      action: "envelope_removed",
      previousAmount: String(round2(Number(envelope.targetAmount))),
      detail: { name: envelope.name, section: envelope.section },
      actorUserId: userId,
    })

    return res.json({ envelope: serialize(removed) })
  }

  return res.status(405).json({ error: "Method not allowed" })
}

/**
 * Did this error violate the named constraint?
 *
 * A NeonDbError puts the constraint in `.constraint` and the offending row in
 * `.detail`; the `.message` is often just "duplicate key value violates unique
 * constraint" with the name quoted, and for a UNIQUE INDEX (as opposed to a
 * table constraint) `.constraint` can be absent entirely. Checking all three is
 * what makes the difference between a helpful 409 and a bare 500.
 */
function violates(err: unknown, constraint: string): boolean {
  // Drizzle wraps the driver error in a DrizzleQueryError whose `message` is the
  // SQL text, so the constraint name lives on `.cause` (the NeonDbError). Walk
  // the chain rather than inspecting only the outer error, which is what made
  // every unique violation surface as a 500 instead of a helpful 409.
  let node: unknown = err
  for (let depth = 0; node && typeof node === "object" && depth < 5; depth++) {
    const e = node as { constraint?: unknown; detail?: unknown; message?: unknown; cause?: unknown }
    if (typeof e.constraint === "string" && e.constraint === constraint) return true
    if ([e.message, e.detail].some((v) => typeof v === "string" && v.includes(constraint))) return true
    node = e.cause
  }
  return false
}
