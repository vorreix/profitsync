import { describe, expect, it } from "vitest"
import { accountCurrencyLockReason, type AccountCurrencyFacts } from "./account-currency-lock"

const empty: AccountCurrencyFacts = {
  type: "bank",
  currentBalance: "0.00",
  openingBalance: "0.00",
  goalAmount: null,
  hasRows: false,
  hasRecurring: false,
  hasCards: false,
  hasOpenTransfers: false,
}

describe("accountCurrencyLockReason", () => {
  it("lets an untouched bank or cash wallet change currency", () => {
    expect(accountCurrencyLockReason(empty)).toBeNull()
    expect(accountCurrencyLockReason({ ...empty, type: "cash", currentBalance: 0, openingBalance: 0 })).toBeNull()
  })

  it("locks on any row, trashed ones included (MC-062)", () => {
    expect(accountCurrencyLockReason({ ...empty, hasRows: true })).toBe("history")
  })

  it("locks a balance with no row behind it (MC-054)", () => {
    expect(accountCurrencyLockReason({ ...empty, currentBalance: "22337.85" })).toBe("balance")
    expect(accountCurrencyLockReason({ ...empty, openingBalance: "-5" })).toBe("balance")
    expect(accountCurrencyLockReason({ ...empty, currentBalance: "garbage" })).toBe("balance")
  })

  it("locks what will post into it later (MC-011)", () => {
    expect(accountCurrencyLockReason({ ...empty, hasRecurring: true })).toBe("recurring")
    expect(accountCurrencyLockReason({ ...empty, hasCards: true })).toBe("card")
    expect(accountCurrencyLockReason({ ...empty, hasOpenTransfers: true })).toBe("transfer")
  })

  it("locks cards, debts and goal Spaces from creation", () => {
    for (const type of ["credit_card", "loan", "receivable"]) {
      expect(accountCurrencyLockReason({ ...empty, type })).toBe("configured")
    }
    expect(accountCurrencyLockReason({ ...empty, type: "space", goalAmount: "1000" })).toBe("configured")
    expect(accountCurrencyLockReason({ ...empty, type: "space" })).toBeNull()
  })

  it("names history first when several facts hold", () => {
    expect(accountCurrencyLockReason({ ...empty, type: "credit_card", currentBalance: "-50", hasRows: true, hasCards: true })).toBe("history")
  })
})
