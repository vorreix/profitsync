import { afterEach, describe, expect, it, vi } from "vitest"
import { FrankfurterProvider, FxUnavailable, OpenErApiProvider, convertAmount } from "./fx-rates"

// Pure/provider-parsing tests only: the module constructs the db client at import
// (placeholder DATABASE_URL in the unit gate) but nothing here ever queries it.

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe("FrankfurterProvider", () => {
  it("parses a current rate and sends only the pair", async () => {
    const fetchMock = mockFetch({ amount: 1, base: "EUR", date: "2026-09-09", rates: { INR: 110.8225 } })
    const q = await new FrankfurterProvider().getCurrentRate("EUR", "INR")
    expect(q).toMatchObject({ baseCurrency: "EUR", quoteCurrency: "INR", rate: "110.8225", rateDate: "2026-09-09", sourceType: "market", provider: "frankfurter" })
    const url = String((fetchMock.mock.calls[0] as unknown as [string])[0])
    expect(url).toContain("base=EUR")
    expect(url).toContain("symbols=INR")
    expect(url).not.toMatch(/amount|balance|account/i)
  })

  it("reports an unsupported pair as FxUnavailable, never as 1", async () => {
    mockFetch({ message: "not found" }, 404)
    await expect(new FrankfurterProvider().getCurrentRate("EUR", "AED")).rejects.toBeInstanceOf(FxUnavailable)
  })

  it("returns a business-day series keyed by date", async () => {
    mockFetch({ rates: { "2026-09-01": { INR: 110.0485 }, "2026-09-02": { INR: 109.962 } } })
    const series = await new FrankfurterProvider().getSeries("EUR", "INR", "2026-09-01", "2026-09-02")
    expect([...series.entries()]).toEqual([["2026-09-01", "110.0485"], ["2026-09-02", "109.962"]])
  })
})

describe("OpenErApiProvider", () => {
  it("parses a current rate from the base-wide table", async () => {
    mockFetch({ result: "success", time_last_update_utc: "Tue, 09 Sep 2026 00:02:31 +0000", rates: { AED: 4.269072, INR: 110.161082 } })
    const q = await new OpenErApiProvider().getCurrentRate("EUR", "AED")
    expect(q).toMatchObject({ rate: "4.269072", rateDate: "2026-09-09", sourceType: "market", provider: "open-er-api" })
  })

  it("has no history", async () => {
    await expect(new OpenErApiProvider().getHistoricalRate("EUR", "AED", "2026-01-01")).rejects.toBeInstanceOf(FxUnavailable)
  })
})

describe("convertAmount", () => {
  it("multiplies in decimal and rounds to cents", () => {
    const rate = { base: "INR", quote: "EUR", rate: "0.00902", rateDate: "2026-09-09", provider: "x", stale: false }
    expect(convertAmount("75000", rate).toFixed()).toBe("676.5")
    expect(convertAmount("0.1", { ...rate, rate: "3" }).toFixed()).toBe("0.3")
  })
})
