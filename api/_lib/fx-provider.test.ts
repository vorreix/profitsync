import { describe, expect, it, vi } from "vitest"
import { CachedFxRateProvider, crossRate, type FxQuote, type FxRateProvider } from "./fx-provider"

const quote = (rate = "102.7"): FxQuote => ({
  baseCurrency: "EUR", quoteCurrency: "INR", rate: rate as FxQuote["rate"],
  rateDate: "2026-09-09", observedAt: "2026-09-09T10:00:00.000Z",
  provider: "fake", sourceType: "market", isFallback: false,
})

function fake(): FxRateProvider & { current: ReturnType<typeof vi.fn>; historical: ReturnType<typeof vi.fn> } {
  const current = vi.fn(async () => quote())
  const historical = vi.fn(async () => ({ ...quote("101.5"), sourceType: "historical_market" as const }))
  return { name: "fake", current, historical, getCurrentRate: current, getHistoricalRate: historical }
}

describe("CachedFxRateProvider", () => {
  it("sends only normalized pair values to a current-rate provider and caches the result", async () => {
    const delegate = fake()
    const provider = new CachedFxRateProvider(delegate)
    await Promise.all([provider.getCurrentRate("eur", "inr"), provider.getCurrentRate("EUR", "INR")])
    expect(delegate.current).toHaveBeenCalledTimes(1)
    expect(delegate.current).toHaveBeenCalledWith("EUR", "INR")
  })

  it("caches historical dates independently and preserves fallback metadata", async () => {
    const delegate = fake()
    const provider = new CachedFxRateProvider(delegate)
    const first = await provider.getHistoricalRate("EUR", "INR", "2026-09-06")
    await provider.getHistoricalRate("EUR", "INR", "2026-09-06")
    await provider.getHistoricalRate("EUR", "INR", "2026-09-05")
    expect(first.sourceType).toBe("historical_market")
    expect(delegate.historical).toHaveBeenCalledTimes(2)
  })

  it("returns identity without calling a provider", async () => {
    const delegate = fake()
    const value = await new CachedFxRateProvider(delegate).getCurrentRate("EUR", "EUR")
    expect(value.rate).toBe("1")
    expect(delegate.current).not.toHaveBeenCalled()
  })

  it("rejects invalid dates and non-positive provider rates", async () => {
    const delegate = fake()
    await expect(new CachedFxRateProvider(delegate).getHistoricalRate("EUR", "INR", "09/09/2026")).rejects.toThrow(RangeError)
    delegate.current.mockResolvedValue(quote("0"))
    await expect(new CachedFxRateProvider(delegate).getCurrentRate("EUR", "INR")).rejects.toThrow(RangeError)
  })
})

describe("crossRate", () => {
  const ecb = { anchor: "EUR", date: "2026-09-30", rates: { IDR: 20315.34, USD: 1.1355, INR: 108.8205 } }

  it("crosses two sides of an anchor table in Decimal, both directions consistent", () => {
    expect(crossRate(ecb, "IDR", "USD")).toEqual({ rate: "0.00005589372366", derived: false })
    expect(crossRate(ecb, "USD", "IDR")?.rate).toBe("17891.09643328929987")
    expect(crossRate(ecb, "EUR", "INR")?.rate).toBe("108.8205")
  })

  it("is null when a side is missing — never 1 — and derives a pegged side only when allowed", () => {
    expect(crossRate(ecb, "AED", "INR")).toBeNull()
    expect(crossRate(ecb, "AED", "INR", true)).toEqual({ rate: "26.09526875551355", derived: true })
    expect(crossRate(ecb, "PKR", "INR", true)).toBeNull()
    expect(crossRate({ ...ecb, rates: { INR: 108.8205 } }, "AED", "INR", true)).toBeNull()
  })

  it("is null when the rate underflows the 14 places the store keeps", () => {
    expect(crossRate({ anchor: "EUR", date: "2026-09-30", rates: { XXX: 1e20 } }, "XXX", "EUR")).toBeNull()
  })
})
