// Budget v2 notifications.
//
// Phase 0's `notify-budget.ts` alerts on the v1 tables (80% warning, exceeded).
// Budget v2 has a richer set of things worth telling someone about, and each one
// is emitted from `POST /api/budgets/v2/sync` — the ONE place budget state is
// written, so an event cannot be announced without having happened.
//
// Two rules shape everything here:
//
//  1. **Best-effort, always.** Every entry point is called as
//     `void notify...().catch(() => {})`. A notification must never block or
//     fail a sync, because sync is what keeps the plan correct.
//
//  2. **Dedupe or be a nuisance.** Sync runs on every self-heal, so an
//     un-deduped emit would re-notify on every page load. Every key below is
//     stable for the event it describes: per occurrence, per envelope per
//     period, or per day for the standing "you have overdue bills" nudge.
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { budgetAllocations, budgetEnvelopes, notifications } from "../../src/lib/db/schema.js"
import { notifyOrgMembers } from "./notifications.js"
import { addDays } from "../../src/lib/budget-math.js"
import { planToday, type PeriodRow, type PlanRow, type BudgetView } from "./budget-engine.js"

/**
 * How many per-envelope overspend alerts one sync may emit.
 *
 * Without a cap, switching these on for an existing plan with several overspent
 * categories would deliver a burst on the next page load. The cap keeps the
 * first run civil; the remainder are picked up on later syncs as each envelope
 * is still over, and the aggregate figure is on the budget screen regardless.
 */
const MAX_OVERSPEND_ALERTS_PER_SYNC = 3

// Amounts are labelled with the PLAN's currency — the currency the view's
// figures are in (never the org currency, which can differ under a
// currency_mismatch limitation) — like every other notification emitter.
const money = (n: number, currency: string) => `${n.toFixed(2)} ${currency}`

/**
 * Overdue obligations — ONE aggregated nudge per plan per day.
 *
 * Deliberately not per commitment: an overdue bill stays overdue, so
 * per-commitment alerts would either fire once and then go quiet as the pile
 * grows, or fire forever. A daily digest matches how the fact actually behaves
 * — it is a standing condition, not a moment.
 */
export async function notifyBudgetOverdue(input: {
  orgId: string
  plan: PlanRow
  view: BudgetView
  actorUserId: string
}): Promise<void> {
  const overdue = input.view.occurrences_overdue
  if (!overdue.length) return

  const total = overdue.reduce((a, o) => a + Number(o.amount ?? 0), 0)
  const today = planToday(input.plan)
  // One per DAY, in the plan's own timezone — the same clock the budget uses to
  // decide what "overdue" means in the first place.
  const dedupeKey = `budget_overdue:${input.plan.id}:${today}`

  await notifyOrgMembers(
    input.orgId,
    {
      type: "budget_overdue",
      title: "Payments overdue",
      body: `${overdue.length} payment${overdue.length === 1 ? "" : "s"} still to pay — ${money(total, input.plan.currency)} is held back for them.`,
      data: {
        i18nKey: "types.budget_overdue.title",
        i18nBodyKey: "types.budget_overdue.body",
        i18nParams: { count: overdue.length, amount: money(total, input.plan.currency) },
      },
      link: "/budgets",
      actorUserId: input.actorUserId,
      dedupeKey,
    },
    { roles: ["owner", "admin", "editor"] },
  )
}

/**
 * A spending category went over its target — once per envelope per period.
 *
 * Only FLEXIBLE envelopes can be over: they have a target that caps spending.
 * A commitment or debt envelope has no target, so its negative remaining means
 * "not yet paid", not "overspent" (§8.7) — announcing that as an overspend is
 * the same conflation the UI had to be fixed for.
 */
export async function notifyEnvelopeOverspend(input: {
  orgId: string
  plan: PlanRow
  view: BudgetView
  actorUserId: string
}): Promise<void> {
  const period = input.view.period as { id?: string } | null
  const sections = input.view.sections as
    | Record<string, { envelopes?: { id: string; name: string; section: string; planned: number; spent_net: number; remaining: number }[] }>
    | null
  if (!period?.id || !sections) return

  const overAll = (sections.flexible?.envelopes ?? [])
    .filter((e) => e.section === "flexible" && e.remaining < 0)
    // Worst first, so the capped run reports the ones that matter most.
    .sort((a, b) => a.remaining - b.remaining)

  // Cap NEW alerts per sync, not the candidate list: an envelope already
  // announced this period (its dedupe row exists) must not keep consuming one
  // of the slots, or the fourth-worst category never notifies at all.
  const keyOf = (env: { id: string }) => `budget_envelope_over:${env.id}:${period.id}`
  const already = new Set(
    overAll.length
      ? (
          await db
            .select({ key: notifications.dedupeKey })
            .from(notifications)
            .where(and(eq(notifications.userId, input.actorUserId), inArray(notifications.dedupeKey, overAll.map(keyOf))))
        ).map((r) => r.key)
      : [],
  )
  const over = overAll.filter((env) => !already.has(keyOf(env))).slice(0, MAX_OVERSPEND_ALERTS_PER_SYNC)

  for (const env of over) {
    const overBy = Math.abs(env.remaining)
    await notifyOrgMembers(
      input.orgId,
      {
        type: "budget_envelope_over",
        title: "Category over its target",
        body: `${env.name} is ${money(overBy, input.plan.currency)} over its ${money(env.planned, input.plan.currency)} target.`,
        data: {
          i18nKey: "types.budget_envelope_over.title",
          i18nBodyKey: "types.budget_envelope_over.body",
          i18nParams: { name: env.name, amount: money(overBy, input.plan.currency), planned: money(env.planned, input.plan.currency) },
        },
        link: "/budgets",
        actorUserId: input.actorUserId,
        // Once per envelope per period: the same category going further over
        // within one period is not new information.
        dedupeKey: `budget_envelope_over:${env.id}:${period.id}`,
      },
      { roles: ["owner", "admin", "editor"] },
    )
  }
}

/**
 * A period closed — one summary per period, and one alert per savings
 * contribution that was NOT confirmed.
 *
 * The missed-contribution alert exists because §8.9.1 forbids auto-crediting a
 * fund: a planned contribution that nobody confirmed becomes `missed`, and the
 * money simply stayed spendable. That is a decision the user did not make
 * deliberately, so it is worth surfacing — stated as a fact, not a scolding.
 */
export async function notifyPeriodClosed(input: {
  orgId: string
  plan: PlanRow
  period: PeriodRow
  actorUserId: string
}): Promise<void> {
  const { orgId, plan, period, actorUserId } = input

  await notifyOrgMembers(
    orgId,
    {
      type: "budget_period_closed",
      title: "Budget period closed",
      // The period's LAST day, not its exclusive end (the first day of the
      // next period) — a September budget "ending 1 October" reads as wrong.
      body: `Your budget period ending ${addDays(period.endExclusive, -1)} is closed. The figures are now final.`,
      data: {
        i18nKey: "types.budget_period_closed.title",
        i18nBodyKey: "types.budget_period_closed.body",
        i18nParams: { date: addDays(period.endExclusive, -1) },
      },
      link: "/budgets",
      actorUserId,
      dedupeKey: `budget_period_closed:${period.id}`,
    },
    { roles: ["owner", "admin", "editor"] },
  )

  // Funds whose contribution was left unconfirmed when the period ended.
  const missed = await db
    .select({
      id: budgetEnvelopes.id,
      name: budgetEnvelopes.name,
      planned: budgetAllocations.plannedAmount,
      rollover: budgetAllocations.rolloverIn,
    })
    .from(budgetAllocations)
    .innerJoin(budgetEnvelopes, eq(budgetAllocations.envelopeId, budgetEnvelopes.id))
    .where(
      and(
        eq(budgetAllocations.periodId, period.id),
        eq(budgetAllocations.contributionStatus, "missed"),
        eq(budgetEnvelopes.section, "savings"),
        ne(budgetEnvelopes.status, "removed"),
      ),
    )

  for (const fund of missed) {
    const amount = Number(fund.planned ?? 0) + Number(fund.rollover ?? 0)
    if (amount <= 0) continue
    await notifyOrgMembers(
      orgId,
      {
        type: "budget_contribution_missed",
        title: "Contribution not confirmed",
        body: `${money(amount, input.plan.currency)} for ${fund.name} was not confirmed, so it was not set aside.`,
        data: {
          i18nKey: "types.budget_contribution_missed.title",
          i18nBodyKey: "types.budget_contribution_missed.body",
          i18nParams: { name: fund.name, amount: money(amount, input.plan.currency) },
        },
        link: "/budgets",
        actorUserId,
        dedupeKey: `budget_contribution_missed:${fund.id}:${period.id}`,
      },
      { roles: ["owner", "admin", "editor"] },
    )
  }

  void plan
}

/**
 * A CLOSED period was restated because its underlying transactions changed
 * (§8.11).
 *
 * Worth announcing precisely because it is a change to a record the user may
 * already have read and acted on. The old version is kept, so the wording says
 * the figures were revised rather than implying anything was wrong.
 */
export async function notifyPeriodRestated(input: {
  orgId: string
  periodId: string
  periodStart: string
  version: number
  actorUserId: string | null
}): Promise<void> {
  await notifyOrgMembers(
    input.orgId,
    {
      type: "budget_period_restated",
      title: "A closed period was updated",
      body: `The period starting ${input.periodStart} was recalculated after a transaction in it changed.`,
      data: {
        i18nKey: "types.budget_period_restated.title",
        i18nBodyKey: "types.budget_period_restated.body",
        i18nParams: { date: input.periodStart },
      },
      link: "/budgets",
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      // Per VERSION, so a second, later restatement of the same period does
      // notify again — it is a genuinely new revision.
      dedupeKey: `budget_period_restated:${input.periodId}:${input.version}`,
    },
    { roles: ["owner", "admin", "editor"] },
  )
}
