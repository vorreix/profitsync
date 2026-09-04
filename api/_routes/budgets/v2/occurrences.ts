import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import {
  budgetCommitments,
  budgetEvents,
  budgetOccurrences,
  recurringRules,
  transactions,
} from "../../../../src/lib/db/schema.js"
import { occurrencesDue } from "../../../../src/lib/recurring.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import {
  allowedOccurrenceActions,
  carryLowerBound,
  checkReschedule,
  effectiveOccurrenceStatus,
  isIsoDate,
  periodFor,
  round2,
  type OccurrenceState,
} from "../../../../src/lib/budget-math.js"
import { cadenceOf, loadPlan, planToday } from "../../../_lib/budget-engine.js"

/**
 * POST /api/budgets/v2/occurrences — act on one projected occurrence.
 *
 * Body: { commitment_id, due_date, action, amount?, to_date?, note? }
 *   action ∈ settle | cancel | skip | reschedule
 *
 * An occurrence is an EXPECTATION, and this route keeps it that way: it writes
 * a DEVIATION row and touches no balance, no transaction and no wealth account.
 * "Mark as paid" records that the money moved elsewhere; it does not move it.
 * Anything else would let a budget silently invent a transaction.
 *
 * Only deviations are stored. `expected` is projected in memory and `overdue` is
 * derived from the due date, so neither can go stale (§8.6).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId, orgId, role } = ctx
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })
  if (plan.status !== "active") return res.status(409).json({ error: "plan_paused" })

  const body = req.body as {
    commitment_id?: string
    due_date?: string
    action?: string
    amount?: number
    to_date?: string
    note?: string
  }

  const action = String(body.action ?? "")
  if (!["settle", "cancel", "skip", "reschedule"].includes(action)) {
    return res.status(400).json({ error: "action must be settle, cancel, skip or reschedule" })
  }
  if (!isIsoDate(body.due_date)) return res.status(400).json({ error: "due_date must be YYYY-MM-DD" })

  const [commitment] = await db
    .select()
    .from(budgetCommitments)
    .where(
      and(
        eq(budgetCommitments.id, String(body.commitment_id ?? "")),
        eq(budgetCommitments.planId, plan.id),
        eq(budgetCommitments.organizationId, orgId),
      ),
    )
  if (!commitment) return res.status(404).json({ error: "Commitment not found" })
  if (commitment.status === "cancelled") return res.status(409).json({ error: "commitment_cancelled" })

  // Existing deviations for this commitment: both the state gate and the
  // reschedule collision check need them. Joined to the settling transaction so
  // a bill whose payment was since trashed reads as EXPECTED again (§10.15) and
  // can be re-settled, skipped or moved instead of being refused as "settled".
  const existingRows = await db
    .select({ occ: budgetOccurrences, txId: transactions.id, txDeletedAt: transactions.deletedAt })
    .from(budgetOccurrences)
    .leftJoin(transactions, eq(transactions.id, budgetOccurrences.settledTransactionId))
    .where(eq(budgetOccurrences.commitmentId, commitment.id))
  const existing = existingRows.map((r) => r.occ)

  const currentRow = existingRows.find((r) => r.occ.dueDate === body.due_date)
  const currentState: OccurrenceState = currentRow
    ? effectiveOccurrenceStatus(currentRow.occ, { id: currentRow.txId, deletedAt: currentRow.txDeletedAt })
    : "expected"

  // A settled or cancelled occurrence is closed. Re-acting on one would rewrite
  // a recorded fact, so it is refused with the states that ARE available.
  const allowed = allowedOccurrenceActions(currentState)
  if (!allowed.includes(action as (typeof allowed)[number])) {
    return res.status(409).json({
      error: "action_not_allowed",
      message: `This is already ${currentState}`,
      state: currentState,
      allowed,
    })
  }

  const today = planToday(plan)
  const values: Record<string, unknown> = {
    commitmentId: commitment.id,
    organizationId: orgId,
    dueDate: body.due_date,
    actorUserId: userId,
    note: String(body.note ?? "").slice(0, 500),
  }

  if (action === "settle") {
    // The amount may legitimately differ from the plan: a bill came in higher.
    // Defaulting to the commitment amount keeps the one-tap case one tap.
    const amount = body.amount == null ? round2(Number(commitment.amount)) : round2(Number(body.amount))
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be positive" })
    if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    values.status = "settled"
    values.settledAmount = String(amount)
    values.settledAt = new Date()
    // settledTransactionId stays NULL: this records that the obligation is met,
    // not that a specific row paid it. The recurring path in sync fills it in
    // when a real posted transaction matches.
  } else if (action === "cancel") {
    values.status = "cancelled"
  } else if (action === "skip") {
    values.status = "skipped"
  } else {
    if (!isIsoDate(body.to_date)) return res.status(400).json({ error: "to_date must be YYYY-MM-DD" })

    // A recurring occurrence may not be moved behind its own carry window: the
    // projection would stop generating it and the move would silently erase it.
    const cadence = cadenceOf(plan)
    const window = periodFor(cadence, today)
    const lower =
      commitment.kind === "recurring"
        ? carryLowerBound(
            { kind: "recurring", dueDate: commitment.dueDate, firstDueDate: commitment.firstDueDate },
            window.start,
            today,
          )
        : null

    // UNDO: moving a payment back onto the date it was moved FROM. Inserting a
    // second row (B → A) would form a cycle the projection resolves to NOTHING —
    // the bill would vanish from pending and reserved. Deleting the original
    // move restores the natural occurrence at A instead.
    const undo = existing.find((o) => o.status === "rescheduled" && o.rescheduledTo === body.due_date && o.dueDate === body.to_date)
    if (undo) {
      await db.delete(budgetOccurrences).where(eq(budgetOccurrences.id, undo.id))
      await db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        envelopeId: commitment.envelopeId,
        action: "occurrence_reschedule",
        detail: {
          commitment_id: commitment.id,
          commitment_name: commitment.name,
          due_date: body.due_date,
          was: currentState,
          rescheduled_to: body.to_date,
          undo_of: undo.id,
          overdue_when_actioned: String(body.due_date) < today,
        },
        actorUserId: userId,
      })
      return res.json({ occurrence: null, restored: { commitment_id: commitment.id, due_date: body.to_date } })
    }

    // Every OTHER stored row occupies its own due_date (a consumed original stays
    // consumed — the projection drops any target that has a stored row there,
    // §10.6) AND its target, so the unique constraint on (commitment_id,
    // due_date) is never the thing that reports the clash.
    const taken = existing
      .filter((o) => o.dueDate !== body.due_date)
      .flatMap((o) => (o.rescheduledTo ? [o.dueDate, o.rescheduledTo] : [o.dueDate]))

    // A recurring rule's NATURAL dates are occupied too, stored or not: landing a
    // move on the rule's next date would merge two obligations into one
    // reservation (§8.6.1 "counted exactly once"). One-shot membership check,
    // horizon-independent — a next-period target is the common case.
    if (commitment.kind === "recurring" && commitment.recurringRuleId) {
      const [rule] = await db.select().from(recurringRules).where(eq(recurringRules.id, commitment.recurringRuleId))
      if (rule) {
        const { due } = occurrencesDue({
          anchor: rule.startDate,
          freq: { unit: rule.frequencyUnit as "day" | "week" | "month" | "year", interval: rule.frequencyInterval },
          cursor: body.to_date,
          until: body.to_date,
          end: rule.endDate,
        })
        taken.push(...due.filter((d: string) => d !== body.due_date))
      }
    }

    const check = checkReschedule({
      toDate: body.to_date,
      currentDate: body.due_date,
      taken,
      lowerBound: lower,
    })
    if (!check.ok) {
      const message =
        check.reason === "collision"
          ? "Another payment is already due on that date"
          : check.reason === "before_window"
            ? "That date is too far in the past to track"
            : undefined
      return res.status(check.reason === "collision" ? 409 : 400).json({ error: check.reason, message })
    }

    values.status = "rescheduled"
    values.rescheduledTo = check.date
  }

  // Idempotent by (commitment_id, due_date): acting twice updates the single
  // deviation row rather than creating a second one the projection would then
  // have to disambiguate.
  const [occurrence] = await db
    .insert(budgetOccurrences)
    .values(values as typeof budgetOccurrences.$inferInsert)
    .onConflictDoUpdate({
      target: [budgetOccurrences.commitmentId, budgetOccurrences.dueDate],
      set: {
        status: values.status as string,
        rescheduledTo: (values.rescheduledTo as string | undefined) ?? null,
        settledAmount: (values.settledAmount as string | undefined) ?? null,
        settledAt: (values.settledAt as Date | undefined) ?? null,
        actorUserId: userId,
        note: values.note as string,
      },
    })
    .returning()

  await db.insert(budgetEvents).values({
    organizationId: orgId,
    planId: plan.id,
    envelopeId: commitment.envelopeId,
    action: `occurrence_${action}`,
    amount: (values.settledAmount as string | undefined) ?? null,
    detail: {
      commitment_id: commitment.id,
      commitment_name: commitment.name,
      due_date: body.due_date,
      was: currentState,
      ...(values.rescheduledTo ? { rescheduled_to: values.rescheduledTo } : {}),
      overdue_when_actioned: String(body.due_date) < today,
    },
    actorUserId: userId,
  })

  return res.json({ occurrence: serialize(occurrence) })
}
