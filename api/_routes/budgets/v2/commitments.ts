import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import {
  budgetCommitments,
  budgetEnvelopes,
  budgetEvents,
  recurringRules,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import { isIsoDate, round2 } from "../../../../src/lib/budget-math.js"
import { loadPlan } from "../../../_lib/budget-engine.js"

// GET  /api/budgets/v2/commitments — bills and debt payments, with their rules
// POST /api/budgets/v2/commitments — add a one-time bill, or track a recurring rule
//
// A RECURRING commitment LINKS an existing `recurring_rules` row; it never
// creates one. That boundary matters twice over: recurring rules are a
// Maqbool-owned feature that materialises real transactions, and the
// auto-settle path in sync matches posted rows on
// (recurring_rule_id, recurring_due_date) — the key the materialiser already
// writes. A budget-owned copy of that schedule would drift from the rule that
// actually moves the money.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  if (req.method === "GET") {
    const rows = await db
      .select({
        commitment: budgetCommitments,
        rule_name: recurringRules.name,
        rule_active: recurringRules.active,
        rule_next_due: recurringRules.nextDueAt,
        rule_frequency_unit: recurringRules.frequencyUnit,
        rule_frequency_interval: recurringRules.frequencyInterval,
        rule_end_date: recurringRules.endDate,
      })
      .from(budgetCommitments)
      .leftJoin(recurringRules, eq(budgetCommitments.recurringRuleId, recurringRules.id))
      .where(eq(budgetCommitments.planId, plan.id))
      .orderBy(asc(budgetCommitments.firstDueDate))

    return res.json({
      commitments: rows.map((r) => ({
        ...serialize(r.commitment),
        rule: r.commitment.recurringRuleId
          ? {
              name: r.rule_name,
              // A commitment whose rule was deleted or switched off still
              // projects nothing, and the UI must be able to say WHY.
              active: r.rule_active ?? false,
              missing: r.rule_name == null,
              next_due_at: r.rule_next_due,
              frequency_unit: r.rule_frequency_unit,
              frequency_interval: r.rule_frequency_interval,
              end_date: r.rule_end_date,
            }
          : null,
      })),
    })
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const body = req.body as {
    envelope_id?: string
    kind?: string
    name?: string
    amount?: number
    due_date?: string
    recurring_rule_id?: string
  }

  const envelopeId = String(body.envelope_id ?? "")
  if (!envelopeId) return res.status(400).json({ error: "envelope_id is required" })

  const [envelope] = await db
    .select()
    .from(budgetEnvelopes)
    .where(
      and(
        eq(budgetEnvelopes.id, envelopeId),
        eq(budgetEnvelopes.planId, plan.id),
        eq(budgetEnvelopes.organizationId, orgId),
      ),
    )
  if (!envelope || envelope.status === "removed") return res.status(404).json({ error: "Envelope not found" })

  // Only the two sections whose money is tracked by settling an expectation.
  if (envelope.section !== "commitment" && envelope.section !== "debt") {
    return res.status(400).json({ error: "wrong_section", message: "Bills belong to a commitment or debt envelope" })
  }

  const kind = body.kind === "recurring" ? "recurring" : "one_time"

  if (kind === "one_time") {
    const name = String(body.name ?? "").trim()
    if (!name) return res.status(400).json({ error: "name is required" })
    if (name.length > 80) return res.status(400).json({ error: "name is too long" })

    const amount = round2(Number(body.amount))
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "amount must be positive" })
    if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })

    if (!isIsoDate(body.due_date)) return res.status(400).json({ error: "due_date must be YYYY-MM-DD" })

    const [commitment] = await db
      .insert(budgetCommitments)
      .values({
        planId: plan.id,
        organizationId: orgId,
        envelopeId,
        kind: "one_time",
        name,
        amount: String(amount),
        dueDate: body.due_date,
        recurringRuleId: null,
        // For a one-time bill the first due date IS the due date. It is what
        // carryLowerBound() anchors on, and it is why a one-time bill never
        // ages out of the projection however overdue it is (decision D-17).
        firstDueDate: body.due_date,
        status: "active",
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      envelopeId,
      action: "commitment_created",
      amount: String(amount),
      detail: { kind: "one_time", name, due_date: body.due_date },
      actorUserId: userId,
    })

    return res.status(201).json({ commitment: serialize(commitment) })
  }

  // ── recurring: link an existing rule ──────────────────────────────────────
  const ruleId = String(body.recurring_rule_id ?? "")
  if (!ruleId) return res.status(400).json({ error: "recurring_rule_id is required for a recurring commitment" })

  const [rule] = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, ruleId), eq(recurringRules.organizationId, orgId)))
  if (!rule) return res.status(404).json({ error: "Recurring rule not found" })

  // A transfer moves money between the user's own accounts, so it is neither a
  // bill nor a debt payment; and only an outflow can be one.
  if (rule.kind !== "standard" || rule.type !== "outgoing") {
    return res.status(400).json({ error: "not_an_expense", message: "Only a recurring expense can be tracked as a bill" })
  }

  let commitment
  try {
    ;[commitment] = await db
      .insert(budgetCommitments)
      .values({
        planId: plan.id,
        organizationId: orgId,
        envelopeId,
        kind: "recurring",
        name: String(body.name ?? rule.name).trim().slice(0, 80) || rule.name,
        // The rule is the source of truth for the amount; a budget-side copy
        // would silently disagree with what actually gets posted.
        amount: rule.amount,
        dueDate: null,
        recurringRuleId: rule.id,
        firstDueDate: rule.startDate,
        status: "active",
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
  } catch (err) {
    if (violates(err, "budget_commitments_rule_unique")) {
      return res.status(409).json({ error: "rule_already_tracked", message: "This recurring expense is already tracked" })
    }
    throw err
  }

  await db.insert(budgetEvents).values({
    organizationId: orgId,
    planId: plan.id,
    envelopeId,
    action: "commitment_created",
    amount: rule.amount,
    detail: { kind: "recurring", name: commitment.name, recurring_rule_id: rule.id, first_due_date: rule.startDate },
    actorUserId: userId,
  })

  return res.status(201).json({ commitment: serialize(commitment) })
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
