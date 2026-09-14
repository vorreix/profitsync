import { describe, expect, it } from "vitest"
import { occurrencesPerYear, previewRecurring } from "./recurring-preview"

const base = { amount: 300, unit: "month" as const, interval: 1, startDate: "2026-10-05", today: "2026-09-13" }
const schedule = (p: ReturnType<typeof previewRecurring>) => {
  if (p.kind !== "schedule") throw new Error(`expected a schedule, got ${p.kind}`)
  return p
}

describe("occurrencesPerYear", () => {
  it("counts the common rhythms", () => {
    expect(occurrencesPerYear("month", 1)).toBe(12)
    expect(occurrencesPerYear("week", 1)).toBe(52)
    expect(occurrencesPerYear("day", 1)).toBe(365)
    expect(occurrencesPerYear("year", 1)).toBe(1)
  })

  it("and the uncommon ones", () => {
    expect(occurrencesPerYear("week", 2)).toBe(26)
    expect(occurrencesPerYear("month", 3)).toBe(4)
    expect(occurrencesPerYear("day", 10)).toBe(36.5)
  })

  it("never divides by zero", () => {
    expect(occurrencesPerYear("month", 0)).toBe(12)
    expect(occurrencesPerYear("month", -2)).toBe(12)
  })
})

describe("previewRecurring", () => {
  it("says nothing without a valid start date", () => {
    expect(previewRecurring({ ...base, startDate: "" })).toEqual({ kind: "empty" })
    expect(previewRecurring({ ...base, startDate: "05/10/2026" })).toEqual({ kind: "empty" })
  })

  it("lists the next three dates and says more follow", () => {
    const p = schedule(previewRecurring(base))
    expect(p.dates).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"])
    expect(p.more).toBe(true)
  })

  it("turns the instalment into the figure that changes minds", () => {
    expect(schedule(previewRecurring(base)).perYear).toBe(3600)
    expect(schedule(previewRecurring({ ...base, amount: 12 })).perYear).toBe(144)
    expect(schedule(previewRecurring({ ...base, amount: 4, unit: "day" })).perYear).toBe(1460)
    expect(schedule(previewRecurring({ ...base, amount: 50, unit: "week", interval: 2 })).perYear).toBe(1300)
  })

  it("rounds the annual figure to the cent", () => {
    // 365/7 is a repeating decimal; nobody should see it.
    const p = schedule(previewRecurring({ ...base, amount: 10, unit: "day", interval: 7 }))
    expect(Number.isInteger(Math.round(p.perYear * 100))).toBe(true)
    expect(p.perYear).toBe(521.43)
  })

  it("stops at an end date and says no more follow", () => {
    const p = schedule(previewRecurring({ ...base, endDate: "2026-11-30" }))
    expect(p.dates).toEqual(["2026-10-05", "2026-11-05"])
    expect(p.more).toBe(false)
  })

  it("flags a schedule that can never run", () => {
    const p = schedule(previewRecurring({ ...base, endDate: "2026-09-30" }))
    expect(p.dates).toEqual([])
    expect(p.neverRuns).toBe(true)
  })

  it("flags a backdated start, because creating it posts the missed ones at once", () => {
    expect(schedule(previewRecurring({ ...base, startDate: "2026-06-05" })).backdated).toBe(true)
    expect(schedule(previewRecurring(base)).backdated).toBe(false)
  })

  it("a start date of today is not backdated", () => {
    expect(schedule(previewRecurring({ ...base, startDate: base.today })).backdated).toBe(false)
  })

  it("keeps a month-end anchor from drifting", () => {
    const p = schedule(previewRecurring({ ...base, startDate: "2026-01-31" }))
    expect(p.dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"])
  })

  it("treats a rubbish amount as zero rather than NaN", () => {
    expect(schedule(previewRecurring({ ...base, amount: Number.NaN })).perYear).toBe(0)
    expect(schedule(previewRecurring({ ...base, amount: -50 })).perYear).toBe(0)
  })
})

describe("previewRecurring with a cursor", () => {
  // Editing a rule that has been running for a year must not list last year's
  // dates under "Next payments" — every one of them has already posted.
  it("skips occurrences behind the cursor", () => {
    const p = previewRecurring({
      amount: 100,
      unit: "month",
      interval: 1,
      startDate: "2025-03-10",
      today: "2026-09-13",
      from: "2026-10-10",
    })
    expect(p.kind).toBe("schedule")
    if (p.kind !== "schedule") return
    expect(p.dates).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"])
    expect(p.more).toBe(true)
    // A cursor means nothing back-posts, whatever the anchor says.
    expect(p.backdated).toBe(false)
  })

  it("still lists from the anchor when there is no cursor", () => {
    const p = previewRecurring({
      amount: 100,
      unit: "month",
      interval: 1,
      startDate: "2026-07-01",
      today: "2026-09-13",
    })
    expect(p.kind).toBe("schedule")
    if (p.kind !== "schedule") return
    expect(p.dates[0]).toBe("2026-07-01")
    expect(p.backdated).toBe(true)
  })

  it("lists nothing when the rule ends before the cursor", () => {
    const p = previewRecurring({
      amount: 100,
      unit: "month",
      interval: 1,
      startDate: "2025-01-01",
      endDate: "2025-06-01",
      today: "2026-09-13",
      from: "2026-09-13",
    })
    expect(p.kind).toBe("schedule")
    if (p.kind !== "schedule") return
    expect(p.neverRuns).toBe(true)
  })

  it("does not spin on a daily rule anchored years ago", () => {
    const p = previewRecurring({
      amount: 1,
      unit: "day",
      interval: 1,
      startDate: "2020-01-01",
      today: "2026-09-13",
      from: "2026-09-14",
    })
    expect(p.kind).toBe("schedule")
    if (p.kind !== "schedule") return
    expect(p.dates).toEqual(["2026-09-14", "2026-09-15", "2026-09-16"])
  })
})
