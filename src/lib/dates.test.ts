import { describe, expect, it } from "vitest"
import { formatIsoDate } from "./dates"

describe("formatIsoDate", () => {
  it("formats an ISO date in the given language without a UTC day shift", () => {
    expect(formatIsoDate("2026-09-04", "en-US")).toBe("Sep 4, 2026")
    expect(formatIsoDate("2026-09-04", "de-DE")).toMatch(/4\. Sept\.? 2026|04\.09\.2026/)
    // A date on the far side of midnight UTC must still be the SAME calendar day.
    expect(formatIsoDate("2026-01-01", "en-US")).toBe("Jan 1, 2026")
  })
  it("passes timestamps through the same formatter and leaves junk alone", () => {
    expect(formatIsoDate("2026-09-04T10:15:00.000Z", "en-US")).toMatch(/Sep [34], 2026/)
    expect(formatIsoDate("", "en-US")).toBe("")
    expect(formatIsoDate(null, "en-US")).toBe("")
    expect(formatIsoDate("not a date", "en-US")).toBe("not a date")
  })
})
