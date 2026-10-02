// Exchange rates: providers, the durable snapshot cache, and the two questions
// the app asks — "what is X worth in Y today?" and "make sure every day of this
// workspace's ledger has a rate" (so SQL can convert each row at its own date
// through reporting_amount(), mig 0074).
//
// Privacy: a provider receives a currency pair and a date. Never an amount, an
// account name or a description. Conversion happens here or in SQL.
//
// Rate purposes stay distinct (docs/multi-currency/ARCHITECTURE.md, section F):
//   market      = today's consolidated wealth: `currentRate`, the ONE
//                 definition every current valuation uses (wealth summary,
//                 debts, budgets overview, the transfer suggestion)
//   historical  = a row converted at its own date ('historical_market'; weekend
//                 and holiday gaps are carried forward, at most CARRY_MAX_DAYS,
//                 and marked is_fallback)
//   effective   = what a cross-currency transfer ACTUALLY got — lives on the
//                 transfers row, never here.
//
// Every observation is stored under its REAL date (a Tuesday ECB quote read on
// Wednesday morning is Tuesday's rate), and only these provider fetches write
// the table — no endpoint lets a user put a rate into it.
//
// Providers, in order: Frankfurter (ECB reference rates, ~30 currencies, back
// to 1999), the daily currency-api archive (every fiat currency, one file per
// day since 2024-03-02), open.er-api (latest only), then a fixed USD peg
// (AED, SAR, …) derived from the ECB's USD rate and marked "+peg".
//
// NOTE: relative imports keep the .js extension (unbundled ESM on @vercel/node).
import { and, eq, gte, lte, sql } from "drizzle-orm"
import Decimal from "decimal.js"
import { db } from "../../src/lib/db/index.js"
import { fxRateSnapshots, organizations } from "../../src/lib/db/schema.js"
import { normalizeCurrencyCode, type DecimalString } from "../../src/lib/money.js"
import { todayIso } from "../../src/lib/recurring.js"
import { CachedFxRateProvider, crossRate, hasPeg, type FxQuote, type FxRateProvider, type FxSourceType, type RateTable } from "./fx-provider.js"

const FETCH_TIMEOUT_MS = 4000
/** A pair fetched less than this long ago is served from the store without asking the provider. */
const CURRENT_MAX_AGE_MS = 60 * 60 * 1000
/**
 * A stored rate may stand in for at most this many calendar days (weekends,
 * holidays, a provider outage). Older → no rate: the row is excluded and
 * counted, never converted at a weeks-old rate.
 */
export const CARRY_MAX_DAYS = 10
/** An observation older than this is flagged stale: a weekend plus a holiday is a normal publication lag, more is not. */
const STALE_AFTER_DAYS = 4
/** Default backfill floor for a direct `ensureHistoricalRates` call. The daily refresh and tooling reach further back (ECB data starts 1999-01-04) through `{ floor }`. */
const MAX_HISTORY_DAYS = 366 * 6
/** First day of the daily currency-api archive. */
const DAILY_FIRST_DAY = "2024-03-02"
/** Day files read from the daily archive per backfill call, newest first; older days follow on later calls (and stay excluded meanwhile). */
const MAX_DAILY_FETCHES = 62
const DAILY_CONCURRENCY = 8
/**
 * How long a request waits on the daily archive. Every report route awaits the
 * fill, so a slow or hanging archive must not hold a screen: what has not
 * answered by then is left for a later call (and excluded meanwhile). Tooling
 * (`floor`) waits for the whole batch.
 */
const ARCHIVE_BUDGET_MS = 3000
/** A pair goes back to the providers for the same set of gaps at most this often (per instance). */
const RECHECK_MS = 60 * 60 * 1000
/** Remember that a provider does not serve a pair, so a hot path is not re-asked on every request. */
const UNSUPPORTED_TTL_MS = 10 * 60 * 1000

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000))
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export class FxUnavailable extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = "FxUnavailable"
  }
}

/**
 * The provider ANSWERED that it does not serve this (an unknown currency, no
 * file for the day). A timeout, a network error or a 5xx is not an answer:
 * asking the same host again in another form would only double the wait.
 */
const saidNo = (e: unknown) => e instanceof FxUnavailable && !(e.status != null && e.status >= 500)

// ── Provider health (MC-127) ─────────────────────────────────────────────────
// Every provider call goes through getJson, so this is the one place a failure
// is seen — the fallbacks above it swallow errors by design (the next provider
// answers). Counted per provider for /admin → Worker → Exchange rates. In
// memory, so per server instance since it started.
// ponytail: per-instance counters; persist them if cross-instance totals are ever needed.

type ProviderHealth = { ok: number; refused: number; failed: number; lastOkAt: string | null; lastError: string | null; lastErrorAt: string | null }
const health = new Map<string, ProviderHealth>()
const healthSince = new Date().toISOString()
const WARN_EVERY_MS = 60 * 1000

function record(provider: string, url: string, e?: unknown): void {
  let h = health.get(provider)
  if (!h) health.set(provider, (h = { ok: 0, refused: 0, failed: 0, lastOkAt: null, lastError: null, lastErrorAt: null }))
  const now = new Date().toISOString()
  if (e === undefined) {
    h.ok++
    h.lastOkAt = now
  } else if (e instanceof FxUnavailable && (e.status == null || e.status === 404 || e.status === 422)) {
    // An answer ("no such pair", "no file for that day") is not an outage.
    // Narrower than saidNo on purpose: a 401/403/429 is the provider refusing
    // US (a revoked key, throttling) — exactly what this panel must surface.
    h.refused++
  } else {
    h.failed++
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    // One line a minute per provider: an outage during a backfill would
    // otherwise log every day file. The URL carries a pair and a date, never an amount.
    if (!h.lastErrorAt || Date.now() - Date.parse(h.lastErrorAt) > WARN_EVERY_MS) {
      const u = new URL(url)
      console.warn("[fx] provider failed", { provider, path: `${u.pathname}${u.search}`, message })
    }
    h.lastError = message
    h.lastErrorAt = now
  }
}

/** Provider call outcomes on THIS server instance since it started. */
export function fxProviderHealth(): { since: string; providers: Record<string, ProviderHealth> } {
  return { since: healthSince, providers: Object.fromEntries([...health].map(([k, v]) => [k, { ...v }])) }
}

async function getJson(url: string, provider: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } })
    if (!res.ok) throw new FxUnavailable(`${res.status} from ${new URL(url).host}`, res.status)
    const body = await res.json()
    record(provider, url)
    return body
  } catch (e) {
    record(provider, url, e)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

const quoteOf = (base: string, quote: string, rate: DecimalString, rateDate: string, provider: string, sourceType: FxSourceType, observedAt = new Date().toISOString()): FxQuote =>
  ({ baseCurrency: base, quoteCurrency: quote, rate, rateDate, observedAt, provider, sourceType, isFallback: false })

// ── Providers ────────────────────────────────────────────────────────────────
// Each reads an EUR-anchored table and crosses the pair in Decimal (MC-102):
// asking a vendor for "base=IDR" returns 5.6e-05, 0.19% off the true rate.

type FrankfurterDay = { date?: string; rates?: Record<string, number> }

/** Frankfurter (ECB reference rates, no key): current, one day, and day ranges back to 1999. */
export class FrankfurterProvider implements FxRateProvider {
  readonly name = "frankfurter"
  private readonly host = process.env.FX_FRANKFURTER_HOST ?? "https://api.frankfurter.dev/v1"

  /** Both sides against EUR (the ECB's own quotes); a pegged side asks for USD instead. */
  private url(path: string, base: string, quote: string, pegs: boolean): string {
    const symbols = [...new Set([base, quote].map((c) => (pegs && hasPeg(c) ? "USD" : c)))].filter((c) => c !== "EUR")
    return `${this.host}/${path}?base=EUR&symbols=${symbols.join(",")}`
  }

  private async day(path: string, base: string, quote: string, sourceType: FxSourceType, pegs: boolean): Promise<FxQuote> {
    const data = (await getJson(this.url(path, base, quote, pegs), this.name)) as FrankfurterDay
    const x = data.date && data.rates ? crossRate({ anchor: "EUR", date: data.date, rates: data.rates }, base, quote, pegs) : null
    if (!x || !data.date) throw new FxUnavailable(`frankfurter has no ${base}/${quote}`)
    return quoteOf(base, quote, x.rate, data.date, x.derived ? `${this.name}+peg` : this.name, sourceType)
  }

  getCurrentRate(base: string, quote: string, pegs = false): Promise<FxQuote> {
    return this.day("latest", base, quote, "market", pegs)
  }

  getHistoricalRate(base: string, quote: string, date: string, pegs = false): Promise<FxQuote> {
    return this.day(date, base, quote, "historical_market", pegs)
  }

  /** Business-day series, date -> rate. Empty when the pair is unsupported. */
  async getSeries(base: string, quote: string, from: string, to: string, pegs = false): Promise<Map<string, string>> {
    const data = (await getJson(this.url(`${from}..${to}`, base, quote, pegs), this.name)) as { rates?: Record<string, Record<string, number>> }
    const out = new Map<string, string>()
    for (const [day, rates] of Object.entries(data.rates ?? {})) {
      const x = crossRate({ anchor: "EUR", date: day, rates }, base, quote, pegs)
      if (x) out.set(day, x.rate)
    }
    return out
  }
}

/**
 * The daily currency-api archive (fawazahmed0, no key): every fiat currency the
 * ECB does not publish (AED, SAR, PKR, LKR, …), one file per calendar day since
 * 2024-03-02, from jsDelivr with a Cloudflare Pages mirror.
 */
export class CurrencyApiProvider implements FxRateProvider {
  readonly name = "currency-api"
  private readonly host = process.env.FX_CURRENCY_API_HOST ?? "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api"
  /** One file serves every pair, so concurrent pairs share it. */
  private readonly tables = new Map<string, Promise<RateTable | null>>()

  /** The EUR table for `day` ('latest' allowed). Null = the archive has no file for that day; throws when unreachable. */
  table(day: string): Promise<RateTable | null> {
    const hit = this.tables.get(day)
    if (hit) return hit
    if (this.tables.size >= 200) this.tables.clear()
    const pending = this.fetchTable(day)
    this.tables.set(day, pending)
    // Kept only when it is a real, dated file: a failure is retried, "latest"
    // moves, and today's file may simply not be published yet.
    pending.then((t) => (!t || day === "latest") && this.tables.delete(day), () => this.tables.delete(day))
    return pending
  }

  private async fetchTable(day: string): Promise<RateTable | null> {
    let notFound = false
    for (const url of [`${this.host}@${day}/v1/currencies/eur.json`, `https://${day}.currency-api.pages.dev/v1/currencies/eur.json`]) {
      try {
        const data = (await getJson(url, this.name)) as { date?: string; eur?: Record<string, number> }
        if (!data.date || !data.eur) continue
        const rates: Record<string, number> = {}
        // The archive also lists crypto tokens; only ISO-shaped codes matter here.
        for (const [code, v] of Object.entries(data.eur)) if (/^[a-z]{3}$/.test(code)) rates[code.toUpperCase()] = v
        return { anchor: "EUR", date: data.date, rates }
      } catch (e) {
        if (e instanceof FxUnavailable && e.status === 404) notFound = true
      }
    }
    if (notFound) return null
    throw new FxUnavailable(`currency-api unreachable for ${day}`, 503)
  }

  private async day(day: string, base: string, quote: string, sourceType: FxSourceType, pegs: boolean): Promise<FxQuote> {
    const t = await this.table(day)
    const x = t ? crossRate(t, base, quote, pegs) : null
    if (!t || !x) throw new FxUnavailable(`currency-api has no ${base}/${quote} for ${day}`)
    return quoteOf(base, quote, x.rate, t.date, x.derived ? `${this.name}+peg` : this.name, sourceType)
  }

  getCurrentRate(base: string, quote: string, pegs = false): Promise<FxQuote> {
    return this.day("latest", base, quote, "market", pegs)
  }

  getHistoricalRate(base: string, quote: string, date: string, pegs = false): Promise<FxQuote> {
    return this.day(date, base, quote, "historical_market", pegs)
  }

  /**
   * One rate per requested day: the rate, or null when the archive answered
   * that it has nothing for that day. A day it could not be reached for, or
   * that had not answered by `deadline` (epoch ms), is left out, so nothing is
   * ever carried into an outage.
   */
  async getDays(base: string, quote: string, days: string[], deadline = Number.POSITIVE_INFINITY): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>()
    const all = (async () => {
      for (let i = 0; i < days.length && Date.now() < deadline; i += DAILY_CONCURRENCY) {
        await Promise.all(
          days.slice(i, i + DAILY_CONCURRENCY).map(async (d) => {
            try {
              const t = await this.table(d)
              out.set(d, t && t.date === d ? (crossRate(t, base, quote)?.rate ?? null) : null)
            } catch {
              // unreachable: not answered
            }
          }),
        )
      }
    })()
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<void>((resolve) => {
      if (Number.isFinite(deadline)) timer = setTimeout(resolve, Math.max(0, deadline - Date.now()))
    })
    await Promise.race([all, late])
    clearTimeout(timer)
    // A copy: files still in flight land in the shared table cache for the next call, not in this answer.
    return new Map(out)
  }
}

/** open.er-api.com (no key, ~160 currencies incl. AED/SAR): current rates only. */
export class OpenErApiProvider implements FxRateProvider {
  readonly name = "open-er-api"
  private readonly host = process.env.FX_OPEN_ER_API_HOST ?? "https://open.er-api.com/v6"

  async getCurrentRate(base: string, quote: string, pegs = false): Promise<FxQuote> {
    const data = (await getJson(`${this.host}/latest/EUR`, this.name)) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    const observed = data.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date()
    const x = data.result === "success" && data.rates ? crossRate({ anchor: "EUR", date: isoDay(observed), rates: data.rates }, base, quote, pegs) : null
    if (!x) throw new FxUnavailable(`open.er-api has no ${base}/${quote}`)
    return quoteOf(base, quote, x.rate, isoDay(observed), x.derived ? `${this.name}+peg` : this.name, "market", observed.toISOString())
  }

  async getHistoricalRate(base: string, quote: string, date: string): Promise<FxQuote> {
    throw new FxUnavailable(`open.er-api serves no history (${base}/${quote} on ${date})`)
  }
}

type PeggableProvider = {
  getCurrentRate(base: string, quote: string, pegs?: boolean): Promise<FxQuote>
  getHistoricalRate(base: string, quote: string, date: string, pegs?: boolean): Promise<FxQuote>
}

/**
 * The first provider that answers. Every provider is asked for the currency
 * itself first; a fixed peg is derived only when none of them can quote it,
 * and only by a provider that answered (an unreachable host cannot derive one
 * either, and re-asking it would only double the wait).
 */
export class ChainedProvider implements FxRateProvider {
  readonly name = "chain"
  constructor(private readonly chain: PeggableProvider[]) {}

  private async first(base: string, quote: string, ask: (p: PeggableProvider, pegs: boolean) => Promise<FxQuote>): Promise<FxQuote> {
    let last: unknown
    const answered: PeggableProvider[] = []
    for (const p of this.chain) {
      try {
        return await ask(p, false)
      } catch (e) {
        last = e
        if (saidNo(e)) answered.push(p)
      }
    }
    if (hasPeg(base) || hasPeg(quote)) {
      for (const p of answered) {
        try {
          return await ask(p, true)
        } catch (e) {
          last = e
        }
      }
    }
    throw last instanceof Error ? last : new FxUnavailable("no provider")
  }

  getCurrentRate(base: string, quote: string): Promise<FxQuote> {
    return this.first(base, quote, (p, pegs) => p.getCurrentRate(base, quote, pegs))
  }

  getHistoricalRate(base: string, quote: string, date: string): Promise<FxQuote> {
    return this.first(base, quote, (p, pegs) => p.getHistoricalRate(base, quote, date, pegs))
  }
}

const frankfurter = new FrankfurterProvider()
const currencyApi = new CurrencyApiProvider()
const provider: FxRateProvider = new CachedFxRateProvider(new ChainedProvider([frankfurter, currencyApi, new OpenErApiProvider()]))
const networkDisabled = () => process.env.FX_DISABLED === "1" || process.env.FX_DISABLED === "true"
const unsupportedUntil = new Map<string, number>()

// ── Snapshot persistence ─────────────────────────────────────────────────────

type SnapshotInput = { base: string; quote: string; rate: string; rateDate: string; provider: string; sourceType: "market" | "historical_market" | "manual"; isFallback: boolean; observedAt: string }

/**
 * Upsert, in chunks. A real observation always replaces what is stored for its
 * key (a placeholder written before the ECB published that day must not stay
 * frozen at the previous day's value — MC-097); a placeholder replaces only
 * another placeholder, never a real observation. Either way fetched_at moves,
 * which is what "fetched recently" and "settled" are read from.
 */
async function storeSnapshots(rows: SnapshotInput[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(fxRateSnapshots)
      .values(
        rows.slice(i, i + 500).map((q) => ({
          baseCurrency: q.base,
          quoteCurrency: q.quote,
          rate: q.rate,
          rateDate: q.rateDate,
          provider: q.provider,
          sourceType: q.sourceType,
          isFallback: q.isFallback,
          observedAt: new Date(q.observedAt),
        })),
      )
      .onConflictDoUpdate({
        target: [fxRateSnapshots.baseCurrency, fxRateSnapshots.quoteCurrency, fxRateSnapshots.rateDate, fxRateSnapshots.provider, fxRateSnapshots.sourceType],
        set: { rate: sql`excluded.rate`, isFallback: sql`excluded.is_fallback`, observedAt: sql`excluded.observed_at`, fetchedAt: sql`now()` },
        setWhere: sql`${fxRateSnapshots.isFallback} or not excluded.is_fallback`,
      })
  }
}

export type RateLookup = {
  base: string
  quote: string
  /** Quote units per ONE base unit, as a decimal string. */
  rate: string
  /** The day the rate was actually observed — never today's date for an older quote. */
  rateDate: string
  provider: string
  /** True when the observation is older than a normal publication lag (STALE_AFTER_DAYS); the caller must say so. */
  stale: boolean
}

/**
 * The stored answer to "what is base worth in quote today": the newest REAL
 * observation (never a carried placeholder) of the pair, direct or inverted,
 * at most CARRY_MAX_DAYS old: newest day, then a manual rate, then the direct
 * pair over the inverse, then the latest fetch.
 * `lastFetch` = the latest fetch of the pair in either direction.
 */
async function storedCurrentRate(base: string, quote: string, today: string): Promise<{ rate: string; rateDate: string; provider: string; lastFetch: number } | null> {
  const floor = addDays(today, -CARRY_MAX_DAYS)
  const res = await db.execute(sql`
    select rate::text as rate, rate_date::text as rate_date, provider,
           (extract(epoch from max(fetched_at) over ()) * 1000)::float8 as last_fetch
      from (
        select rate, rate_date, provider, source_type, fetched_at, 1 as direct from fx_rate_snapshots
          where base_currency = ${base} and quote_currency = ${quote} and not is_fallback and rate_date between ${floor} and ${today}
        union all
        select 1 / rate, rate_date, provider, source_type, fetched_at, 0 from fx_rate_snapshots
          where base_currency = ${quote} and quote_currency = ${base} and not is_fallback and rate_date between ${floor} and ${today} and rate > 0
      ) s
     order by rate_date desc, (source_type = 'manual') desc, direct desc, fetched_at desc
     limit 1
  `)
  const row = (res.rows as Array<{ rate: string; rate_date: string; provider: string; last_fetch: number | string }>)[0]
  if (!row) return null
  return { rate: new Decimal(row.rate).toDecimalPlaces(14).toFixed(), rateDate: String(row.rate_date).slice(0, 10), provider: row.provider, lastFetch: Number(row.last_fetch) }
}

/**
 * Today's market rate for base->quote — the ONE definition of "today's rate"
 * for current valuations. Reads the store; asks the provider only when the
 * pair was not fetched in the last hour (and `refresh` is not false), stores
 * the answer under its real observation date, then answers from the store
 * again, so a provider answer and a stored one are never reported differently
 * (MC-101). Null when nothing at most CARRY_MAX_DAYS old exists — never 1.
 *
 * `refresh: false` = read-only (no provider call, no write), for callers that
 * must not make the server fetch arbitrary pairs (MC-169).
 */
export async function currentRate(baseInput: string, quoteInput: string, opts: { refresh?: boolean } = {}): Promise<RateLookup | null> {
  const base = normalizeCurrencyCode(baseInput)
  const quote = normalizeCurrencyCode(quoteInput)
  const today = todayIso()
  if (base === quote) return { base, quote, rate: "1", rateDate: today, provider: "identity", stale: false }

  let stored = await storedCurrentRate(base, quote, today)
  const key = `${base}/${quote}`
  const fresh = stored != null && Date.now() - stored.lastFetch < CURRENT_MAX_AGE_MS
  if (!fresh && opts.refresh !== false && !networkDisabled() && (unsupportedUntil.get(key) ?? 0) < Date.now()) {
    let q: FxQuote | null = null
    try {
      q = await provider.getCurrentRate(base, quote)
    } catch {
      unsupportedUntil.set(key, Date.now() + UNSUPPORTED_TTL_MS)
    }
    if (q && q.rateDate <= today) {
      await storeSnapshots([{ base, quote, rate: q.rate, rateDate: q.rateDate, provider: q.provider, sourceType: "market", isFallback: false, observedAt: q.observedAt }])
      stored = await storedCurrentRate(base, quote, today)
    }
  }
  if (!stored) return null
  return { base, quote, rate: stored.rate, rateDate: stored.rateDate, provider: stored.provider, stale: daysBetween(stored.rateDate, today) > STALE_AFTER_DAYS }
}

/** Explicit conversion; the caller decides what a null rate means for its report. */
export function convertAmount(amount: Decimal.Value, rate: RateLookup): Decimal {
  return new Decimal(amount).times(rate.rate).toDecimalPlaces(2)
}

// ── Historical coverage ──────────────────────────────────────────────────────

/** One carry-forward step: the newest observation on or before each day, used for at most CARRY_MAX_DAYS. */
export type DayRate = { rate: string; provider: string }

/**
 * The rows to write for `missing` days, walking [start, end] in order. A day
 * with an observation gets it; a day without one borrows the newest earlier
 * observation (stored `known` or fetched `obs`) — only when a provider
 * ANSWERED for that day (a weekend, a holiday: never an outage, which would
 * freeze a guess) and only for CARRY_MAX_DAYS. Pure, so it is tested alone.
 */
export function fillDays(input: { start: string; end: string; missing: Set<string>; obs: Map<string, DayRate>; known: Map<string, DayRate>; answered: Set<string> }): Array<DayRate & { day: string; isFallback: boolean }> {
  const out: Array<DayRate & { day: string; isFallback: boolean }> = []
  let carry: (DayRate & { day: string }) | null = null
  for (let d = input.start; d <= input.end; d = addDays(d, 1)) {
    const real = input.obs.get(d)
    const seen = real ?? input.known.get(d)
    if (seen) carry = { day: d, ...seen }
    if (!input.missing.has(d)) continue
    if (real) out.push({ day: d, ...real, isFallback: false })
    else if (carry && input.answered.has(d) && daysBetween(carry.day, d) <= CARRY_MAX_DAYS) out.push({ day: d, rate: carry.rate, provider: carry.provider, isFallback: true })
  }
  return out
}

/** True when `obs` has an observation on `day` or up to CARRY_MAX_DAYS before it. */
function observedWithin(obs: ReadonlyMap<string, unknown>, day: string): boolean {
  for (let k = 0; k <= CARRY_MAX_DAYS; k++) if (obs.has(addDays(day, -k))) return true
  return false
}

/**
 * The days to read from the daily archive: every missing day since the
 * archive starts that THIS call's ECB answer does not reach (a weekend after a
 * Friday quote is reached; a currency the ECB does not publish never is),
 * newest first, at most `max`. A stored row does not count: the day after it
 * still has its own file, and carrying the stored rate instead would convert
 * that day at an older rate while the exact one exists.
 */
export function archiveDays(missing: readonly string[], ecb: ReadonlyMap<string, unknown>, max = MAX_DAILY_FETCHES): string[] {
  return missing.filter((d) => d >= DAILY_FIRST_DAY && !observedWithin(ecb, d)).reverse().slice(0, max)
}

const inFlightFills = new Map<string, Promise<{ covered: boolean; written?: number }>>()
/** When a pair last went to the providers for a given set of gaps (see fillHistory). */
const attemptedAt = new Map<string, number>()

/**
 * Make sure base->quote has ONE stored rate for EVERY calendar day in [from,
 * today], so fx_rate_on() is exact per day. Concurrent callers for the same
 * pair share one fill. `floor` lets tooling backfill beyond the request path's
 * six years (MC-166) — the ECB series reaches 1999-01-04. `deadline` (epoch
 * ms) bounds the wait on the daily archive for a caller with a time budget
 * (the daily refresh); without it, a request waits ARCHIVE_BUDGET_MS and
 * tooling (`floor`) waits for the whole batch.
 */
// async: an invalid code must reject (callers .catch), not throw synchronously.
export async function ensureHistoricalRates(baseInput: string, quoteInput: string, fromInput: string, opts: { floor?: string; deadline?: number } = {}): Promise<{ covered: boolean; written?: number }> {
  const base = normalizeCurrencyCode(baseInput)
  const quote = normalizeCurrencyCode(quoteInput)
  if (base === quote) return { covered: true }
  const key = `${base}/${quote}/${fromInput}/${opts.floor ?? ""}`
  const pending = inFlightFills.get(key)
  if (pending) return pending
  const run = fillHistory(base, quote, fromInput, opts.floor, opts.deadline).finally(() => inFlightFills.delete(key))
  inFlightFills.set(key, run)
  return run
}

async function fillHistory(base: string, quote: string, fromInput: string, floorInput?: string, deadlineInput?: number): Promise<{ covered: boolean; written?: number }> {
  const today = todayIso()
  const floor = floorInput ?? addDays(today, -MAX_HISTORY_DAYS)
  const from = fromInput < floor ? floor : fromInput
  if (from > today) return { covered: true }

  // The days not yet SETTLED: no row, or only a placeholder that no fetch at
  // least two days later has confirmed (until then it may be a business day
  // the provider had simply not published yet — MC-097).
  const gaps = await db.execute(sql`
    select g.d::text as day,
           exists (select 1 from fx_rate_snapshots s where s.base_currency = ${base} and s.quote_currency = ${quote} and s.rate_date = g.d) as has_row
      from (select generate_series(${from}::date, ${today}::date, interval '1 day')::date as d) g
     where not exists (
       select 1 from fx_rate_snapshots s
        where s.base_currency = ${base} and s.quote_currency = ${quote} and s.rate_date = g.d
          and (not s.is_fallback or s.fetched_at::date > s.rate_date + 1))
     order by g.d
  `)
  const gapRows = gaps.rows as Array<{ day: string; has_row: boolean }>
  if (gapRows.length === 0) return { covered: true }
  const missing = gapRows.map((r) => String(r.day).slice(0, 10))
  const unfilled = gapRows.filter((r) => !r.has_row).map((r) => String(r.day).slice(0, 10))
  const pairKey = `${base}/${quote}`
  // One trip to the providers per pair and set of gaps per hour. Days no
  // source serves (a non-pegged currency before the archive) would otherwise
  // send every request back out, and confirming placeholders is hourly work.
  // A fill that made progress changes the gaps, so a backfill keeps going.
  const attemptKey = unfilled.length === 0 ? `${pairKey}|confirm` : `${pairKey}|${from}|${missing[0]}|${missing.length}|${unfilled.length}`
  if ((attemptedAt.get(attemptKey) ?? 0) > Date.now() - RECHECK_MS) return { covered: unfilled.length === 0 }
  if (networkDisabled() || (unsupportedUntil.get(`series:${pairKey}`) ?? 0) > Date.now()) return { covered: unfilled.length === 0 }

  // The real observations already stored around the gaps, to carry from.
  const start = addDays(missing[0], -CARRY_MAX_DAYS)
  const knownRows = await db
    .select({ day: sql<string>`${fxRateSnapshots.rateDate}::text`, rate: sql<string>`${fxRateSnapshots.rate}::text`, provider: fxRateSnapshots.provider })
    .from(fxRateSnapshots)
    .where(and(eq(fxRateSnapshots.baseCurrency, base), eq(fxRateSnapshots.quoteCurrency, quote), eq(fxRateSnapshots.isFallback, false), gte(fxRateSnapshots.rateDate, start), lte(fxRateSnapshots.rateDate, today)))
  const known = new Map<string, DayRate>()
  for (const r of knownRows) if (!known.has(r.day)) known.set(r.day, { rate: r.rate, provider: r.provider })

  const obs = new Map<string, DayRate>()
  const answered = new Set<string>()
  // 1. ECB reference rates: one request for the whole range, back to 1999.
  let ecbReachable = true
  const ecb = await frankfurter.getSeries(base, quote, start, today).catch((e: unknown) => {
    ecbReachable = saidNo(e)
    return null
  })
  if (ecb && ecb.size > 0) {
    for (const [d, rate] of ecb) obs.set(d, { rate, provider: frankfurter.name })
    for (let d = start; d <= today; d = addDays(d, 1)) answered.add(d)
  }

  // 2. What the ECB cannot cover (a currency it does not publish, or stopped
  //    publishing): the daily archive, newest days first, a bounded number per
  //    call and, on a request, a bounded wait.
  const asked = archiveDays(missing, obs)
  if (asked.length > 0) {
    const deadline = deadlineInput ?? (floorInput ? Number.POSITIVE_INFINITY : Date.now() + ARCHIVE_BUDGET_MS)
    for (const [d, rate] of await currencyApi.getDays(base, quote, asked, deadline)) {
      answered.add(d)
      if (rate) obs.set(d, { rate, provider: currencyApi.name })
    }
  }

  // 3. Last resort, for a pegged currency on days no provider quotes (before
  //    the archive, or it had nothing): the peg against the ECB's USD rate,
  //    marked. Never for a day the archive has not answered yet (past this
  //    call's batch or deadline) — that day waits for its own file.
  if ((hasPeg(base) || hasPeg(quote)) && ecbReachable) {
    const waiting = new Set(missing.filter((d) => d >= DAILY_FIRST_DAY && !answered.has(d)))
    const rest = missing.filter((d) => !waiting.has(d) && !observedWithin(obs, d))
    if (rest.length > 0) {
      const pegFrom = addDays(rest[0], -CARRY_MAX_DAYS)
      const pegTo = rest[rest.length - 1]
      const pegged = await frankfurter.getSeries(base, quote, pegFrom, pegTo, true).catch(() => null)
      if (pegged && pegged.size > 0) {
        for (const [d, rate] of pegged) if (!obs.has(d) && !known.has(d) && !waiting.has(d)) obs.set(d, { rate, provider: `${frankfurter.name}+peg` })
        for (let d = pegFrom; d <= pegTo; d = addDays(d, 1)) if (!waiting.has(d)) answered.add(d)
      }
    }
  }

  if (answered.size === 0) {
    // Nothing answered: remember the pair as unserved for a while — unless the
    // CALLER's deadline (the daily refresh's budget) cut the archive off before
    // it could answer. A provider that never got the chance has not said no,
    // and marking it would also skip every request-path top-up of the pair.
    if (!(asked.length > 0 && deadlineInput != null && Date.now() >= deadlineInput)) unsupportedUntil.set(`series:${pairKey}`, Date.now() + UNSUPPORTED_TTL_MS)
    return { covered: unfilled.length === 0 }
  }
  const observedAt = new Date().toISOString()
  const rows = fillDays({ start, end: today, missing: new Set(missing), obs, known, answered })
  await storeSnapshots(rows.map((r) => ({ base, quote, rate: r.rate, rateDate: r.day, provider: r.provider, sourceType: "historical_market" as const, isFallback: r.isFallback, observedAt })))
  if (attemptedAt.size >= 5000) attemptedAt.clear()
  attemptedAt.set(attemptKey, Date.now())
  // `written` counts only days that had no row before, so a caller looping until
  // nothing more fills (scripts/fx-backfill.ts) is not kept going by placeholders.
  const written = new Set(rows.map((r) => r.day))
  const filled = unfilled.filter((d) => written.has(d)).length
  return { covered: filled === unfilled.length, written: filled }
}

/**
 * How far back a report request fills history itself (MC-039). Older days are
 * the daily refresh's job (POST /api/cron/fx → runFxRefresh); until it lands,
 * a row on such a day is excluded and counted, never converted at a guess.
 */
export const REQUEST_FILL_DAYS = 31

type OrgRates = { currencies: string[]; uncovered: string[] }
/** The check in flight per (workspace, reporting currency) — shared, never remembered once settled. */
const orgChecks = new Map<string, Promise<OrgRates>>()

/**
 * Every foreign currency this workspace holds or has transacted in has a rate
 * for each day of the last REQUEST_FILL_DAYS (or since it first appears) and
 * a market rate fetched within the hour. Best effort and idempotent; callers
 * that render numbers await it, then read the count of rows
 * reporting_amount() could not convert from the SQL side.
 *
 * Cheap when nothing is missing (MC-168): ONE query (~44 ms) answers
 * "complete?" for every currency at once, and the parallel routes of a page
 * load share it while it runs. Only an incomplete currency goes to the bounded
 * top-up (MC-039); bulk history is the daily refresh's.
 *
 * The answer is NOT reused once settled: transaction and account writes do not
 * fill rates, so the refetch right after a save (a workspace's first AED row, a
 * back-dated one) must re-check, or it would report the new row as excluded.
 * ponytail: a check already in flight when a write commits is still shared; a
 * per-org invalidation from the write routes would close that window.
 */
export async function ensureRatesForOrg(orgId: string, reportingInput: string): Promise<OrgRates> {
  const reporting = normalizeCurrencyCode(reportingInput)
  const key = `${orgId}|${reporting}`
  const pending = orgChecks.get(key)
  if (pending) return pending
  const run = checkOrgRates(orgId, reporting, todayIso())
  orgChecks.set(key, run)
  run.then(
    () => orgChecks.delete(key),
    // Every caller swallows the rejection (best effort), so it is logged here.
    (e: unknown) => {
      orgChecks.delete(key)
      console.warn("[fx] rate check failed", { orgId, reporting, message: e instanceof Error ? e.message : String(e) })
    },
  )
  return run
}

async function checkOrgRates(orgId: string, reporting: string, today: string): Promise<OrgRates> {
  const windowStart = addDays(today, -REQUEST_FILL_DAYS)
  // Per currency: is every window day stored (the gaps fillHistory looks for),
  // and was a real rate fetched within the hour (what currentRate checks)?
  // A future-only currency needs no window days (count >= a negative span).
  const result = await db.execute(sql`
    select u.cur, u.first_date::text as first_date,
           (select count(distinct s.rate_date) from fx_rate_snapshots s
             where s.base_currency = u.cur and s.quote_currency = ${reporting}
               and s.rate_date between greatest(u.first_date, ${windowStart}::date) and ${today}::date)
             >= ${today}::date - greatest(u.first_date, ${windowStart}::date) + 1 as window_full,
           exists (select 1 from fx_rate_snapshots s
             where ((s.base_currency = u.cur and s.quote_currency = ${reporting}) or (s.base_currency = ${reporting} and s.quote_currency = u.cur))
               and not s.is_fallback and s.rate_date between ${addDays(today, -CARRY_MAX_DAYS)}::date and ${today}::date
               and s.fetched_at > now() - make_interval(secs => ${CURRENT_MAX_AGE_MS / 1000})) as fresh
      from (
        select cur, min(first_date) as first_date from (
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
      ) u
  `)
  const rows = result.rows as Array<{ cur: string; first_date: string; window_full: boolean; fresh: boolean }>
  // Currencies in parallel: each is independent, and a slow one must not hold the rest up.
  const checked = await Promise.all(
    rows.map(async (row) => {
      const cur = row.cur.toUpperCase()
      if (row.window_full && row.fresh) return null
      const first = String(row.first_date).slice(0, 10)
      const [hist, current] = await Promise.all([
        ensureHistoricalRates(cur, reporting, first < windowStart ? windowStart : first).catch((e: unknown) => {
          console.warn("[fx] history top-up failed", { pair: `${cur}/${reporting}`, message: e instanceof Error ? e.message : String(e) })
          return { covered: false }
        }),
        currentRate(cur, reporting).catch(() => null),
      ])
      return !hist.covered || !current ? cur : null
    }),
  )
  return { currencies: rows.map((r) => r.cur.toUpperCase()), uncovered: checked.filter((c): c is string => c != null) }
}

/**
 * Every (base, quote) pair some workspace converts, with the first day it is
 * needed from: each currency a workspace holds or has transacted in (trashed
 * rows too — a restore needs them), into its reporting currency and into every
 * budget and client-cap currency (ensureRatesInto's targets). A held account
 * needs today only. Read by the daily refresh and the admin FX view.
 */
export const fxPairsInUseSql = () => sql`
  select u.cur as base, tg.cur as quote, min(u.first_date)::date as first_date
    from (
      select c.organization_id as org, upper(t.currency_code) as cur, min(t.date) as first_date
        from transactions t join clients c on c.id = t.client_id
       where t.currency_code is not null
       group by 1, 2
      union all
      select organization_id, upper(currency_code), current_date from wealth_accounts where currency_code is not null group by 1, 2
    ) u
    join (
      select id as org, upper(coalesce(reporting_currency, currency)) as cur from organizations
      union select organization_id, upper(currency_code) from spending_budgets where currency_code is not null
      union select organization_id, upper(currency_code) from budgets where currency_code is not null
    ) tg on tg.org = u.org
   where u.cur <> tg.cur
   group by 1, 2`

/**
 * `ensureRatesForOrg` into EVERY currency a figure here is measured in — a
 * budget kept in INR after the workspace moved to EUR needs USD→INR, not only
 * USD→EUR (fx_rate_on resolves a stored direct or inverse pair and never goes
 * through a third currency). Concurrent and best effort: what stays missing is
 * counted as excluded by the SQL, never guessed.
 */
export async function ensureRatesInto(orgId: string, targets: Iterable<string>): Promise<void> {
  const unique = [...new Set([...targets].map((c) => c.toUpperCase()))]
  await Promise.all(unique.map((c) => ensureRatesForOrg(orgId, c).catch(() => undefined)))
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
