import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, dbBatch } from "../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetEnvelopes,
  budgetEvents,
  budgetPeriods,
  budgetPlans,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { amountExceedsLimit } from "../../../../src/lib/money.js"
import { normalizeTarget, periodDays, round2 } from "../../../../src/lib/budget-math.js"
import { cadenceOf, loadPlan, openPeriod, planToday } from "../../../_lib/budget-engine.js"
import { periodFor } from "../../../../src/lib/budget-math.js"

/**
 * POST /api/budgets/v2/prompts — answer a question the MIGRATION refused to
 * guess (spec §13.4, §13.8).
 *
 * Body: { prompt: "lifetime" | "salary", choice: ... }
 *
 *   lifetime · set_target   { amount }  → activate the plan with a real target
 *   lifetime · keep_record              → stay paused; the v1 figure remains readable
 *   salary   · income       { }         → the amount was INCOME: set expected_income,
 *                                         and clear the target so the user sets a real one
 *   salary   · target       { }         → the amount really was the spending target
 *   salary   · dismiss      { }         → ask no more
 *
 * Each choice is recorded as an audited event, which is also what suppresses the
 * prompt — a dismissal is a user decision, so `budget_events` is the right home
 * for it rather than a new column.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId, orgId, role } = ctx
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  const body = req.body as { prompt?: string; choice?: string; amount?: number }
  const prompt = String(body.prompt ?? "")
  const choice = String(body.choice ?? "")

  // ── §13.4 · the lifetime budget ───────────────────────────────────────────
  if (prompt === "lifetime") {
    if (choice === "keep_record") {
      // Stays paused, tracks nothing, and the v1 amount + history remain
      // readable. Recording the choice is what stops us asking again.
      await db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        action: "lifetime_choice_resolved",
        detail: { choice: "keep_record" },
        actorUserId: userId,
      })
      return res.json({ resolved: "keep_record", plan_status: plan.status })
    }

    if (choice === "set_target") {
      const amount = round2(Number(body.amount))
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "amount must be positive" })
      }
      if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })

      const [catchAll] = await db
        .select()
        .from(budgetEnvelopes)
        .where(
          and(
            eq(budgetEnvelopes.planId, plan.id),
            eq(budgetEnvelopes.isCatchAll, true),
            eq(budgetEnvelopes.status, "active"),
          ),
        )
      if (!catchAll) return res.status(409).json({ error: "no_catch_all" })

      // Activate and retarget together, so the plan is never observed active
      // with the old lifetime figure still standing in as a monthly target.
      await dbBatch([
        db
          .update(budgetPlans)
          .set({ status: "active", pausedAt: null, updatedBy: userId, updatedAt: new Date() })
          .where(eq(budgetPlans.id, plan.id)),
        db
          .update(budgetEnvelopes)
          .set({ targetAmount: String(amount), targetCadence: "period", updatedBy: userId, updatedAt: new Date() })
          .where(eq(budgetEnvelopes.id, catchAll.id)),
        db.insert(budgetEvents).values({
          organizationId: orgId,
          planId: plan.id,
          envelopeId: catchAll.id,
          action: "lifetime_choice_resolved",
          amount: String(amount),
          previousAmount: catchAll.targetAmount,
          detail: { choice: "set_target", was_lifetime: round2(Number(catchAll.targetAmount)) },
          actorUserId: userId,
        }),
      ] as unknown as Parameters<typeof dbBatch>[0])

      // A paused plan opened no period, so the first one is opened now that the
      // plan actually governs something.
      const [fresh] = await db.select().from(budgetPlans).where(eq(budgetPlans.id, plan.id))
      const [existing] = await db
        .select({ id: budgetPeriods.id })
        .from(budgetPeriods)
        .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
        .orderBy(desc(budgetPeriods.start))
        .limit(1)

      if (!existing) {
        const today = planToday(fresh)
        const window = periodFor(cadenceOf(fresh), today)
        await openPeriod(orgId, fresh, window, {
          isPartial: today !== window.start,
          actorUserId: userId,
          // Same reasoning as the migration: snapshot, never reconstruct a
          // period this plan did not govern (§13.3).
          forceSource: "snapshot_at_open",
        })
      } else {
        // The period existed already; just bring its allocation in line with
        // the target the user has now chosen.
        const [period] = await db.select().from(budgetPeriods).where(eq(budgetPeriods.id, existing.id))
        const planned = normalizeTarget(
          amount,
          "period",
          periodDays({ start: period.start, endExclusive: period.endExclusive }),
        )
        await db
          .update(budgetAllocations)
          .set({ plannedAmount: String(planned), authoredAmount: String(amount), authoredCadence: "period" })
          .where(and(eq(budgetAllocations.periodId, period.id), eq(budgetAllocations.envelopeId, catchAll.id)))
      }

      return res.json({ resolved: "set_target", amount, plan_status: "active" })
    }

    return res.status(400).json({ error: "choice must be set_target or keep_record" })
  }

  // ── §13.8 · was that figure your income, or your spending target? ─────────
  if (prompt === "salary") {
    if (choice === "target" || choice === "dismiss") {
      // Nothing changes: the figure really was the spending target, or the user
      // does not want to decide. Either way we stop asking.
      await db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        action: "salary_prompt_dismissed",
        detail: { choice },
        actorUserId: userId,
      })
      return res.json({ resolved: choice })
    }

    if (choice === "income") {
      const [catchAll] = await db
        .select()
        .from(budgetEnvelopes)
        .where(
          and(
            eq(budgetEnvelopes.planId, plan.id),
            eq(budgetEnvelopes.isCatchAll, true),
            eq(budgetEnvelopes.status, "active"),
          ),
        )
      if (!catchAll) return res.status(409).json({ error: "no_catch_all" })

      const asIncome = round2(Number(catchAll.targetAmount))
      if (asIncome <= 0) return res.status(409).json({ error: "no_target_to_reinterpret" })

      // The figure moves from "what I want to spend" to "what I earn", and the
      // spending target is CLEARED rather than guessed at — §13.8 is explicit
      // that the user sets the real one. Zeroing it makes safe-to-spend
      // cash-bound until they do, which is the honest interim state.
      await dbBatch([
        db
          .update(budgetPlans)
          .set({
            incomeMode: "expected",
            expectedIncome: String(asIncome),
            updatedBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(budgetPlans.id, plan.id)),
        db
          .update(budgetEnvelopes)
          .set({ targetAmount: "0", updatedBy: userId, updatedAt: new Date() })
          .where(eq(budgetEnvelopes.id, catchAll.id)),
        db.insert(budgetEvents).values({
          organizationId: orgId,
          planId: plan.id,
          envelopeId: catchAll.id,
          action: "salary_prompt_dismissed",
          amount: String(asIncome),
          previousAmount: catchAll.targetAmount,
          detail: { choice: "income", expected_income: asIncome, target_cleared: true },
          actorUserId: userId,
        }),
      ] as unknown as Parameters<typeof dbBatch>[0])

      // Bring the open period's allocation down with it, so the screen does not
      // keep showing a target the plan no longer claims.
      const [open] = await db
        .select()
        .from(budgetPeriods)
        .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
        .orderBy(desc(budgetPeriods.start))
        .limit(1)
      if (open) {
        await db
          .update(budgetAllocations)
          .set({ plannedAmount: "0", authoredAmount: "0" })
          .where(and(eq(budgetAllocations.periodId, open.id), eq(budgetAllocations.envelopeId, catchAll.id)))
      }

      return res.json({ resolved: "income", expected_income: asIncome, target_cleared: true })
    }

    return res.status(400).json({ error: "choice must be income, target or dismiss" })
  }

  return res.status(400).json({ error: "prompt must be lifetime or salary" })
}
