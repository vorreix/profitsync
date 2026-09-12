import { describe, expect, it, vi } from "vitest"
import { CachedFxRateProvider, type FxQuote, type FxRateProvider } from "./fx-provider"

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
