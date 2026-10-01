import Decimal from "decimal.js"
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

// ── Cross rates from one anchor table ────────────────────────────────────────

/**
 * One provider observation: units of each currency per ONE `anchor` unit on
 * `date` (the anchor itself is implicitly 1). Every provider is read through a
 * table like this, never as "base=<weak currency>": a vendor quoting IDR->USD
 * directly rounds it to 5.6e-05 (0.19% off), while EUR->IDR and EUR->USD both
 * carry full precision and their quotient, taken here in Decimal, does too.
 */
export type RateTable = Readonly<{ anchor: string; date: string; rates: Readonly<Record<string, number | string>> }>

/**
 * Units of the currency per ONE US dollar, for currencies held at a fixed peg.
 * Used ONLY when no provider answers for the currency itself, and the stored
 * row is then marked (provider "<name>+peg"), never passed off as a quote.
 * ponytail: assumes each peg held for the whole history we backfill (all of
 * these date from 2001 or earlier); a re-peg needs a dated entry here.
 */
export const USD_PEGS: Readonly<Record<string, string>> = { AED: "3.6725", SAR: "3.75", QAR: "3.64", OMR: "0.3845", BHD: "0.376", JOD: "0.709" }

export const hasPeg = (code: string) => code in USD_PEGS

function unitsPerAnchor(table: RateTable, code: string, pegs: boolean): { units: Decimal; derived: boolean } | null {
  if (code === table.anchor) return { units: new Decimal(1), derived: false }
  const raw = table.rates[code]
  if (raw != null && Number(raw) > 0) return { units: new Decimal(raw), derived: false }
  if (pegs && hasPeg(code)) {
    const usd = unitsPerAnchor(table, "USD", false)
    if (usd) return { units: usd.units.times(USD_PEGS[code]), derived: true }
  }
  return null
}

/**
 * base->quote (quote units per ONE base unit) from an anchor table, in Decimal
 * to the 14 places fx_rate_snapshots.rate keeps. Null when the table lacks a
 * side (or the result underflows 14 places) — never 1, never a guess. With
 * `pegs`, a missing pegged side is derived from USD and `derived` says so.
 */
export function crossRate(table: RateTable, base: string, quote: string, pegs = false): { rate: DecimalString; derived: boolean } | null {
  const b = unitsPerAnchor(table, base, pegs)
  const q = unitsPerAnchor(table, quote, pegs)
  if (!b || !q) return null
  const rate = q.units.div(b.units).toDecimalPlaces(14)
  if (rate.lte(0)) return null
  return { rate: rate.toFixed() as DecimalString, derived: b.derived || q.derived }
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
