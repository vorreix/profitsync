import { describe, expect, it, vi } from "vitest"

// Capture what would be sent instead of writing it (no DB).
const sent: { type: string; body: string; data: Record<string, unknown> }[] = []
vi.mock("./notifications.js", () => ({
  notifyOrgMembers: async (_org: string, n: { type: string; body: string; data: Record<string, unknown> }) => { sent.push(n) },
}))

const { notifyAutopayFailed, notifyPaymentOverdue, notifyUtilizationHigh, AUTOPAY_FAILURE_REASONS } = await import("./notify-cards.js")

const card = { id: "c1", name: "Visa Gold", network: "visa", kind: "credit", last4: "4577", account_bank_name: "Federal", currency: "INR" } as const

describe("card notifications speak the card's currency (MC-086)", () => {
  it("formats the amount in the card's currency and carries it raw beside", async () => {
    sent.length = 0
    await notifyPaymentOverdue({ orgId: "o", card, statementId: "s1", remaining: 1800, dueDate: "2026-09-15" })
    const [n] = sent
    expect(n.body).toBe("Visa Gold •••• 4577: ₹1,800.00 was due 2026-09-15.")
    expect(n.data).toMatchObject({ amount: 1800, currency: "INR", i18nParams: { amount: "₹1,800.00", currency: "INR" } })
  })

  it("never a bare number in another currency either", async () => {
    sent.length = 0
    await notifyUtilizationHigh({ orgId: "o", card: { ...card, currency: "EUR" }, cycleStart: "2026-09-01", utilization: 0.95, available: 50 })
    expect(sent[0].body).toContain("€50.00 left")
  })

  it("an autopay failure carries a stable code and its translated body key, never a raw error", async () => {
    sent.length = 0
    await notifyAutopayFailed({ orgId: "o", card, statementId: "s1", amount: 1000, code: "autopay_not_recorded" })
    const [n] = sent
    expect(n.body).toBe(`Visa Gold •••• 4577: ₹1,000.00 was not paid — ${AUTOPAY_FAILURE_REASONS.autopay_not_recorded}. Pay it manually.`)
    expect(n.data).toMatchObject({
      reason_code: "autopay_not_recorded",
      i18nBodyKey: "types.card_autopay_failed.body",
      i18nBodyKeyAmounts: "types.card_autopay_failed.reasons.autopay_not_recorded",
    })
  })

  it("a known detail replaces the clause in push/mail only", async () => {
    sent.length = 0
    await notifyAutopayFailed({ orgId: "o", card, statementId: "s1", amount: 10, code: "autopay_quota", detail: "Free plan is limited to 30 transactions per client." })
    expect(sent[0].body).toContain("— Free plan is limited to 30 transactions per client.")
    expect(sent[0].data.reason_code).toBe("autopay_quota")
  })
})
