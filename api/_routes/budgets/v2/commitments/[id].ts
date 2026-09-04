import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../../../src/lib/db/index.js"
import { budgetCommitments, budgetEnvelopes, budgetEvents } from "../../../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../../src/lib/money.js"
import { isIsoDate, round2 } from "../../../../../src/lib/budget-math.js"
import { loadPlan } from "../../../../_lib/budget-engine.js"

// PATCH  /api/budgets/v2/commitments/:id — amount, due date, envelope, pause
// DELETE /api/budgets/v2/commitments/:id — stop tracking (status = cancelled)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const id = String(req.query.id ?? "")
  if (!id) return res.status(400).json({ error: "Missing id" })
  // A malformed id is "not found", not a 22P02 from the uuid cast (a 500).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(404).json({ error: "Commitment not found" })
  }

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  const [commitment] = await db
    .select()
    .from(budgetCommitments)
    .where(
      and(
        eq(budgetCommitments.id, id),
        eq(budgetCommitments.planId, plan.id),
        eq(budgetCommitments.organizationId, orgId),
      ),
    )
  if (!commitment) return res.status(404).json({ error: "Commitment not found" })

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

    const body = req.body as {
      name?: string
      amount?: number
      due_date?: string
      envelope_id?: string
      status?: string
      clear_attention?: boolean
    }
    const patch: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() }

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return res.status(400).json({ error: "name is required" })
      patch.name = name.slice(0, 80)
    }

    let newAmount: number | null = null
    if (body.amount !== undefined) {
      // A recurring commitment takes its amount from the rule, so editing it
      // here would produce a budget figure that disagrees with what is actually
      // posted. The rule is the thing to edit.
      if (commitment.kind === "recurring") {
        return res.status(400).json({
          error: "amount_owned_by_rule",
          message: "Change the amount on the recurring expense itself",
        })
      }
      newAmount = round2(Number(body.amount))
      if (!Number.isFinite(newAmount) || newAmount <= 0) return res.status(400).json({ error: "amount must be positive" })
      if (amountExceedsLimit(newAmount)) return res.status(400).json({ error: "Amount is too large" })
      patch.amount = String(newAmount)
    }

    if (body.due_date !== undefined) {
      if (commitment.kind !== "one_time") {
        return res.status(400).json({ error: "due_date_owned_by_rule", message: "Reschedule the occurrence instead" })
      }
      if (!isIsoDate(body.due_date)) return res.status(400).json({ error: "due_date must be YYYY-MM-DD" })
      patch.dueDate = body.due_date
      // firstDueDate anchors the carry window, so it moves with the due date —
      // otherwise a bill moved forward would still be projected from its old
      // anchor and reappear as overdue.
      patch.firstDueDate = body.due_date
    }

    if (body.envelope_id !== undefined) {
      const [target] = await db
        .select()
        .from(budgetEnvelopes)
        .where(
          and(
            eq(budgetEnvelopes.id, String(body.envelope_id)),
            eq(budgetEnvelopes.planId, plan.id),
            eq(budgetEnvelopes.organizationId, orgId),
          ),
        )
      if (!target || target.status === "removed") return res.status(404).json({ error: "Envelope not found" })
      if (target.section !== "commitment" && target.section !== "debt") {
        return res.status(400).json({ error: "wrong_section" })
      }
      patch.envelopeId = target.id
    }

    if (body.status !== undefined) {
      // Cancelling goes through DELETE: it is owner/admin-gated there and
      // records the commitment_cancelled event (§10.9, §18.2). A PATCH must not
      // reach the same state under canWrite and a commitment_updated event.
      if (String(body.status) === "cancelled") {
        return res.status(400).json({ error: "use_delete", message: "Cancel a commitment with DELETE" })
      }
      if (!["active", "paused", "completed"].includes(String(body.status))) {
        return res.status(400).json({ error: "invalid status" })
      }
      patch.status = body.status
    }

    // Acknowledging the pile-up is a user decision; the flag is recurring-only,
    // and the DB CHECK makes it unrepresentable on a one-time commitment.
    if (body.clear_attention && commitment.kind === "recurring") patch.needsAttention = false

    const [updated] = await db
      .update(budgetCommitments)
      .set(patch)
      .where(eq(budgetCommitments.id, commitment.id))
      .returning()

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      envelopeId: (patch.envelopeId as string | undefined) ?? commitment.envelopeId,
      action: "commitment_updated",
      amount: newAmount != null ? String(newAmount) : null,
      previousAmount: newAmount != null ? String(round2(Number(commitment.amount))) : null,
      detail: { fields: Object.keys(patch).filter((k) => k !== "updatedBy" && k !== "updatedAt") },
      actorUserId: userId,
    })

    return res.json({ commitment: serialize(updated) })
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

    // SOFT: cancelled, never deleted. Its occurrences and their settlements are
    // history — a bill that was paid stays paid in the record.
    const [cancelled] = await db
      .update(budgetCommitments)
      .set({ status: "cancelled", updatedBy: userId, updatedAt: new Date() })
      .where(eq(budgetCommitments.id, commitment.id))
      .returning()

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      envelopeId: commitment.envelopeId,
      action: "commitment_cancelled",
      previousAmount: String(round2(Number(commitment.amount))),
      detail: { name: commitment.name, kind: commitment.kind },
      actorUserId: userId,
    })

    return res.json({ commitment: serialize(cancelled) })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
