import { describe, expect, it } from "vitest"
import { MAX_OCCURRENCES_PER_RUN, occurrenceAt, occurrencesDue, ruleExhausted } from "./recurring"

describe("occurrenceAt", () => {
  it("steps days and weeks", () => {
    expect(occurrenceAt("2026-06-10", { unit: "day", interval: 1 }, 3)).toBe("2026-06-13")
    expect(occurrenceAt("2026-06-10", { unit: "day", interval: 10 }, 2)).toBe("2026-06-30")
    expect(occurrenceAt("2026-06-10", { unit: "week", interval: 1 }, 2)).toBe("2026-06-24")
    expect(occurrenceAt("2026-12-29", { unit: "week", interval: 2 }, 1)).toBe("2027-01-12")
  })

  it("steps months with month-end clamping FROM THE ANCHOR (no drift)", () => {
    const freq = { unit: "month", interval: 1 } as const
    expect(occurrenceAt("2026-01-31", freq, 1)).toBe("2026-02-28")
    // The clamp must NOT stick: March returns to the 31st.
    expect(occurrenceAt("2026-01-31", freq, 2)).toBe("2026-03-31")
    expect(occurrenceAt("2026-01-31", freq, 3)).toBe("2026-04-30")
  })

  it("handles leap years", () => {
    expect(occurrenceAt("2028-01-31", { unit: "month", interval: 1 }, 1)).toBe("2028-02-29")
    expect(occurrenceAt("2028-02-29", { unit: "year", interval: 1 }, 1)).toBe("2029-02-28")
  })

  it("steps years and crosses year boundaries on months", () => {
    expect(occurrenceAt("2026-06-10", { unit: "year", interval: 1 }, 2)).toBe("2028-06-10")
    expect(occurrenceAt("2026-11-15", { unit: "month", interval: 3 }, 1)).toBe("2027-02-15")
  })

  it("treats interval < 1 as 1", () => {
    expect(occurrenceAt("2026-06-10", { unit: "day", interval: 0 }, 1)).toBe("2026-06-11")
  })
})

describe("occurrencesDue", () => {
  const freq = { unit: "month", interval: 1 } as const

  it("catches up every missed occurrence from the cursor through today", () => {
    const { due, nextCursor } = occurrencesDue({
      anchor: "2026-03-05",
      freq,
      cursor: "2026-04-05",
      until: "2026-06-10",
    })
    expect(due).toEqual(["2026-04-05", "2026-05-05", "2026-06-05"])
    expect(nextCursor).toBe("2026-07-05")
  })

  it("starts from the anchor when there is no cursor", () => {
    const { due } = occurrencesDue({ anchor: "2026-06-01", freq, cursor: null, until: "2026-06-10" })
    expect(due).toEqual(["2026-06-01"])
  })

  it("returns nothing when the next occurrence is in the future", () => {
    const { due, nextCursor } = occurrencesDue({
      anchor: "2026-06-15",
      freq,
      cursor: null,
      until: "2026-06-10",
    })
    expect(due).toEqual([])
    expect(nextCursor).toBe("2026-06-15")
  })

  it("respects the rule's end date (inclusive)", () => {
    const { due, nextCursor } = occurrencesDue({
      anchor: "2026-01-10",
      freq,
      cursor: "2026-04-10",
      until: "2026-12-31",
      end: "2026-06-10",
    })
    expect(due).toEqual(["2026-04-10", "2026-05-10", "2026-06-10"])
    expect(ruleExhausted(nextCursor, "2026-06-10")).toBe(true)
  })

  it("caps a runaway catch-up and the cursor resumes where it stopped", () => {
    const daily = { unit: "day", interval: 1 } as const
    const { due, nextCursor } = occurrencesDue({
      anchor: "2025-01-01",
      freq: daily,
      cursor: "2025-01-01",
      until: "2026-06-10",
    })
    expect(due).toHaveLength(MAX_OCCURRENCES_PER_RUN)
    expect(due[0]).toBe("2025-01-01")
    expect(nextCursor).toBe(due[due.length - 1] < "2025-03-02" ? "2025-03-02" : nextCursor) // 60 days after Jan 1
    // The next run continues seamlessly:
    const second = occurrencesDue({ anchor: "2025-01-01", freq: daily, cursor: nextCursor, until: "2026-06-10" })
    expect(second.due[0]).toBe(nextCursor)
  })

  it("clamped month-end occurrences materialize on the clamped date", () => {
    const { due } = occurrencesDue({
      anchor: "2026-01-31",
      freq,
      cursor: "2026-02-01",
      until: "2026-04-30",
    })
    expect(due).toEqual(["2026-02-28", "2026-03-31", "2026-04-30"])
  })
})

describe("ruleExhausted", () => {
  it("is false without an end date", () => {
    expect(ruleExhausted("2099-01-01", null)).toBe(false)
    expect(ruleExhausted("2099-01-01", undefined)).toBe(false)
  })
  it("is true only when the cursor passed the end", () => {
    expect(ruleExhausted("2026-07-01", "2026-06-30")).toBe(true)
    expect(ruleExhausted("2026-06-30", "2026-06-30")).toBe(false)
  })
})
