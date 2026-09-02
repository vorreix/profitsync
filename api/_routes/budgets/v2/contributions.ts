import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, dbBatch, serialize } from "../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetEnvelopes,
  budgetEvents,
  budgetFundEntries,
  budgetPeriods,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { round2 } from "../../../../src/lib/budget-math.js"
import { loadPlan } from "../../../_lib/budget-engine.js"

/**
 * POST /api/budgets/v2/contributions — confirm or decline this period's
 * contribution to a savings fund (spec §8.9.1).
 *
 * Body: { envelope_id, action: "confirm" | "skip" | "unskip" }
 *
 * The distinction this route exists to protect: automatically RESERVING a
 * planned contribution is fine — it is what the plan says, and it only ever
 * makes safe-to-spend more conservative. Automatically asserting the money
 * **was set aside** is not, because a fund balance is a money-like figure the
 * user will trust and nobody actually did anything.
 *
 * So confirming is the user's decision, and it is deliberately
 * RESERVED-NEUTRAL: the amount simply moves from
 * `virtualContributionsUnconfirmed` into `virtualFundBalances`. Safe-to-spend
 * does not jump, which is what makes it safe to leave a contribution
 * unconfirmed for days.
 *
 * Crediting is idempotent on `(envelope_id, period_id)` via the partial unique
 * index `budget_fund_entries_once_per_period_idx`, so neither a double-tapped
 * Confirm nor a repeated period close can double-credit a fund.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  const [open] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(desc(budgetPeriods.start))
    .limit(1)

  // ── the fund ledger, for the detail view ──────────────────────────────────
  if (req.method === "GET") {
    const envelopeId = String(req.query.envelope_id ?? "")
    if (!envelopeId) return res.status(400).json({ error: "envelope_id is required" })
    const entries = await db
      .select()
      .from(budgetFundEntries)
      .where(and(eq(budgetFundEntries.organizationId, orgId), eq(budgetFundEntries.envelopeId, envelopeId)))
      .orderBy(desc(budgetFundEntries.createdAt))
      .limit(100)
    return res.json({ entries: entries.map(serialize) })
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
  if (plan.status !== "active") return res.status(409).json({ error: "plan_paused" })
  if (!open) return res.status(409).json({ error: "no_open_period", message: "Sync the plan first" })

  const body = req.body as { envelope_id?: string; action?: string }
  const action = String(body.action ?? "")
  if (!["confirm", "skip", "unskip"].includes(action)) {
    return res.status(400).json({ error: "action must be confirm, skip or unskip" })
  }

  const [envelope] = await db
    .select()
    .from(budgetEnvelopes)
    .where(
      and(
        eq(budgetEnvelopes.id, String(body.envelope_id ?? "")),
        eq(budgetEnvelopes.planId, plan.id),
        eq(budgetEnvelopes.organizationId, orgId),
      ),
    )
  if (!envelope || envelope.status === "removed") return res.status(404).json({ error: "Envelope not found" })
  if (envelope.section !== "savings") {
    return res.status(400).json({ error: "not_a_fund", message: "Only a savings envelope has contributions" })
  }

  const [alloc] = await db
    .select()
    .from(budgetAllocations)
    .where(and(eq(budgetAllocations.periodId, open.id), eq(budgetAllocations.envelopeId, envelope.id)))
  if (!alloc) return res.status(409).json({ error: "no_allocation", message: "Sync the plan first" })

  const status = alloc.contributionStatus ?? "planned"
  const amount = round2(Number(alloc.plannedAmount) + Number(alloc.rolloverIn))

  // ── skip / unskip: a declaration, no money either way ─────────────────────
  if (action === "skip" || action === "unskip") {
    if (status === "confirmed") {
      return res.status(409).json({
        error: "already_confirmed",
        message: "This contribution is already set aside",
        state: status,
      })
    }
    const next = action === "skip" ? "skipped" : "planned"
    const [updated] = await db
      .update(budgetAllocations)
      .set({ contributionStatus: next, updatedBy: userId })
      .where(eq(budgetAllocations.id, alloc.id))
      .returning()

    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: open.id,
      envelopeId: envelope.id,
      action: action === "skip" ? "fund_skipped" : "fund_unskipped",
      amount: String(amount),
      detail: { was: status, now: next, name: envelope.name },
      actorUserId: userId,
    })
    return res.json({ allocation: serialize(updated), state: next })
  }

  // ── confirm ───────────────────────────────────────────────────────────────
  if (status === "confirmed") {
    // Idempotent from the caller's point of view: already done is not an error.
    return res.json({ state: "confirmed", already: true })
  }
  if (amount <= 0) {
    return res.status(400).json({ error: "nothing_to_confirm", message: "This fund has nothing planned this period" })
  }

  // A Space-backed contribution is only real once the money has actually been
  // transferred into the Space, and that transfer is the app's own machinery —
  // Budget must not fabricate it. So confirming here would claim money moved
  // when it did not.
  if (envelope.fundingMode === "space_backed") {
    return res.status(400).json({
      error: "transfer_required",
      message: "Move the money into the Space; the contribution is confirmed by the transfer itself",
    })
  }

  // The fund entry and the status change land together, so a fund can never be
  // observed credited-but-not-confirmed or the reverse.
  try {
    await dbBatch([
      db.insert(budgetFundEntries).values({
        envelopeId: envelope.id,
        organizationId: orgId,
        periodId: open.id,
        kind: "contribution",
        amount: String(amount),
        source: "confirmed",
        actorUserId: userId,
      }),
      db
        .update(budgetAllocations)
        .set({
          contributionStatus: "confirmed",
          contributionConfirmedAt: new Date(),
          contributionConfirmedBy: userId,
          updatedBy: userId,
        })
        .where(eq(budgetAllocations.id, alloc.id)),
      db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        periodId: open.id,
        envelopeId: envelope.id,
        action: "fund_contributed",
        amount: String(amount),
        detail: { source: "confirmed", was: status, name: envelope.name, funding_mode: envelope.fundingMode },
        actorUserId: userId,
      }),
    ] as unknown as Parameters<typeof dbBatch>[0])
  } catch (err) {
    // The partial unique index rejected a second credit for this period. That
    // is the guard working, not a failure to report to the user.
    const msg = `${(err as { message?: string })?.message ?? ""} ${
      (err as { cause?: { message?: string } })?.cause?.message ?? ""
    }`
    if (msg.includes("budget_fund_entries_once_per_period_idx")) {
      await db
        .update(budgetAllocations)
        .set({ contributionStatus: "confirmed", updatedBy: userId })
        .where(eq(budgetAllocations.id, alloc.id))
      return res.json({ state: "confirmed", already: true })
    }
    throw err
  }

  return res.json({ state: "confirmed", amount })
}
