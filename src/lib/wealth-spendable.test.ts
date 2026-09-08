import { describe, expect, it } from "vitest"
import { accountSpendableLabel } from "./wealth"

const L = {
  available: (a: string) => `${a} available`,
  owed: (a: string) => `${a} owed`,
  nothingOwed: "Nothing owed",
}
const label = (a: Parameters<typeof accountSpendableLabel>[0], visible = true) =>
  accountSpendableLabel(a, "EUR", visible, L)

describe("accountSpendableLabel", () => {
  it("shows a bank's balance unchanged", () => {
    expect(label({ type: "bank", current_balance: "2061.00" })).toBe("€2,061.00")
  })

  it("shows a credit card's REMAINING CREDIT, not its debt", () => {
    // €2,300 limit, €1,000 owed (a liability balance is negative).
    expect(label({ type: "credit_card", current_balance: "-1000.00", credit_limit: "2300.00" })).toBe("€1,300.00 available")
  })

  it("never leaks the raw negative balance", () => {
    const out = label({ type: "credit_card", current_balance: "-950.00", credit_limit: "1200.00" })
    expect(out).not.toContain("-")
    expect(out).toBe("€250.00 available")
  })

  it("reports zero rather than a negative when the card is over its limit", () => {
    expect(label({ type: "credit_card", current_balance: "-1500.00", credit_limit: "1000.00" })).toBe("€0.00 available")
  })

  it("counts an overpaid card's credit on top of its limit", () => {
    // Paid €200 more than owed: that €200 is spendable as well as the limit.
    expect(label({ type: "credit_card", current_balance: "200.00", credit_limit: "1000.00" })).toBe("€1,200.00 available")
  })

  it("falls back to what is owed when no credit limit is set", () => {
    expect(label({ type: "credit_card", current_balance: "-400.00", credit_limit: null })).toBe("€400.00 owed")
  })

  it("says nothing owed for a limitless card at zero", () => {
    expect(label({ type: "credit_card", current_balance: "0", credit_limit: null })).toBe("Nothing owed")
  })

  it("treats a zero limit as no limit", () => {
    expect(label({ type: "credit_card", current_balance: "-75.00", credit_limit: "0" })).toBe("€75.00 owed")
  })

  it("masks the figure under privacy without changing which figure it is", () => {
    const out = label({ type: "credit_card", current_balance: "-1000.00", credit_limit: "2300.00" }, false)
    expect(out).toContain("available")
    expect(out).not.toContain("1,300")
  })

  it("does not let privacy mode reveal a limitless card's debt", () => {
    const owing = label({ type: "credit_card", current_balance: "-400.00", credit_limit: null }, false)
    const clear = label({ type: "credit_card", current_balance: "0", credit_limit: null }, false)
    // Both must read the same, or the wording tells you whether anything is owed.
    expect(owing).toBe(clear)
  })
})
