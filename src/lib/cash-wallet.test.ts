import { describe, expect, it } from "vitest"
import { DEFAULT_CASH_NAME, isDefaultCash } from "./cash-wallet"

describe("isDefaultCash", () => {
  it("is only the permanent default wallet — extra cash wallets are archivable (MC-W08)", () => {
    expect(isDefaultCash({ type: "cash", bank_name: DEFAULT_CASH_NAME })).toBe(true)
    expect(isDefaultCash({ type: "cash", bank_name: "Cash EUR" })).toBe(false)
    expect(isDefaultCash({ type: "bank", bank_name: DEFAULT_CASH_NAME })).toBe(false)
    expect(isDefaultCash(null)).toBe(false)
  })
})
