// Exchange rates: providers, the durable snapshot cache, and the two questions
// the app asks — "what is X worth in Y today?" and "make sure every day of this
// workspace's ledger has a rate" (so SQL can convert each row at its own date
// through reporting_amount(), mig 0074).
//
// Privacy: a provider receives a currency pair and a date. Never an amount, an
// account name or a description. Conversion happens here or in SQL.
//
// Rate purposes stay distinct (docs/multi-currency/ARCHITECTURE.md, section F):
//   market      = today's consolidated wealth (fx_rate_snapshots source 'market')
//   historical  = a row converted at its own date ('historical_market'; weekend
//                 and holiday gaps are carried forward and marked is_fallback)
//   effective   = what a cross-currency transfer ACTUALLY got — lives on the
//                 transfers row, never here.
//
// NOTE: relative imports keep the .js extension (unbundled ESM on @vercel/node).
import { and, eq, gte, lte, sql } from "drizzle-orm"
import Decimal from "decimal.js"
import { db } from "../../src/lib/db/index.js"
import { fxRateSnapshots, organizations } from "../../src/lib/db/schema.js"
import { normalizeCurrencyCode } from "../../src/lib/money.js"
import { todayIso } from "../../src/lib/recurring.js"
import { CachedFxRateProvider, type FxQuote, type FxRateProvider } from "./fx-provider.js"

const FETCH_TIMEOUT_MS = 4000
/** A market snapshot older than this is refreshed on the next current-rate ask. */
const CURRENT_MAX_AGE_MS = 12 * 60 * 60 * 1000
/** Never backfill further back than this. */
const MAX_HISTORY_DAYS = 366 * 6
/** Remember that a provider does not serve a pair, so a hot path is not re-asked on every request. */
const UNSUPPORTED_TTL_MS = 10 * 60 * 1000

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000))
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export class FxUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FxUnavailable"
  }
}

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } })
    if (!res.ok) throw new FxUnavailable(`${res.status} from ${new URL(url).host}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ── Providers ────────────────────────────────────────────────────────────────

/** Frankfurter (ECB reference rates, no key): current, one day, and day ranges. */
export class FrankfurterProvider implements FxRateProvider {
  readonly name = "frankfurter"
  private readonly host = process.env.FX_FRANKFURTER_HOST ?? "https://api.frankfurter.dev/v1"

  async getCurrentRate(base: string, quote: string): Promise<FxQuote> {
    const data = (await getJson(`${this.host}/latest?base=${base}&symbols=${quote}`)) as { date?: string; rates?: Record<string, number> }
    const rate = data.rates?.[quote]
    if (!rate || !data.date) throw new FxUnavailable(`frankfurter has no ${base}/${quote}`)
    return { baseCurrency: base, quoteCurrency: quote, rate: String(rate) as FxQuote["rate"], rateDate: data.date, observedAt: new Date().toISOString(), provider: this.name, sourceType: "market", isFallback: false }
  }

  async getHistoricalRate(base: string, quote: string, date: string): Promise<FxQuote> {
    const data = (await getJson(`${this.host}/${date}?base=${base}&symbols=${quote}`)) as { date?: string; rates?: Record<string, number> }
    const rate = data.rates?.[quote]
    if (!rate || !data.date) throw new FxUnavailable(`frankfurter has no ${base}/${quote} on ${date}`)
    return { baseCurrency: base, quoteCurrency: quote, rate: String(rate) as FxQuote["rate"], rateDate: data.date, observedAt: new Date().toISOString(), provider: this.name, sourceType: "historical_market", isFallback: false }
  }

  /** Business-day series, date -> rate. Empty when the pair is unsupported. */
  async getSeries(base: string, quote: string, from: string, to: string): Promise<Map<string, string>> {
    const data = (await getJson(`${this.host}/${from}..${to}?base=${base}&symbols=${quote}`)) as { rates?: Record<string, Record<string, number>> }
    const out = new Map<string, string>()
    for (const [day, rates] of Object.entries(data.rates ?? {})) if (rates?.[quote]) out.set(day, String(rates[quote]))
    return out
  }
}

/** open.er-api.com (no key, ~160 currencies incl. AED/SAR): current rates only. */
export class OpenErApiProvider implements FxRateProvider {
  readonly name = "open-er-api"
  private readonly host = process.env.FX_OPEN_ER_API_HOST ?? "https://open.er-api.com/v6"

  async getCurrentRate(base: string, quote: string): Promise<FxQuote> {
    const data = (await getJson(`${this.host}/latest/${base}`)) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    const rate = data.rates?.[quote]
    if (data.result !== "success" || !rate) throw new FxUnavailable(`open.er-api has no ${base}/${quote}`)
    const observed = data.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date()
    return { baseCurrency: base, quoteCurrency: quote, rate: String(rate) as FxQuote["rate"], rateDate: isoDay(observed), observedAt: observed.toISOString(), provider: this.name, sourceType: "market", isFallback: false }
  }

  async getHistoricalRate(base: string, quote: string, date: string): Promise<FxQuote> {
    throw new FxUnavailable(`open.er-api serves no history (${base}/${quote} on ${date})`)
  }
}

/** Frankfurter first (it has history), open.er-api for the pairs the ECB does not publish. */
class ChainedProvider implements FxRateProvider {
  readonly name = "chain"
  constructor(private readonly chain: FxRateProvider[]) {}
  async getCurrentRate(base: string, quote: string): Promise<FxQuote> {
    let last: unknown
    for (const p of this.chain) {
      try {
        return await p.getCurrentRate(base, quote)
      } catch (e) {
        last = e
      }
    }
    throw last instanceof Error ? last : new FxUnavailable("no provider")
  }
  async getHistoricalRate(base: string, quote: string, date: string): Promise<FxQuote> {
    let last: unknown
    for (const p of this.chain) {
      try {
        return await p.getHistoricalRate(base, quote, date)
      } catch (e) {
        last = e
      }
    }
    throw last instanceof Error ? last : new FxUnavailable("no provider")
  }
}

const frankfurter = new FrankfurterProvider()
const provider: FxRateProvider = new CachedFxRateProvider(new ChainedProvider([frankfurter, new OpenErApiProvider()]))
const networkDisabled = () => process.env.FX_DISABLED === "1" || process.env.FX_DISABLED === "true"
const unsupportedUntil = new Map<string, number>()

// ── Snapshot persistence ─────────────────────────────────────────────────────

type SnapshotInput = { base: string; quote: string; rate: string; rateDate: string; provider: string; sourceType: "market" | "historical_market" | "manual"; isFallback: boolean; observedAt: string }

async function storeSnapshot(q: SnapshotInput): Promise<void> {
  await db
    .insert(fxRateSnapshots)
    .values({
      baseCurrency: q.base,
      quoteCurrency: q.quote,
      rate: q.rate,
      rateDate: q.rateDate,
      provider: q.provider,
      sourceType: q.sourceType,
      isFallback: q.isFallback,
      observedAt: new Date(q.observedAt),
    })
    .onConflictDoNothing()
}

export type RateLookup = {
  base: string
  quote: string
  /** Quote units per ONE base unit, as a decimal string. */
  rate: string
  rateDate: string
  provider: string
  /** True when this is not today's observation (offline, provider down, weekend). */
  stale: boolean
}

/**
 * Today's market rate for base->quote, from the durable snapshot when it is
 * fresh, otherwise from the provider (and stored). Falls back to the latest
 * stored observation (marked stale) and finally to null — never to 1.
 */
export async function currentRate(baseInput: string, quoteInput: string): Promise<RateLookup | null> {
  const base = normalizeCurrencyCode(baseInput)
  const quote = normalizeCurrencyCode(quoteInput)
  if (base === quote) return { base, quote, rate: "1", rateDate: todayIso(), provider: "identity", stale: false }
  const today = todayIso()

  const [fresh] = await db
    .select()
    .from(fxRateSnapshots)
    .where(and(eq(fxRateSnapshots.baseCurrency, base), eq(fxRateSnapshots.quoteCurrency, quote), eq(fxRateSnapshots.rateDate, today), eq(fxRateSnapshots.sourceType, "market")))
    .orderBy(sql`${fxRateSnapshots.fetchedAt} desc`)
    .limit(1)
  if (fresh && Date.now() - new Date(fresh.fetchedAt).getTime() < CURRENT_MAX_AGE_MS) {
    return { base, quote, rate: fresh.rate, rateDate: fresh.rateDate, provider: fresh.provider, stale: false }
  }

  const key = `${base}/${quote}`
  if (!networkDisabled() && (unsupportedUntil.get(key) ?? 0) < Date.now()) {
    try {
      const q = await provider.getCurrentRate(base, quote)
      // The provider's own date may lag (ECB publishes mid-afternoon, weekends
      // carry Friday). Store it under TODAY as the market observation, and under
      // its own date for history, so both lookups are exact.
      await storeSnapshot({ base, quote, rate: q.rate, rateDate: today, provider: q.provider, sourceType: "market", isFallback: q.rateDate !== today, observedAt: q.observedAt })
      if (q.rateDate !== today) await storeSnapshot({ base, quote, rate: q.rate, rateDate: q.rateDate, provider: q.provider, sourceType: "historical_market", isFallback: false, observedAt: q.observedAt })
      return { base, quote, rate: q.rate, rateDate: q.rateDate, provider: q.provider, stale: false }
    } catch {
      unsupportedUntil.set(key, Date.now() + UNSUPPORTED_TTL_MS)
    }
  }

  // Offline / unsupported: the newest thing we know, honestly labelled stale.
  const latestRows = await db.execute(sql`
    select rate, rate_date, provider from fx_rate_snapshots
      where base_currency = ${base} and quote_currency = ${quote} and rate_date <= ${today}
    union all
    select (1 / rate) as rate, rate_date, provider from fx_rate_snapshots
      where base_currency = ${quote} and quote_currency = ${base} and rate_date <= ${today} and rate > 0
    order by rate_date desc limit 1
  `)
  const latest = (latestRows.rows as Array<{ rate: string; rate_date: string; provider: string }>)[0]
  if (!latest) return null
  return { base, quote, rate: new Decimal(latest.rate).toDecimalPlaces(14).toFixed(), rateDate: String(latest.rate_date).slice(0, 10), provider: latest.provider, stale: true }
}

/** Explicit conversion; the caller decides what a null rate means for its report. */
export function convertAmount(amount: Decimal.Value, rate: RateLookup): Decimal {
  return new Decimal(amount).times(rate.rate).toDecimalPlaces(2)
}

// ── Historical coverage ──────────────────────────────────────────────────────

/**
 * Make sure base->quote has ONE stored rate for EVERY calendar day in [from,
 * today]. Business days come from the provider's series; weekends and holidays
 * are carried forward from the previous observation and marked is_fallback, so
 * fx_rate_on() is exact per day and this check is a simple count.
 */
export async function ensureHistoricalRates(baseInput: string, quoteInput: string, fromInput: string): Promise<{ covered: boolean }> {
  const base = normalizeCurrencyCode(baseInput)
  const quote = normalizeCurrencyCode(quoteInput)
  if (base === quote) return { covered: true }
  const today = todayIso()
  const floor = addDays(today, -MAX_HISTORY_DAYS)
  const from = fromInput < floor ? floor : fromInput
  const expected = daysBetween(from, today) + 1
  if (expected <= 0) return { covered: true }

  const [{ have }] = await db
    .select({ have: sql<number>`count(distinct ${fxRateSnapshots.rateDate})::int` })
    .from(fxRateSnapshots)
    .where(and(eq(fxRateSnapshots.baseCurrency, base), eq(fxRateSnapshots.quoteCurrency, quote), gte(fxRateSnapshots.rateDate, from), lte(fxRateSnapshots.rateDate, today)))
  if (have >= expected) return { covered: true }

  const key = `series:${base}/${quote}`
  if (networkDisabled() || (unsupportedUntil.get(key) ?? 0) > Date.now()) return { covered: false }
  let series: Map<string, string>
  try {
    // Start a week early so the first days of the range have something to carry forward.
    series = await frankfurter.getSeries(base, quote, addDays(from, -7), today)
  } catch {
    unsupportedUntil.set(key, Date.now() + UNSUPPORTED_TTL_MS)
    return { covered: false }
  }
  if (series.size === 0) {
    unsupportedUntil.set(key, Date.now() + UNSUPPORTED_TTL_MS)
    return { covered: false }
  }
  const observedAt = new Date().toISOString()
  let carry: string | null = null
  for (let d = addDays(from, -7); d <= today; d = addDays(d, 1)) {
    const real = series.get(d)
    if (real) carry = real
    if (d < from || !carry) continue
    await storeSnapshot({ base, quote, rate: carry, rateDate: d, provider: frankfurter.name, sourceType: "historical_market", isFallback: !real, observedAt })
  }
  return { covered: true }
}

/**
 * Every foreign currency this workspace holds or has ever transacted in gets a
 * full daily series up to today, plus a fresh market rate. Best effort and
 * idempotent; callers that render numbers await it, then read the count of
 * rows reporting_amount() could not convert from the SQL side.
 */
export async function ensureRatesForOrg(orgId: string, reportingInput: string): Promise<{ currencies: string[]; uncovered: string[] }> {
  const reporting = normalizeCurrencyCode(reportingInput)
  const result = await db.execute(sql`
    select cur, min(first_date)::text as first_date from (
      select t.currency_code as cur, min(t.date) as first_date
        from transactions t join clients c on c.id = t.client_id
        where c.organization_id = ${orgId} and t.currency_code is not null and t.currency_code <> ${reporting}
        group by t.currency_code
      union all
      select wa.currency_code as cur, current_date as first_date
        from wealth_accounts wa
        where wa.organization_id = ${orgId} and wa.currency_code is not null and wa.currency_code <> ${reporting}
        group by wa.currency_code
    ) x group by cur
  `)
  const rows = result.rows as Array<{ cur: string; first_date: string }>
  const uncovered: string[] = []
  for (const row of rows) {
    const cur = row.cur.toUpperCase()
    const [hist, current] = await Promise.all([
      ensureHistoricalRates(cur, reporting, String(row.first_date).slice(0, 10)).catch(() => ({ covered: false })),
      currentRate(cur, reporting).catch(() => null),
    ])
    if (!hist.covered || !current) uncovered.push(cur)
  }
  return { currencies: rows.map((r) => r.cur.toUpperCase()), uncovered }
}

/** The organization's reporting currency (falls back to the legacy column). */
export async function reportingCurrencyFor(orgId: string): Promise<string> {
  const [org] = await db
    .select({ reporting: organizations.reportingCurrency, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
  return normalizeCurrencyCode(org?.reporting ?? org?.currency ?? "USD")
}
