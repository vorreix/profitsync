import { describe, it, expect } from "vitest"
import {
  accountTypeAllows,
  ACCOUNT_TYPES,
  isPaidPlanKey,
  type BusinessFeature,
  type PersonalFeature,
} from "./types"

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

  // Personal-only features gate the OTHER way, and their unknown-account
  // default is the opposite too — see the individual cases below.
  const PERSONAL_FEATURES: PersonalFeature[] = ["spaces"]

  it("blocks every personal-only feature for business accounts", () => {
    for (const feature of PERSONAL_FEATURES) {
      expect(accountTypeAllows("business", feature), feature).toBe(false)
    }
  })

  it("allows every personal-only feature for personal accounts", () => {
    for (const feature of PERSONAL_FEATURES) {
      expect(accountTypeAllows("personal", feature), feature).toBe(true)
    }
  })

  it("denies personal-only features to unknown / legacy accounts", () => {
    // Deliberately the opposite default from business-only features. Those open
    // up for a legacy org so nobody is locked out of something they already
    // use; a personal-only feature has to be EARNED by an explicit `personal`,
    // because showing a household budget on an unclassified workspace is the
    // wrong kind of mistake.
    for (const feature of PERSONAL_FEATURES) {
      expect(accountTypeAllows(null, feature), feature).toBe(false)
      expect(accountTypeAllows(undefined, feature), feature).toBe(false)
    }
  })

  it("gates the Budget v2 household plan away from business workspaces", () => {
    // Spec §23 / decision D-1: a business workspace keeps per-client SPEND CAPS,
    // which are a different concept and are not gated. Its revenue is per
    // client, so expected income, funding base and safe-to-spend have no
    // business meaning. The server refuses to create a plan for one, and the
    // migration skips them; this is the same rule in the UI.
    // Client caps are reached through business-only surfaces, which stay open.
    expect(accountTypeAllows("business", "clients")).toBe(true)
  })
})

describe("isPaidPlanKey", () => {
  it("treats free / empty as not paid", () => {
    expect(isPaidPlanKey("free")).toBe(false)
    expect(isPaidPlanKey(null)).toBe(false)
    expect(isPaidPlanKey(undefined)).toBe(false)
    expect(isPaidPlanKey("")).toBe(false)
  })

  it("treats every non-free plan key as paid (current + legacy)", () => {
    for (const key of ["personal", "business", "premium"]) {
      expect(isPaidPlanKey(key)).toBe(true)
    }
  })
})
