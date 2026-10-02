import { beforeEach, describe, expect, it, vi } from "vitest"

// Mark done on a planned transfer (MC-147), DB-free: SELECTs are a queue of
// canned results; the header UPDATE and the complete_transfer call must land in
// ONE dbBatch, in that order.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  headerPatch: null as Record<string, unknown> | null,
  batches: [] as unknown[][],
  audits: [] as Record<string, unknown>[],
  executed: [] as Array<{ queryChunks: unknown[] }>,
}))

const chain = (value: unknown) => {
  const c: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(value).then(ok, ko),
  }
  for (const m of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c
  return c
}

vi.mock("../../src/lib/db/index.js", () => ({
  db: {
    select: () => chain(h.selects.shift() ?? []),
    update: () => ({ set: (patch: Record<string, unknown>) => { h.headerPatch = patch; return chain(undefined) } }),
    execute: (query: { queryChunks: unknown[] }) => { h.executed.push(query); return "complete_transfer()" },
  },
  dbBatch: async (items: unknown[]) => {
    h.batches.push(items)
    return [undefined, { rows: [{ out_leg_id: "out", in_leg_id: "in", fee_leg_id: "fee" }] }]
  },
}))
vi.mock("./auth.js", () => ({ ensureDefaultClient: async () => "client-1" }))
vi.mock("./audit.js", () => ({ logAudit: async (entry: Record<string, unknown>) => { h.audits.push(entry) } }))
vi.mock("./quota.js", () => ({ getOrgPlan: async () => ({ planKey: "premium", limits: {} }), checkBankAccountQuota: vi.fn(), checkCreditCardQuota: vi.fn() }))
vi.mock("./debts.js", () => ({ isDebtAccountType: (t: string) => t === "loan" || t === "receivable" }))
vi.mock("./notify-budget.js", () => ({ notifyIfBudgetExceeded: async () => undefined }))

const { transitionTransfer } = await import("./wealth-accounts.js")

const plan = {
  id: "tr-1", organizationId: "org-1", status: "planned", sourceAccountId: "eur", destinationAccountId: "inr",
  sourceAmount: "100.0000", sourceCurrency: "EUR", destinationAmount: "10000.0000", destinationCurrency: "INR",
  sourceFeeAmount: "0.0000", note: "",
}
const accounts = [
  { id: "eur", type: "bank", nickname: "", bankName: "EUR Bank", currencyCode: "EUR" },
  { id: "inr", type: "bank", nickname: "", bankName: "INR Bank", currencyCode: "INR" },
]
const queue = (header = plan) => h.selects.push([header], accounts, [{ ...header, status: "completed" }])

beforeEach(() => {
  h.selects.length = 0
  h.batches.length = 0
  h.audits.length = 0
  h.headerPatch = null
  h.executed.length = 0
})

describe("completing a planned cross-currency transfer (MC-147)", () => {
  it("books what actually arrived and the fee, on the header, in the same batch as complete_transfer", async () => {
    queue()
    const result = await transitionTransfer("org-1", "user-1", "tr-1", "completed", { destinationAmount: "9870", sourceFeeAmount: "2.5" })
    expect(result).toMatchObject({ ok: true, legIds: ["out", "in", "fee"] })
    expect(h.batches).toHaveLength(1)
    expect(h.batches[0]).toHaveLength(2)
    expect(h.batches[0][1]).toBe("complete_transfer()")
    expect(h.headerPatch).toMatchObject({ destinationAmount: "9870.00", sourceFeeAmount: "2.50", effectiveRate: "98.7" })
    expect(h.audits[0]).toMatchObject({ entityType: "transfer", action: "update", changes: { destination_amount: { from: "10000.0000", to: "9870.00" }, source_fee_amount: { from: "0.0000", to: "2.50" } } })
  })

  it("keeps the plan's figures when the caller states none (an old build)", async () => {
    queue()
    await transitionTransfer("org-1", "user-1", "tr-1", "completed")
    expect(h.headerPatch).toMatchObject({ destinationAmount: "10000.00", sourceFeeAmount: "0.00", effectiveRate: "100" })
    expect(h.audits).toHaveLength(0)
  })

  it("refuses an invalid figure before anything is written", async () => {
    queue()
    const result = await transitionTransfer("org-1", "user-1", "tr-1", "completed", { destinationAmount: "0" })
    expect(result).toMatchObject({ ok: false, status: 400, body: { field: "destination" } })
    expect(h.batches).toHaveLength(0)
  })

  it("posts the outgoing leg with the card the plan was made with", async () => {
    queue({ ...plan, fromCardId: "card-debit" } as typeof plan)
    await transitionTransfer("org-1", "user-1", "tr-1", "completed")
    expect(h.executed[0].queryChunks).toContain("card-debit")
  })

  it("refuses a received amount that differs on a same-currency plan", async () => {
    queue({ ...plan, destinationCurrency: "EUR", destinationAmount: "100.0000" })
    h.selects[1] = [accounts[0], { ...accounts[1], currencyCode: "EUR" }]
    const result = await transitionTransfer("org-1", "user-1", "tr-1", "completed", { destinationAmount: "99" })
    expect(result).toMatchObject({ ok: false, status: 400, body: { code: "same_currency_amounts_differ" } })
    expect(h.batches).toHaveLength(0)
  })
})
