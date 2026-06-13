import { describe, it, expect } from "vitest"
import { parseGoal, parseTargetDate } from "./spaces"

// Pure input validators for the Space goal — DB-free, safe for the committed
// unit gate.

describe("parseGoal", () => {
  it("treats empty / null / undefined / zero as no goal", () => {
    expect(parseGoal("")).toBeNull()
    expect(parseGoal(null)).toBeNull()
    expect(parseGoal(undefined)).toBeNull()
    expect(parseGoal(0)).toBeNull()
    expect(parseGoal("0")).toBeNull()
  })
  it("stores a positive number as a string", () => {
    expect(parseGoal(1500)).toBe("1500")
    expect(parseGoal("2500.5")).toBe("2500.5")
  })
  it("rejects negatives and non-numbers", () => {
    expect(parseGoal(-1)).toBe("invalid")
    expect(parseGoal("abc")).toBe("invalid")
  })
  it("rejects absurdly large amounts (money cap)", () => {
    expect(parseGoal(1e30)).toBe("invalid")
  })
})

describe("parseTargetDate", () => {
  it("treats empty / null as no target", () => {
    expect(parseTargetDate("")).toBeNull()
    expect(parseTargetDate(null)).toBeNull()
    expect(parseTargetDate(undefined)).toBeNull()
  })
  it("accepts a YYYY-MM-DD string", () => {
    expect(parseTargetDate("2026-12-01")).toBe("2026-12-01")
  })
  it("rejects malformed dates", () => {
    expect(parseTargetDate("12/01/2026")).toBe("invalid")
    expect(parseTargetDate("2026-13")).toBe("invalid")
  })
})
