// Budget v1 ⇄ v2 compatibility adapter (spec §11.1).
//
// WHY THIS EXISTS: the Android and iOS apps are Capacitor shells around a
// STORE-PINNED bundle, the service worker is disabled in the shell, and the store
// is the only native update path (docs/native/README.md). A user on an older
// build keeps calling `GET /api/budgets` forever. If that path changed shape,
// their app would break and we could not push a fix.
//
// So `/api/budgets` keeps its v1 contract INDEFINITELY. When an org has a v2
// plan, this module projects the v2 model down to the v1 shape. The projection
// may lose DETAIL, but it must never report a wrong number.
//
// Retirement is evidence-based (decision D-14): every adapter call records
// `detail.via = 'v1_adapter'` on a budget event, so adoption can be measured
// before the path is ever removed.
import { and, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetEnvelopes,
  budgetEvents,
  budgetPeriods,
  budgetPlans,
} from "../../src/lib/db/schema.js"
import { outgoingByClient } from "./budget-spend.js"
import { normalizeTarget, periodDays, type TargetCadence, type PlanCadence } from "../../src/lib/budget-math.js"
import { buildBudgetView, loadPlan, planToday, type PlanRow, migrationPrompts } from "./budget-engine.js"

/** The v1 `budgets` row shape, exactly as v1 clients parse it. */
export type V1Budget = {
  id: string
  organization_id: string
  client_id: string | null
  period: "lifetime" | "monthly" | "weekly" | "daily"
  amount: number
  spent: number | null
  created_at?: string | null
  updated_at?: string | null
}

/**
 * Map a v2 plan cadence to the nearest v1 `period`.
 *
 * `payday` and `custom` have no v1 representation, so they report `monthly` —
 * the nearest truthful value — and the response carries `degraded: true`, which
 * old clients ignore harmlessly while the web app can detect it.
 */
export function cadenceToV1Period(cadence: string): V1Budget["period"] {
  switch (cadence) {
    case "weekly":
      return "weekly"
    case "monthly":
      return "monthly"
    default:
      return "monthly" // payday | custom → nearest v1 value
  }
}

export const isDegradedCadence = (cadence: string): boolean => cadence === "payday" || cadence === "custom"

export type V1Response = {
  budgets: V1Budget[]
  account_type: string | null
  /** Only present when the projection lost fidelity. Unknown keys are ignored by v1 clients. */
  degraded?: boolean
}

/**
 * Project a v2 plan to the v1 GET shape.
 *
 * Only the FLEXIBLE section is projected, because that is the only thing v1's
 * single `(amount, spent)` pair can mean. Commitments, savings and debt are
 * invisible to a v1 client — a loss of detail, never a wrong number.
 *
 * A PAUSED plan projects `budgets: []` — v1's "no budget", which is the honest
 * degradation: nothing is being tracked.
 */
export async function projectPlanToV1(
  orgId: string,
  role: string,
  accountType: string | null,
): Promise<V1Response | null> {
  // PERSONAL ONLY, and this one is a correctness fix rather than a scope gate.
  //
  // A business workspace's `budgets` rows ARE its per-client spend caps. If such
  // an org somehow has a v2 plan — the ungated wizard used to allow it — then
  // projecting that plan here would serve one household-shaped row INSTEAD of
  // those caps, and the caps would simply vanish from GET /api/budgets.
  //
  // Returning null makes the caller read the real v1 tables, which is both the
  // correct answer for business and the documented rollback path (§13.9).
  if (accountType !== "personal") return null

  const plan = await loadPlan(orgId)
  if (!plan) return null // caller falls back to the real v1 tables

  if (plan.status !== "active") {
    // A migrated LIFETIME cap is parked as a paused plan awaiting the user's
    // choice (§13.4). Until then a store-pinned v1 client must still see the
    // cap it set — as the lifetime row it was — rather than "no budget".
    const prompts = await migrationPrompts(orgId, plan, 0, planToday(plan))
    if (prompts.lifetime_choice) {
      const [catchAll] = await db
        .select({ targetAmount: budgetEnvelopes.targetAmount })
        .from(budgetEnvelopes)
        .where(and(eq(budgetEnvelopes.planId, plan.id), eq(budgetEnvelopes.isCatchAll, true), eq(budgetEnvelopes.status, "active")))
      const byClient = await outgoingByClient(orgId, new Date())
      let lifetimeSpent = 0
      for (const sums of byClient.values()) lifetimeSpent += sums.lifetime
      const row: V1Budget = {
        id: plan.id,
        organization_id: orgId,
        client_id: null,
        period: "lifetime",
        amount: Number(catchAll?.targetAmount ?? prompts.lifetime_choice.amount ?? 0),
        spent: Number(lifetimeSpent.toFixed(2)),
        created_at: plan.createdAt ? new Date(plan.createdAt).toISOString() : null,
        updated_at: plan.updatedAt ? new Date(plan.updatedAt).toISOString() : null,
      }
      return { budgets: [row], account_type: accountType, degraded: true }
    }
    return { budgets: [], account_type: accountType }
  }

  const view = await buildBudgetView(orgId, role, accountType, new Date())
  const flexible = view.sections?.flexible as
    | { planned?: number; spent_net?: number }
    | undefined

  // No open period yet (the plan exists but sync has not run): report no budget
  // rather than inventing a figure.
  if (!view.period || !flexible) {
    return { budgets: [], account_type: accountType }
  }

  const row: V1Budget = {
    id: plan.id,
    organization_id: orgId,
    client_id: null, // a v2 plan is workspace-level
    period: cadenceToV1Period(plan.cadence),
    amount: Number(flexible.planned ?? 0),
    spent: Number(flexible.spent_net ?? 0),
    created_at: plan.createdAt ? new Date(plan.createdAt).toISOString() : null,
    updated_at: plan.updatedAt ? new Date(plan.updatedAt).toISOString() : null,
  }

  const res: V1Response = { budgets: [row], account_type: accountType }
  if (isDegradedCadence(plan.cadence)) res.degraded = true
  return res
}

/**
 * Apply a v1 `POST /api/budgets` write to a v2 plan, so an old client can still
 * edit a budget it can only partly see.
 *
 * Maps onto the catch-all flexible envelope's target. `amount: 0` **pauses** the
 * plan rather than deleting it: deleting a v2 plan from a v1 client would
 * silently destroy envelopes, commitments and funds the old client cannot see.
 */
/** v1 `period` → the v2 target cadence that preserves what the user authored. */
const V1_PERIOD_TO_TARGET_CADENCE: Record<string, TargetCadence> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
}

export async function applyV1Write(input: {
  orgId: string
  plan: PlanRow
  period: string | undefined
  amount: number
  actorUserId: string
}): Promise<{ paused: boolean; rejected?: "lifetime_unsupported" }> {
  const { orgId, plan, amount, actorUserId } = input

  // A LIFETIME cap has no period and cannot be expressed as a per-period target
  // (§13.4, D-13): converting it would be exactly the "lifetime cap becomes a
  // monthly budget" misrepresentation the v1→v2 migration refuses. Refuse here
  // too, and let the route tell the old client so.
  if (input.period === "lifetime") return { paused: false, rejected: "lifetime_unsupported" }

  if (amount <= 0) {
    await db
      .update(budgetPlans)
      .set({ status: "paused", pausedAt: new Date(), updatedBy: actorUserId, updatedAt: new Date() })
      .where(eq(budgetPlans.id, plan.id))
    await recordAdapterEvent(orgId, plan.id, "plan_paused", { via: "v1_adapter" }, actorUserId)
    return { paused: true }
  }

  // A v1 period is the AUTHORED cadence of the amount, and v2 has a target
  // cadence for each of them: "€150/week" stays a week-authored target and is
  // normalised onto the plan's own period, "€600/month" a month-authored one,
  // "€20/day" a day-authored one (§11.1). Mapping everything to "period" would
  // silently re-denominate the figure — a weekly €150 would become €150 a month.
  const authoredCadence: TargetCadence = V1_PERIOD_TO_TARGET_CADENCE[input.period ?? ""] ?? "period"

  const [catchAll] = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.planId, plan.id), eq(budgetEnvelopes.isCatchAll, true), eq(budgetEnvelopes.status, "active")))

  if (catchAll) {
    await db
      .update(budgetEnvelopes)
      .set({ targetAmount: String(amount), targetCadence: authoredCadence, updatedBy: actorUserId, updatedAt: new Date() })
      .where(eq(budgetEnvelopes.id, catchAll.id))

    // Keep the OPEN period's allocation in step, so the change is visible now.
    const [open] = await db
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    if (open) {
      const days = periodDays({ start: open.start, endExclusive: open.endExclusive })
      await db
        .update(budgetAllocations)
        .set({
          plannedAmount: String(normalizeTarget(amount, authoredCadence, days, plan.cadence as PlanCadence)),
          authoredAmount: String(amount),
          authoredCadence,
          source: "manual",
          updatedBy: actorUserId,
          updatedAt: new Date(),
        })
        .where(and(eq(budgetAllocations.periodId, open.id), eq(budgetAllocations.envelopeId, catchAll.id)))
    }
  }

  // Resuming: a v1 client setting a positive amount on a paused plan clearly
  // intends it to be active again.
  if (plan.status === "paused") {
    await db
      .update(budgetPlans)
      .set({ status: "active", pausedAt: null, updatedBy: actorUserId, updatedAt: new Date() })
      .where(eq(budgetPlans.id, plan.id))
  }

  await recordAdapterEvent(orgId, plan.id, "amount_changed", { via: "v1_adapter", amount, period: input.period }, actorUserId)
  return { paused: false }
}

/** Adapter traffic is recorded so the D-14 sunset decision has evidence. */
export async function recordAdapterEvent(
  orgId: string,
  planId: string,
  action: string,
  detail: Record<string, unknown>,
  actorUserId: string | null,
): Promise<void> {
  await db.insert(budgetEvents).values({
    organizationId: orgId,
    planId,
    action,
    detail: { ...detail, via: "v1_adapter" },
    actorUserId,
  })
}

/**
 * Record that a v1 client READ through the adapter.
 *
 * Deliberately a log line, not a DB insert: budget reads must never write
 * (§8.10 invariant #1). Adapter read volume is therefore measured from function
 * logs, while adapter WRITES leave a durable budget_events row — together
 * enough evidence for the D-14 sunset decision.
 */
export function noteAdapterRead(orgId: string, planId: string): void {
  console.log(`[budget-v1-adapter] read org=${orgId} plan=${planId}`)
}

export { planToday }
