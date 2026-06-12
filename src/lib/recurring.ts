// Recurring-payment date math — the single source of truth for WHEN a rule
// fires. Pure and timezone-free (everything is an ISO `YYYY-MM-DD` date string
// computed in UTC), so the API materializer, the UI preview, and the tests all
// agree to the day.
//
// Occurrences are ALWAYS computed from the rule's anchor (start_date) +
// n×interval — never by stepping from the previous occurrence — so month-end
// clamping can't drift (Jan 31 → Feb 28 → Mar 31, not Mar 28).

export type FrequencyUnit = "day" | "week" | "month" | "year"
export type Frequency = { unit: FrequencyUnit; interval: number }

export const FREQUENCY_UNITS: readonly FrequencyUnit[] = ["day", "week", "month", "year"]

/** Hard cap on catch-up materialization per request — a backstop, not a limit
 * (the cursor advances, so the next request continues where this one stopped). */
export const MAX_OCCURRENCES_PER_RUN = 60

function parseIso(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The n-th occurrence (0-based) of a rule anchored at `anchor`. */
export function occurrenceAt(anchor: string, freq: Frequency, n: number): string {
  const { y, m, d } = parseIso(anchor)
  const interval = Math.max(1, Math.floor(freq.interval || 1))
  if (freq.unit === "day" || freq.unit === "week") {
    const stepDays = (freq.unit === "week" ? 7 : 1) * interval
    const t = Date.UTC(y, m - 1, d) + n * stepDays * 86_400_000
    const dt = new Date(t)
    return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const monthStep = (freq.unit === "year" ? 12 : 1) * interval
  const totalMonths = (m - 1) + n * monthStep
  const ny = y + Math.floor(totalMonths / 12)
  const nm = (totalMonths % 12) + 1
  // Clamp the anchor day to the target month's length (31st → Feb 28/29).
  const nd = Math.min(d, daysInMonth(ny, nm))
  return toIso(ny, nm, nd)
}

/** Smallest n with occurrenceAt(n) >= date (binary search — n can be large). */
function firstIndexAtOrAfter(anchor: string, freq: Frequency, date: string): number {
  if (occurrenceAt(anchor, freq, 0) >= date) return 0
  let lo = 0
  let hi = 1
  while (occurrenceAt(anchor, freq, hi) < date) {
    lo = hi
    hi *= 2
    if (hi > 1_000_000) break // ~2700 years of daily occurrences — defensive
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (occurrenceAt(anchor, freq, mid) < date) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The occurrence dates due for materialization: every occurrence in
 * [cursor (or anchor), min(until, end)] — oldest first, capped. Returns the
 * due dates plus the next cursor (the first occurrence after the last one
 * returned; when capped, that's the next still-due date so a follow-up run
 * continues the catch-up).
 */
export function occurrencesDue(opts: {
  anchor: string
  freq: Frequency
  /** next_due_at — the first occurrence NOT yet materialized (null = anchor). */
  cursor: string | null
  /** Materialize up to and including this date (usually today). */
  until: string
  /** Optional inclusive end date of the rule. */
  end?: string | null
  cap?: number
}): { due: string[]; nextCursor: string } {
  const cap = Math.max(1, opts.cap ?? MAX_OCCURRENCES_PER_RUN)
  const from = opts.cursor && opts.cursor > opts.anchor ? opts.cursor : opts.anchor
  const limit = opts.end && opts.end < opts.until ? opts.end : opts.until

  const due: string[] = []
  let n = firstIndexAtOrAfter(opts.anchor, opts.freq, from)
  while (due.length < cap) {
    const date = occurrenceAt(opts.anchor, opts.freq, n)
    if (date > limit) break
    due.push(date)
    n++
  }
  return { due, nextCursor: occurrenceAt(opts.anchor, opts.freq, n) }
}

/** True when the rule has nothing left to fire (past its end date). */
export function ruleExhausted(nextCursor: string, end: string | null | undefined): boolean {
  return !!end && nextCursor > end
}

/** Today as an ISO date (UTC) — the materializer's "until". */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}
