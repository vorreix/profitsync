import { beforeEach, describe, expect, it, vi } from "vitest"
import type { VercelRequest, VercelResponse } from "@vercel/node"

// DB-free: every db chain resolves to the next queued result (in call order),
// auth and the currency writers are stand-ins that record what they were asked.
const fake = vi.hoisted(() => ({
  selects: [] as unknown[][],
  reporting: "USD",
  created: [] as Array<{ currency?: string }>,
  adopted: [] as string[],
}))

function chain(result: unknown): unknown {
  const self: unknown = new Proxy(() => {}, {
    get: (_t, key) =>
      key === "then" ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko) : () => self,
  })
  return self
}

vi.mock("../../src/lib/db/index.js", () => ({
  db: { select: () => chain(fake.selects.shift() ?? []), update: () => chain([]) },
}))
vi.mock("../_lib/auth.js", () => ({
  getUserId: async () => "user-1",
  ensurePersonalOrg: async () => "personal-1",
  createOrgForUser: async (input: { currency?: string }) => {
    fake.created.push(input)
    return { id: "biz-new", currency: input.currency ?? "USD" }
  },
}))
vi.mock("../_lib/org-currency.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/org-currency.js")>()),
  setOrgCurrency: async (_orgId: string, code: string) => { fake.adopted.push(code) },
}))
vi.mock("../_lib/fx-rates.js", () => ({ reportingCurrencyFor: async () => fake.reporting }))
vi.mock("../_lib/wealth-accounts.js", () => ({ DEFAULT_CASH_NAME: "Cash in Hand" }))

const { default: handler } = await import("./onboarding.js")

async function onboard(body: Record<string, unknown>) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    json(payload: unknown) { this.body = payload; return this },
  }
  await handler({ method: "POST", body, headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse)
  return res
}

beforeEach(() => {
  fake.selects = []
  fake.reporting = "USD"
  fake.created = []
  fake.adopted = []
})

describe("POST /api/onboarding — the workspace currency", () => {
  it("refuses a 3-decimal currency for a new workspace (an old build guessing KWD), before creating it", async () => {
    fake.selects = [[]] // no business workspace yet
    const res = await onboard({ account_type: "business", currency: "KWD" })
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: "invalid_currency" })
    expect(fake.created).toEqual([])
  })

  it("accepts it for a workspace that already reports in it", async () => {
    fake.reporting = "KWD"
    fake.selects = [[{ id: "biz-1", accountType: "business", currency: "KWD", reportingCurrency: "KWD" }], [{ id: "tx-1" }]]
    const res = await onboard({ account_type: "business", currency: "KWD" })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ organization_id: "biz-1", reporting_currency: "KWD" })
  })

  it("answers the currency a workspace with history KEPT, not the one picked", async () => {
    fake.reporting = "EUR"
    fake.selects = [[{ id: "tx-1" }]] // the personal workspace has a ledger row
    const res = await onboard({ account_type: "personal", currency: "INR" })
    expect(res.statusCode).toBe(200)
    expect(fake.adopted).toEqual([])
    expect(res.body).toMatchObject({ organization_id: "personal-1", reporting_currency: "EUR" })
  })
})
