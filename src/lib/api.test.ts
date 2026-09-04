import { describe, expect, it } from "vitest"
import { apiErrorMessage } from "./api"

describe("apiErrorMessage", () => {
  it("prefers a route's human message over its machine code, then quota reason, then the code", () => {
    expect(apiErrorMessage(new Error('{"error":"category_claimed","message":"Already tracked by Groceries"}'), "fallback")).toBe(
      "Already tracked by Groceries",
    )
    expect(apiErrorMessage(new Error('{"reason":"Free plan allows 10 clients","upgradeHint":true}'), "fallback")).toBe("Free plan allows 10 clients")
    expect(apiErrorMessage(new Error('{"error":"Forbidden"}'), "fallback")).toBe("Forbidden")
  })
  it("falls back for auth failures, empty bodies and non-JSON text", () => {
    expect(apiErrorMessage(new Error("auth"), "fallback")).toBe("fallback")
    expect(apiErrorMessage(new Error(""), "fallback")).toBe("fallback")
    expect(apiErrorMessage("not an error", "fallback")).toBe("fallback")
    expect(apiErrorMessage(new Error("HTTP 502"), "fallback")).toBe("HTTP 502")
  })
})
