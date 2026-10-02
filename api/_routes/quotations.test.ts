import { beforeEach, describe, expect, it, vi } from "vitest"
import type { VercelRequest, VercelResponse } from "@vercel/node"
import { PgDialect } from "drizzle-orm/pg-core"

// DB-free: auth, quota and the reporting-currency lookup are stand-ins; the
// db is a chain that resolves to the row under test and records what was written.
const fake = vi.hoisted(() => ({
  reporting: "USD",
  before: null as null | { amount: string; currencyCode: string | null },
  inserted: [] as Array<Record<string, unknown>>,
  updated: [] as Array<Record<string, unknown>>,
}))

function chain(result: () => unknown, record?: (v: Record<string, unknown>) => void): unknown {
  const self: unknown = new Proxy(() => {}, {
    get: (_t, key) =>
      key === "then"
        ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko)
        : (arg: Record<string, unknown>) => {
            if ((key === "values" || key === "set") && record) record(arg)
            return self
          },
  })
  return self
}

vi.mock("../../src/lib/db/index.js", () => ({
  db: {
    select: () => chain(() => (fake.before ? [fake.before] : [])),
    insert: () => chain(() => [{ id: "q1" }], (v) => fake.inserted.push(v)),
    update: () => chain(() => [{ id: "q1", status: "draft" }], (v) => fake.updated.push(v)),
  },
  serialize: (row: unknown) => row,
}))
vi.mock("../_lib/auth.js", () => ({
  requireAuth: async () => ({ userId: "u1", orgId: "org-1", role: "owner" }),
  requireBusinessFeature: () => true,
  canWrite: () => true,
  canDelete: () => true,
}))
vi.mock("../_lib/quota.js", () => ({
  checkQuotationQuota: async () => ({ allowed: true }),
  checkNoteLength: async () => ({ allowed: true }),
}))
vi.mock("../_lib/audit.js", () => ({ logAudit: async () => {}, diffFields: () => ({}) }))
vi.mock("../_lib/notify-quotation.js", () => ({ notifyQuotationAccepted: async () => {} }))
vi.mock("../_lib/fx-rates.js", () => ({ reportingCurrencyFor: async () => fake.reporting }))

const { default: list, orderForSort } = await import("./quotations.js")
const { default: one } = await import("./quotations/[id].js")

async function call(handler: typeof list, method: string, body: Record<string, unknown>) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    json(payload: unknown) { this.body = payload; return this },
  }
  await handler({ method, body, query: { id: "q1" }, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse)
  return res
}

const quote = { title: "Website", prospect_name: "Acme" }

beforeEach(() => {
  fake.reporting = "USD"
  fake.before = null
  fake.inserted = []
  fake.updated = []
})

describe("quotation writes hold amounts to their currency (MC-031/047)", () => {
  it("refuses a new quote in a non-selectable currency (the AI heard Kuwaiti dinars)", async () => {
    const res = await call(list, "POST", { ...quote, amount: 12, currency_code: "KWD" })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: "invalid_currency" })
    expect(fake.inserted).toEqual([])
  })

  it("keeps a workspace's own currency even when it is not selectable", async () => {
    fake.reporting = "KWD"
    const res = await call(list, "POST", { ...quote, amount: 12, currency_code: "KWD" })
    expect(res.statusCode).toBe(201)
    expect(fake.inserted[0]).toMatchObject({ currencyCode: "KWD" })
  })

  it("refuses ¥1,500.50 in a yen workspace and stores ¥1,500", async () => {
    fake.reporting = "JPY"
    expect((await call(list, "POST", { ...quote, amount: 1500.5 })).body).toMatchObject({ code: "amount_whole_units" })
    const ok = await call(list, "POST", { ...quote, amount: 1500 })
    expect(ok.statusCode).toBe(201)
    expect(fake.inserted[0]).toMatchObject({ amount: "1500", currencyCode: "JPY" })
  })

  it("PATCH refuses a changed amount in the quote's own currency, not an unchanged legacy one", async () => {
    fake.before = { amount: "1500.50", currencyCode: "JPY" }
    expect((await call(one, "PATCH", { amount: 1600.5 })).body).toMatchObject({ code: "amount_whole_units" })
    expect(fake.updated).toEqual([])
    const titleOnly = await call(one, "PATCH", { title: "Renamed", amount: 1500.5 })
    expect(titleOnly.statusCode).toBe(200)
    expect(fake.updated).toHaveLength(1)
  })
})

describe("orderForSort — amount compares quotes in the reporting currency (as MC-130)", () => {
  it("sorts by the converted amount, rate-less quotes last", () => {
    const sql = (dir: "amount_desc" | "amount_asc") => new PgDialect().sqlToQuery(orderForSort(dir, "org-1")[0]).sql
    expect(sql("amount_desc")).toMatch(/reporting_amount\(.*\) desc nulls last$/)
    expect(sql("amount_asc")).toMatch(/reporting_amount\(.*\) asc nulls last$/)
  })
})
