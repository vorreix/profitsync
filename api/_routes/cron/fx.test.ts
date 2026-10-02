import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// DB-free: the pairs query, the heartbeat and the FX engine are stand-ins, so
// only the refresh's own bookkeeping is under test.
const fake = vi.hoisted(() => ({
  pairs: [] as Array<{ base: string; quote: string; first_date: string }>,
  heartbeat: null as null | { lastReminders: number; lastBroadcasts: number },
  fills: new Map<string, Array<{ covered: boolean; written?: number }>>(),
  calls: [] as Array<{ pair: string; from: string; floor?: string }>,
  current: [] as string[],
  /** ms each deep-history call takes (the fake clock moves by it). */
  fillMs: 0,
}))
vi.mock("../../../src/lib/db/index.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    execute: async () => ({ rows: fake.pairs }),
    insert: () => ({
      values: (v: { lastReminders: number; lastBroadcasts: number }) => ({
        onConflictDoUpdate: async () => {
          fake.heartbeat = v
        },
      }),
    }),
  },
}))
vi.mock("../../_lib/fx-rates.js", () => ({
  fxPairsInUseSql: () => "",
  fxProviderHealth: () => ({ since: "", providers: {} }),
  REQUEST_FILL_DAYS: 31,
  currentRate: async (base: string, quote: string) => {
    fake.current.push(`${base}/${quote}`)
    return null
  },
  ensureHistoricalRates: async (base: string, quote: string, from: string, opts: { floor?: string } = {}) => {
    const pair = `${base}/${quote}`
    fake.calls.push({ pair, from, floor: opts.floor })
    // Pass 1 (the recent window, no floor) is not what the queued answers script.
    if (!opts.floor) return { covered: false }
    if (fake.fillMs) vi.setSystemTime(Date.now() + fake.fillMs)
    return fake.fills.get(pair)?.shift() ?? { covered: false, written: 0 }
  },
}))

const { runFxRefresh } = await import("./fx")

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-01T09:00:00Z"), toFake: ["Date"] })
  fake.heartbeat = null
  fake.calls = []
  fake.current = []
  fake.fillMs = 0
})
afterEach(() => vi.useRealTimers())

const deep = (pair: string) => fake.calls.filter((c) => c.pair === pair && c.floor)

describe("runFxRefresh", () => {
  it("keeps filling a pair while calls still fill days; a pair no provider can finish is incomplete, not retried", async () => {
    fake.pairs = [
      { base: "AED", quote: "INR", first_date: "2024-05-01" },
      { base: "XAF", quote: "EUR", first_date: "1990-05-01" },
    ]
    fake.fills = new Map([["AED/INR", [{ covered: false, written: 62 }, { covered: true, written: 9 }]]])

    const r = await runFxRefresh(10_000)

    expect(r).toMatchObject({ pairs: 2, complete: 1, incomplete: 1, remaining: 0 })
    expect(deep("AED/INR")).toHaveLength(2)
    // Back to the first day it is needed, but never before the ECB series starts.
    expect(deep("XAF/EUR")).toEqual([{ pair: "XAF/EUR", from: "1999-01-04", floor: "1999-01-04" }])
    // Pass 1 topped every pair up over the request window first.
    expect(fake.calls.filter((c) => !c.floor).map((c) => [c.pair, c.from])).toEqual([["AED/INR", "2026-08-31"], ["XAF/EUR", "2026-08-31"]])
    expect(fake.heartbeat).toMatchObject({ lastReminders: 2, lastBroadcasts: 1 })
  })

  it("stops at its budget and reports the pairs left as remaining, so a caller can call again", async () => {
    fake.pairs = [{ base: "USD", quote: "EUR", first_date: "2026-01-01" }]
    const r = await runFxRefresh(0)
    expect(r).toMatchObject({ pairs: 1, complete: 0, remaining: 1 })
    expect(fake.calls).toHaveLength(0)
    expect(fake.heartbeat).toMatchObject({ lastReminders: 1, lastBroadcasts: 1 })
  })

  it("deep backfills cannot starve later pairs: every pair gets today's rate and the recent window first", async () => {
    fake.pairs = ["AED", "LKR", "PKR", "SAR", "QAR", "OMR"].map((c) => ({ base: c, quote: "INR", first_date: "2024-03-02" }))
    fake.fills = new Map(fake.pairs.map((p) => [`${p.base}/INR`, Array.from({ length: 20 }, () => ({ covered: false, written: 62 }))]))
    fake.fillMs = 4000

    const r = await runFxRefresh(15_000)

    expect(fake.current).toHaveLength(6)
    expect(fake.calls.filter((c) => !c.floor)).toHaveLength(6)
    expect(r).toMatchObject({ pairs: 6, complete: 0, incomplete: 0, remaining: 6 })
  })

  it("a fill the deadline cut off counts as remaining, not as a pair no provider serves", async () => {
    fake.pairs = [{ base: "AED", quote: "INR", first_date: "2024-03-02" }]
    fake.fills = new Map([["AED/INR", [{ covered: false }]]])
    fake.fillMs = 20_000
    expect(await runFxRefresh(15_000)).toMatchObject({ complete: 0, incomplete: 0, remaining: 1 })
  })
})
