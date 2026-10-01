import { afterEach, describe, expect, it, vi } from "vitest"
import { CARRY_MAX_DAYS, ChainedProvider, CurrencyApiProvider, FrankfurterProvider, FxUnavailable, OpenErApiProvider, archiveDays, convertAmount, ensureHistoricalRates, ensureRatesForOrg, fillDays, fxProviderHealth, type DayRate } from "./fx-rates"
import type { FxQuote } from "./fx-provider"

// DB-free (the unit gate): the db module is replaced by an in-memory stand-in
// that answers fillHistory's three statements — the gaps query, the stored
// observations around them, and the upsert — so the fill runs end to end, and
// ensureRatesForOrg's one completeness check (`orgCheck`). Every raw statement
// is recorded as rendered SQL + params.
const fakeDb = vi.hoisted(() => ({
  gaps: [] as Array<{ day: string; has_row: boolean }>,
  known: [] as Array<{ day: string; rate: string; provider: string }>,
  written: [] as Array<{ rateDate: string; rate: string; provider: string; isFallback: boolean }>,
  orgCheck: [] as Array<{ cur: string; first_date: string; window_full: boolean; fresh: boolean }>,
  executed: [] as Array<{ sql: string; params: unknown[] }>,
}))
vi.mock("../../src/lib/db/index.js", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core")
  const dialect = new PgDialect()
  return {
    db: {
      execute: async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const { sql, params } = dialect.sqlToQuery(q)
        fakeDb.executed.push({ sql, params })
        return { rows: sql.includes("window_full") ? fakeDb.orgCheck : fakeDb.gaps }
      },
      select: () => ({ from: () => ({ where: async () => fakeDb.known }) }),
      insert: () => ({
        values: (rows: typeof fakeDb.written) => ({
          onConflictDoUpdate: async () => {
            fakeDb.written.push(...rows)
          },
        }),
      }),
    },
  }
})

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal("fetch", fn)
  return fn
}

/** Answer each URL by the first matching route; anything unrouted is a network failure. */
function routeFetch(routes: Array<[RegExp, number, unknown?]>) {
  const fn = vi.fn(async (url: string) => {
    const hit = routes.find(([re]) => re.test(url))
    if (!hit) throw new TypeError("fetch failed")
    return { ok: hit[1] >= 200 && hit[1] < 300, status: hit[1], json: async () => hit[2] }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const urlOf = (fn: ReturnType<typeof vi.fn>, i = 0) => String((fn.mock.calls[i] as unknown as [string])[0])

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Calendar days a..b inclusive. */
const span = (a: string, b: string) => {
  const out: string[] = []
  for (let d = new Date(`${a}T00:00:00Z`); d.toISOString().slice(0, 10) <= b; d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10))
  return out
}

describe("FrankfurterProvider", () => {
  it("parses a current rate and sends only the pair", async () => {
    const fetchMock = mockFetch({ amount: 1, base: "EUR", date: "2026-09-09", rates: { INR: 110.8225 } })
    const q = await new FrankfurterProvider().getCurrentRate("EUR", "INR")
    expect(q).toMatchObject({ baseCurrency: "EUR", quoteCurrency: "INR", rate: "110.8225", rateDate: "2026-09-09", sourceType: "market", provider: "frankfurter" })
    const url = urlOf(fetchMock)
    expect(url).toContain("base=EUR")
    expect(url).toContain("symbols=INR")
    expect(url).not.toMatch(/amount|balance|account/i)
  })

  it("never asks for a weak base: crosses both sides against EUR in Decimal (MC-102)", async () => {
    // Frankfurter's own base=IDR answer is 5.6e-05 (0.19% off); EUR->IDR and EUR->USD keep full precision.
    const fetchMock = mockFetch({ amount: 1, base: "EUR", date: "2026-09-30", rates: { IDR: 20315.34, USD: 1.1355 } })
    const q = await new FrankfurterProvider().getCurrentRate("IDR", "USD")
    expect(q.rate).toBe("0.00005589372366")
    expect(q.rateDate).toBe("2026-09-30")
    expect(urlOf(fetchMock)).toMatch(/base=EUR&symbols=IDR,USD$/)
  })

  it("reports an unsupported pair as FxUnavailable, never as 1", async () => {
    mockFetch({ message: "not found" }, 404)
    await expect(new FrankfurterProvider().getCurrentRate("EUR", "AED")).rejects.toBeInstanceOf(FxUnavailable)
    // A partial table (Frankfurter drops unknown symbols) is not an answer either.
    mockFetch({ date: "2026-09-30", rates: { INR: 108.8 } })
    await expect(new FrankfurterProvider().getCurrentRate("AED", "INR")).rejects.toBeInstanceOf(FxUnavailable)
  })

  it("derives a pegged side from USD only when asked, and marks it", async () => {
    const fetchMock = mockFetch({ date: "2026-09-30", rates: { USD: 1.1355, INR: 108.8205 } })
    const q = await new FrankfurterProvider().getCurrentRate("AED", "INR", true)
    expect(q.rate).toBe("26.09526875551355")
    expect(q.provider).toBe("frankfurter+peg")
    expect(urlOf(fetchMock)).toMatch(/symbols=USD,INR$/)
  })

  it("returns a business-day series keyed by date", async () => {
    mockFetch({ rates: { "2026-09-01": { INR: 110.0485 }, "2026-09-02": { INR: 109.962 } } })
    const series = await new FrankfurterProvider().getSeries("EUR", "INR", "2026-09-01", "2026-09-02")
    expect([...series.entries()]).toEqual([["2026-09-01", "110.0485"], ["2026-09-02", "109.962"]])
  })
})

describe("CurrencyApiProvider", () => {
  const table = (date: string) => ({ date, eur: { aed: 4.16178609, inr: 108.5, "1inch": 11.2, usd: 1.1332297 } })

  it("crosses a non-ECB pair from the day's EUR table and ignores non-ISO tokens", async () => {
    const fetchMock = routeFetch([[/@2025-01-15\//, 200, table("2025-01-15")]])
    const p = new CurrencyApiProvider()
    const q = await p.getHistoricalRate("AED", "INR", "2025-01-15")
    expect(q).toMatchObject({ rateDate: "2025-01-15", provider: "currency-api", sourceType: "historical_market" })
    expect(Number(q.rate)).toBeCloseTo(108.5 / 4.16178609, 10)
    expect((await p.table("2025-01-15"))?.rates).not.toHaveProperty("1INCH")
    expect(urlOf(fetchMock)).not.toMatch(/amount|balance|account/i)
  })

  it("falls back to the mirror, says null for a day with no file, and leaves an unreachable day out", async () => {
    routeFetch([
      [/jsdelivr.*@2026-09-29\//, 500],
      [/2026-09-29\.currency-api\.pages\.dev/, 200, table("2026-09-29")],
      [/@2024-03-01\//, 404],
      [/2024-03-01\.currency-api/, 404],
      // 2026-09-30: both mirrors unreachable (unrouted)
    ])
    const days = await new CurrencyApiProvider().getDays("AED", "INR", ["2026-09-29", "2024-03-01", "2026-09-30"])
    expect(days.get("2026-09-29")).toBeTruthy()
    expect(days.get("2024-03-01")).toBeNull()
    expect(days.has("2026-09-30")).toBe(false)
  })

  it("answers by the deadline with what has arrived; a hanging day is left out, not waited for", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("@2026-09-30")) return new Promise(() => {}) // never answers
      return { ok: true, status: 200, json: async () => table("2026-09-29") }
    }))
    const t0 = Date.now()
    const days = await new CurrencyApiProvider().getDays("AED", "INR", ["2026-09-30", "2026-09-29"], Date.now() + 50)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect([...days.keys()]).toEqual(["2026-09-29"])
  })
})

describe("OpenErApiProvider", () => {
  it("parses a current rate from the EUR table", async () => {
    const fetchMock = mockFetch({ result: "success", time_last_update_utc: "Tue, 09 Sep 2026 00:02:31 +0000", rates: { EUR: 1, AED: 4.269072, INR: 110.161082 } })
    const q = await new OpenErApiProvider().getCurrentRate("EUR", "AED")
    expect(q).toMatchObject({ rate: "4.269072", rateDate: "2026-09-09", sourceType: "market", provider: "open-er-api" })
    expect(urlOf(fetchMock)).toMatch(/\/latest\/EUR$/)
  })

  it("has no history", async () => {
    await expect(new OpenErApiProvider().getHistoricalRate("EUR", "AED", "2026-01-01")).rejects.toBeInstanceOf(FxUnavailable)
  })
})

describe("ChainedProvider", () => {
  const q = (provider: string): FxQuote => ({ baseCurrency: "AED", quoteCurrency: "INR", rate: "26" as FxQuote["rate"], rateDate: "2026-09-30", observedAt: "", provider, sourceType: "market", isFallback: false })

  it("asks every provider for the currency itself before deriving a peg", async () => {
    const calls: string[] = []
    const fake = (name: string, answersWithPeg: boolean) => ({
      getCurrentRate: async (_b: string, _q: string, pegs?: boolean) => {
        calls.push(`${name}:${pegs ? "peg" : "strict"}`)
        if (pegs && answersWithPeg) return q(`${name}+peg`)
        throw new FxUnavailable("no")
      },
      getHistoricalRate: async () => { throw new FxUnavailable("no") },
    })
    const out = await new ChainedProvider([fake("ecb", true), fake("daily", false)]).getCurrentRate("AED", "INR")
    expect(out.provider).toBe("ecb+peg")
    expect(calls).toEqual(["ecb:strict", "daily:strict", "ecb:peg"])
  })

  it("derives no peg when every provider was unreachable (a peg needs one of them too)", async () => {
    const calls: string[] = []
    const down = (name: string) => ({
      getCurrentRate: async (_b: string, _q: string, pegs?: boolean) => {
        calls.push(`${name}:${pegs ? "peg" : "strict"}`)
        throw new TypeError("fetch failed")
      },
      getHistoricalRate: async () => { throw new TypeError("fetch failed") },
    })
    const outage = { getCurrentRate: async () => { calls.push("5xx:strict"); throw new FxUnavailable("503 from host", 503) }, getHistoricalRate: vi.fn() }
    await expect(new ChainedProvider([down("ecb"), outage, down("daily")]).getCurrentRate("AED", "INR")).rejects.toBeInstanceOf(TypeError)
    expect(calls).toEqual(["ecb:strict", "5xx:strict", "daily:strict"])
  })

  it("never derives a peg for a pair without one", async () => {
    const strictOnly = { getCurrentRate: vi.fn(async () => { throw new FxUnavailable("no") }), getHistoricalRate: vi.fn() }
    await expect(new ChainedProvider([strictOnly]).getCurrentRate("PKR", "INR")).rejects.toBeInstanceOf(FxUnavailable)
    expect(strictOnly.getCurrentRate).toHaveBeenCalledTimes(1)
  })
})

describe("fillDays", () => {
  const r = (rate: string, provider = "frankfurter"): DayRate => ({ rate, provider })
  const all = (a: string, b: string) => {
    const s = new Set<string>()
    for (let d = new Date(`${a}T00:00:00Z`); d.toISOString().slice(0, 10) <= b; d = new Date(d.getTime() + 86_400_000)) s.add(d.toISOString().slice(0, 10))
    return s
  }

  it("writes real observations and carries the last one over an answered weekend", () => {
    const rows = fillDays({
      start: "2026-09-25", end: "2026-09-29",
      missing: all("2026-09-26", "2026-09-29"),
      obs: new Map([["2026-09-25", r("1.14")], ["2026-09-28", r("1.13")]]),
      known: new Map(), answered: all("2026-09-25", "2026-09-29"),
    })
    expect(rows).toEqual([
      { day: "2026-09-26", rate: "1.14", provider: "frankfurter", isFallback: true },
      { day: "2026-09-27", rate: "1.14", provider: "frankfurter", isFallback: true },
      { day: "2026-09-28", rate: "1.13", provider: "frankfurter", isFallback: false },
      // 09-29 answered with no observation yet (before publication): a placeholder the next fetch replaces (MC-097)
      { day: "2026-09-29", rate: "1.13", provider: "frankfurter", isFallback: true },
    ])
  })

  it("carries a stored observation for at most CARRY_MAX_DAYS, then leaves the day without a rate", () => {
    const rows = fillDays({
      start: "2026-09-01", end: "2026-09-20", missing: all("2026-09-02", "2026-09-20"),
      obs: new Map(), known: new Map([["2026-09-01", r("3.67", "currency-api")]]), answered: all("2026-09-01", "2026-09-20"),
    })
    expect(rows.map((x) => x.day)).toEqual([...all("2026-09-02", "2026-09-11")])
    expect(rows).toHaveLength(CARRY_MAX_DAYS)
    expect(rows.every((x) => x.isFallback && x.rate === "3.67" && x.provider === "currency-api")).toBe(true)
  })

  it("never carries into a day no provider answered for (an outage), and writes only missing days", () => {
    const rows = fillDays({
      start: "2026-09-01", end: "2026-09-04", missing: new Set(["2026-09-03", "2026-09-04"]),
      obs: new Map([["2026-09-01", r("1.1")], ["2026-09-02", r("1.2")]]), known: new Map(), answered: new Set(["2026-09-01", "2026-09-02", "2026-09-04"]),
    })
    expect(rows).toEqual([{ day: "2026-09-04", rate: "1.2", provider: "frankfurter", isFallback: true }])
  })
})

describe("archiveDays", () => {
  const ecbRate = { rate: "1", provider: "frankfurter" }

  it("asks for every missing day of a currency the ECB does not publish, newest first — a stored row next to it does not count", () => {
    expect(archiveDays(span("2026-09-26", "2026-10-01"), new Map())).toEqual(span("2026-09-26", "2026-10-01").reverse())
  })

  it("skips days this call's ECB answer reaches (a weekend after a Friday quote), and days before the archive", () => {
    const ecb = new Map([["2026-09-25", ecbRate]])
    expect(archiveDays(["2026-09-26", "2026-09-27"], ecb)).toEqual([])
    expect(archiveDays(["2024-02-28", "2024-03-02"], new Map())).toEqual(["2024-03-02"])
  })

  it("asks at most `max` days, the newest", () => {
    expect(archiveDays(span("2026-09-01", "2026-09-10"), new Map(), 3)).toEqual(["2026-09-10", "2026-09-09", "2026-09-08"])
  })
})

describe("ensureHistoricalRates (in-memory db)", () => {
  const eurTable = (date: string) => ({ date, eur: { pkr: 315.5, inr: 108.5 } })

  it("fills the days after a stored row from the daily archive, and carries only over a day the archive has no file for", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
    // Real rows through 09-25 (the previous fill); nothing since.
    fakeDb.gaps = span("2026-09-26", "2026-10-01").map((day) => ({ day, has_row: false }))
    fakeDb.known = span("2026-09-16", "2026-09-25").map((day) => ({ day, rate: "0.3439", provider: "currency-api" }))
    fakeDb.written = []
    const fetchMock = routeFetch([
      // Frankfurter knows INR but not PKR: a partial table, i.e. no ECB series for the pair.
      [/frankfurter/, 200, { rates: { "2026-09-25": { INR: 108.5 } } }],
      [/@2026-10-01\/|2026-10-01\.currency-api/, 404],
      ...span("2026-09-26", "2026-09-30").map((d): [RegExp, number, unknown] => [new RegExp(`@${d}/`), 200, eurTable(d)]),
    ])

    const result = await ensureHistoricalRates("PKR", "INR", "2026-09-01")

    const archive = fetchMock.mock.calls.map((c) => String((c as unknown as [string])[0])).filter((u) => u.includes("jsdelivr"))
    expect(archive.map((u) => u.match(/@([\d-]+)\//)?.[1]).sort()).toEqual(span("2026-09-26", "2026-10-01"))
    expect(fakeDb.written.map((r) => [r.rateDate, r.provider, r.isFallback])).toEqual([
      ...span("2026-09-26", "2026-09-30").map((d) => [d, "currency-api", false]),
      // today's file is not out yet: yesterday's rate as a placeholder the next fetch replaces
      ["2026-10-01", "currency-api", true],
    ])
    expect(Number(fakeDb.written[0].rate)).toBeCloseTo(108.5 / 315.5, 10)
    expect(result).toEqual({ covered: true, written: 6 })
  })

  it("derives a peg only for days no source has (before the archive, or no file) — a day the archive could not be reached for waits", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
    fakeDb.gaps = [...span("2024-02-27", "2024-03-01"), "2026-09-21", "2026-10-01"].map((day) => ({ day, has_row: false }))
    fakeDb.known = []
    fakeDb.written = []
    const usdInr = (days: string[]) => Object.fromEntries(days.map((d) => [d, { USD: 1.08, INR: 90 }]))
    routeFetch([
      [/frankfurter.*symbols=USD,INR/, 200, { rates: usdInr([...span("2024-02-26", "2024-03-01"), "2026-09-21", "2026-10-01"]) }],
      [/frankfurter/, 404, { message: "not found" }],
      [/@2026-10-01\/|2026-10-01\.currency-api/, 404],
      // 2026-09-21: both archive hosts unreachable (unrouted), so no peg either
    ])

    await ensureHistoricalRates("AED", "INR", "2024-02-27")

    expect(fakeDb.written.map((r) => [r.rateDate, r.provider, r.isFallback])).toEqual([
      ...span("2024-02-27", "2024-03-01").map((d) => [d, "frankfurter+peg", false]),
      ["2026-10-01", "frankfurter+peg", false],
    ])
  })

  it("a caller's deadline that cut the archive off does not mark the pair unserved — the next request still fills it", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
    fakeDb.gaps = span("2026-09-28", "2026-10-01").map((day) => ({ day, has_row: false }))
    fakeDb.known = []
    fakeDb.written = []
    routeFetch([
      [/frankfurter/, 404, { message: "not found" }],
      [/@2026-10-01\/|2026-10-01\.currency-api/, 404],
      ...span("2026-09-28", "2026-09-30").map((d): [RegExp, number, unknown] => [new RegExp(`@${d}/`), 200, eurTable(d)]),
    ])

    // The refresh reached this pair with its budget already spent.
    expect(await ensureHistoricalRates("PKR", "INR", "2026-09-28", { floor: "2026-09-28", deadline: Date.now() })).toEqual({ covered: false })
    expect(fakeDb.written).toEqual([])

    expect(await ensureHistoricalRates("PKR", "INR", "2026-09-28")).toEqual({ covered: true, written: 4 })
  })

  it("goes back to the providers for the same gaps at most hourly, not on every request", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
    // LKR has no source before the archive: those days can never fill, but
    // today's unconfirmed placeholder keeps answering — so no back-off applies.
    fakeDb.gaps = [...span("2024-02-28", "2024-03-01").map((day) => ({ day, has_row: false })), { day: "2026-10-01", has_row: true }]
    fakeDb.known = [{ day: "2026-09-30", rate: "0.29", provider: "currency-api" }]
    fakeDb.written = []
    const fetchMock = routeFetch([[/frankfurter/, 404, { message: "not found" }], [/2026-10-01/, 404]])

    expect(await ensureHistoricalRates("LKR", "INR", "2024-02-28")).toEqual({ covered: false, written: 0 })
    const first = fetchMock.mock.calls.length
    expect(first).toBeGreaterThan(0)
    expect(await ensureHistoricalRates("LKR", "INR", "2024-02-28")).toEqual({ covered: false })
    expect(fetchMock.mock.calls.length).toBe(first)
  })
})

describe("ensureRatesForOrg (in-memory db)", () => {
  const checks = () => fakeDb.executed.filter((q) => q.sql.includes("window_full")).length

  it("a complete workspace costs ONE query, shared by parallel routes, and the next request checks again (MC-168)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
    fakeDb.orgCheck = [{ cur: "EUR", first_date: "2020-01-01", window_full: true, fresh: true }]
    fakeDb.executed = []
    const fetchMock = routeFetch([])

    const results = await Promise.all([ensureRatesForOrg("org-complete", "USD"), ensureRatesForOrg("org-complete", "usd"), ensureRatesForOrg("org-complete", "USD")])
    expect(results.every((r) => r.uncovered.length === 0 && r.currencies.join() === "EUR")).toBe(true)
    expect(fakeDb.executed).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()

    // Not remembered once settled: the refetch after a save (a first AED row,
    // a back-dated one) must see the currency or the window it just added.
    await ensureRatesForOrg("org-complete", "USD")
    expect(checks()).toBe(2)
  })

  it("tops an incomplete currency up from REQUEST_FILL_DAYS back at most — older history is the daily refresh's (MC-039)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
    vi.stubEnv("FX_DISABLED", "1") // read-only: what matters is the range asked for
    fakeDb.orgCheck = [
      { cur: "GBP", first_date: "2020-01-01", window_full: false, fresh: true },
      { cur: "JPY", first_date: "2026-09-20", window_full: false, fresh: true },
    ]
    fakeDb.gaps = []
    fakeDb.executed = []

    await ensureRatesForOrg("org-gaps", "USD")

    const fills = fakeDb.executed.filter((q) => q.sql.includes("generate_series"))
    const from = (cur: string) => fills.find((q) => q.params[0] === cur)?.params[2]
    expect(from("GBP")).toBe("2026-08-31")
    expect(from("JPY")).toBe("2026-09-20")
    vi.unstubAllEnvs()
  })
})

describe("provider health (MC-127)", () => {
  it("counts an answer, a refusal and a failure per provider, and keeps the last error", async () => {
    const before = fxProviderHealth().providers["open-er-api"] ?? { ok: 0, refused: 0, failed: 0 }
    mockFetch({ result: "success", time_last_update_utc: "Tue, 09 Sep 2026 00:02:31 +0000", rates: { EUR: 1, AED: 4.26 } })
    await new OpenErApiProvider().getCurrentRate("EUR", "AED")
    mockFetch({}, 404)
    await new OpenErApiProvider().getCurrentRate("EUR", "AED").catch(() => null)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockFetch({}, 503)
    await new OpenErApiProvider().getCurrentRate("EUR", "AED").catch(() => null)
    // Throttled is not "no such pair": it is the outage this panel exists for.
    mockFetch({}, 429)
    await new OpenErApiProvider().getCurrentRate("EUR", "AED").catch(() => null)
    const after = fxProviderHealth().providers["open-er-api"]
    expect([after.ok - before.ok, after.refused - before.refused, after.failed - before.failed]).toEqual([1, 1, 2])
    expect(after.lastError).toMatch(/429/)
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/amount|balance/i)
    warn.mockRestore()
  })
})

describe("convertAmount", () => {
  it("multiplies in decimal and rounds to cents", () => {
    const rate = { base: "INR", quote: "EUR", rate: "0.00902", rateDate: "2026-09-09", provider: "x", stale: false }
    expect(convertAmount("75000", rate).toFixed()).toBe("676.5")
    expect(convertAmount("0.1", { ...rate, rate: "3" }).toFixed()).toBe("0.3")
  })
})
