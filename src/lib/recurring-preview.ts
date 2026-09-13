// What a recurring rule will DO, worked out from what has been typed so far.
// Pure, so the dialog can recompute it on every keystroke and the tests can pin
// every branch.
//
// The number that decides whether a subscription is worth keeping is almost
// never the one on the form. €12 a month is €144 a year, and €4 a day is €1,460
// — the annual figure is the one that changes minds, and it is the one nobody
// works out in their head.
import { occurrenceAt, type Frequency, type FrequencyUnit } from "./recurring.js"

/** Occurrences per year for any rhythm. Days are 365, not "about a year". */
export function occurrencesPerYear(unit: FrequencyUnit, interval: number): number {
  const per = interval > 0 ? interval : 1
  const yearly = unit === "day" ? 365 : unit === "week" ? 52 : unit === "month" ? 12 : 1
  return yearly / per
}

export type RecurringPreview =
  | { kind: "empty" }
  | {
      kind: "schedule"
      /** The next few dates it would post on, from the anchor. */
      dates: string[]
      /** True when more follow the ones listed. */
      more: boolean
      perYear: number
      /** It starts in the past, so creating it posts the missed ones at once. */
      backdated: boolean
      /** An end date is set and nothing falls on or after the anchor. */
      neverRuns: boolean
    }

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function previewRecurring(input: {
  amount: number
  unit: FrequencyUnit
  interval: number
  startDate: string
  endDate?: string | null
  today: string
  /** How many dates to list (the dialog shows three). */
  count?: number
}): RecurringPreview {
  if (!ISO.test(input.startDate)) return { kind: "empty" }
  const interval = Math.max(1, Math.floor(input.interval) || 1)
  const freq: Frequency = { unit: input.unit, interval }
  const want = input.count ?? 3

  const dates: string[] = []
  let more = false
  for (let n = 0; n <= want; n++) {
    const d = occurrenceAt(input.startDate, freq, n)
    if (input.endDate && d > input.endDate) break
    if (n === want) { more = true; break }
    dates.push(d)
  }

  const amount = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0
  return {
    kind: "schedule",
    dates,
    more,
    // Rounded to the cent: it is money, and a repeating decimal from 365/7 is
    // not something to show anyone.
    perYear: Math.round(amount * occurrencesPerYear(input.unit, interval) * 100) / 100,
    backdated: input.startDate < input.today,
    neverRuns: dates.length === 0,
  }
}
