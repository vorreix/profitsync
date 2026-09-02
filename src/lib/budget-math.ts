// Budget v2 — the pure calculation layer.
//
// ZERO imports on purpose (like src/lib/budget-history.ts): the unbundled Vercel
// functions, the Vite client and Vitest all consume this identically, with no
// module-resolution quirks. No DB, no React, no dates-as-instants.
//
// This module is the SINGLE definition of every threshold and formula in
// docs/budget-v2/SMART_HYBRID_BUDGET_SPEC.md §8. Budget v1 triplicated its 0.8
// warn ratio across three files and they drifted; there is exactly one here.
//
// Dates are always calendar-date STRINGS ('YYYY-MM-DD'), never Date instants.
// That is what makes every period boundary DST-safe: no arithmetic crosses an
// hour, and `transactions.date` is a bare Postgres `date` compared as a string.

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export const BUDGET_SECTIONS = ["income", "commitment", "flexible", "savings", "debt"] as const
export type BudgetSection = (typeof BUDGET_SECTIONS)[number]

export const PLAN_CADENCES = ["monthly", "weekly", "payday", "custom"] as const
export type PlanCadence = (typeof PLAN_CADENCES)[number]

/** An envelope's target may be authored at a different rhythm than the plan's. */
export const TARGET_CADENCES = ["period", "month", "week", "day"] as const
export type TargetCadence = (typeof TARGET_CADENCES)[number]

export const CARRY_POLICIES = ["none", "surplus", "deficit", "both"] as const
export type CarryPolicy = (typeof CARRY_POLICIES)[number]

export const PRIORITIES = ["essential", "important", "optional"] as const
export type Priority = (typeof PRIORITIES)[number]

export const INCOME_MODES = ["expected", "available"] as const
export type IncomeMode = (typeof INCOME_MODES)[number]

export const FUNDING_MODES = ["virtual", "space_backed"] as const
export type FundingMode = (typeof FUNDING_MODES)[number]

export const CONTRIBUTION_STATUSES = ["planned", "confirmed", "missed", "skipped"] as const
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number]

export const OCCURRENCE_STATES = ["expected", "settled", "cancelled", "skipped", "rescheduled"] as const
export type OccurrenceState = (typeof OCCURRENCE_STATES)[number]

export const FUNDING_BASE_SOURCES = ["expected_income", "reconstructed_at_boundary", "snapshot_at_open"] as const
export type FundingBaseSource = (typeof FUNDING_BASE_SOURCES)[number]

export const NEXT_PERIOD_SEEDS = ["copy", "fresh", "suggest"] as const
export type NextPeriodSeed = (typeof NEXT_PERIOD_SEEDS)[number]

const isMember = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v)

export const isBudgetSection = (v: unknown): v is BudgetSection => isMember(BUDGET_SECTIONS, v)
export const isPlanCadence = (v: unknown): v is PlanCadence => isMember(PLAN_CADENCES, v)
export const isTargetCadence = (v: unknown): v is TargetCadence => isMember(TARGET_CADENCES, v)
export const isCarryPolicy = (v: unknown): v is CarryPolicy => isMember(CARRY_POLICIES, v)
export const isPriority = (v: unknown): v is Priority => isMember(PRIORITIES, v)
export const isIncomeMode = (v: unknown): v is IncomeMode => isMember(INCOME_MODES, v)
export const isFundingMode = (v: unknown): v is FundingMode => isMember(FUNDING_MODES, v)

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

/** Round to cents. Every money result in this module ends here. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

// ─────────────────────────────────────────────────────────────────────────────
// §8.1 — thresholds (ONE definition)
// ─────────────────────────────────────────────────────────────────────────────

export const WARN_RATIO = 0.8

/** `full` is deliberately distinct from `warn` and `over`: spending EXACTLY the
 *  planned amount is "fully used", not "nearing" (v1 reported it as a warning). */
export type BudgetStateV2 = "none" | "ok" | "warn" | "full" | "over"

export function state(spent: number, planned: number): BudgetStateV2 {
  if (!(planned > 0)) return spent > 0 ? "over" : "none"
  const r = spent / planned
  if (r > 1) return "over"
  if (r === 1) return "full"
  if (r >= WARN_RATIO) return "warn"
  return "ok"
}

/** Alert tier for a state. `full` does not alert on its own — reaching the cap
 *  exactly is already covered by the warning tier. */
export function alertTier(spent: number, planned: number): "budget_warning" | "budget_exceeded" | null {
  const s = state(spent, planned)
  if (s === "over") return "budget_exceeded"
  if (s === "warn" || s === "full") return "budget_warning"
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.2 — calendar helpers (all string dates)
// ─────────────────────────────────────────────────────────────────────────────

const p2 = (n: number) => String(n).padStart(2, "0")
export const ymd = (y: number, m1: number, d: number): string => `${y}-${p2(m1)}-${p2(d)}`
const DAY_MS = 86_400_000

/** Parse 'YYYY-MM-DD' into parts. Throws on anything else — callers validate first. */
export function parseDate(iso: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) throw new Error(`not an ISO date: ${iso}`)
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Days in a month (1-based month). */
export function daysInMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate()
}

/** Add days to a calendar date. Uses UTC arithmetic on a date-only value, so it
 *  never crosses a DST boundary. */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseDate(iso)
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS
  const dt = new Date(t)
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** Whole days between two calendar dates (b − a). */
export function daysBetween(a: string, b: string): number {
  const A = parseDate(a)
  const B = parseDate(b)
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / DAY_MS)
}

/** Add months, clamping the day to the target month's length (31 Jan +1m => 28/29 Feb).
 *  Mirrors src/lib/recurring.ts so commitment dates and period anchors agree. */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parseDate(iso)
  const total = (y * 12 + (m - 1)) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function weekday(iso: string): number {
  const { y, m, d } = parseDate(iso)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun
  return wd === 0 ? 7 : wd
}

/**
 * "What is today" in the plan's timezone — the ONLY timezone-sensitive value in
 * the engine (§8.2). `en-CA` formats as YYYY-MM-DD directly.
 *
 * `tz` is expected to have been validated by safeTimezone() before storage; an
 * invalid value still degrades to UTC rather than throwing.
 */
export function todayInTz(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.2 — period boundaries
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodWindow = { start: string; endExclusive: string }

export type CadenceConfig = {
  cadence: PlanCadence
  /** 1–7, 1 = Monday. `weekly` only. */
  weekStartDay?: number | null
  /** 1–31, clamped to month length. `payday` only. */
  anchorDay?: number | null
  /** `custom` only. */
  customStart?: string | null
  customDays?: number | null
}

/**
 * The period containing `today`, as calendar dates. `[start, endExclusive)`.
 *
 * DST-safe by construction: every boundary is a date string and all arithmetic
 * is date-only (§8.2).
 */
export function periodFor(cfg: CadenceConfig, today: string): PeriodWindow {
  const { y, m, d } = parseDate(today)

  switch (cfg.cadence) {
    case "monthly":
      return { start: ymd(y, m, 1), endExclusive: addMonths(ymd(y, m, 1), 1) }

    case "weekly": {
      const startDay = clampInt(cfg.weekStartDay ?? 1, 1, 7)
      const wd = weekday(today)
      const back = (wd - startDay + 7) % 7
      const start = addDays(today, -back)
      return { start, endExclusive: addDays(start, 7) }
    }

    case "payday": {
      const anchor = clampInt(cfg.anchorDay ?? 1, 1, 31)
      // This month's anchor, clamped (a 31st anchor lands on the 28th in Feb).
      const thisMonthAnchor = ymd(y, m, Math.min(anchor, daysInMonth(y, m)))
      if (d >= parseDate(thisMonthAnchor).d) {
        return { start: thisMonthAnchor, endExclusive: anchorOf(addMonths(thisMonthAnchor, 1), anchor) }
      }
      const prev = addMonths(thisMonthAnchor, -1)
      return { start: anchorOf(prev, anchor), endExclusive: thisMonthAnchor }
    }

    case "custom": {
      const len = Math.max(1, Math.min(400, cfg.customDays ?? 30))
      const base = isIsoDate(cfg.customStart) ? cfg.customStart : ymd(y, m, 1)
      // Walk forward/back in whole periods until `today` is inside one, so a
      // custom cycle keeps repeating rather than expiring after its first window.
      const offset = Math.floor(daysBetween(base, today) / len)
      const start = addDays(base, offset * len)
      return { start, endExclusive: addDays(start, len) }
    }
  }
}

/** Re-clamp an anchor day within the month of `iso`. */
function anchorOf(iso: string, anchorDay: number): string {
  const { y, m } = parseDate(iso)
  return ymd(y, m, Math.min(anchorDay, daysInMonth(y, m)))
}

export function clampInt(n: number, lo: number, hi: number): number {
  const i = Math.trunc(Number.isFinite(n) ? n : lo)
  return i < lo ? lo : i > hi ? hi : i
}

/** Length of a window in whole days. */
export const periodDays = (w: PeriodWindow): number => daysBetween(w.start, w.endExclusive)

/** The period immediately before `w`, for the same cadence. */
export function previousPeriod(cfg: CadenceConfig, w: PeriodWindow): PeriodWindow {
  return periodFor(cfg, addDays(w.start, -1))
}

/** The period immediately after `w`. */
export function nextPeriod(cfg: CadenceConfig, w: PeriodWindow): PeriodWindow {
  return periodFor(cfg, w.endExclusive)
}

/** Is `date` inside `[start, endExclusive)`? String comparison is correct for ISO dates. */
export const inWindow = (date: string, w: PeriodWindow): boolean => date >= w.start && date < w.endExclusive

// ─────────────────────────────────────────────────────────────────────────────
// §8.7 — cadence normalisation (never aggregate across cadences)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an authored target to this period's equivalent. "€20/day" over a
 * 30-day period is €600; the authored pair is kept for display so the number is
 * never unexplained.
 */
export function normalizeTarget(amount: number, cadence: TargetCadence, days: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  switch (cadence) {
    case "period":
      return round2(amount)
    case "day":
      return round2(amount * days)
    case "week":
      return round2((amount / 7) * days)
    case "month":
      // A month is the period's own length when the plan is monthly; otherwise
      // pro-rate on a 30.44-day mean month so weekly/custom plans stay sane.
      return round2((amount / 30.436875) * days)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.4 — funding base and capacity
// ─────────────────────────────────────────────────────────────────────────────

export type FundingInput = {
  incomeMode: IncomeMode
  /** Stored on the period; immutable for snapshot mode, recomputed for reconstructed. */
  fundingBase: number
  fundingBaseSource: FundingBaseSource
  /** Income that QUALIFIES to accrete — already filtered by the engine per source. */
  incomeAccreted: number
  /** Signed sum of audited funding_adjusted events. */
  fundingAdjustments: number
}

/**
 * The period's capacity. **Spending never appears here** — that is the whole
 * point of the funding base (§8.4): spending consumes an allocation, it does not
 * reduce what the period had to work with.
 *
 * In `expected` mode income does NOT accrete: capacity IS the stated
 * expectation, and income actually received is reported separately in the income
 * section. In `available` mode the base is a real balance, so income arriving
 * after the anchor genuinely adds capacity.
 */
export function fundingCapacity(f: FundingInput): number {
  const accreted = f.incomeMode === "expected" ? 0 : f.incomeAccreted
  return round2(f.fundingBase + accreted + f.fundingAdjustments)
}

export function unallocated(capacity: number, totalAllocated: number): number {
  return round2(capacity - totalAllocated)
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.5 — the four numbers
// ─────────────────────────────────────────────────────────────────────────────

export type ReservedBreakdown = {
  commitmentsOutstanding: number
  /** Subset of the above whose due date has passed — presentation only, NOT added again. */
  commitmentsOverdue: number
  debtOutstanding: number
  /** CONFIRMED virtual fund balances: the cash is still in the bank, so hold it back. */
  virtualFundBalances: number
  /** Planned-but-unconfirmed virtual contributions (§8.9.1). */
  virtualContributionsUnconfirmed: number
  /** Space contributions due but not yet transferred. The BALANCE is never reserved. */
  spaceContributionsDue: number
  protectedSavingsDue: number
}

export function reservedTotal(b: ReservedBreakdown): number {
  // commitmentsOverdue is deliberately excluded: it is a SUBSET of
  // commitmentsOutstanding, surfaced for the UI, never a separate claim.
  return round2(
    b.commitmentsOutstanding +
      b.debtOutstanding +
      b.virtualFundBalances +
      b.virtualContributionsUnconfirmed +
      b.spaceContributionsDue +
      b.protectedSavingsDue,
  )
}

export type FlexibleTotals = {
  planned: number
  spentNet: number
  pending: number
}

/**
 * Plan-wide flexible headroom — **netted across envelopes, THEN floored once**.
 *
 * This is the rev-3 correction and the single easiest thing to get wrong:
 * `Σ max(0, remaining)` per envelope ignores an overspend in one envelope.
 * Groceries 300/400 with Dining 200/0 is 100 of capacity, not 200.
 */
export function flexibleHeadroom(t: FlexibleTotals): number {
  return Math.max(0, round2(t.planned - t.spentNet - t.pending))
}

/** Signed remaining — may be negative, and is what an envelope CARD shows. */
export function remaining(planned: number, spentNet: number, pending = 0): number {
  return round2(planned - spentNet - pending)
}

export type SafeToSpendBinding = "cash" | "plan" | "both" | "cash_only"

export type SafeToSpend = {
  amount: number
  binding: SafeToSpendBinding
  cashAfterReservations: number
  flexibleHeadroom: number
  ceilingDefined: boolean
}

/**
 * `Safe to spend` — the bounded intersection of cash and plan (§8.5).
 *
 * Not floored: `min()` produces the right sign naturally. Negative cash yields a
 * negative answer (a real cash shortfall); a spent-out ceiling with cash in the
 * bank yields exactly 0 (a real plan limit). Both are true and must be shown.
 *
 * `unallocated` is NEVER folded in — it is a buffer, offered only as an explicit
 * opt-in top-up (P3).
 */
export function safeToSpend(input: {
  availableNow: number
  reserved: number
  flexible: FlexibleTotals
  /** True when any flexible envelope has a positive planned amount. */
  ceilingDefined: boolean
}): SafeToSpend {
  const cash = round2(input.availableNow - input.reserved)
  const headroom = flexibleHeadroom(input.flexible)

  if (!input.ceilingDefined) {
    return {
      amount: cash,
      binding: "cash_only",
      cashAfterReservations: cash,
      flexibleHeadroom: headroom,
      ceilingDefined: false,
    }
  }
  const amount = Math.min(cash, headroom)
  const binding: SafeToSpendBinding = cash < headroom ? "cash" : headroom < cash ? "plan" : "both"
  return { amount: round2(amount), binding, cashAfterReservations: cash, flexibleHeadroom: headroom, ceilingDefined: true }
}

export function forecastBalance(input: {
  availableNow: number
  expectedRemainingIncome: number
  reserved: number
  flexibleRemainingPlanned: number
}): number {
  return round2(
    input.availableNow + input.expectedRemainingIncome - input.reserved - Math.max(0, input.flexibleRemainingPlanned),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.6 — occurrence projection (one-time never ages out)
// ─────────────────────────────────────────────────────────────────────────────

export const RECURRING_OVERDUE_LOOKBACK_DAYS = 365
export const MAX_UNRESOLVED_RECURRING_OCCURRENCES = 12

export type CommitmentKind = "one_time" | "recurring"

/**
 * How far back the projection window reaches for a commitment (§8.6.1).
 *
 * The rev-3 bug was projecting from `period.start`: a prior-period occurrence was
 * never GENERATED, so no downstream filter could recover it. The window itself
 * must reach back — and by kind, because the risks are not symmetric:
 *
 *  - `one_time` → its own due date, ALWAYS in range. It projects exactly one
 *    occurrence ever, so an unbounded reach costs O(1). An unpaid fine, tax bill,
 *    university fee or personal repayment is a real debt that does not expire.
 *  - `recurring` → bounded, because an abandoned monthly rule would otherwise
 *    reserve years of duplicate obligations.
 */
export function carryLowerBound(
  c: { kind: CommitmentKind; dueDate?: string | null; firstDueDate: string },
  periodStart: string,
  today: string,
): string {
  if (c.kind === "one_time") return c.dueDate ?? c.firstDueDate
  const lookback = addDays(today, -RECURRING_OVERDUE_LOOKBACK_DAYS)
  const floor = c.firstDueDate > lookback ? c.firstDueDate : lookback
  // Never start AFTER the period, even for a commitment created mid-period.
  return floor < periodStart ? floor : periodStart
}

export type ProjectedOccurrence = {
  commitmentId: string
  dueDate: string
  amount: number
  state: OccurrenceState
  /** Due before the current period started — carried from an earlier period. */
  carried: boolean
  /** Set when this occurrence exists because another was rescheduled onto its date. */
  rescheduledFrom?: string
  settledTransactionId?: string | null
}

/** `overdue` is a DERIVED presentation condition, never a stored state (§8.6.1). */
export const isOverdue = (o: Pick<ProjectedOccurrence, "state" | "dueDate">, today: string): boolean =>
  o.state === "expected" && o.dueDate < today

/**
 * Apply stored deviations to a raw projection, and emit reschedule targets.
 *
 * Deduped on `(commitmentId, dueDate)` — the occurrence IDENTITY — so a duplicate
 * is structurally impossible.
 */
export function applyOccurrenceDeviations(input: {
  commitmentId: string
  kind: CommitmentKind
  defaultAmount: number
  /** Raw projected dates, ascending. */
  rawDates: { dueDate: string; amount: number }[]
  /** Stored deviations keyed by dueDate. */
  deviations: Record<
    string,
    { status: Exclude<OccurrenceState, "expected">; rescheduledTo?: string | null; settledAmount?: number | null; settledTransactionId?: string | null }
  >
  periodStart: string
  windowEndExclusive: string
  windowStart: string
}): { occurrences: ProjectedOccurrence[]; excludedCount: number; needsAttention: boolean } {
  const byKey = new Map<string, ProjectedOccurrence>()

  for (const raw of input.rawDates) {
    const dev = input.deviations[raw.dueDate]
    if (dev?.status === "rescheduled") continue // the original is consumed
    byKey.set(raw.dueDate, {
      commitmentId: input.commitmentId,
      dueDate: raw.dueDate,
      amount: dev?.settledAmount ?? raw.amount,
      state: dev?.status ?? "expected",
      carried: raw.dueDate < input.periodStart,
      settledTransactionId: dev?.settledTransactionId ?? null,
    })
  }

  // Reschedule targets land as fresh expected occurrences, exactly once.
  for (const [from, dev] of Object.entries(input.deviations)) {
    if (dev.status !== "rescheduled" || !dev.rescheduledTo) continue
    const to = dev.rescheduledTo
    if (to < input.windowStart || to >= input.windowEndExclusive) continue
    if (input.deviations[to]) continue // the target is itself resolved
    if (byKey.has(to)) continue // never create a second reservation for one obligation
    byKey.set(to, {
      commitmentId: input.commitmentId,
      dueDate: to,
      amount: input.defaultAmount,
      state: "expected",
      carried: to < input.periodStart,
      rescheduledFrom: from,
    })
  }

  let occurrences = [...byKey.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  let excludedCount = 0
  let needsAttention = false

  // Recurring safety cap — RECURRING ONLY (D-17). One-time commitments are never
  // capped and never age out.
  if (input.kind === "recurring") {
    const unresolved = occurrences.filter((o) => o.state === "expected")
    if (unresolved.length > MAX_UNRESOLVED_RECURRING_OCCURRENCES) {
      const keep = new Set(unresolved.slice(-MAX_UNRESOLVED_RECURRING_OCCURRENCES).map((o) => o.dueDate))
      excludedCount = unresolved.length - keep.size
      needsAttention = true
      occurrences = occurrences.filter((o) => o.state !== "expected" || keep.has(o.dueDate))
    }
  }

  return { occurrences, excludedCount, needsAttention }
}

/** Sum of expected occurrence amounts — the envelope's `pending`. */
export function pendingFrom(occurrences: ProjectedOccurrence[]): number {
  return round2(occurrences.filter((o) => o.state === "expected").reduce((s, o) => s + o.amount, 0))
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.8 — signed net spend with provisional refunds
// ─────────────────────────────────────────────────────────────────────────────

export type SpendBreakdown = {
  spentGross: number
  refundsConfirmed: number
  refundsProvisional: number
}

/** `spentNet` may be NEGATIVE when refunds exceed spend; the true value is kept. */
export function spentNet(b: SpendBreakdown): number {
  return round2(b.spentGross - b.refundsConfirmed - b.refundsProvisional)
}

/** Bar width only — clamped to [0,100]. The underlying figure is never clamped. */
export function barPercent(spent: number, planned: number): number {
  if (!(planned > 0)) return spent > 0 ? 100 : 0
  return Math.max(0, Math.min(100, round2((spent / planned) * 100)))
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.12 — rollover
// ─────────────────────────────────────────────────────────────────────────────

/** Carry for the NEXT period, from this period's signed surplus/deficit. */
export function carryFor(policy: CarryPolicy, surplus: number, cap?: number | null): number {
  let carry: number
  switch (policy) {
    case "none":
      carry = 0
      break
    case "surplus":
      carry = Math.max(0, surplus)
      break
    case "deficit":
      carry = Math.min(0, surplus)
      break
    case "both":
      carry = surplus
      break
  }
  if (cap != null && Number.isFinite(cap) && cap > 0) {
    carry = Math.max(-cap, Math.min(cap, carry))
  }
  return round2(carry)
}

/** Sections whose default carry is `none`: carrying an unpaid bill would double-reserve it. */
export function defaultCarryPolicy(section: BudgetSection): CarryPolicy {
  return section === "flexible" ? "surplus" : "none"
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.9 — sinking-fund math (reuses the Spaces goal model, both funding modes)
// ─────────────────────────────────────────────────────────────────────────────

/** Signed sum of a virtual fund's ledger. Only CONFIRMED contributions are entries. */
export function fundBalanceFromEntries(
  entries: { kind: "contribution" | "withdrawal" | "adjustment"; amount: number }[],
): number {
  return round2(
    entries.reduce((s, e) => s + (e.kind === "withdrawal" ? -e.amount : e.amount), 0),
  )
}

/** Only a CONFIRMED contribution may be described as funded (§8.9.1). */
export const isFunded = (s: ContributionStatus): boolean => s === "confirmed"

/** What a period close does to an unresolved contribution. */
export function contributionAtClose(current: ContributionStatus, autoFund: boolean): ContributionStatus {
  if (current !== "planned") return current
  return autoFund ? "confirmed" : "missed"
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.13 — suggestions (median-of-3, explainable, never auto-applied)
// ─────────────────────────────────────────────────────────────────────────────

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2)
}

export type Suggestion = {
  amount: number | null
  basis: "no_history" | "single_period" | "median_of_3"
  observations: number[]
  confidence: "low" | "normal" | null
}

/** Median, not mean: one holiday month must not permanently raise a grocery target. */
export function suggestFlexible(observations: number[]): Suggestion {
  const obs = observations.filter((n) => Number.isFinite(n))
  if (!obs.length) return { amount: null, basis: "no_history", observations: [], confidence: null }
  if (obs.length === 1) return { amount: round2(obs[0]), basis: "single_period", observations: obs, confidence: "low" }
  return {
    amount: round2(median(obs)),
    basis: "median_of_3",
    observations: obs,
    confidence: obs.length >= 3 ? "normal" : "low",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §8.14 — multicurrency seam (identity in Phase 1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONE place a currency conversion will ever land (§12.2). Phase 1 is the
 * identity function: every amount is already in the org currency by
 * construction. Do NOT add a rate table, base currency or conversion policy here
 * — that is Maqbool's multicurrency model, and §12.3 M1–M12 must be agreed first.
 */
export function amountInPlanCurrency(amount: number): number {
  return amount
}
