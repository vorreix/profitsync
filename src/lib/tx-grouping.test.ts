import { describe, expect, it } from "vitest"
import { isSplitTx, summarizeLegs } from "./tx-grouping"

describe("summarizeLegs", () => {
  it("sums amounts and counts distinct accounts", () => {
    const r = summarizeLegs([
      { amount: 30, wealth_account_id: "cash" },
      { amount: "25", wealth_account_id: "ac1" },
      { amount: 45, wealth_account_id: "ac2" },
    ])
    expect(r.total).toBe(100)
    expect(r.leg_count).toBe(3)
    expect(r.account_count).toBe(3)
  })

  it("treats a single leg as a non-split", () => {
    const r = summarizeLegs([{ amount: 50, wealth_account_id: "cash" }])
    expect(r).toEqual({ total: 50, leg_count: 1, account_count: 1 })
  })

  it("ignores null/empty account ids in the account count", () => {
    const r = summarizeLegs([
      { amount: 10, wealth_account_id: null },
      { amount: 20 },
    ])
    expect(r.total).toBe(30)
    expect(r.account_count).toBe(0)
  })

  it("counts two legs on the same account as one account", () => {
    const r = summarizeLegs([
      { amount: 10, wealth_account_id: "cash" },
      { amount: 20, wealth_account_id: "cash" },
    ])
    expect(r.account_count).toBe(1)
    expect(r.leg_count).toBe(2)
  })
})

describe("isSplitTx", () => {
  it("is true when leg_count > 1", () => {
    expect(isSplitTx({ leg_count: 3 })).toBe(true)
  })
  it("is false when leg_count is 1 or absent", () => {
    expect(isSplitTx({ leg_count: 1 })).toBe(false)
    expect(isSplitTx({})).toBe(false)
  })
  it("falls back to the loaded legs array length", () => {
    expect(isSplitTx({ legs: [{}, {}] })).toBe(true)
    expect(isSplitTx({ legs: [{}] })).toBe(false)
  })
})
