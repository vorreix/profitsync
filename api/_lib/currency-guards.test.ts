import { describe, expect, it } from "vitest"
import { currencyChangeRefusal, splitCurrencyRefusal } from "./currency-guards"

describe("currencyChangeRefusal (MC-044 / MC-075)", () => {
  it("refuses a currency change that does not restate the amount", () => {
    expect(currencyChangeRefusal("EUR", "INR", false)?.code).toBe("amount_required_for_currency_change")
  })
  it("accepts it when the amount is in the same request", () => {
    expect(currencyChangeRefusal("EUR", "INR", true)).toBeNull()
  })
  it("ignores an unchanged currency, case-insensitively", () => {
    expect(currencyChangeRefusal("EUR", "eur", false)).toBeNull()
  })
  it("treats stamping a legacy row (no stored currency) as no change", () => {
    expect(currencyChangeRefusal(null, "INR", false)).toBeNull()
    expect(currencyChangeRefusal(undefined, "INR", false)).toBeNull()
  })
})

describe("splitCurrencyRefusal (MC-042 / MC-157)", () => {
  it("accepts legs that share one currency", () => {
    expect(splitCurrencyRefusal(["INR", "inr", "INR"])).toBeNull()
    expect(splitCurrencyRefusal(["EUR"])).toBeNull()
  })
  it("refuses legs in different currencies with 400 split_currency_mismatch", () => {
    expect(splitCurrencyRefusal(["INR", "EUR"])).toMatchObject({ status: 400, body: { code: "split_currency_mismatch" } })
  })
  it("refuses an account with no currency with 409 currency_missing", () => {
    expect(splitCurrencyRefusal(["INR", null])).toMatchObject({ status: 409, body: { code: "currency_missing" } })
    expect(splitCurrencyRefusal([undefined])).toMatchObject({ status: 409, body: { code: "currency_missing" } })
  })
})
