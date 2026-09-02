// Budget v2 — the DB layer (spec §11.4 layer 2).
//
// Rule for this file: it FETCHES and hands off. Every formula lives in
// src/lib/budget-math.ts and is unit-tested there; nothing here re-derives a
// number. That split is what makes the engine testable at all given the repo's
// DB-free unit gate.
//
// Two invariants worth stating up front, because breaking either is a money bug:
//   1. Budget READS never write. They detect staleness and report `sync_required`;
//      the write happens in an explicit idempotent sync (§8.10, decision D-3).
//   2. An occurrence is an EXPECTATION. Nothing in this file lets one touch
//      wealth_accounts.current_balance.
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import {
  budgetAllocations,
  budgetCommitments,
  budgetEnvelopes,
  budgetEvents,
  budgetExclusions,
  budgetFundEntries,
  budgetOccurrences,
  budgetPeriods,
  budgetPlans,
  clients,
  organizations,
  recurringRules,
  transactions,
  wealthAccounts,
} from "../../src/lib/db/schema.js"
import { safeTimezone } from "../../src/lib/schedule-notifications.js"
import { occurrencesDue } from "../../src/lib/recurring.js"
import {
  addDays,
  applyOccurrenceDeviations,
  carryLowerBound,
  fundBalanceFromEntries,
  fundingCapacity,
  flexibleHeadroom,
  normalizeTarget,
  pendingFrom,
  periodDays,
  periodFor,
  remaining,
  reservedTotal,
  round2,
  safeToSpend,
  spentNet,
  state,
  todayInTz,
  unallocated,
  type BudgetSection,
  type CadenceConfig,
  type FundingBaseSource,
  type IncomeMode,
  type PeriodWindow,
  type ProjectedOccurrence,
  type ReservedBreakdown,
  type TargetCadence,
} from "../../src/lib/budget-math.js"

export const ENGINE_VERSION = 1

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes
// ─────────────────────────────────────────────────────────────────────────────

export type PlanRow = typeof budgetPlans.$inferSelect
export type PeriodRow = typeof budgetPeriods.$inferSelect
export type EnvelopeRow = typeof budgetEnvelopes.$inferSelect
export type AllocationRow = typeof budgetAllocations.$inferSelect

const num = (v: unknown): number => (v == null ? 0 : Number(v))

/** The plan's cadence config, in the shape budget-math expects. */
export function cadenceOf(plan: PlanRow): CadenceConfig {
  return {
    cadence: plan.cadence as CadenceConfig["cadence"],
    weekStartDay: plan.weekStartDay,
    anchorDay: plan.anchorDay,
    customStart: plan.customStart,
    customDays: plan.customDays,
  }
}

/** "Today" in the plan's timezone — the only timezone-sensitive value (§8.2). */
export function planToday(plan: PlanRow, now = new Date()): string {
  return todayInTz(safeTimezone(plan.timezone), now)
}

export async function loadPlan(orgId: string): Promise<PlanRow | null> {
  const [plan] = await db
    .select()
    .from(budgetPlans)
    .where(and(eq(budgetPlans.organizationId, orgId), ne(budgetPlans.status, "archived")))
  return plan ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.5 — Available now
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Liquid money: bank + cash only, non-archived, restricted to the plan's
 * included accounts when it names any.
 *
 * Spaces are excluded by the `type in ('bank','cash')` filter — that exclusion is
 * what MAKES them savings, and it is why a Space-backed fund's balance must
 * never also be reserved (§8.5).
 */
export async function availableNow(orgId: string, plan: PlanRow | null): Promise<number> {
  const included = (plan?.includedAccountIds as string[] | null) ?? []
  const conds = [
    eq(wealthAccounts.organizationId, orgId),
    isNull(wealthAccounts.archivedAt),
    inArray(wealthAccounts.type, ["bank", "cash"]),
  ]
  if (included.length) conds.push(inArray(wealthAccounts.id, included))
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${wealthAccounts.currentBalance}::numeric), 0)` })
    .from(wealthAccounts)
    .where(and(...conds))
  return round2(num(row?.total))
}

/** The account ids Available-now is computed over — also the plan's tx scope. */
async function includedAccountIds(orgId: string, plan: PlanRow | null): Promise<string[]> {
  const named = (plan?.includedAccountIds as string[] | null) ?? []
  const rows = await db
    .select({ id: wealthAccounts.id })
    .from(wealthAccounts)
    .where(
      and(
        eq(wealthAccounts.organizationId, orgId),
        isNull(wealthAccounts.archivedAt),
        inArray(wealthAccounts.type, ["bank", "cash"]),
        ...(named.length ? [inArray(wealthAccounts.id, named)] : []),
      ),
    )
  return rows.map((r) => r.id)
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.4 — funding base
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum of every balance movement on the plan's accounts since `fromDate`.
 *
 * The rollback set is *"transactions whose balance effect is CURRENTLY
 * applied"*, which is NOT the same as "not deleted": a soft-deleted ordinary row
 * has already been reversed (wealth-ledger `reversesOnTrash`) so it must be
 * excluded, while a soft-deleted SYSTEM row keeps its effect through Trash so it
 * must be included. Getting this backwards silently shifts every funding base.
 */
export async function balanceMovedSince(orgId: string, plan: PlanRow | null, fromDate: string): Promise<number> {
  const accounts = await includedAccountIds(orgId, plan)
  if (!accounts.length) return 0
  const [row] = await db
    .select({
      moved: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else -${transactions.amount}::numeric end), 0)`,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.wealthAccountId, accounts),
        gte(transactions.date, fromDate),
        // "effect currently applied" — see the docblock.
        or(isNull(transactions.deletedAt), eq(transactions.isSystem, true)),
      ),
    )
  return round2(num(row?.moved))
}

/**
 * Income that QUALIFIES to accrete capacity, per the base's source (§8.4).
 *
 * The discriminator differs by source and the types never mix:
 *  - reconstructed → by `date >= anchor_date` (a calendar date vs a date column)
 *  - snapshot      → by `created_at > as_of`  (an instant vs a timestamp column)
 *
 * The snapshot rule uses `created_at`, NOT `date`, because current_balance moves
 * when a row is INSERTED whatever date it carries — so a backdated income
 * entered after the snapshot was not inside that balance and must accrete.
 */
export async function incomeAccreted(orgId: string, plan: PlanRow | null, period: PeriodRow): Promise<number> {
  if (plan?.incomeMode !== "available") return 0
  const accounts = await includedAccountIds(orgId, plan)
  if (!accounts.length) return 0

  const conds = [
    inArray(transactions.wealthAccountId, accounts),
    eq(transactions.type, "incoming"),
    eq(transactions.kind, "standard"),
    eq(transactions.isSystem, false),
    isNull(transactions.deletedAt),
    lt(transactions.date, period.endExclusive),
  ]
  if (period.fundingBaseSource === "snapshot_at_open" && period.fundingBaseAsOf) {
    conds.push(sql`${transactions.createdAt} > ${period.fundingBaseAsOf}`)
  } else {
    conds.push(gte(transactions.date, period.fundingBaseAnchorDate))
  }

  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)` })
    .from(transactions)
    .where(and(...conds))
  return round2(num(row?.total))
}

/** Signed sum of audited funding_adjusted events for a period (§8.4). */
export async function fundingAdjustments(periodId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${budgetEvents.amount}::numeric), 0)` })
    .from(budgetEvents)
    .where(and(eq(budgetEvents.periodId, periodId), eq(budgetEvents.action, "funding_adjusted")))
  return round2(num(row?.total))
}

/** Compute what the funding base SHOULD be for a reconstructed period. */
export async function reconstructedBase(orgId: string, plan: PlanRow, period: PeriodRow): Promise<number> {
  const now = await availableNow(orgId, plan)
  const moved = await balanceMovedSince(orgId, plan, period.start)
  return round2(now - moved)
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.3 / §8.8 — spend
// ─────────────────────────────────────────────────────────────────────────────

/** The inclusion predicates every v2 spend query shares (§8.3). */
function inclusionConds(orgId: string, accounts: string[], planId: string) {
  return [
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    isNull(transactions.deletedAt),
    eq(transactions.kind, "standard"),
    // System rows DEFINE balances; they are not spending (v1 defect #1).
    eq(transactions.isSystem, false),
    ...(accounts.length ? [inArray(transactions.wealthAccountId, accounts)] : []),
    // Explicit, audited opt-out — also carries "not a refund" (§8.8).
    sql`not exists (select 1 from ${budgetExclusions} bx where bx.transaction_id = ${transactions.id} and bx.plan_id = ${planId})`,
  ]
}

export type EnvelopeSpend = { spentGross: number; refundsProvisional: number; refundsConfirmed: number }

/**
 * Gross outflow and provisional refund inflow for a window.
 *
 * `matchKeys` empty means "everything not claimed by another envelope" (the
 * catch-all). An INFLOW only ever nets when it matches an envelope's EXPLICIT
 * category keys — never the catch-all — so salary can never cancel out grocery
 * spending (§8.8). That is why a catch-all-only plan reports no refunds: netting
 * income against a catch-all would be worse than not netting at all.
 */
export async function spendForEnvelope(
  orgId: string,
  plan: PlanRow,
  window: PeriodWindow,
  matchKeys: string[],
  claimedKeys: string[],
): Promise<EnvelopeSpend> {
  const accounts = await includedAccountIds(orgId, plan)
  const base = inclusionConds(orgId, accounts, plan.id)
  const inRange = [gte(transactions.date, window.start), lt(transactions.date, window.endExclusive)]

  const keyExpr = sql`lower(btrim(coalesce(${transactions.category}, '')))`
  const isCatchAll = matchKeys.length === 0

  // Bind each key as its own placeholder (the `sql.join` pattern already used by
  // api/_routes/flow.ts). Passing a JS array to `= any(...)` binds it as ONE
  // param and Postgres then fails with "malformed array literal".
  const list = (keys: string[]) => sql.join(keys.map((k) => sql`${k}`), sql`, `)
  const scope = isCatchAll
    ? // Everything NOT claimed by an explicit envelope.
      claimedKeys.length
      ? [sql`${keyExpr} not in (${list(claimedKeys)})`]
      : []
    : [sql`${keyExpr} in (${list(matchKeys)})`]

  const [row] = await db
    .select({
      gross: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`,
      inflow: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...base, ...inRange, ...scope))

  return {
    spentGross: round2(num(row?.gross)),
    // A catch-all never nets inflows (see docblock); explicit envelopes do,
    // provisionally, and the UI discloses it with confirm / not-a-refund.
    refundsProvisional: isCatchAll ? 0 : round2(num(row?.inflow)),
    refundsConfirmed: 0, // Phase 2: transaction_settlements (§10.11)
  }
}

/** Income actually received in the window — the income section's `received`. */
export async function incomeReceived(orgId: string, plan: PlanRow, window: PeriodWindow): Promise<number> {
  const accounts = await includedAccountIds(orgId, plan)
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}::numeric), 0)` })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(
      and(
        ...inclusionConds(orgId, accounts, plan.id),
        eq(transactions.type, "incoming"),
        gte(transactions.date, window.start),
        lt(transactions.date, window.endExclusive),
      ),
    )
  return round2(num(row?.total))
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.6 — occurrence projection (pure reads; expectations never move money)
// ─────────────────────────────────────────────────────────────────────────────

export type EnvelopeOccurrences = {
  envelopeId: string
  occurrences: ProjectedOccurrence[]
  needsAttention: boolean
  excludedCount: number
}

/**
 * Project every active commitment's occurrences for the window, applying stored
 * deviations. The window's LOWER bound comes from carryLowerBound() and reaches
 * back past the period start, because a prior-period occurrence that is never
 * GENERATED cannot be recovered by any later filter (§8.6.1).
 */
export async function projectOccurrences(
  orgId: string,
  plan: PlanRow,
  period: PeriodWindow,
  today: string,
): Promise<EnvelopeOccurrences[]> {
  const commitments = await db
    .select()
    .from(budgetCommitments)
    .where(and(eq(budgetCommitments.planId, plan.id), eq(budgetCommitments.status, "active")))
  if (!commitments.length) return []

  const devRows = await db
    .select()
    .from(budgetOccurrences)
    .where(inArray(budgetOccurrences.commitmentId, commitments.map((c) => c.id)))

  const ruleIds = commitments.map((c) => c.recurringRuleId).filter((v): v is string => !!v)
  const rules = ruleIds.length
    ? await db.select().from(recurringRules).where(inArray(recurringRules.id, ruleIds))
    : []
  const ruleById = new Map(rules.map((r) => [r.id, r]))

  const byEnvelope = new Map<string, EnvelopeOccurrences>()

  for (const c of commitments) {
    const lower = carryLowerBound(
      { kind: c.kind as "one_time" | "recurring", dueDate: c.dueDate, firstDueDate: c.firstDueDate },
      period.start,
      today,
    )

    // Raw projection.
    let rawDates: { dueDate: string; amount: number }[] = []
    if (c.kind === "one_time") {
      if (c.dueDate && c.dueDate >= lower && c.dueDate < period.endExclusive) {
        rawDates = [{ dueDate: c.dueDate, amount: num(c.amount) }]
      }
    } else {
      const rule = c.recurringRuleId ? ruleById.get(c.recurringRuleId) : undefined
      if (rule) {
        // REUSES the recurring engine's anchor-based math (no month-end drift).
        const { due } = occurrencesDue({
          anchor: rule.startDate,
          freq: { unit: rule.frequencyUnit as "day" | "week" | "month" | "year", interval: rule.frequencyInterval },
          cursor: lower,
          until: addDays(period.endExclusive, -1),
          end: rule.endDate,
        })
        rawDates = due.map((d: string) => ({ dueDate: d, amount: num(rule.amount) }))
      }
    }

    const deviations: Parameters<typeof applyOccurrenceDeviations>[0]["deviations"] = {}
    for (const d of devRows.filter((d) => d.commitmentId === c.id)) {
      deviations[d.dueDate] = {
        status: d.status as "settled" | "cancelled" | "skipped" | "rescheduled",
        rescheduledTo: d.rescheduledTo,
        settledAmount: d.settledAmount == null ? null : num(d.settledAmount),
        settledTransactionId: d.settledTransactionId,
      }
    }

    const applied = applyOccurrenceDeviations({
      commitmentId: c.id,
      kind: c.kind as "one_time" | "recurring",
      defaultAmount: num(c.amount),
      rawDates,
      deviations,
      periodStart: period.start,
      windowStart: lower,
      windowEndExclusive: period.endExclusive,
    })

    const entry = byEnvelope.get(c.envelopeId) ?? {
      envelopeId: c.envelopeId,
      occurrences: [],
      needsAttention: false,
      excludedCount: 0,
    }
    entry.occurrences.push(...applied.occurrences)
    entry.needsAttention = entry.needsAttention || applied.needsAttention
    entry.excludedCount += applied.excludedCount
    byEnvelope.set(c.envelopeId, entry)
  }

  return [...byEnvelope.values()]
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.9 — fund balances
// ─────────────────────────────────────────────────────────────────────────────

/** Virtual fund balances by envelope: the signed sum of CONFIRMED entries. */
export async function virtualFundBalances(orgId: string, envelopeIds: string[]): Promise<Map<string, number>> {
  if (!envelopeIds.length) return new Map()
  const rows = await db
    .select({ envelopeId: budgetFundEntries.envelopeId, kind: budgetFundEntries.kind, amount: budgetFundEntries.amount })
    .from(budgetFundEntries)
    .where(and(eq(budgetFundEntries.organizationId, orgId), inArray(budgetFundEntries.envelopeId, envelopeIds)))

  const byEnvelope = new Map<string, { kind: "contribution" | "withdrawal" | "adjustment"; amount: number }[]>()
  for (const r of rows) {
    const list = byEnvelope.get(r.envelopeId) ?? []
    list.push({ kind: r.kind as "contribution" | "withdrawal" | "adjustment", amount: num(r.amount) })
    byEnvelope.set(r.envelopeId, list)
  }
  const out = new Map<string, number>()
  for (const [id, entries] of byEnvelope) out.set(id, fundBalanceFromEntries(entries))
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.10 — period lifecycle. Called ONLY from sync, never from a GET.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_PERIODS_PER_RUN = 24

/** Is anything stale? A cheap read-only probe used by every budget GET (§8.10). */
export async function syncRequired(orgId: string, plan: PlanRow | null, today: string): Promise<boolean> {
  if (!plan || plan.status !== "active") return false

  // 1. A due recurring rule that has not materialized its transaction yet.
  const [dueRule] = await db
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(
      and(eq(recurringRules.organizationId, orgId), eq(recurringRules.active, true), lte(recurringRules.nextDueAt, today)),
    )
    .limit(1)
  if (dueRule) return true

  // 2. The current period is missing, or an open period has already elapsed.
  const cur = periodFor(cadenceOf(plan), today)
  const open = await db
    .select({ id: budgetPeriods.id, start: budgetPeriods.start, endExclusive: budgetPeriods.endExclusive })
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
  if (!open.length) return true
  if (open.some((p) => p.endExclusive <= today)) return true
  if (!open.some((p) => p.start === cur.start)) return true

  return false
}

function baseSourceFor(plan: PlanRow, isPartial: boolean): FundingBaseSource {
  if (plan.incomeMode === "expected") return "expected_income"
  // A plan created mid-period anchors at creation (D-18): reconstructing to a
  // boundary before the plan existed would describe a period it never governed.
  return isPartial ? "snapshot_at_open" : "reconstructed_at_boundary"
}

/** Open a period, materialize its allocations, and set its funding base. */
export async function openPeriod(
  orgId: string,
  plan: PlanRow,
  window: PeriodWindow,
  opts: { isPartial: boolean; actorUserId?: string | null },
): Promise<PeriodRow> {
  const source = baseSourceFor(plan, opts.isPartial)
  const now = new Date()

  let base = 0
  let asOf: Date | null = null
  let anchor = window.start
  if (source === "expected_income") {
    base = num(plan.expectedIncome)
  } else if (source === "snapshot_at_open") {
    base = await availableNow(orgId, plan)
    asOf = now
    anchor = planToday(plan, now)
  } else {
    const avail = await availableNow(orgId, plan)
    const moved = await balanceMovedSince(orgId, plan, window.start)
    base = round2(avail - moved)
  }

  const [period] = await db
    .insert(budgetPeriods)
    .values({
      planId: plan.id,
      organizationId: orgId,
      start: window.start,
      endExclusive: window.endExclusive,
      status: "open",
      fundingBase: String(base),
      fundingBaseSource: source,
      fundingBaseAnchorDate: anchor,
      fundingBaseAsOf: asOf,
      fundingBaseComputedAt: now,
      isPartial: opts.isPartial,
    })
    .onConflictDoNothing({ target: [budgetPeriods.planId, budgetPeriods.start] })
    .returning()

  if (!period) {
    // Lost the race — another request opened it. Return the existing row.
    const [existing] = await db
      .select()
      .from(budgetPeriods)
      .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.start, window.start)))
    await materializeAllocations(orgId, plan, existing)
    return existing
  }

  await db.insert(budgetEvents).values({
    organizationId: orgId,
    planId: plan.id,
    periodId: period.id,
    action: "period_opened",
    detail: { start: window.start, end_exclusive: window.endExclusive, funding_base_source: source, is_partial: opts.isPartial },
    actorUserId: opts.actorUserId ?? null,
  })

  await materializeAllocations(orgId, plan, period)
  return period
}

/** Create this period's allocation rows from the envelopes. Idempotent. */
export async function materializeAllocations(orgId: string, plan: PlanRow, period: PeriodRow): Promise<void> {
  const envelopes = await db
    .select()
    .from(budgetEnvelopes)
    .where(and(eq(budgetEnvelopes.planId, plan.id), eq(budgetEnvelopes.status, "active")))
  if (!envelopes.length) return

  const days = periodDays({ start: period.start, endExclusive: period.endExclusive })
  const seed = plan.nextPeriodSeed

  // Rollover written by the previous close, keyed by envelope.
  const rows = envelopes.map((e) => {
    const authored = num(e.targetAmount)
    const cadence = e.targetCadence as TargetCadence
    const planned = seed === "fresh" ? 0 : normalizeTarget(authored, cadence, days)
    return {
      periodId: period.id,
      envelopeId: e.id,
      organizationId: orgId,
      plannedAmount: String(planned),
      authoredAmount: String(authored),
      authoredCadence: cadence,
      source: seed,
      // A savings envelope's contribution starts merely PLANNED — reserved, but
      // never described as funded until confirmed (§8.9.1).
      contributionStatus: e.section === "savings" ? "planned" : null,
    }
  })

  await db.insert(budgetAllocations).values(rows).onConflictDoNothing({
    target: [budgetAllocations.periodId, budgetAllocations.envelopeId],
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembling the read model
// ─────────────────────────────────────────────────────────────────────────────

export type EnvelopeView = {
  id: string
  name: string
  section: BudgetSection
  planned: number
  rollover_in: number
  authored_amount: number
  authored_cadence: TargetCadence
  spent_gross: number
  refunds_confirmed: number
  refunds_provisional: number
  spent_net: number
  pending: number
  remaining: number
  state: ReturnType<typeof state>
  priority: string
  carry_policy: string
  is_catch_all: boolean
  reimbursable: boolean
  funding_mode: string | null
  auto_fund: boolean
  goal_amount: number | null
  target_date: string | null
  balance: number | null
  contribution_status: string | null
  needs_attention: boolean
  excluded_occurrence_count: number
}

export type BudgetView = {
  plan: Record<string, unknown> | null
  period: Record<string, unknown> | null
  money: Record<string, unknown> | null
  sections: Record<string, unknown> | null
  plan_status: string | null
  total_outflow: number | null
  occurrences_upcoming: Record<string, unknown>[]
  occurrences_overdue: Record<string, unknown>[]
  sync_required: boolean
  alerts: Record<string, unknown>[]
  suggestions: Record<string, unknown>[]
  capabilities: Record<string, unknown>
  limitations: string[]
}

/**
 * The whole overview in one read (§11.3). READ-ONLY: it never writes, and
 * reports `sync_required` instead of silently serving a stale figure.
 */
export async function buildBudgetView(
  orgId: string,
  role: string,
  accountType: string | null,
  now = new Date(),
): Promise<BudgetView> {
  const plan = await loadPlan(orgId)
  const capabilities = {
    can_write: ["owner", "admin", "editor"].includes(role),
    can_close: ["owner", "admin"].includes(role),
    account_type: accountType,
  }
  const limitations = ["credit_cards_unsupported", "loan_split_unsupported", "manual_pending_unsupported"]

  if (!plan) {
    return {
      plan: null,
      period: null,
      money: null,
      sections: null,
      plan_status: null,
      total_outflow: null,
      occurrences_upcoming: [],
      occurrences_overdue: [],
      sync_required: false,
      alerts: [],
      suggestions: [],
      capabilities,
      limitations,
    }
  }

  const today = planToday(plan, now)
  const stale = await syncRequired(orgId, plan, today)

  // The currently OPEN period (there is at most one — a partial unique index).
  const [period] = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
    .orderBy(desc(budgetPeriods.start))
    .limit(1)

  // Currency divergence is DETECTED, never converted (§12.4).
  const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId))
  if (org && org.currency !== plan.currency) limitations.push("currency_changed")

  if (!period) {
    return {
      plan: planView(plan),
      period: null,
      money: null,
      sections: null,
      plan_status: null,
      total_outflow: null,
      occurrences_upcoming: [],
      occurrences_overdue: [],
      sync_required: true, // no open period yet — sync will create one
      alerts: [],
      suggestions: [],
      capabilities,
      limitations,
    }
  }

  const window: PeriodWindow = { start: period.start, endExclusive: period.endExclusive }

  const [envelopes, allocations] = await Promise.all([
    db
      .select()
      .from(budgetEnvelopes)
      .where(and(eq(budgetEnvelopes.planId, plan.id), ne(budgetEnvelopes.status, "removed")))
      .orderBy(asc(budgetEnvelopes.position), asc(budgetEnvelopes.createdAt)),
    db.select().from(budgetAllocations).where(eq(budgetAllocations.periodId, period.id)),
  ])
  const allocByEnvelope = new Map(allocations.map((a) => [a.envelopeId, a]))

  // Explicit category keys, so the catch-all can exclude what others claim.
  const claimedKeys = envelopes
    .filter((e) => e.section === "flexible" && !e.isCatchAll)
    .flatMap((e) => (e.matchKeys as string[] | null) ?? [])

  const [occByEnvelope, fundBalances, incomeRecv, adjustments] = await Promise.all([
    projectOccurrences(orgId, plan, window, today),
    virtualFundBalances(
      orgId,
      envelopes.filter((e) => e.section === "savings" && e.fundingMode === "virtual").map((e) => e.id),
    ),
    incomeReceived(orgId, plan, window),
    fundingAdjustments(period.id),
  ])
  const occMap = new Map(occByEnvelope.map((o) => [o.envelopeId, o]))

  // Per-envelope spend. Sequential by design: each is one indexed aggregate and
  // Phase 1 plans have a handful of envelopes; §17.3 caps the payload at 200.
  const views: EnvelopeView[] = []
  for (const e of envelopes) {
    const alloc = allocByEnvelope.get(e.id)
    const rolloverIn = num(alloc?.rolloverIn)
    const planned = round2(num(alloc?.plannedAmount) + rolloverIn)
    const occ = occMap.get(e.id)
    const pending = occ ? pendingFrom(occ.occurrences) : 0

    let spend: EnvelopeSpend = { spentGross: 0, refundsProvisional: 0, refundsConfirmed: 0 }
    if (e.section === "flexible") {
      spend = await spendForEnvelope(orgId, plan, window, ((e.matchKeys as string[]) ?? []), claimedKeys)
    }
    const net = spentNet(spend)

    views.push({
      id: e.id,
      name: e.name,
      section: e.section as BudgetSection,
      planned,
      rollover_in: rolloverIn,
      authored_amount: num(alloc?.authoredAmount ?? e.targetAmount),
      authored_cadence: (alloc?.authoredCadence ?? e.targetCadence) as TargetCadence,
      spent_gross: spend.spentGross,
      refunds_confirmed: spend.refundsConfirmed,
      refunds_provisional: spend.refundsProvisional,
      spent_net: net,
      pending,
      remaining: remaining(planned, net, pending),
      state: state(net + pending, planned),
      priority: e.priority,
      carry_policy: e.carryPolicy,
      is_catch_all: e.isCatchAll,
      reimbursable: e.reimbursable,
      funding_mode: e.fundingMode,
      auto_fund: e.autoFund,
      goal_amount: e.goalAmount == null ? null : num(e.goalAmount),
      target_date: e.targetDate,
      balance:
        e.section === "savings"
          ? e.fundingMode === "virtual"
            ? (fundBalances.get(e.id) ?? 0)
            : null // Space-backed: the Space's own balance, surfaced by /api/spaces
          : null,
      contribution_status: alloc?.contributionStatus ?? null,
      needs_attention: occ?.needsAttention ?? false,
      excluded_occurrence_count: occ?.excludedCount ?? 0,
    })
  }

  // ── section totals: separate shapes, never one cross-section ratio (§8.7) ──
  const bySection = (s: BudgetSection) => views.filter((v) => v.section === s)
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))

  const flex = bySection("flexible")
  const flexTotals = {
    planned: sum(flex.map((v) => v.planned)),
    spentNet: sum(flex.map((v) => v.spent_net)),
    pending: sum(flex.map((v) => v.pending)),
  }
  const ceilingDefined = flex.some((v) => v.planned > 0)

  const commit = bySection("commitment")
  const debt = bySection("debt")
  const savings = bySection("savings")

  const commitmentOutstanding = sum(commit.map((v) => v.pending))
  const debtOutstanding = sum(debt.map((v) => v.pending))
  const overdueAmount = sum(
    occByEnvelope.flatMap((o) =>
      o.occurrences.filter((x) => x.state === "expected" && x.dueDate < today).map((x) => x.amount),
    ),
  )

  const virtualBalances = sum(savings.filter((v) => v.funding_mode === "virtual").map((v) => v.balance ?? 0))
  const virtualUnconfirmed = sum(
    savings.filter((v) => v.funding_mode === "virtual" && v.contribution_status === "planned").map((v) => v.planned),
  )
  const spaceDue = sum(
    savings.filter((v) => v.funding_mode === "space_backed" && v.contribution_status === "planned").map((v) => v.planned),
  )
  const protectedDue = sum(savings.filter((v) => !v.goal_amount && v.contribution_status === "planned").map(() => 0))

  const breakdown: ReservedBreakdown = {
    commitmentsOutstanding: commitmentOutstanding,
    commitmentsOverdue: overdueAmount,
    debtOutstanding,
    virtualFundBalances: virtualBalances,
    virtualContributionsUnconfirmed: virtualUnconfirmed,
    spaceContributionsDue: spaceDue,
    protectedSavingsDue: protectedDue,
  }
  const reserved = reservedTotal(breakdown)
  const available = await availableNow(orgId, plan)
  const sts = safeToSpend({ availableNow: available, reserved, flexible: flexTotals, ceilingDefined })

  const capacity = fundingCapacity({
    incomeMode: plan.incomeMode as IncomeMode,
    fundingBase: num(period.fundingBase),
    fundingBaseSource: period.fundingBaseSource as FundingBaseSource,
    incomeAccreted: await incomeAccreted(orgId, plan, period),
    fundingAdjustments: adjustments,
  })
  const totalAllocated = sum(views.map((v) => v.planned))

  const expectedIncome = plan.incomeMode === "expected" ? num(plan.expectedIncome) : null
  const flexHeadroom = flexibleHeadroom(flexTotals)

  const upcoming = occByEnvelope
    .flatMap((o) => o.occurrences.map((x) => ({ ...x, envelopeId: o.envelopeId })))
    .filter((x) => x.state === "expected")
  const overdueList = upcoming.filter((x) => x.dueDate < today)

  return {
    plan: planView(plan),
    period: {
      id: period.id,
      start: period.start,
      end_exclusive: period.endExclusive,
      status: period.status,
      is_partial: period.isPartial,
      days_left: Math.max(0, Number(daysLeft(today, period.endExclusive))),
      funding_base: num(period.fundingBase),
      funding_base_source: period.fundingBaseSource,
      funding_base_anchor_date: period.fundingBaseAnchorDate,
      funding_base_as_of: period.fundingBaseAsOf,
      income_accreted: round2(capacity - num(period.fundingBase) - adjustments),
      funding_adjustments: adjustments,
      funding_capacity: capacity,
    },
    money: {
      available_now: available,
      reserved,
      reserved_breakdown: {
        commitments_outstanding: breakdown.commitmentsOutstanding,
        commitments_overdue: breakdown.commitmentsOverdue,
        debt_outstanding: breakdown.debtOutstanding,
        virtual_fund_balances: breakdown.virtualFundBalances,
        virtual_contributions_unconfirmed: breakdown.virtualContributionsUnconfirmed,
        space_contributions_due: breakdown.spaceContributionsDue,
        protected_savings_due: breakdown.protectedSavingsDue,
      },
      cash_after_reservations: sts.cashAfterReservations,
      flexible_headroom: sts.flexibleHeadroom,
      ceiling_defined: sts.ceilingDefined,
      safe_to_spend: sts.amount,
      binding: sts.binding,
      unallocated: unallocated(capacity, totalAllocated),
      unallocated_available: Math.max(0, unallocated(capacity, totalAllocated)),
      forecast_balance: round2(available - reserved - Math.max(0, flexHeadroom)),
    },
    sections: {
      income: {
        expected: expectedIncome,
        received: incomeRecv,
        outstanding: expectedIncome == null ? null : Math.max(0, round2(expectedIncome - incomeRecv)),
      },
      flexible: {
        planned: flexTotals.planned,
        spent_gross: sum(flex.map((v) => v.spent_gross)),
        refunds_confirmed: sum(flex.map((v) => v.refunds_confirmed)),
        refunds_provisional: sum(flex.map((v) => v.refunds_provisional)),
        spent_net: flexTotals.spentNet,
        pending: flexTotals.pending,
        remaining: round2(flexTotals.planned - flexTotals.spentNet - flexTotals.pending), // SIGNED
        headroom: flexHeadroom, // floored once
        utilisation: state(flexTotals.spentNet + flexTotals.pending, flexTotals.planned),
        envelopes: flex,
      },
      commitment: {
        planned: sum(commit.map((v) => v.planned)),
        settled: sum(commit.map((v) => v.spent_net)),
        outstanding: commitmentOutstanding,
        envelopes: commit,
      },
      debt: {
        planned: sum(debt.map((v) => v.planned)),
        paid: sum(debt.map((v) => v.spent_net)),
        outstanding: debtOutstanding,
        envelopes: debt,
      },
      savings: {
        planned: sum(savings.map((v) => v.planned)),
        reserved: round2(virtualUnconfirmed + spaceDue),
        funded: sum(savings.filter((v) => v.contribution_status === "confirmed").map((v) => v.planned)),
        funded_cash: sum(
          savings.filter((v) => v.funding_mode === "space_backed" && v.contribution_status === "confirmed").map((v) => v.planned),
        ),
        missed: sum(savings.filter((v) => v.contribution_status === "missed").map((v) => v.planned)),
        outstanding: round2(virtualUnconfirmed + spaceDue),
        balance: sum(savings.map((v) => v.balance ?? 0)),
        awaiting_confirmation: savings.filter((v) => v.contribution_status === "planned").length,
        envelopes: savings,
      },
    },
    // Plan utilisation is the FLEXIBLE section alone — never a cross-section ratio.
    plan_status: state(flexTotals.spentNet + flexTotals.pending, flexTotals.planned),
    total_outflow: round2(
      flexTotals.spentNet +
        sum(commit.map((v) => v.spent_net)) +
        sum(debt.map((v) => v.spent_net)) +
        sum(savings.filter((v) => v.funding_mode === "space_backed" && v.contribution_status === "confirmed").map((v) => v.planned)),
    ),
    occurrences_upcoming: upcoming
      .filter((x) => x.dueDate >= today)
      .map((x) => ({ commitment_id: x.commitmentId, due_date: x.dueDate, amount: x.amount, state: x.state, overdue: false })),
    occurrences_overdue: overdueList.map((x) => ({
      commitment_id: x.commitmentId,
      due_date: x.dueDate,
      amount: x.amount,
      state: x.state,
      overdue: true,
      days_overdue: Number(daysLeft(x.dueDate, today)),
      from_previous_period: x.carried,
    })),
    sync_required: stale,
    alerts: [],
    suggestions: [],
    capabilities,
    limitations,
  }
}

function daysLeft(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z")
  const b = Date.parse(to + "T00:00:00Z")
  return Math.round((b - a) / 86_400_000)
}

function planView(plan: PlanRow): Record<string, unknown> {
  return {
    id: plan.id,
    status: plan.status,
    cadence: plan.cadence,
    anchor_day: plan.anchorDay,
    week_start_day: plan.weekStartDay,
    custom_days: plan.customDays,
    custom_start: plan.customStart,
    timezone: plan.timezone,
    income_mode: plan.incomeMode,
    expected_income: plan.expectedIncome == null ? null : num(plan.expectedIncome),
    included_account_ids: plan.includedAccountIds,
    currency: plan.currency,
    next_period_seed: plan.nextPeriodSeed,
    paused_at: plan.pausedAt,
    updated_at: plan.updatedAt,
  }
}
