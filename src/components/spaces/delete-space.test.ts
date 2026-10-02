import { describe, expect, it } from "vitest"
import { defaultSpaceDestination, needsReceivedAmount } from "./delete-space"

const acc = (id: string, type: string, currency_code: string | null, is_default = false) => ({ id, type, currency_code, is_default }) as Parameters<typeof defaultSpaceDestination>[0][number]

describe("defaultSpaceDestination", () => {
  it("prefers an account in the Space's currency, the default one first", () => {
    const accounts = [acc("cash", "cash", "INR", true), acc("eur", "bank", "EUR"), acc("eur-main", "bank", "EUR", true)]
    expect(defaultSpaceDestination(accounts, "EUR", "INR")).toBe("eur-main")
  })

  it("never pre-selects a credit card, even one in the Space's currency", () => {
    const accounts = [acc("card", "credit_card", "EUR"), acc("cash", "cash", "INR", true), acc("eur", "bank", "EUR")]
    expect(defaultSpaceDestination(accounts, "EUR", "INR")).toBe("eur")
    // No holding account in EUR: the default holding account, still not the card.
    expect(defaultSpaceDestination([acc("card", "credit_card", "EUR"), acc("cash", "cash", "INR", true)], "EUR", "INR")).toBe("cash")
    expect(defaultSpaceDestination([acc("card", "credit_card", "EUR")], "EUR", "INR")).toBe("")
  })
})

describe("needsReceivedAmount", () => {
  it("asks only when money moves across currencies", () => {
    expect(needsReceivedAmount(200, "EUR", "INR")).toBe(true)
    expect(needsReceivedAmount(200, "EUR", "EUR")).toBe(false)
    expect(needsReceivedAmount(200, "EUR", null)).toBe(false)
  })

  it("lets an empty foreign-currency Space be deleted without a received figure", () => {
    expect(needsReceivedAmount(0, "EUR", "INR")).toBe(false)
  })
})
