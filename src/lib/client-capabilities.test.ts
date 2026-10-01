import { describe, expect, it } from "vitest"
import { CLIENT_CAPABILITIES, MULTI_CURRENCY, hasCapability, needsClientUpdate } from "./client-capabilities"

describe("client capabilities (MC-034)", () => {
  it("this build announces multi-currency", () => {
    expect(hasCapability(CLIENT_CAPABILITIES, MULTI_CURRENCY)).toBe(true)
  })

  it("reads a comma list, any case, repeated headers; absence is an old build", () => {
    expect(hasCapability("foo, Multi-Currency", MULTI_CURRENCY)).toBe(true)
    expect(hasCapability(["foo", "multi-currency"], MULTI_CURRENCY)).toBe(true)
    expect(hasCapability(undefined, MULTI_CURRENCY)).toBe(false)
    expect(hasCapability("", MULTI_CURRENCY)).toBe(false)
    expect(hasCapability("multi-currency-v0", MULTI_CURRENCY)).toBe(false)
  })

  it("gates only a foreign currency from an old build", () => {
    expect(needsClientUpdate("EUR", "INR", false)).toBe(true)
    expect(needsClientUpdate("eur ", "INR", false)).toBe(true)
    expect(needsClientUpdate("EUR", "INR", true)).toBe(false)
    expect(needsClientUpdate("inr", "INR", false)).toBe(false)
    expect(needsClientUpdate(undefined, "INR", false)).toBe(false)
    expect(needsClientUpdate(null, "INR", false)).toBe(false)
    expect(needsClientUpdate("  ", "INR", false)).toBe(false)
  })
})
