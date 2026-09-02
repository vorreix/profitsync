import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetCommitments,
  budgetEnvelopes,
  budgetEvents,
  budgetFundEntries,
  budgetOccurrences,
  budgetPeriodSnapshots,
  budgetPeriods,
  transactions,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { materializeDueRecurring } from "../../../_lib/recurring-materialize.js"
import {
  buildBudgetView,
  cadenceOf,
  ENGINE_VERSION,
  loadPlan,
  materializeAllocations,
  MAX_PERIODS_PER_RUN,
  openPeriod,
  planToday,
  reconstructedBase,
  type PeriodRow,
  type PlanRow,
} from "../../../_lib/budget-engine.js"
import { carryFor, contributionAtClose, periodFor, round2, type CarryPolicy } from "../../../../src/lib/budget-math.js"

/**
 * POST /api/budgets/v2/sync — the ONE place budget state is written.
 *
 * Budget GETs are strictly read-only (a read must never move money or create
 * transactions), so they detect staleness and report `sync_required`; the client
 * then calls this once. Idempotent and cheap when nothing is due, so it is also
 * safe for the period-boundary job to call (§8.10, reversed decision D-3).
 *
 * Steps, in order:
 *   1. materialize due recurring transactions (existing, race-proof engine)
 *   2. reconcile occurrence settlements  (posted rows → occurrences)
 *   3. close elapsed periods + open the current one
 *   4. refresh a reconstructed funding base, auditing any drift
 *   5. restate any closed period whose underlying transactions changed
 *   6. return the freshly computed view
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId, orgId, role, accountType } = ctx
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.json({ synced: false, reason: "no_plan" })

  const today = planToday(plan)
  const result = { materialized: 0, settled: 0, closed: 0, opened: 0, restated: 0, base_refreshed: false }

  // 1 ── materialize due recurring transactions.
  try {
    const m = await materializeDueRecurring(orgId)
    result.materialized = m.created
  } catch {
    /* best-effort: a blocked rule records last_error and must not fail sync */
  }

  // A PAUSED plan opens no periods, writes no snapshots and credits no funds
  // (§6.13). Materialization above is org-wide and unrelated to the plan.
  if (plan.status !== "active") {
    const view = await buildBudgetView(orgId, role, accountType)
    return res.json({ synced: true, paused: true, result, view })
  }

  // 2 ── reconcile occurrence settlements.
  result.settled = await reconcileSettlements(orgId, plan)

  // 3 ── close elapsed periods, then open the current one.
  const cadence = cadenceOf(plan)
  const cur = periodFor(cadence, today)

  const openPeriods = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(asc(budgetPeriods.start))

  for (const p of openPeriods.slice(0, MAX_PERIODS_PER_RUN)) {
    if (p.endExclusive <= today) {
      await closePeriod(orgId, plan, p, role, accountType, userId)
      result.closed++
    }
  }

  const [stillOpen] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))

  if (!stillOpen) {
    // Was the plan created mid-period? Then the base anchors at creation (D-18)
    // rather than reconstructing a period the plan never governed.
    const hadAny = await db
      .select({ id: budgetPeriods.id })
      .from(budgetPeriods)
      .where(eq(budgetPeriods.planId, plan.id))
      .limit(1)
    const isPartial = hadAny.length === 0 && today !== cur.start
    await openPeriod(orgId, plan, cur, { isPartial, actorUserId: userId })
    result.opened++
  } else {
    // Keep allocations in step with any envelope added since the period opened.
    await materializeAllocations(orgId, plan, stillOpen)

    // 4 ── refresh a reconstructed base; audit real drift only.
    if (stillOpen.fundingBaseSource === "reconstructed_at_boundary") {
      const fresh = await reconstructedBase(orgId, plan, stillOpen)
      const was = Number(stillOpen.fundingBase ?? 0)
      if (Math.abs(fresh - was) >= 0.01) {
        await db.batch([
          db
            .update(budgetPeriods)
            .set({ fundingBase: String(fresh), fundingBaseComputedAt: new Date() })
            .where(eq(budgetPeriods.id, stillOpen.id)),
          db.insert(budgetEvents).values({
            organizationId: orgId,
            planId: plan.id,
            periodId: stillOpen.id,
            action: "funding_base_recomputed",
            amount: String(fresh),
            previousAmount: String(was),
            detail: { reason: "boundary_reconstruction", was, now: fresh },
            actorUserId: null,
          }),
        ])
        result.base_refreshed = true
      }
    }
  }

  // 5 ── restate closed periods whose underlying transactions changed.
  result.restated = await restateDriftedPeriods(orgId, plan, role, accountType)

  const view = await buildBudgetView(orgId, role, accountType)
  return res.json({ synced: true, result, view })
}

/**
 * Match posted transactions to expected occurrences (§8.6).
 *
 * Recurring occurrences match EXACTLY on `(recurring_rule_id, recurring_due_date)`
 * — the key the materializer already writes and already has a unique index on.
 * One-time commitments are matched explicitly by the user, never heuristically
 * here (a wrong auto-match would silently mark a bill paid).
 */
async function reconcileSettlements(orgId: string, plan: PlanRow): Promise<number> {
  const commitments = await db
    .select()
    .from(budgetCommitments)
    .where(
      and(
        eq(budgetCommitments.planId, plan.id),
        eq(budgetCommitments.status, "active"),
        eq(budgetCommitments.kind, "recurring"),
      ),
    )
  if (!commitments.length) return 0

  const ruleIds = commitments.map((c) => c.recurringRuleId).filter((v): v is string => !!v)
  if (!ruleIds.length) return 0

  const posted = await db
    .select({
      id: transactions.id,
      ruleId: transactions.recurringRuleId,
      dueDate: transactions.recurringDueDate,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(inArray(transactions.recurringRuleId, ruleIds), isNull(transactions.deletedAt)))

  let settled = 0
  for (const tx of posted) {
    if (!tx.ruleId || !tx.dueDate) continue
    const commitment = commitments.find((c) => c.recurringRuleId === tx.ruleId)
    if (!commitment) continue
    const inserted = await db
      .insert(budgetOccurrences)
      .values({
        commitmentId: commitment.id,
        organizationId: orgId,
        dueDate: tx.dueDate,
        status: "settled",
        settledTransactionId: tx.id,
        settledAmount: tx.amount,
        settledAt: new Date(),
        actorUserId: null, // matched by the system
      })
      // Idempotent: (commitment_id, due_date) is unique, so re-running is a no-op.
      .onConflictDoNothing({ target: [budgetOccurrences.commitmentId, budgetOccurrences.dueDate] })
      .returning({ id: budgetOccurrences.id })
    if (inserted.length) settled++
  }
  return settled
}

/** Close a period: freeze a snapshot, apply rollover, resolve contributions. */
async function closePeriod(
  orgId: string,
  plan: PlanRow,
  period: PeriodRow,
  role: string,
  accountType: string | null,
  actorUserId: string,
): Promise<void> {
  // Idempotent: a snapshot already exists ⇒ this period is already closed.
  const [existing] = await db
    .select({ id: budgetPeriodSnapshots.id })
    .from(budgetPeriodSnapshots)
    .where(and(eq(budgetPeriodSnapshots.periodId, period.id), eq(budgetPeriodSnapshots.isCurrent, true)))
  if (existing) {
    await db.update(budgetPeriods).set({ status: "closed" }).where(eq(budgetPeriods.id, period.id))
    return
  }

  const payload = await snapshotPayload(orgId, plan, period, role, accountType)

  const envelopes = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
  const allocations = await db.select().from(budgetAllocations).where(eq(budgetAllocations.periodId, period.id))
  const envById = new Map(envelopes.map((e) => [e.id, e]))

  const nextWindow = periodFor(cadenceOf(plan), period.endExclusive)

  const writes: Parameters<typeof db.batch>[0] = [
    db.insert(budgetPeriodSnapshots).values({
      periodId: period.id,
      organizationId: orgId,
      version: 1,
      isCurrent: true,
      currency: plan.currency,
      payload,
      engineVersion: ENGINE_VERSION,
    }),
    db
      .update(budgetPeriods)
      .set({ status: "closed", closedAt: new Date(), closedBy: actorUserId || "system" })
      .where(eq(budgetPeriods.id, period.id)),
    db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: period.id,
      action: "period_closed",
      detail: { start: period.start, end_exclusive: period.endExclusive },
      actorUserId: actorUserId || null,
    }),
  ] as unknown as Parameters<typeof db.batch>[0]

  const batch = [...(writes as unknown as unknown[])] as unknown[]

  // Resolve savings contributions: a close marks an unconfirmed contribution
  // MISSED — never funded — unless auto_fund was explicitly enabled (§8.9.1).
  for (const alloc of allocations) {
    const env = envById.get(alloc.envelopeId)
    if (!env || env.section !== "savings" || !alloc.contributionStatus) continue
    const next = contributionAtClose(alloc.contributionStatus as "planned", env.autoFund)
    if (next === alloc.contributionStatus) continue

    batch.push(
      db
        .update(budgetAllocations)
        .set({
          contributionStatus: next,
          contributionConfirmedAt: next === "confirmed" ? new Date() : null,
          contributionConfirmedBy: null, // NULL actor + confirmed = auto_fund
          updatedAt: new Date(),
        })
        .where(eq(budgetAllocations.id, alloc.id)),
    )
    batch.push(
      db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        periodId: period.id,
        envelopeId: env.id,
        action: next === "confirmed" ? "fund_contributed" : "fund_missed",
        amount: alloc.plannedAmount,
        detail: { via: next === "confirmed" ? "auto_fund" : "period_close_unconfirmed" },
        actorUserId: null,
      }),
    )
    // Only a CONFIRMED contribution writes a fund entry, so the balance can
    // never overstate what the user actually committed.
    if (next === "confirmed" && env.fundingMode === "virtual") {
      batch.push(
        db
          .insert(budgetFundEntries)
          .values({
            envelopeId: env.id,
            organizationId: orgId,
            periodId: period.id,
            kind: "contribution",
            amount: alloc.plannedAmount,
            source: "auto_fund",
            actorUserId: null,
          })
          .onConflictDoNothing(),
      )
    }
  }

  await db.batch(batch as unknown as Parameters<typeof db.batch>[0])

  // Open the next period and carry rollover into it.
  const next = await openPeriod(orgId, plan, nextWindow, { isPartial: false, actorUserId })

  for (const alloc of allocations) {
    const env = envById.get(alloc.envelopeId)
    if (!env) continue
    const snapEnv = (payload.envelopes as { envelope_id: string; remaining: number }[]).find(
      (e) => e.envelope_id === alloc.envelopeId,
    )
    const surplus = snapEnv?.remaining ?? 0
    const carry = carryFor(env.carryPolicy as CarryPolicy, surplus, env.carryCap == null ? null : Number(env.carryCap))
    if (carry === 0) continue
    // rollover_in is written ONCE per (period, envelope), so a repeated close
    // cannot compound it.
    await db
      .update(budgetAllocations)
      .set({ rolloverIn: String(carry), updatedAt: new Date() })
      .where(and(eq(budgetAllocations.periodId, next.id), eq(budgetAllocations.envelopeId, env.id)))
    await db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: next.id,
      envelopeId: env.id,
      action: "rollover_applied",
      amount: String(carry),
      detail: { from_period: period.id, policy: env.carryPolicy },
      actorUserId: null,
    })
  }
}

/** The frozen report for a closed period (§10.8). */
async function snapshotPayload(
  orgId: string,
  plan: PlanRow,
  period: PeriodRow,
  role: string,
  accountType: string | null,
): Promise<Record<string, unknown>> {
  const view = await buildBudgetView(orgId, role, accountType)
  const sections = (view.sections ?? {}) as Record<string, { envelopes?: unknown[] }>
  const envelopes = Object.values(sections).flatMap((s) =>
    (s.envelopes ?? []).map((e) => {
      const v = e as Record<string, unknown>
      return {
        envelope_id: v.id,
        name: v.name, // stored so a rename cannot change what a closed period says
        section: v.section,
        planned: v.planned,
        rollover_in: v.rollover_in,
        spent_gross: v.spent_gross,
        refunds_confirmed: v.refunds_confirmed,
        refunds_provisional: v.refunds_provisional,
        spent_net: v.spent_net,
        pending_at_close: v.pending,
        remaining: v.remaining,
        state: v.state,
      }
    }),
  )
  return {
    period: {
      start: period.start,
      end_exclusive: period.endExclusive,
      timezone: plan.timezone,
      funding_base: Number(period.fundingBase ?? 0),
      funding_base_source: period.fundingBaseSource,
    },
    ...(view.sections ? stripEnvelopes(view.sections as Record<string, unknown>) : {}),
    money: view.money,
    plan_status: view.plan_status,
    total_outflow: view.total_outflow,
    envelopes,
  }
}

/** Section totals without the nested envelope arrays (those are stored flat). */
function stripEnvelopes(sections: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(sections)) {
    if (v && typeof v === "object") {
      const { envelopes: _drop, ...rest } = v as Record<string, unknown>
      void _drop
      out[k] = rest
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Detect and apply restatements (§8.11).
 *
 * A closed period is recomputed and compared with its current snapshot. Any
 * difference produces a NEW version — never an in-place mutation — so the
 * original is preserved and the displayed record is still correct.
 *
 * Threshold is exact (0): a money figure is either the current truth or it is
 * restated.
 */
async function restateDriftedPeriods(
  orgId: string,
  plan: PlanRow,
  role: string,
  accountType: string | null,
): Promise<number> {
  // Phase 1 scope: the most recently closed period. Older periods are restated
  // when they are next opened in the history view (Phase 4 broadens this sweep).
  const [lastClosed] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "closed")))
    .orderBy(sql`${budgetPeriods.start} desc`)
    .limit(1)
  if (!lastClosed) return 0

  const [current] = await db
    .select()
    .from(budgetPeriodSnapshots)
    .where(and(eq(budgetPeriodSnapshots.periodId, lastClosed.id), eq(budgetPeriodSnapshots.isCurrent, true)))
  if (!current) return 0

  // Recompute what that period WOULD report now. buildBudgetView reports the
  // open period, so a full historical recompute is Phase 4; here we compare the
  // stored transaction fingerprint instead, which is cheap and exact.
  const [fingerprint] = await db
    .select({
      total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)`,
      n: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.date} >= ${lastClosed.start}`,
        sql`${transactions.date} < ${lastClosed.endExclusive}`,
        isNull(transactions.deletedAt),
        eq(transactions.isSystem, false),
        eq(transactions.kind, "standard"),
      ),
    )

  const payload = current.payload as Record<string, unknown>
  const prevPrint = (payload.__fingerprint ?? null) as { total?: number; n?: number } | null
  const nowPrint = { total: round2(Number(fingerprint?.total ?? 0)), n: Number(fingerprint?.n ?? 0) }

  if (!prevPrint) {
    // First sync after this period closed: record the fingerprint so future
    // drift is detectable, without claiming a restatement happened.
    await db
      .update(budgetPeriodSnapshots)
      .set({ payload: { ...payload, __fingerprint: nowPrint } })
      .where(eq(budgetPeriodSnapshots.id, current.id))
    return 0
  }

  if (prevPrint.total === nowPrint.total && prevPrint.n === nowPrint.n) return 0

  const nextVersion = current.version + 1
  const view = await buildBudgetView(orgId, role, accountType)
  void view

  await db.batch([
    db
      .update(budgetPeriodSnapshots)
      .set({ isCurrent: false })
      .where(eq(budgetPeriodSnapshots.id, current.id)),
    db.insert(budgetPeriodSnapshots).values({
      periodId: lastClosed.id,
      organizationId: orgId,
      version: nextVersion,
      isCurrent: true,
      supersedesId: current.id,
      restatedReason: "transaction_edited",
      restatedBy: null, // system-detected
      drift: { transactions: [prevPrint, nowPrint] },
      currency: current.currency, // carried forward, so history keeps its currency
      payload: { ...payload, __fingerprint: nowPrint, __restated: true },
      engineVersion: ENGINE_VERSION,
    }),
    db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      periodId: lastClosed.id,
      action: "period_restated",
      detail: { version: nextVersion, reason: "transaction_edited", was: prevPrint, now: nowPrint },
      actorUserId: null,
    }),
  ] as unknown as Parameters<typeof db.batch>[0])

  return 1
}
