import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, ne, sql } from "drizzle-orm"
import { db, dbBatch } from "../../../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetCommitments,
  budgetEnvelopes,
  budgetEvents,
  budgetExclusions,
  budgetFundEntries,
  budgetOccurrences,
  budgetPeriodSnapshots,
  budgetPeriods,
  clients,
  transactionSettlements,
  transactions,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { violates } from "../../../_lib/db-errors.js"
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
import { carryFor, contributionAtClose, nextPeriod, periodFor, round2, type CarryPolicy } from "../../../../src/lib/budget-math.js"
import {
  notifyBudgetOverdue,
  notifyEnvelopeOverspend,
  notifyPeriodClosed,
  notifyPeriodRestated,
} from "../../../_lib/notify-budget-v2.js"

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

  // 3 ── close EVERY elapsed period, oldest first, then make sure one is open.
  //
  // §8.10 ensurePeriods is a chain: closing a period opens its successor, which
  // after a long absence is itself elapsed — so walk the chain rather than
  // closing one period per call and handing the user an elapsed view. Capped
  // (MAX_PERIODS_PER_RUN) and RESUMABLE: past the cap the view still reports
  // sync_required and the next sync continues from the latest closed period.
  // That same resume path also repairs a close whose successor never opened
  // (a failure between the two writes), including the rollover it is owed.
  const cadence = cadenceOf(plan)
  const cur = periodFor(cadence, today)

  const [firstOpen] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
  let open: PeriodRow | null = firstOpen ?? null
  let openedThisRun = false
  for (let i = 0; i < MAX_PERIODS_PER_RUN; i++) {
    if (!open) {
      const [last] = await db
        .select()
        .from(budgetPeriods)
        .where(eq(budgetPeriods.planId, plan.id))
        .orderBy(desc(budgetPeriods.start))
        .limit(1)
      if (last && last.status === "closed") {
        // Resume the chain from the latest closed period: its snapshot still
        // carries the rollover its successor is owed (§8.12).
        open = await openAfter(orgId, plan, last, userId)
      } else {
        // First period ever. Was the plan created mid-period? Then the base
        // anchors at creation (D-18) rather than reconstructing a period the
        // plan never governed.
        const isPartial = !last && today !== cur.start
        open = await openPeriod(orgId, plan, cur, { isPartial, actorUserId: userId })
      }
      openedThisRun = true
      result.opened++
    }
    if (open.endExclusive > today) break
    const elapsed = open
    open = await closePeriod(orgId, plan, elapsed, role, accountType, userId)
    result.closed++
    if (open) {
      openedThisRun = true
      result.opened++
    }
    // After the close has committed, so a "period closed" notice can never
    // precede the snapshot it refers to.
    void notifyPeriodClosed({ orgId, plan, period: elapsed, actorUserId: userId }).catch(() => {})
  }

  const stillOpen =
    open ??
    (
      await db
        .select()
        .from(budgetPeriods)
        .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    )[0] ??
    null

  if (stillOpen && !openedThisRun) {
    // Keep allocations in step with any envelope added since the period opened.
    await materializeAllocations(orgId, plan, stillOpen)

    // 4 ── refresh a reconstructed base; audit real drift only.
    if (stillOpen.fundingBaseSource === "reconstructed_at_boundary") {
      const fresh = await reconstructedBase(orgId, plan, stillOpen)
      const was = Number(stillOpen.fundingBase ?? 0)
      if (Math.abs(fresh - was) >= 0.01) {
        await dbBatch([
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

  // ── notifications ────────────────────────────────────────────────────────
  // Best-effort, ALWAYS. Sync is what keeps the plan correct, so a notification
  // failure must never fail it — and these run after every write above has
  // already landed, so nothing can be announced that did not happen.
  void notifyBudgetOverdue({ orgId, plan, view, actorUserId: userId }).catch(() => {})
  void notifyEnvelopeOverspend({ orgId, plan, view, actorUserId: userId }).catch(() => {})

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
  // ONE round trip (§17.3), however many transactions the rules have posted:
  // the DB matches posted transactions to their commitments and inserts the
  // occurrences that do not exist yet. The unique (commitment_id, due_date)
  // index dedupes inside the statement, and RETURNING under DO NOTHING yields
  // only the rows actually inserted — so a re-run inserts nothing and ships
  // nothing, and the count is the number of newly settled bills.
  const inserted = await db.execute(sql`
    insert into ${budgetOccurrences}
      (commitment_id, organization_id, due_date, status, settled_transaction_id, settled_amount, settled_at, actor_user_id)
    select c.id, ${orgId}::uuid, t.recurring_due_date, 'settled', t.id, t.amount, now(), null
    from ${transactions} t
    join ${budgetCommitments} c on c.recurring_rule_id = t.recurring_rule_id
    where c.plan_id = ${plan.id}
      and c.status = 'active'
      and c.kind = 'recurring'
      and t.deleted_at is null
      and t.recurring_due_date is not null
      and not exists (
        select 1 from ${budgetOccurrences} o
        where o.commitment_id = c.id and o.due_date = t.recurring_due_date
      )
    on conflict (commitment_id, due_date) do nothing
    returning id
  `)
  return ((inserted as unknown as { rows?: unknown[] }).rows ?? []).length
}

/**
 * Close a period: freeze a snapshot, resolve contributions, then open the
 * successor WITH its rollover. Returns the period it opened, or null when
 * nothing was opened here (already closed, or a concurrent close won).
 */
async function closePeriod(
  orgId: string,
  plan: PlanRow,
  period: PeriodRow,
  role: string,
  accountType: string | null,
  actorUserId: string,
): Promise<PeriodRow | null> {
  // Idempotent: a snapshot already exists ⇒ this period is already closed.
  const [existing] = await db
    .select({ id: budgetPeriodSnapshots.id })
    .from(budgetPeriodSnapshots)
    .where(and(eq(budgetPeriodSnapshots.periodId, period.id), eq(budgetPeriodSnapshots.isCurrent, true)))
  if (existing) {
    await db.update(budgetPeriods).set({ status: "closed" }).where(eq(budgetPeriods.id, period.id))
    return null // the caller resumes the chain from this closed period
  }

  const payload = await snapshotPayload(orgId, plan, period, role, accountType)
  // The drift fingerprint is taken AT close and stored with the snapshot, so a
  // later sync never has to UPDATE the immutable v1 record to backfill it.
  const fingerprint = await windowFingerprint(orgId, plan, { start: period.start, endExclusive: period.endExclusive })

  const envelopes = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
  const allocations = await db.select().from(budgetAllocations).where(eq(budgetAllocations.periodId, period.id))
  const envById = new Map(envelopes.map((e) => [e.id, e]))

  const writes: Parameters<typeof dbBatch>[0] = [
    db.insert(budgetPeriodSnapshots).values({
      periodId: period.id,
      organizationId: orgId,
      version: 1,
      isCurrent: true,
      currency: plan.currency,
      payload: { ...payload, __fingerprint: fingerprint },
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
  ] as unknown as Parameters<typeof dbBatch>[0]

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

  try {
    await dbBatch(batch as unknown as Parameters<typeof dbBatch>[0])
  } catch (err) {
    // Lost a concurrent close (two tabs at the boundary): the other request's
    // snapshot v1 already exists (§10.14 — a repeat close returns the existing
    // snapshot). Nothing here is wrong, so this must not surface as a 500; the
    // caller resumes the chain, which finds the successor the winner opened.
    if (violates(err, "budget_period_snapshots_version_unique") || violates(err, "budget_period_snapshots_current_unique")) return null
    throw err
  }

  return openSuccessor(orgId, plan, period, payload, envelopes, actorUserId)
}

/**
 * Resume the period chain after a CLOSED period whose successor is not open:
 * a close that failed between its two writes, a concurrent close that lost,
 * or a sync that stopped at the cap. The rollover comes from the closed
 * period's current snapshot, so it is never lost.
 */
async function openAfter(orgId: string, plan: PlanRow, closed: PeriodRow, actorUserId: string): Promise<PeriodRow> {
  const [current] = await db
    .select({ payload: budgetPeriodSnapshots.payload })
    .from(budgetPeriodSnapshots)
    .where(and(eq(budgetPeriodSnapshots.periodId, closed.id), eq(budgetPeriodSnapshots.isCurrent, true)))
  const envelopes = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
  return openSuccessor(orgId, plan, closed, (current?.payload ?? {}) as Record<string, unknown>, envelopes, actorUserId)
}

type EnvelopeCarryRow = { id: string; carryPolicy: string; carryCap: string | null }

/** Rollover per envelope out of a closed period's snapshot (§8.12). */
function rolloverFrom(envelopes: EnvelopeCarryRow[], payload: Record<string, unknown>): Map<string, number> {
  const lines = envelopeLines(payload)
  const out = new Map<string, number>()
  for (const env of envelopes) {
    const line = lines.get(env.id)
    if (!line) continue
    const surplus = Number(line.remaining ?? 0)
    const carry = carryFor(env.carryPolicy as CarryPolicy, surplus, env.carryCap == null ? null : Number(env.carryCap))
    if (carry !== 0) out.set(env.id, carry)
  }
  return out
}

/**
 * Open the period after `closed` and carry its rollover in.
 *
 * The successor is the BRIDGED next window (§6.16 / §8.6.1 — never overlapping
 * the closed period after a cadence change). The rollover is written IN the
 * allocation insert (one write, never a period with its carry missing), and
 * the rollover events are recorded only when THIS call created the period, so
 * a resumed or concurrent open cannot record them twice.
 */
async function openSuccessor(
  orgId: string,
  plan: PlanRow,
  closed: PeriodRow,
  payload: Record<string, unknown>,
  envelopes: EnvelopeCarryRow[],
  actorUserId: string,
): Promise<PeriodRow> {
  const nextWindow = nextPeriod(cadenceOf(plan), { start: closed.start, endExclusive: closed.endExclusive })
  const rollover = rolloverFrom(envelopes, payload)

  const [already] = await db
    .select({ id: budgetPeriods.id })
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.start, nextWindow.start)))
    .limit(1)

  const next = await openPeriod(orgId, plan, nextWindow, { isPartial: false, actorUserId, rollover })

  if (!already && rollover.size) {
    await db.insert(budgetEvents).values(
      [...rollover].map(([envelopeId, carry]) => ({
        organizationId: orgId,
        planId: plan.id,
        periodId: next.id,
        envelopeId,
        action: "rollover_applied",
        amount: String(carry),
        detail: { from_period: closed.id, policy: envelopes.find((e) => e.id === envelopeId)?.carryPolicy ?? null },
        actorUserId: null,
      })),
    )
  }
  return next
}

/** The frozen report for a closed period (§10.8). */
async function snapshotPayload(
  orgId: string,
  plan: PlanRow,
  period: PeriodRow,
  role: string,
  accountType: string | null,
): Promise<Record<string, unknown>> {
  // Report THIS period explicitly. At close time it is still the open one, so
  // this is a no-op then; when restating a closed period it is the whole point,
  // because the default is "whatever is open now" — which would have silently
  // snapshotted the CURRENT period's figures over a historical record.
  const view = await buildBudgetView(orgId, role, accountType, new Date(), { periodId: period.id })
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
/** How many closed periods one sync will re-examine. */
const MAX_RESTATE_SWEEP = 12

type Fingerprint = { total: number; n: number; tx?: string; settlements?: string }

/**
 * The SQL that fingerprints one closed window (§8.11.2).
 *
 * ORG-SCOPED via the clients join: `transactions` carries no organization_id, so
 * without it this would hash EVERY organization's rows in the window and any
 * unrelated workspace's activity would restate this org's closed period.
 *
 * `tx` hashes every input a per-envelope figure depends on — id, type, amount,
 * account, category key and date, plus whether the row is excluded from this
 * plan — and `settlements` hashes the settlement links whose inflow falls in
 * the window. Σ and count alone could not see a re-categorised, re-dated or
 * re-accounted row, an exclusion, or a settlement link, and so most closed-
 * period drift went unrestated. Σ/count are kept for the human-readable
 * `drift.transactions` record.
 */
function fingerprintSql(orgId: string, planId: string, start: ReturnType<typeof sql>, endExclusive: ReturnType<typeof sql>) {
  return sql`
    select
      coalesce(sum(t.amount::numeric), 0)::text as total,
      count(*)::int as n,
      md5(coalesce(string_agg(
        t.id::text || '|' || t.type || '|' || t.amount::text || '|' || coalesce(t.wealth_account_id::text, '') || '|'
          || lower(btrim(coalesce(t.category, ''))) || '|' || t.date::text || '|'
          || (exists (select 1 from ${budgetExclusions} bx where bx.transaction_id = t.id and bx.plan_id = ${planId}))::int,
        ',' order by t.id), '')) as tx,
      (
        select md5(coalesce(string_agg(
          ts.expense_transaction_id::text || '|' || ts.settlement_transaction_id::text || '|' || ts.amount::text || '|'
            || lower(btrim(coalesce(e.category, ''))) || '|' || (e.deleted_at is null)::int,
          ',' order by ts.expense_transaction_id, ts.settlement_transaction_id), ''))
        from ${transactionSettlements} ts
        join ${transactions} s on s.id = ts.settlement_transaction_id
        join ${transactions} e on e.id = ts.expense_transaction_id
        where ts.organization_id = ${orgId} and s.deleted_at is null
          and s.date >= ${start} and s.date < ${endExclusive}
      ) as settlements
    from ${transactions} t
    join ${clients} c on c.id = t.client_id
    where c.organization_id = ${orgId} and c.deleted_at is null
      and t.date >= ${start} and t.date < ${endExclusive}
      and t.deleted_at is null and t.is_system = false and t.kind = 'standard'
  `
}

function fingerprintOf(row: Record<string, unknown> | undefined): Fingerprint {
  return {
    total: round2(Number(row?.total ?? 0)),
    n: Number(row?.n ?? 0),
    tx: typeof row?.tx === "string" ? row.tx : "",
    settlements: typeof row?.settlements === "string" ? row.settlements : "",
  }
}

/** Fingerprint one window (used at close time, so the snapshot carries it). */
async function windowFingerprint(
  orgId: string,
  plan: PlanRow,
  window: { start: string; endExclusive: string },
): Promise<Fingerprint> {
  const res = await db.execute(fingerprintSql(orgId, plan.id, sql`${window.start}::date`, sql`${window.endExclusive}::date`))
  return fingerprintOf((res as unknown as { rows?: Record<string, unknown>[] }).rows?.[0])
}

/**
 * Has the window drifted? A snapshot taken before signatures existed carries
 * only Σ/count; it is compared on those until it is restated (or backfilled).
 */
function driftBetween(prev: Fingerprint, now: Fingerprint): boolean {
  if (prev.tx != null && prev.settlements != null && now.tx != null && now.settlements != null) {
    return prev.tx !== now.tx || prev.settlements !== now.settlements
  }
  return prev.total !== now.total || prev.n !== now.n
}

/** Per-envelope figures out of a snapshot payload, keyed by envelope id. */
function envelopeLines(payload: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  const list = (payload as { envelopes?: unknown })?.envelopes
  if (!Array.isArray(list)) return out
  for (const e of list) {
    const row = e as Record<string, unknown>
    if (typeof row?.envelope_id === "string") out.set(row.envelope_id, row)
  }
  return out
}

/**
 * What actually changed between two snapshot payloads.
 *
 * Recorded on the restatement so a reader can see WHICH envelope moved and by
 * how much, instead of only that something did. A restatement that cannot say
 * what it corrected is not much better than no restatement.
 */
function payloadDrift(before: unknown, after: unknown): Record<string, unknown>[] {
  const a = envelopeLines(before)
  const b = envelopeLines(after)
  const changes: Record<string, unknown>[] = []
  for (const [id, next] of b) {
    const prev = a.get(id)
    const was = round2(Number(prev?.spent_net ?? 0))
    const now = round2(Number(next.spent_net ?? 0))
    if (prev == null || was !== now) {
      changes.push({
        envelope_id: id,
        // The name AS STORED in each snapshot, so a rename cannot disguise a diff.
        name: next.name ?? prev?.name ?? null,
        spent_net: { was: prev == null ? null : was, now },
        remaining: {
          was: prev == null ? null : round2(Number(prev.remaining ?? 0)),
          now: round2(Number(next.remaining ?? 0)),
        },
      })
    }
  }
  for (const [id, prev] of a) {
    if (!b.has(id)) changes.push({ envelope_id: id, name: prev.name ?? null, removed: true })
  }
  return changes
}

/**
 * Restate every closed period whose underlying transactions have changed (§8.11).
 *
 * A backdated, edited, deleted or restored transaction changes what a CLOSED
 * period should say. History is never edited in place: the old snapshot is
 * marked `is_current = false` and a new version supersedes it, so the record of
 * what was reported at the time survives alongside the correction.
 *
 * The recompute is real. Phase 1 detected drift and then re-stored the OLD
 * payload with a `__restated` flag, which recorded that something had changed
 * without ever saying what the corrected figures were. `buildBudgetView` now
 * accepts a period id, so the closed window is genuinely recomputed from the
 * ledger as it stands.
 *
 * The one thing that is NOT recomputed is cash. `available_now` is a reading of
 * today's account balances and cannot be reconstructed for a past instant, so
 * the original snapshot's cash figures are carried forward and flagged
 * `as_at_close`. Recomputing them would quietly replace "what your balance was
 * when this period closed" with "what it is today", which is a different and
 * much less useful fact.
 */
async function restateDriftedPeriods(
  orgId: string,
  plan: PlanRow,
  role: string,
  accountType: string | null,
): Promise<number> {
  // ONE round trip for the closed periods AND their current snapshots (the
  // partial unique index on is_current serves the join) …
  const closed = await db
    .select({ period: budgetPeriods, snapshot: budgetPeriodSnapshots })
    .from(budgetPeriods)
    .innerJoin(
      budgetPeriodSnapshots,
      and(eq(budgetPeriodSnapshots.periodId, budgetPeriods.id), eq(budgetPeriodSnapshots.isCurrent, true)),
    )
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "closed")))
    .orderBy(desc(budgetPeriods.start))
    .limit(MAX_RESTATE_SWEEP)
  if (!closed.length) return 0

  // … and ONE for every window's fingerprint, instead of one per period. The
  // sweep used to cost 1 + 2×N trips on every sync (25 after a year).
  const windows = sql.join(
    closed.map(({ period }) => sql`(${period.id}::uuid, ${period.start}::date, ${period.endExclusive}::date)`),
    sql`, `,
  )
  const printed = await db.execute(sql`
    select w.id, fp.total, fp.n, fp.tx, fp.settlements
    from (values ${windows}) as w(id, start, end_exclusive)
    cross join lateral (${fingerprintSql(orgId, plan.id, sql`w.start`, sql`w.end_exclusive`)}) fp
  `)
  const nowById = new Map<string, Fingerprint>()
  for (const row of (printed as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) {
    nowById.set(String(row.id), fingerprintOf(row))
  }

  let restated = 0

  for (const { period, snapshot: current } of closed) {
    const payload = current.payload as Record<string, unknown>
    const prevRaw = (payload.__fingerprint ?? null) as Partial<Fingerprint> | null
    const nowPrint = nowById.get(period.id) ?? fingerprintOf(undefined)

    if (!prevRaw) {
      // A snapshot frozen before fingerprints were stored at close: record one
      // now so future drift is detectable, without claiming a restatement.
      await db
        .update(budgetPeriodSnapshots)
        .set({ payload: { ...payload, __fingerprint: nowPrint } })
        .where(eq(budgetPeriodSnapshots.id, current.id))
      continue
    }
    const prevPrint: Fingerprint = {
      total: round2(Number(prevRaw.total ?? 0)),
      n: Number(prevRaw.n ?? 0),
      tx: typeof prevRaw.tx === "string" ? prevRaw.tx : undefined,
      settlements: typeof prevRaw.settlements === "string" ? prevRaw.settlements : undefined,
    }

    if (!driftBetween(prevPrint, nowPrint)) continue

    // Genuine recompute of THIS closed window.
    const fresh = await snapshotPayload(orgId, plan, period, role, accountType)
    const originalMoney = (payload.money ?? {}) as Record<string, unknown>
    const freshMoney = (fresh.money ?? {}) as Record<string, unknown>

    const merged: Record<string, unknown> = {
      ...fresh,
      money: {
        ...freshMoney,
        // Cash as at close — unknowable retrospectively, so preserved verbatim.
        available_now: originalMoney.available_now ?? null,
        cash_after_reservations: originalMoney.cash_after_reservations ?? null,
        safe_to_spend: originalMoney.safe_to_spend ?? null,
        binding: originalMoney.binding ?? null,
        forecast_balance: originalMoney.forecast_balance ?? null,
        as_at_close: true,
      },
      __fingerprint: nowPrint,
      __restated: true,
      __restated_at: new Date().toISOString(),
      __supersedes_version: current.version,
    }

    const changes = payloadDrift(payload, fresh)
    const nextVersion = current.version + 1

    try {
      await dbBatch([
      db
        .update(budgetPeriodSnapshots)
        .set({ isCurrent: false })
        .where(eq(budgetPeriodSnapshots.id, current.id)),
      db.insert(budgetPeriodSnapshots).values({
        periodId: period.id,
        organizationId: orgId,
        version: nextVersion,
        isCurrent: true,
        supersedesId: current.id,
        restatedReason: "transaction_edited",
        restatedBy: null, // system-detected
        drift: { transactions: [prevPrint, nowPrint], envelopes: changes },
        currency: current.currency, // carried forward, so history keeps its currency
        payload: merged,
        engineVersion: ENGINE_VERSION,
      }),
      db.insert(budgetEvents).values({
        organizationId: orgId,
        planId: plan.id,
        periodId: period.id,
        action: "period_restated",
        detail: {
          version: nextVersion,
          reason: "transaction_edited",
          was: prevPrint,
          now: nowPrint,
          envelopes_changed: changes.length,
        },
        actorUserId: null,
      }),
      ] as unknown as Parameters<typeof dbBatch>[0])
    } catch (err) {
      // A concurrent sync restated this version first (§16.12): the record is
      // already correct and already announced — nothing for the loser to do.
      if (violates(err, "budget_period_snapshots_version_unique") || violates(err, "budget_period_snapshots_current_unique")) continue
      throw err
    }

    // Worth announcing: this revises a record the user may already have read.
    // Deduped per VERSION, so a later second revision does notify again.
    void notifyPeriodRestated({
      orgId,
      periodId: period.id,
      periodStart: period.start,
      version: nextVersion,
      actorUserId: null,
    }).catch(() => {})

    restated++
  }

  return restated
}
