import { beforeEach, describe, expect, it, vi } from "vitest"

// A Space auto-save across currencies (MC-159), DB-free: the database is a
// queue of canned SELECT results and every collaborator is a spy.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  updates: [] as Record<string, unknown>[],
  rate: null as string | null,
  createTransfer: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true })),
}))

const chain = (value: unknown) => {
  const c: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(value).then(ok, ko),
  }
  for (const m of ["from", "where", "limit", "orderBy"]) c[m] = () => c
  return c
}

vi.mock("../../src/lib/db/index.js", () => ({
  db: {
    select: () => chain(h.selects.shift() ?? []),
    update: () => ({ set: (patch: Record<string, unknown>) => { h.updates.push(patch); return chain(undefined) } }),
    execute: async () => ({ rows: [{ rate: h.rate }] }),
  },
}))
vi.mock("./wealth-accounts.js", () => ({ createTransfer: h.createTransfer }))
vi.mock("./fx-rates.js", () => ({ ensureHistoricalRates: async () => ({ covered: true }) }))
vi.mock("./auth.js", () => ({ ensureDefaultClient: async () => "client-1" }))
vi.mock("./quota.js", () => ({ checkTransactionQuota: async () => ({ allowed: true }) }))
vi.mock("./notifications.js", () => ({ createNotification: async () => undefined }))
vi.mock("./notify-budget.js", () => ({ notifyIfBudgetExceeded: async () => undefined }))
vi.mock("./audit.js", () => ({ logAudit: async () => undefined }))
vi.mock("./recurring-debt.js", () => ({ mirrorDebtSchedule: vi.fn(), postDebtOccurrences: vi.fn(), reloadRule: vi.fn() }))

const { autoSaveReceivedAmount, isRecurringOnceClash, materializeDueRecurring } = await import("./recurring-materialize.js")
const { todayIso } = await import("../../src/lib/recurring.js")

const today = todayIso()
const rule = {
  id: "rule-1", name: "Auto-save to Trip", kind: "transfer", type: "outgoing", amount: "1000.00", currencyCode: "INR",
  wealthAccountId: "bank-inr", toAccountId: "space-eur", cardId: null, clientId: null, debtAccountId: null,
  startDate: today, nextDueAt: today, endDate: null, frequencyUnit: "month", frequencyInterval: 1, createdBy: "user-1",
}

function queueOneDueOccurrence() {
  h.selects.push(
    [rule],                                            // due rules
    [{ id: "bank-inr", archivedAt: null, currencyCode: "INR" }],
    [{ id: "space-eur", archivedAt: null, currencyCode: "EUR" }],
    [],                                                // no occurrence posted yet for the date
  )
}

beforeEach(() => {
  h.selects.length = 0
  h.updates.length = 0
  h.createTransfer.mockClear()
})

describe("autoSaveReceivedAmount", () => {
  it("converts at the rate and rounds half-up to cents", () => {
    expect(autoSaveReceivedAmount("1000.00", "0.010734", "EUR")).toBe("10.73")
    expect(autoSaveReceivedAmount("10", "0.1235", "USD")).toBe("1.24")
  })
  it("gives whole units to a zero-decimal currency", () => {
    expect(autoSaveReceivedAmount("100.00", "163.456", "JPY")).toBe("16346")
  })
  it("never goes past the ledger's 2 decimals (a 3-decimal currency)", () => {
    expect(autoSaveReceivedAmount("10", "0.30714", "KWD")).toBe("3.07")
  })
  it("keeps cents for a currency Intl displays without them (IDR is 2 in ISO)", () => {
    expect(autoSaveReceivedAmount("10", "16234.5678", "IDR")).toBe("162345.68")
  })
})

describe("a cross-currency Space auto-save (MC-159)", () => {
  it("moves the source amount and books what arrives at the date's rate, as a provider rate", async () => {
    h.rate = "0.0107340000"
    queueOneDueOccurrence()
    const result = await materializeDueRecurring("org-1")
    expect(result).toEqual({ created: 1, skipped: [] })
    expect(h.createTransfer).toHaveBeenCalledTimes(1)
    expect(h.createTransfer.mock.calls[0][2]).toMatchObject({
      fromAccountId: "bank-inr", toAccountId: "space-eur", amount: "1000.00", destinationAmount: "10.73",
      rateSource: "provider", sourceCurrency: "INR", destinationCurrency: "EUR", recurringDueDate: today,
    })
    expect(h.updates.at(-1)).toMatchObject({ lastError: "" })
  })

  it("pauses at the occurrence with a coded reason when the date has no rate", async () => {
    h.rate = null
    queueOneDueOccurrence()
    const result = await materializeDueRecurring("org-1")
    expect(h.createTransfer).not.toHaveBeenCalled()
    expect(result).toEqual({ created: 0, skipped: ["Auto-save to Trip"] })
    // One write only — the reason; the cursor is NOT advanced past the date.
    expect(h.updates).toHaveLength(1)
    expect(JSON.parse(String(h.updates[0].lastError))).toMatchObject({ code: "autosave_rate_unavailable", from: "INR", to: "EUR" })
  })

  it("leaves a same-currency auto-save exactly as it was (no rate, no destination amount)", async () => {
    h.rate = "999"
    h.selects.push([rule], [{ id: "bank-inr", archivedAt: null, currencyCode: "INR" }], [{ id: "space-eur", archivedAt: null, currencyCode: "INR" }], [])
    await materializeDueRecurring("org-1")
    expect(h.createTransfer.mock.calls[0][2]).toMatchObject({ destinationAmount: undefined, rateSource: undefined, sourceCurrency: "INR", destinationCurrency: "INR" })
  })
})

describe("a parallel run that already posted the occurrence (MC-160)", () => {
  const clash = { code: "23505", constraint: "transactions_recurring_once_idx", message: 'duplicate key value violates unique constraint "transactions_recurring_once_idx"' }

  it("recognises the once-per-date clash however it is wrapped, and nothing else", () => {
    expect(isRecurringOnceClash(clash)).toBe(true)
    expect(isRecurringOnceClash(Object.assign(new Error("Failed query: insert …"), { cause: clash }))).toBe(true)
    expect(isRecurringOnceClash({ code: "23505", constraint: "transfers_group_unique" })).toBe(false)
    expect(isRecurringOnceClash({ code: "23503", constraint: "transactions_recurring_once_idx" })).toBe(false)
    expect(isRecurringOnceClash(new Error("fetch failed"))).toBe(false)
  })

  it("skips the occurrence and leaves no error on the rule", async () => {
    h.createTransfer.mockRejectedValueOnce(clash)
    h.selects.push([rule], [{ id: "bank-inr", archivedAt: null, currencyCode: "INR" }], [{ id: "space-eur", archivedAt: null, currencyCode: "INR" }], [])
    const result = await materializeDueRecurring("org-1")
    expect(result).toEqual({ created: 0, skipped: [] })
    // The only write is the cursor advance, which clears last_error.
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).toMatchObject({ lastError: "" })
  })

  it("still records any other failure on the rule", async () => {
    h.createTransfer.mockRejectedValueOnce(new Error("boom"))
    h.selects.push([rule], [{ id: "bank-inr", archivedAt: null, currencyCode: "INR" }], [{ id: "space-eur", archivedAt: null, currencyCode: "INR" }], [])
    const result = await materializeDueRecurring("org-1")
    expect(result.skipped).toEqual(["Auto-save to Trip"])
    expect(JSON.parse(String(h.updates.at(-1)?.lastError))).toMatchObject({ code: "recurring_failed" })
  })
})
