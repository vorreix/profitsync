import { decimalFxRate, normalizeCurrencyCode, type DecimalString } from "../../src/lib/money.js"

export type FxSourceType = "market" | "historical_market"

export type FxQuote = Readonly<{
  baseCurrency: string
  quoteCurrency: string
  rate: DecimalString
  rateDate: string
  observedAt: string
  provider: string
  sourceType: FxSourceType
  isFallback: boolean
}>

/** Vendors receive currency codes and a date only—never balances or descriptions. */
export interface FxRateProvider {
  readonly name: string
  getCurrentRate(baseCurrency: string, quoteCurrency: string): Promise<FxQuote>
  getHistoricalRate(baseCurrency: string, quoteCurrency: string, date: string): Promise<FxQuote>
}

type Clock = () => number

/** Process-local request coalescing/TTL cache; persisted snapshots remain the durable cache. */
export class CachedFxRateProvider implements FxRateProvider {
  readonly name: string
  private readonly values = new Map<string, { quote: FxQuote; expiresAt: number }>()
  private readonly inFlight = new Map<string, Promise<FxQuote>>()

  constructor(
    private readonly delegate: FxRateProvider,
    private readonly currentTtlMs = 60 * 60 * 1000,
    private readonly clock: Clock = Date.now,
  ) {
    this.name = delegate.name
  }

  getCurrentRate(baseCurrency: string, quoteCurrency: string): Promise<FxQuote> {
    return this.get("current", baseCurrency, quoteCurrency, undefined)
  }

  getHistoricalRate(baseCurrency: string, quoteCurrency: string, date: string): Promise<FxQuote> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Promise.reject(new RangeError("FX date must be YYYY-MM-DD"))
    return this.get(`historical:${date}`, baseCurrency, quoteCurrency, date)
  }

  private get(kind: string, baseInput: string, quoteInput: string, date: string | undefined): Promise<FxQuote> {
    const base = normalizeCurrencyCode(baseInput)
    const quote = normalizeCurrencyCode(quoteInput)
    if (base === quote) {
      const day = date ?? new Date(this.clock()).toISOString().slice(0, 10)
      return Promise.resolve({
        baseCurrency: base,
        quoteCurrency: quote,
        rate: decimalFxRate(base, quote, "1").rate,
        rateDate: day,
        observedAt: new Date(this.clock()).toISOString(),
        provider: "identity",
        sourceType: date ? "historical_market" : "market",
        isFallback: false,
      })
    }
    const key = `${kind}:${base}:${quote}`
    const cached = this.values.get(key)
    if (cached && cached.expiresAt > this.clock()) return Promise.resolve(cached.quote)
    const pending = this.inFlight.get(key)
    if (pending) return pending
    const request = (date
      ? this.delegate.getHistoricalRate(base, quote, date)
      : this.delegate.getCurrentRate(base, quote))
      .then((raw) => {
        const rate = decimalFxRate(base, quote, raw.rate)
        const quoteValue = Object.freeze({ ...raw, baseCurrency: rate.baseCurrency, quoteCurrency: rate.quoteCurrency, rate: rate.rate })
        // Historical snapshots are immutable and can stay cached for the process lifetime.
        this.values.set(key, { quote: quoteValue, expiresAt: date ? Number.POSITIVE_INFINITY : this.clock() + this.currentTtlMs })
        return quoteValue
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, request)
    return request
  }
}
