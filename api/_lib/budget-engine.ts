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
import { alias } from "drizzle-orm/pg-core"
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
  transactionSettlements,
  wealthAccounts,
} from "../../src/lib/db/schema.js"
import { safeTimezone } from "../../src/lib/schedule-notifications.js"
import { spaceProgress, suggestedMonthly } from "../../src/lib/spaces.js"
import { occurrencesDue } from "../../src/lib/recurring.js"
import {
  addDays,
  aggregateAllSections,
  allowedOccurrenceActions,
  amountInPlanCurrency,
  applyOccurrenceDeviations,
  carryLowerBound,
  categoryKey,
  daysOverdue,
  detectCurrencyMismatch,
  normalizeMatchKeys,
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
  type CurrencyLimitation,
  type EnvelopeTotals,
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

/**
 * The inclusion predicates every v2 spend query shares (§8.3).
 *
 * `restrictsAccounts` is the plan's OWN choice, not "did we find any accounts":
 *
 * - Plan named no accounts (the default, meaning "all my money") → an
 *   account-less transaction still counts. `wealth_account_id` is nullable and
 *   the Add-Transaction form allows "no account", so treating NULL as excluded
 *   would silently drop real spending from the budget while still showing it on
 *   /transactions — two different answers for the same month.
 * - Plan named specific accounts → only those. The user deliberately narrowed
 *   the scope, and an account-less row is not in it.
 */
function inclusionConds(orgId: string, accounts: string[], planId: string, restrictsAccounts: boolean) {
  const accountScope = restrictsAccounts
    ? accounts.length
      ? [inArray(transactions.wealthAccountId, accounts)]
      : // Named accounts that no longer exist: match nothing rather than everything.
        [sql`false`]
    : accounts.length
      ? [or(isNull(transactions.wealthAccountId), inArray(transactions.wealthAccountId, accounts))!]
      : []
  return [
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    isNull(transactions.deletedAt),
    eq(transactions.kind, "standard"),
    // System rows DEFINE balances; they are not spending (v1 defect #1).
    eq(transactions.isSystem, false),
    ...accountScope,
    // Explicit, audited opt-out — also carries "not a refund" (§8.8).
    sql`not exists (select 1 from ${budgetExclusions} bx where bx.transaction_id = ${transactions.id} and bx.plan_id = ${planId})`,
  ]
}

/** Did the plan explicitly narrow its account scope? */
const planRestrictsAccounts = (plan: PlanRow): boolean =>
  (((plan.includedAccountIds as string[] | null) ?? []).length > 0)

/**
 * The normalised category key expression. MUST stay identical to
 * `categoryKey()` in src/lib/budget-math.ts and to the expression the
 * functional index `transactions_category_key_idx` is built on.
 */
const categoryKeyExpr = sql<string>`lower(btrim(coalesce(${transactions.category}, '')))`

export type EnvelopeSpend = { spentGross: number; refundsProvisional: number; refundsConfirmed: number }

/** One row per normalised category key present in the window. */
export type CategorySpendRow = { key: string; gross: number; inflow: number; unlinkedInflow: number }

/**
 * ALL spend for the window, grouped by normalised category key — ONE query for
 * the whole plan (§17.3).
 *
 * Phase 1 ran one aggregate per envelope, which was fine for a single catch-all
 * but becomes N queries the moment a user adds categories. Grouping in SQL and
 * assigning to envelopes in JS is a single index-backed scan regardless of how
 * many envelopes exist, and it makes the catch-all exact: it is "every key that
 * no explicit envelope claimed", computed from the same rows.
 *
 * `unlinkedInflow` excludes inflows already recorded in `transaction_settlements`
 * so a CONFIRMED settlement is never also counted as a provisional guess at the
 * same money (§8.8.1).
 */
export async function spendByCategoryKey(
  orgId: string,
  plan: PlanRow,
  window: PeriodWindow,
): Promise<CategorySpendRow[]> {
  const accounts = await includedAccountIds(orgId, plan)
  const rows = await db
    .select({
      key: categoryKeyExpr,
      gross: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`,
      inflow: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`,
      unlinked: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' and not exists (
        select 1 from ${transactionSettlements} ts where ts.settlement_transaction_id = ${transactions.id}
      ) then ${transactions.amount}::numeric else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(
      and(
        ...inclusionConds(orgId, accounts, plan.id, planRestrictsAccounts(plan)),
        gte(transactions.date, window.start),
        lt(transactions.date, window.endExclusive),
      ),
    )
    .groupBy(categoryKeyExpr)

  return rows.map((r) => ({
    key: r.key ?? "",
    gross: round2(amountInPlanCurrency(num(r.gross), plan.currency, plan.currency)),
    inflow: round2(amountInPlanCurrency(num(r.inflow), plan.currency, plan.currency)),
    unlinkedInflow: round2(amountInPlanCurrency(num(r.unlinked), plan.currency, plan.currency)),
  }))
}

/**
 * CONFIRMED settlements landing in this window, grouped by the ORIGINAL
 * expense's category key (§8.8.1, cash view).
 *
 * Cash view: a settlement reduces spend in the period ITS OWN transaction date
 * falls in — that is when the money actually moved. It is attributed to the
 * expense's envelope rather than the inflow's own category, because a €250
 * reimbursement for travel belongs against travel however it was categorised.
 */
export async function confirmedSettlementsByCategoryKey(
  orgId: string,
  plan: PlanRow,
  window: PeriodWindow,
): Promise<Map<string, number>> {
  const expense = alias(transactions, "expense_tx")
  const rows = await db
    .select({
      key: sql<string>`lower(btrim(coalesce(${expense.category}, '')))`,
      total: sql<string>`coalesce(sum(${transactionSettlements.amount}::numeric), 0)`,
    })
    .from(transactionSettlements)
    .innerJoin(transactions, eq(transactionSettlements.settlementTransactionId, transactions.id))
    .innerJoin(expense, eq(transactionSettlements.expenseTransactionId, expense.id))
    .where(
      and(
        eq(transactionSettlements.organizationId, orgId),
        isNull(transactions.deletedAt),
        isNull(expense.deletedAt),
        gte(transactions.date, window.start),
        lt(transactions.date, window.endExclusive),
      ),
    )
    .groupBy(sql`lower(btrim(coalesce(${expense.category}, '')))`)

  const out = new Map<string, number>()
  for (const r of rows) {
    out.set(r.key ?? "", round2(amountInPlanCurrency(num(r.total), plan.currency, plan.currency)))
  }
  return out
}

/**
 * ATTRIBUTED settlements (§8.8.1) — report only, never operational.
 *
 * The cash view (`confirmedSettlementsByCategoryKey`) is authoritative because
 * it records money in the period it actually moved. But it cannot answer "what
 * did that trip really cost me": a €400 March expense reimbursed €250 in May
 * shows as €400 of March spend and €250 of May credit, and neither figure is
 * the €150 true cost.
 *
 * This attributes each settlement back to the period its ORIGINAL EXPENSE falls
 * in, keyed by the expense's category. It rewrites nothing: a settlement
 * arriving after a period closed produces a restatement candidate (§8.11), not
 * a silent edit. Every caller must label the result as a report.
 */
export async function attributedSettlementsByCategoryKey(
  orgId: string,
  plan: PlanRow,
  window: PeriodWindow,
): Promise<Map<string, number>> {
  const expense = alias(transactions, "attributed_expense_tx")
  const rows = await db
    .select({
      key: sql<string>`lower(btrim(coalesce(${expense.category}, '')))`,
      total: sql<string>`coalesce(sum(${transactionSettlements.amount}::numeric), 0)`,
    })
    .from(transactionSettlements)
    .innerJoin(expense, eq(transactionSettlements.expenseTransactionId, expense.id))
    .innerJoin(transactions, eq(transactionSettlements.settlementTransactionId, transactions.id))
    .where(
      and(
        eq(transactionSettlements.organizationId, orgId),
        isNull(expense.deletedAt),
        isNull(transactions.deletedAt),
        // The EXPENSE's date decides the bucket — that is the whole difference
        // from the cash view, which keys off the settlement's date.
        gte(expense.date, window.start),
        lt(expense.date, window.endExclusive),
      ),
    )
    .groupBy(sql`lower(btrim(coalesce(${expense.category}, '')))`)

  const out = new Map<string, number>()
  for (const r of rows) {
    out.set(r.key ?? "", round2(amountInPlanCurrency(num(r.total), plan.currency, plan.currency)))
  }
  return out
}

/**
 * Assign the grouped rows to one envelope.
 *
 * `matchKeys` empty means the catch-all: everything NOT claimed by an explicit
 * envelope. An INFLOW only ever nets when it matches an envelope's EXPLICIT
 * category keys — never the catch-all — so salary can never cancel out grocery
 * spending (§8.8). A confirmed settlement is the exception: it nets wherever its
 * expense lives, catch-all included, because it is a stated fact rather than a
 * guess.
 */
export function spendForKeys(
  rows: CategorySpendRow[],
  settled: Map<string, number>,
  matchKeys: string[],
  claimedKeys: Set<string>,
): EnvelopeSpend {
  const isCatchAll = matchKeys.length === 0
  const mine = new Set(matchKeys)
  const selected = rows.filter((r) => (isCatchAll ? !claimedKeys.has(r.key) : mine.has(r.key)))

  let gross = 0
  let provisional = 0
  for (const r of selected) {
    gross += r.gross
    if (!isCatchAll) provisional += r.unlinkedInflow
  }
  let confirmed = 0
  for (const [key, amount] of settled) {
    if (isCatchAll ? !claimedKeys.has(key) : mine.has(key)) confirmed += amount
  }

  return {
    spentGross: round2(gross),
    refundsProvisional: round2(provisional),
    refundsConfirmed: round2(confirmed),
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
        ...inclusionConds(orgId, accounts, plan.id, planRestrictsAccounts(plan)),
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

/** Commitment display metadata, keyed by id. */
export type CommitmentMeta = { name: string; kind: string; envelope_id: string; needs_attention: boolean }

/**
 * Names for the occurrence lists. A projected occurrence carries only a
 * commitment id, and an overdue row reading "500, due 12 days ago" without
 * saying WHAT is due cannot be acted on.
 */
export async function commitmentIndex(planId: string): Promise<Map<string, CommitmentMeta>> {
  const rows = await db
    .select({
      id: budgetCommitments.id,
      name: budgetCommitments.name,
      kind: budgetCommitments.kind,
      envelopeId: budgetCommitments.envelopeId,
      needsAttention: budgetCommitments.needsAttention,
    })
    .from(budgetCommitments)
    .where(eq(budgetCommitments.planId, planId))
  return new Map(
    rows.map((r) => [
      r.id,
      { name: r.name, kind: r.kind, envelope_id: r.envelopeId, needs_attention: r.needsAttention },
    ]),
  )
}

function commitmentMeta(idx: Map<string, CommitmentMeta>, id: string): Record<string, unknown> {
  const m = idx.get(id)
  return {
    name: m?.name ?? "",
    kind: m?.kind ?? "one_time",
    needs_attention: m?.needs_attention ?? false,
  }
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
  opts: {
    isPartial: boolean
    actorUserId?: string | null
    /**
     * MIGRATION ONLY. Force the funding-base source instead of deriving it.
     *
     * §13.3 requires a migrated plan's first period to snapshot, never
     * reconstruct — reconstructing to a boundary before the plan existed would
     * describe a period v2 never governed, and would risk counting income that
     * is already inside the migrated balance. `baseSourceFor` would pick
     * `reconstructed_at_boundary` on the one day the migration happens to run
     * exactly on a period boundary, so the migration states its requirement
     * rather than depending on the date it is run.
     */
    forceSource?: FundingBaseSource
  },
): Promise<PeriodRow> {
  const source = opts.forceSource ?? baseSourceFor(plan, opts.isPartial)
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
  /** Category keys this envelope claims (empty for the catch-all). */
  match_keys: string[]
  /**
   * Goal progress for a savings fund, or null.
   *
   * Computed with `spaceProgress` / `suggestedMonthly` from src/lib/spaces.ts,
   * REUSED UNCHANGED (§8.9): that module is pure math over
   * (balance, goal, targetDate) and never assumed a Space, so a virtual fund
   * gets identical treatment without needing one. `suggested_monthly` rises
   * when a contribution is missed, which is how a fund tells the truth about
   * being behind instead of quietly forgiving it.
   */
  goal_progress: { pct: number; remaining: number; reached: boolean } | null
  suggested_monthly: number | null
  /**
   * Occurrence money SETTLED inside this period, for the commitment and debt
   * sections whose spend is defined by settling an expectation rather than by
   * matching a category.
   *
   * Attributed by DUE date, so a carried overdue occurrence settled now stays
   * counted in the period it was due — the period it was reserved in and the
   * period whose closed snapshot already reports it. Counting it in both is the
   * one thing this must not do.
   */
  settled: number
  overdue_count: number
  overdue_amount: number
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
  currency_limitation?: CurrencyLimitation | null
}

/**
 * The whole overview in one read (§11.3). READ-ONLY: it never writes, and
 * reports `sync_required` instead of silently serving a stale figure.
 */
export type BuildViewOptions = {
  /**
   * Report a SPECIFIC period instead of the currently open one.
   *
   * Used by restatement (§8.11) to recompute a closed period from the ledger as
   * it stands now. Every window-derived figure (spend, refunds, occurrences,
   * section totals) recomputes correctly against that window. The CASH figures
   * do not: `available_now` is a reading of today's balances and cannot be
   * reconstructed for a past instant, so a caller recomputing history must
   * carry the original snapshot's cash figures forward rather than believe
   * these ones. `restateDriftedPeriods` does exactly that.
   */
  periodId?: string
}

export async function buildBudgetView(
  orgId: string,
  role: string,
  accountType: string | null,
  now = new Date(),
  options: BuildViewOptions = {},
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

  // The requested period, or the currently OPEN one (there is at most one open
  // period — a partial unique index guarantees it). An explicitly requested
  // period is still scoped to this plan, so an id from another workspace
  // resolves to nothing rather than leaking a foreign period.
  const [period] = options.periodId
    ? await db
        .select()
        .from(budgetPeriods)
        .where(and(eq(budgetPeriods.id, options.periodId), eq(budgetPeriods.planId, plan.id)))
    : await db
        .select()
        .from(budgetPeriods)
        .where(and(eq(budgetPeriods.planId, plan.id), eq(budgetPeriods.status, "open")))
        .orderBy(desc(budgetPeriods.start))
        .limit(1)

  // Currency divergence is DETECTED, never converted (§12.4).
  const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId))
  const currencyLimitation = detectCurrencyMismatch(plan.currency, org?.currency)
  if (currencyLimitation) limitations.push("currency_changed")

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
  // Normalised defensively: writes go through normalizeMatchKeys(), but a row
  // that predates that (or was seeded by hand) must not create a key that the
  // catch-all fails to exclude — that would double-count the spend.
  const claimedKeys = new Set(
    envelopes.filter((e) => !e.isCatchAll).flatMap((e) => ((e.matchKeys as string[] | null) ?? []).map(categoryKey)),
  )

  const [occByEnvelope, fundBalances, incomeRecv, adjustments, spendRows, settledByKey, commitmentIdx] =
    await Promise.all([
    projectOccurrences(orgId, plan, window, today),
    virtualFundBalances(
      orgId,
      envelopes.filter((e) => e.section === "savings" && e.fundingMode === "virtual").map((e) => e.id),
    ),
    incomeReceived(orgId, plan, window),
    fundingAdjustments(period.id),
    // ONE grouped query for the whole plan, however many envelopes it has.
    spendByCategoryKey(orgId, plan, window),
    confirmedSettlementsByCategoryKey(orgId, plan, window),
    commitmentIndex(plan.id),
  ])
  const occMap = new Map(occByEnvelope.map((o) => [o.envelopeId, o]))

  /**
   * One definition of a fund's balance, used by BOTH the `balance` field and the
   * goal math — otherwise a rounding or mode difference would let the progress
   * bar disagree with the figure printed beside it.
   *
   * Virtual: the CONFIRMED entry ledger. Space-backed: the Space's own balance,
   * which is authoritative and surfaced by /api/wealth/accounts, so it is null
   * here rather than guessed.
   */
  const fundBalanceOf = (e: EnvelopeRow): number =>
    e.fundingMode === "virtual" ? (fundBalances.get(e.id) ?? 0) : 0

  const views: EnvelopeView[] = []
  for (const e of envelopes) {
    const alloc = allocByEnvelope.get(e.id)
    const rolloverIn = num(alloc?.rolloverIn)
    const planned = round2(num(alloc?.plannedAmount) + rolloverIn)
    const occ = occMap.get(e.id)
    const pending = occ ? pendingFrom(occ.occurrences) : 0

    // Sections whose spend is defined by OCCURRENCES (commitment, debt) or by
    // CONTRIBUTIONS (savings) do not draw from the category ledger: their money
    // is tracked by settling an expectation, not by matching a category. Only
    // flexible envelopes consume categorised spend.
    const spend: EnvelopeSpend =
      e.section === "flexible"
        ? spendForKeys(spendRows, settledByKey, normalizeMatchKeys((e.matchKeys as string[] | null) ?? []), claimedKeys)
        : { spentGross: 0, refundsProvisional: 0, refundsConfirmed: 0 }
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
            ? fundBalanceOf(e)
            : null // Space-backed: the Space's own balance, surfaced by /api/wealth/accounts
          : null,
      contribution_status: alloc?.contributionStatus ?? null,
      needs_attention: occ?.needsAttention ?? false,
      excluded_occurrence_count: occ?.excludedCount ?? 0,
      match_keys: normalizeMatchKeys((e.matchKeys as string[] | null) ?? []),
      goal_progress:
        e.section === "savings" && e.goalAmount != null
          ? spaceProgress(fundBalanceOf(e), num(e.goalAmount))
          : null,
      suggested_monthly:
        e.section === "savings" && e.goalAmount != null
          ? suggestedMonthly(fundBalanceOf(e), num(e.goalAmount), e.targetDate, today)
          : null,
      settled: round2(
        (occ?.occurrences ?? [])
          .filter((x) => x.state === "settled" && x.dueDate >= window.start && x.dueDate < window.endExclusive)
          .reduce((a, x) => a + amountInPlanCurrency(x.amount, plan.currency, plan.currency), 0),
      ),
      overdue_count: (occ?.occurrences ?? []).filter((x) => x.state === "expected" && x.dueDate < today).length,
      overdue_amount: round2(
        (occ?.occurrences ?? [])
          .filter((x) => x.state === "expected" && x.dueDate < today)
          .reduce((a, x) => a + x.amount, 0),
      ),
    })
  }

  // ── section totals: separate shapes, never one cross-section ratio (§8.7) ──
  const bySection = (s: BudgetSection) => views.filter((v) => v.section === s)
  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0))

  // Aggregated in the pure math layer so the netting-then-flooring rule has
  // exactly ONE implementation (§8.5.1) and is unit-tested without a database.
  const sectionTotals = aggregateAllSections(
    views.map<EnvelopeTotals>((v) => ({
      section: v.section,
      planned: v.planned,
      spentNet: v.spent_net,
      pending: v.pending,
    })),
  )

  const flex = bySection("flexible")
  const flexTotals = {
    planned: sectionTotals.flexible.planned,
    spentNet: sectionTotals.flexible.spentNet,
    pending: sectionTotals.flexible.pending,
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
  // PROTECTED SAVINGS (§8.5): a savings envelope with NO funding mode — a plain
  // "hold this back" line rather than a sinking fund. The other three savings
  // terms above already cover every virtual and Space-backed envelope, so this
  // one must cover exactly the remainder or the same money is reserved twice.
  //
  // `max(0, planned − funded)` is what is still owed to the intention this
  // period: a partially confirmed line reserves only the unconfirmed part.
  const protectedDue = sum(
    savings
      .filter((v) => v.funding_mode == null && v.contribution_status !== "skipped")
      .map((v) => Math.max(0, round2(v.planned - (v.contribution_status === "confirmed" ? v.planned : 0)))),
  )

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
        remaining: sectionTotals.flexible.remaining, // SIGNED
        headroom: sectionTotals.flexible.headroom, // netted, then floored ONCE
        utilisation: sectionTotals.flexible.utilisation,
        envelope_count: sectionTotals.flexible.envelopeCount,
        overspent_count: sectionTotals.flexible.overspentCount,
        // Outflow that matched no explicit envelope, i.e. what the catch-all
        // absorbed. Surfaced so "where did the rest go" is answerable.
        uncategorised: round2(spendRows.filter((r) => !claimedKeys.has(r.key)).reduce((a, r) => a + r.gross, 0)),
        envelopes: flex,
      },
      commitment: {
        planned: sectionTotals.commitment.planned,
        settled: sum(commit.map((v) => v.settled)),
        outstanding: commitmentOutstanding,
        overdue: sum(commit.map((v) => v.overdue_amount)),
        overdue_count: commit.reduce((a, v) => a + v.overdue_count, 0),
        needs_attention_count: commit.filter((v) => v.needs_attention).length,
        envelopes: commit,
      },
      debt: {
        planned: sectionTotals.debt.planned,
        paid: sum(debt.map((v) => v.settled)),
        outstanding: debtOutstanding,
        overdue: sum(debt.map((v) => v.overdue_amount)),
        overdue_count: debt.reduce((a, v) => a + v.overdue_count, 0),
        needs_attention_count: debt.filter((v) => v.needs_attention).length,
        envelopes: debt,
      },
      savings: {
        planned: sectionTotals.savings.planned,
        reserved: round2(virtualUnconfirmed + spaceDue),
        funded: sum(savings.filter((v) => v.contribution_status === "confirmed").map((v) => v.planned)),
        funded_cash: sum(
          savings.filter((v) => v.funding_mode === "space_backed" && v.contribution_status === "confirmed").map((v) => v.planned),
        ),
        missed: sum(savings.filter((v) => v.contribution_status === "missed").map((v) => v.planned)),
        outstanding: round2(virtualUnconfirmed + spaceDue),
        balance: sum(savings.map((v) => v.balance ?? 0)),
        awaiting_confirmation: savings.filter((v) => v.contribution_status === "planned").length,
        skipped_count: savings.filter((v) => v.contribution_status === "skipped").length,
        // Funds that are behind their goal pace, so the section can say so
        // without the user opening each one.
        behind_count: savings.filter((v) => v.suggested_monthly != null && v.suggested_monthly > 0).length,
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
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((x) => ({
        commitment_id: x.commitmentId,
        ...commitmentMeta(commitmentIdx, x.commitmentId),
        envelope_id: x.envelopeId,
        due_date: x.dueDate,
        amount: x.amount,
        state: x.state,
        overdue: false,
        actions: allowedOccurrenceActions(x.state),
      })),
    occurrences_overdue: overdueList
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((x) => ({
        commitment_id: x.commitmentId,
        ...commitmentMeta(commitmentIdx, x.commitmentId),
        envelope_id: x.envelopeId,
        due_date: x.dueDate,
        amount: x.amount,
        state: x.state,
        overdue: true,
        days_overdue: daysOverdue(x.dueDate, today),
        from_previous_period: x.carried,
        actions: allowedOccurrenceActions(x.state),
      })),
    sync_required: stale,
    alerts: [],
    suggestions: [],
    capabilities,
    limitations,
    /**
     * The machine-readable form of an unsupported currency situation, present
     * only when the plan currency and the organization currency disagree (the
     * org currency was changed after the plan was created). Nothing is
     * converted, and `converted: false` says so explicitly rather than leaving
     * the client to assume a rate was applied.
     */
    currency_limitation: currencyLimitation,
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
