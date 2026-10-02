import { describe, expect, it, vi } from "vitest"

// The NULL fallback is the only path that reads the workspace; stub it (no DB).
const reporting = vi.fn(async () => "EUR")
vi.mock("./fx-rates.js", () => ({ reportingCurrencyFor: () => reporting() }))

const { sameNativeCurrency } = await import("./cards.js")

describe("sameNativeCurrency (autopay currency guard)", () => {
  it("compares stored codes without reading the workspace", async () => {
    expect(await sameNativeCurrency("org", "INR", "INR")).toBe(true)
    expect(await sameNativeCurrency("org", "INR", "EUR")).toBe(false)
    expect(await sameNativeCurrency("org", null, undefined)).toBe(true)
    expect(reporting).not.toHaveBeenCalled()
  })

  it("reads a legacy NULL as the reporting currency", async () => {
    expect(await sameNativeCurrency("org", null, "EUR")).toBe(true)
    expect(await sameNativeCurrency("org", "INR", null)).toBe(false)
  })
})
