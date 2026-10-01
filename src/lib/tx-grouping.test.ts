import { describe, expect, it } from "vitest"
import { isSplitTx } from "./tx-grouping"

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
