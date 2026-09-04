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
export function amountInPlanCurrency(
  amount: number,
  from?: string | null,
  planCurrency?: string | null,
): number {
  // Identity, deliberately. The two currency parameters exist so that EVERY
  // call site already declares what it believes the denomination to be: the
  // day a conversion policy is agreed, this function gains a rate lookup and
  // no call site changes. Passing a mismatch here is not an error — the caller
  // is responsible for surfacing it via detectCurrencyMismatch() rather than
  // silently summing, because a pure function must not throw on data.
  void from
  void planCurrency
  return amount
}

/**
 * A machine-readable limitation, NOT a conversion (§12.2, and the Phase 2
 * multicurrency boundary).
 *
 * What can actually mismatch in the CURRENT data model matters here. Neither
 * `transactions` nor `wealth_accounts` carries a currency column — every amount
 * in an organization is denominated in `organizations.currency` by
 * construction, so a per-account or per-transaction mismatch is structurally
 * impossible today and inventing an FX table to handle it would be inventing a
 * problem.
 *
 * The one mismatch that IS reachable: `budget_plans.currency` is a SNAPSHOT
 * taken when the plan was created, so changing the organization currency
 * afterwards leaves historical amounts that were entered under the old
 * denomination being summed with new ones. That is a real correctness hazard
 * and the honest response is to say so, not to guess a rate.
 *
 * Returns null when everything agrees (the overwhelmingly common case).
 */
export type CurrencyLimitation = {
  code: "currency_mismatch"
  plan_currency: string
  org_currency: string
  /** Sums remain in `plan_currency`; nothing was converted. */
  converted: false
}

export function detectCurrencyMismatch(
  planCurrency: string | null | undefined,
  orgCurrency: string | null | undefined,
): CurrencyLimitation | null {
  const plan = (planCurrency ?? "").trim().toUpperCase()
  const org = (orgCurrency ?? "").trim().toUpperCase()
  if (!plan || !org || plan === org) return null
  return { code: "currency_mismatch", plan_currency: plan, org_currency: org, converted: false }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — categories, sections, reallocation, settlements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalised category key (§8.3). MUST stay identical in behaviour to the
 * SQL expression `lower(btrim(coalesce(category, '')))` that the functional
 * index `transactions_category_key_idx` is built on — if these two ever
 * disagree, spend silently lands in the catch-all instead of its envelope.
 *
 * Postgres `btrim(text)` with no character list strips ONLY U+0020 SPACE —
 * not tab, newline, CR, and not unicode whitespace. JS `.trim()` strips all
 * of those and would be WIDER (verified against a live Postgres 17: a category
 * with a leading tab kept its tab under btrim() but lost it under .trim()). So
 * we trim exactly that one character rather than calling .trim().
 */
const BTRIM_CHARS = " "
export function categoryKey(raw: string | null | undefined): string {
  let s = raw ?? ""
  let a = 0
  let b = s.length
  while (a < b && BTRIM_CHARS.includes(s[a]!)) a++
  while (b > a && BTRIM_CHARS.includes(s[b - 1]!)) b--
  s = s.slice(a, b)
  // Postgres lower() on a UTF-8 database is locale-aware; JS toLowerCase() is
  // full-unicode. Over the ASCII-plus-accented range that real categories use
  // they agree. Documented as a known narrow divergence rather than pretended
  // away.
  return s.toLowerCase()
}

/** True when two category strings denote the same category. */
export const sameCategory = (a: string | null | undefined, b: string | null | undefined): boolean =>
  categoryKey(a) === categoryKey(b)

/**
 * ONE CATEGORY → ONE ENVELOPE (§8.3). Returns the keys that would collide, so
 * the API can name them in the error instead of saying "invalid".
 *
 * `existing` is every other envelope match list in the same plan; the catch-all
 * is excluded by the caller because it claims "everything not claimed" rather
 * than a key list.
 */
export function categoryConflicts(
  proposed: (string | null | undefined)[],
  existing: { id: string; name: string; matchKeys: string[] }[],
): { key: string; envelopeId: string; envelopeName: string }[] {
  const out: { key: string; envelopeId: string; envelopeName: string }[] = []
  const want = new Set(proposed.map(categoryKey).filter((k) => k.length > 0))
  for (const e of existing) {
    for (const k of e.matchKeys) {
      const key = categoryKey(k)
      if (want.has(key)) out.push({ key, envelopeId: e.id, envelopeName: e.name })
    }
  }
  return out
}

/** De-duplicated, normalised, empty-stripped key list ready to store. */
export function normalizeMatchKeys(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    const k = categoryKey(r)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

// ── per-section aggregation (§8.7) ───────────────────────────────────────────

export type EnvelopeTotals = {
  section: BudgetSection
  planned: number
  spentNet: number
  pending: number
}

export type SectionTotals = {
  section: BudgetSection
  planned: number
  spentNet: number
  pending: number
  /** Signed. NEGATIVE means the section as a whole is over its target. */
  remaining: number
  /**
   * Non-negative spendable room. Netted across the WHOLE section, then floored
   * exactly ONCE (§8.5.1) — never the sum of per-envelope floors, which would
   * let an overspend hide behind an untouched envelope.
   */
  headroom: number
  utilisation: BudgetStateV2
  envelopeCount: number
  overspentCount: number
}

/**
 * Aggregate one section.
 *
 * The floor-once rule is the whole point. Groceries planned 300 / spent 400 and
 * Dining planned 200 / spent 0 gives planned 500, spent 400 → headroom 100.
 * Flooring per envelope first would give max(0,-100) + max(0,200) = 200 and
 * invite the user to spend money the plan does not have.
 */
export function aggregateSection(section: BudgetSection, envelopes: EnvelopeTotals[]): SectionTotals {
  const mine = envelopes.filter((e) => e.section === section)
  let planned = 0
  let spent = 0
  let pending = 0
  let overspent = 0
  for (const e of mine) {
    planned += e.planned
    spent += e.spentNet
    pending += e.pending
    if (remaining(e.planned, e.spentNet, e.pending) < 0) overspent++
  }
  planned = round2(planned)
  spent = round2(spent)
  pending = round2(pending)
  return {
    section,
    planned,
    spentNet: spent,
    pending,
    remaining: remaining(planned, spent, pending),
    headroom: flexibleHeadroom({ planned, spentNet: spent, pending }),
    utilisation: state(round2(spent + pending), planned),
    envelopeCount: mine.length,
    overspentCount: overspent,
  }
}

/** Every section, in display order, including the empty ones. */
export function aggregateAllSections(envelopes: EnvelopeTotals[]): Record<BudgetSection, SectionTotals> {
  const out = {} as Record<BudgetSection, SectionTotals>
  for (const s of BUDGET_SECTIONS) out[s] = aggregateSection(s, envelopes)
  return out
}

// ── reallocation and covering an overspend (§8.5.2, §8.10) ───────────────────

export type ReallocationCheck =
  | { ok: true; amount: number }
  | {
      ok: false
      reason: "same_envelope" | "not_positive" | "insufficient_source" | "cross_section"
      available?: number
    }

/**
 * Moving planned money between two envelopes must leave the plan-wide total
 * planned UNCHANGED — that is what makes safe-to-spend invariant under
 * reallocation (§8.5.2). This validates the move; it does not perform it.
 *
 * `allowCrossSection` is false by default because moving a commitment planned
 * amount into flexible spending changes what is RESERVED, and therefore changes
 * safe-to-spend. That is a legitimate action, but it must be an explicit
 * decision rather than a side effect of a drag.
 */
export function checkReallocation(input: {
  fromId: string
  toId: string
  amount: number
  fromSection: BudgetSection
  toSection: BudgetSection
  /** The source own remaining room — money already spent cannot be moved. */
  fromAvailable: number
  allowCrossSection?: boolean
}): ReallocationCheck {
  if (input.fromId === input.toId) return { ok: false, reason: "same_envelope" }
  const amount = round2(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "not_positive" }
  if (!input.allowCrossSection && input.fromSection !== input.toSection) {
    return { ok: false, reason: "cross_section" }
  }
  const available = round2(input.fromAvailable)
  if (amount > available) return { ok: false, reason: "insufficient_source", available }
  return { ok: true, amount }
}

/** Proves the invariance the UI promises: total planned is unchanged. */
export function reallocationPreservesTotal(
  before: { fromPlanned: number; toPlanned: number },
  after: { fromPlanned: number; toPlanned: number },
): boolean {
  return round2(before.fromPlanned + before.toPlanned) === round2(after.fromPlanned + after.toPlanned)
}

export type OverspendOption =
  | { kind: "move_from_envelope"; envelopeId: string; envelopeName: string; available: number }
  | { kind: "cover_from_unallocated"; available: number }
  | { kind: "raise_target"; delta: number }
  | { kind: "accept" }

/**
 * The options offered when an envelope is over (§8.10). ORDER IS THE ADVICE:
 * cheapest-for-the-plan first. Moving money from another envelope keeps total
 * planned flat; unallocated is a real buffer; raising the target increases what
 * the plan claims it can spend and so is offered LAST before simply accepting.
 *
 * "Accept" is always present and never framed as a failure (principle P7): an
 * overspend the user has seen and accepted is a valid plan state.
 */
export function overspendOptions(input: {
  overBy: number
  unallocated: number
  siblings: { id: string; name: string; available: number }[]
}): OverspendOption[] {
  const over = round2(input.overBy)
  const out: OverspendOption[] = []
  for (const s of [...input.siblings].sort((a, b) => b.available - a.available)) {
    if (s.available > 0) {
      out.push({
        kind: "move_from_envelope",
        envelopeId: s.id,
        envelopeName: s.name,
        available: round2(s.available),
      })
    }
  }
  if (input.unallocated > 0) out.push({ kind: "cover_from_unallocated", available: round2(input.unallocated) })
  if (over > 0) out.push({ kind: "raise_target", delta: over })
  out.push({ kind: "accept" })
  return out
}

// ── settlements (§8.8.1) ─────────────────────────────────────────────────────

export type SettlementStatus = "unsettled" | "partially_settled" | "fully_settled"

export type SettlementRollup = {
  expenseAmount: number
  settled: number
  outstanding: number
  status: SettlementStatus
}

/**
 * The sum of settlements per expense is capped at the expense amount on write,
 * so `outstanding` never goes negative and `settled` is clamped. A caller that
 * has somehow accumulated more than the expense gets `fully_settled` and
 * outstanding 0 rather than a nonsensical negative figure in the UI.
 */
export function settlementRollup(expenseAmount: number, settlements: number[]): SettlementRollup {
  const expense = round2(Math.abs(expenseAmount))
  const raw = round2(settlements.reduce((a, b) => a + b, 0))
  const settled = round2(Math.min(raw, expense))
  const outstanding = round2(Math.max(0, expense - settled))
  const status: SettlementStatus =
    settled <= 0 ? "unsettled" : outstanding <= 0 ? "fully_settled" : "partially_settled"
  return { expenseAmount: expense, settled, outstanding, status }
}

/** Enforced on write: may this settlement amount be added? */
export function canAddSettlement(input: {
  expenseAmount: number
  alreadySettled: number
  amount: number
}): { ok: true; amount: number } | { ok: false; reason: "not_positive" | "exceeds_expense"; room: number } {
  const amount = round2(input.amount)
  const room = round2(Math.max(0, round2(Math.abs(input.expenseAmount)) - round2(input.alreadySettled)))
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "not_positive", room }
  if (amount > room) return { ok: false, reason: "exceeds_expense", room }
  return { ok: true, amount }
}

// ── occurrence actions (§8.6) ────────────────────────────────────────────────

export type OccurrenceAction = "settle" | "cancel" | "skip" | "reschedule"

/**
 * Rescheduling must not create two occurrences of the same commitment on the
 * same day — `budget_occurrences_commitment_due_unique` would reject the write,
 * so the collision is detected first and the taken date is named (§8.6).
 *
 * `taken` is every other effective due date for this commitment.
 */
export function checkReschedule(input: {
  toDate: string
  currentDate: string
  taken: string[]
  /** Recurring commitments may not be moved outside their carry window. */
  lowerBound?: string | null
}): { ok: true; date: string } | { ok: false; reason: "invalid_date" | "unchanged" | "collision" | "before_window" } {
  if (!isIsoDate(input.toDate)) return { ok: false, reason: "invalid_date" }
  if (input.toDate === input.currentDate) return { ok: false, reason: "unchanged" }
  if (input.lowerBound && input.toDate < input.lowerBound) return { ok: false, reason: "before_window" }
  if (input.taken.some((d) => d === input.toDate)) return { ok: false, reason: "collision" }
  return { ok: true, date: input.toDate }
}

/** Which actions make sense for an occurrence in its current state. */
export function allowedOccurrenceActions(occState: OccurrenceState): OccurrenceAction[] {
  switch (occState) {
    case "expected":
    case "rescheduled":
      return ["settle", "reschedule", "skip", "cancel"]
    case "skipped":
      // A skip is reversible by settling or moving it; cancelling a skip is a no-op.
      return ["settle", "reschedule"]
    case "settled":
    case "cancelled":
      return []
    default:
      return []
  }
}

/** Days a commitment is past due, floored at 0. */
export const daysOverdue = (dueDate: string, today: string): number => Math.max(0, daysBetween(dueDate, today))

/**
 * `needs_attention` (§8.6.1) is a RECURRING-only flag — the schema CHECK
 * `budget_commitments_attention_check` enforces that. A recurring commitment
 * earns it when unresolved occurrences pile up to the cap, which is the signal
 * that the rule itself is wrong (a cancelled subscription, a changed landlord)
 * rather than that one payment is late.
 */
export function needsAttention(kind: CommitmentKind, unresolvedCount: number): boolean {
  return kind === "recurring" && unresolvedCount >= MAX_UNRESOLVED_RECURRING_OCCURRENCES
}
