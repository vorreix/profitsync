// Pure savings-goal math for Spaces (personal savings buckets). No I/O, no DB —
// safe to import from both the client and the API, and unit-tested so the
// suggestion can't silently drift. A Space is a wealth_accounts row with
// type='space'; `current_balance` is the saved amount, `goal_amount` +
// `target_date` are optional. The monthly-contribution suggestion is DERIVED
// here (never stored) from (goal − saved) / months-remaining.

export type SpaceFrequencyUnit = "day" | "week" | "month" | "year"

const round2 = (n: number): number => Math.round(n * 100) / 100

function ymd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m, d }
}

/**
 * Whole calendar months from `todayIso` to `targetIso` (day-of-month ignored).
 * Negative when the target is in a past month. Both are 'YYYY-MM-DD'.
 */
export function monthsUntil(todayIso: string, targetIso: string): number {
  const a = ymd(todayIso)
  const b = ymd(targetIso)
  return (b.y - a.y) * 12 + (b.m - a.m)
}

export type SpaceProgress = { pct: number; remaining: number; reached: boolean }

/**
 * Progress toward the goal. Returns null when no (positive) goal is set — a
 * Space can be a plain bucket. `pct` is clamped 0..100.
 */
export function spaceProgress(currentBalance: number, goalAmount: number | null | undefined): SpaceProgress | null {
  if (goalAmount == null || goalAmount <= 0) return null
  const remaining = round2(goalAmount - currentBalance)
  const pct = Math.max(0, Math.min(100, round2((currentBalance / goalAmount) * 100)))
  return { pct, remaining: Math.max(0, remaining), reached: currentBalance >= goalAmount }
}

/**
 * Suggested amount to set aside each month to reach the goal by the target date.
 * - null  → no goal, or a goal but no target date (nothing to pace against)
 * - 0     → goal already reached
 * - full remainder → target date is today/past but goal not met (catch up now)
 * - else  → remaining / months-remaining (rounded to the cent)
 */
export function suggestedMonthly(
  currentBalance: number,
  goalAmount: number | null | undefined,
  targetDate: string | null | undefined,
  todayIso: string,
): number | null {
  if (goalAmount == null || goalAmount <= 0) return null
  const remaining = goalAmount - currentBalance
  if (remaining <= 0) return 0
  if (!targetDate) return null
  if (targetDate <= todayIso) return round2(remaining) // due now / overdue → the whole remainder
  const months = Math.max(1, monthsUntil(todayIso, targetDate))
  return round2(remaining / months)
}

export type SpaceGoalStatus =
  | { kind: "none" }
  | { kind: "reached" }
  | { kind: "overdue"; remaining: number }
  | { kind: "on_pace"; remaining: number; monthsLeft: number; suggestedMonthly: number }

/**
 * A single discriminated status for the UI badge/label, combining progress +
 * the target date. `none` = no goal; `reached` = met; `overdue` = past the date
 * and unmet; `on_pace` = future target with a per-month suggestion.
 */
export function spaceGoalStatus(
  currentBalance: number,
  goalAmount: number | null | undefined,
  targetDate: string | null | undefined,
  todayIso: string,
): SpaceGoalStatus {
  if (goalAmount == null || goalAmount <= 0) return { kind: "none" }
  const remaining = round2(goalAmount - currentBalance)
  if (remaining <= 0) return { kind: "reached" }
  if (targetDate && targetDate <= todayIso) return { kind: "overdue", remaining }
  const monthsLeft = targetDate ? Math.max(1, monthsUntil(todayIso, targetDate)) : 0
  return {
    kind: "on_pace",
    remaining,
    monthsLeft,
    suggestedMonthly: suggestedMonthly(currentBalance, goalAmount, targetDate, todayIso) ?? 0,
  }
}

const UNIT_MONTHS: Record<SpaceFrequencyUnit, number> = {
  day: 12 / 365,
  week: 12 / 52,
  month: 1,
  year: 12,
}

/**
 * Normalize a recurring auto-save (amount every `interval` × `unit`) to a
 * per-month figure, so its pace can be compared to `suggestedMonthly`.
 * e.g. £50 every 2 weeks ≈ £108.33/month.
 */
export function monthlyEquivalent(amount: number, unit: SpaceFrequencyUnit, interval: number): number {
  const periodMonths = Math.max(1, interval) * UNIT_MONTHS[unit]
  return round2(amount / periodMonths)
}

export type AutoSavePace = "ahead" | "on_track" | "behind"

/**
 * Compare an auto-save's monthly-equivalent pace to the suggested monthly. Null
 * when there's nothing to compare (no goal/date suggestion). A small tolerance
 * (1%) avoids flapping between on_track/behind on rounding noise.
 */
export function autoSavePace(monthlyEquiv: number, suggested: number | null): AutoSavePace | null {
  if (suggested == null || suggested <= 0) return null
  if (monthlyEquiv >= suggested * 1.05) return "ahead"
  if (monthlyEquiv >= suggested * 0.99) return "on_track"
  return "behind"
}
