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
import { violates } from "../../../../_lib/db-errors.js"
import { parseGoal, parseTargetDate } from "../../../../_lib/spaces.js"
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
  type PlanCadence,
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
  // A malformed id is "not found", not a 22P02 from the uuid cast (a 500).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(404).json({ error: "Envelope not found" })
  }

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
      goal_amount?: number | string | null
      target_date?: string | null
      position?: number
      icon?: string
      parent_id?: string | null
      hidden?: boolean
      status?: string
    }

    const patch: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() }

    // ── the budgets list (docs/budget-v2/SIMPLE.md) ─────────────────────────
    // Move into / out of a group. Only a category can be grouped, only into a
    // live group of THIS plan, and the catch-all stays at the top level — it is
    // the plan's ceiling and must never be silenced by deactivating a group.
    if (body.parent_id !== undefined) {
      if (envelope.kind === "group") return res.status(400).json({ error: "A group cannot be inside another group" })
      if (envelope.section !== "flexible") return res.status(400).json({ error: "Only a spending budget can be grouped" })
      if (envelope.isCatchAll && body.parent_id != null) {
        return res.status(400).json({ error: "catch_all_ungrouped", message: "The leftover budget stays at the top level" })
      }
      if (body.parent_id == null) {
        patch.parentId = null
      } else {
        const raw = String(body.parent_id).trim()
        const [group] = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
          ? await db
              .select({ id: budgetEnvelopes.id })
              .from(budgetEnvelopes)
              .where(
                and(
                  eq(budgetEnvelopes.id, raw),
                  eq(budgetEnvelopes.planId, plan.id),
                  eq(budgetEnvelopes.kind, "group"),
                  ne(budgetEnvelopes.status, "removed"),
                ),
              )
          : []
        if (!group) return res.status(404).json({ error: "group_not_found", message: "That group does not exist" })
        patch.parentId = group.id
      }
    }
    // Hidden is display only — the budget still counts everywhere.
    if (body.hidden !== undefined) patch.hidden = Boolean(body.hidden)
    // Inactive = paused. The engine gives it semantics now: no claimed
    // categories, no planned amount, out of every total (buildBudgetView reads
    // only effectively-active lines). The catch-all cannot be paused — without
    // it the plan has no ceiling (invariant 5).
    if (body.status !== undefined) {
      if (!["active", "paused"].includes(String(body.status))) {
        return res.status(400).json({ error: "status must be active or paused" })
      }
      if (envelope.isCatchAll && body.status === "paused") {
        return res.status(400).json({ error: "catch_all_required", message: "The leftover budget cannot be deactivated" })
      }
      patch.status = body.status
    }

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
      // §8.12: NULL is "no cap"; 0 means "carry nothing". Validated so a NaN
      // can never be stored (numeric accepts 'NaN').
      if (body.carry_cap == null) {
        patch.carryCap = null
      } else {
        const cap = Number(body.carry_cap)
        if (!Number.isFinite(cap) || cap < 0) return res.status(400).json({ error: "carry_cap must be zero or more" })
        if (amountExceedsLimit(cap)) return res.status(400).json({ error: "Amount is too large" })
        patch.carryCap = String(round2(cap))
      }
    }
    if (body.priority !== undefined && isPriority(body.priority)) patch.priority = body.priority
    if (body.reimbursable !== undefined) patch.reimbursable = Boolean(body.reimbursable)
    if (body.auto_fund !== undefined && envelope.section === "savings") patch.autoFund = Boolean(body.auto_fund)
    // A fund's goal and target date are editable (the dialog sends them); its
    // funding MODE is not — §6.10 makes a mode change a confirmed transfer
    // plus an audited event, so a flipped column without moved money would
    // drop a virtual fund's reserved balance from the view.
    if (body.goal_amount !== undefined && envelope.section === "savings") {
      const goal = parseGoal(body.goal_amount)
      if (goal === "invalid") return res.status(400).json({ error: "goal_amount is invalid" })
      patch.goalAmount = goal
    }
    if (body.target_date !== undefined && envelope.section === "savings") {
      const date = parseTargetDate(body.target_date)
      if (date === "invalid") return res.status(400).json({ error: "target_date must be YYYY-MM-DD" })
      patch.targetDate = date
    }
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

    // Re-plan the OPEN period when the TARGET changed. The target is
    // (amount, cadence) — §10.3 — and normalisation is a pure function of
    // (amount, cadence, period) — §8.7 — so a cadence-only change re-plans
    // too (the dialog sends a constant "period", so only a real change counts).
    // Rollover is preserved: rollover_in is its own column and is not touched —
    // it is money the previous period actually left behind and retargeting
    // must not silently confiscate it (§8.12).
    const cadenceChanged = patch.targetCadence !== undefined && patch.targetCadence !== envelope.targetCadence
    const retargeted = newTarget != null || cadenceChanged
    const cadence = (patch.targetCadence ?? envelope.targetCadence) as TargetCadence
    const authored = round2(newTarget ?? Number(envelope.targetAmount))
    if (retargeted && open) {
      const days = periodDays({ start: open.start, endExclusive: open.endExclusive })
      const planned = normalizeTarget(authored, cadence, days, plan.cadence as PlanCadence)
      await db
        .update(budgetAllocations)
        .set({
          plannedAmount: String(planned),
          authoredAmount: String(authored),
          authoredCadence: cadence,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(and(eq(budgetAllocations.periodId, open.id), eq(budgetAllocations.envelopeId, envelope.id)))
    }

    // Reactivated mid-period: the period was opened without it (only active
    // envelopes are allocated at open), so give it its allocation NOW or it
    // would sit at zero until the next period. Idempotent — an allocation that
    // survived a pause is left alone.
    const reactivated = patch.status === "active" && envelope.status !== "active"
    if (reactivated && open && envelope.kind === "category") {
      const days = periodDays({ start: open.start, endExclusive: open.endExclusive })
      const planned = normalizeTarget(authored, cadence, days, plan.cadence as PlanCadence)
      await db
        .insert(budgetAllocations)
        .values({
          periodId: open.id,
          envelopeId: envelope.id,
          organizationId: orgId,
          plannedAmount: String(planned),
          authoredAmount: String(authored),
          authoredCadence: cadence,
          rolloverIn: "0",
          contributionStatus: envelope.section === "savings" ? "planned" : null,
        })
        .onConflictDoNothing()
    }

    const statusChanged = patch.status !== undefined && patch.status !== envelope.status
    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: open?.id ?? null,
      envelopeId: envelope.id,
      action: retargeted
        ? "envelope_retargeted"
        : statusChanged
          ? patch.status === "paused"
            ? "envelope_deactivated"
            : "envelope_activated"
          : "envelope_updated",
      amount: retargeted ? String(authored) : null,
      previousAmount: retargeted ? String(round2(Number(envelope.targetAmount))) : null,
      detail: {
        fields: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt"),
        ...(cadenceChanged ? { cadence: { was: envelope.targetCadence, now: cadence } } : {}),
      },
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

    // Removing a GROUP keeps every budget inside it — they move to the top
    // level. The FK is ON DELETE SET NULL, but this is a soft delete, so the
    // detach is explicit (docs/budget-v2/SIMPLE.md).
    if (envelope.kind === "group") {
      await db
        .update(budgetEnvelopes)
        .set({ parentId: null, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(budgetEnvelopes.parentId, envelope.id), eq(budgetEnvelopes.planId, plan.id)))
    }

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: open?.id ?? null,
      envelopeId: envelope.id,
      action: "envelope_removed",
      previousAmount: String(round2(Number(envelope.targetAmount))),
      detail: { name: envelope.name, section: envelope.section, kind: envelope.kind },
      actorUserId: userId,
    })

    return res.json({ envelope: serialize(removed) })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
