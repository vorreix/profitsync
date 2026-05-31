import { describe, it, expect } from "vitest"
import { accountTypeAllows, ACCOUNT_TYPES, type BusinessFeature } from "./types"

const BUSINESS_FEATURES: BusinessFeature[] = ["clients", "quotations", "members"]

describe("accountTypeAllows", () => {
  it("blocks every business-only feature for personal accounts", () => {
    for (const feature of BUSINESS_FEATURES) {
      expect(accountTypeAllows("personal", feature)).toBe(false)
    }
  })

  it("allows every business-only feature for business accounts", () => {
    for (const feature of BUSINESS_FEATURES) {
      expect(accountTypeAllows("business", feature)).toBe(true)
    }
  })

  it("defaults unknown / legacy (null/undefined) account types to full access", () => {
    for (const feature of BUSINESS_FEATURES) {
      expect(accountTypeAllows(null, feature)).toBe(true)
      expect(accountTypeAllows(undefined, feature)).toBe(true)
    }
  })

  it("exposes exactly the two supported account types", () => {
    expect(ACCOUNT_TYPES).toEqual(["personal", "business"])
  })
})
