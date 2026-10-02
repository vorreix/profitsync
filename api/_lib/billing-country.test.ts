import { describe, expect, it } from "vitest"
import { billingCountry } from "./billing-country.js"

describe("billingCountry", () => {
  it("prefers the profile country over the IP (MC-109: pricing and checkout agree)", () => {
    expect(billingCountry("in", "US")).toBe("IN")
  })
  it("falls back to the IP geo when the profile has no usable country", () => {
    expect(billingCountry("", "de")).toBe("DE")
    expect(billingCountry(null, "GB")).toBe("GB")
    expect(billingCountry("India", "FR")).toBe("FR")
  })
  it("defaults to US when neither is known", () => {
    expect(billingCountry(undefined, undefined)).toBe("US")
    expect(billingCountry("", ["IN", "US"])).toBe("US")
  })
})
