import { describe, expect, it } from "vitest"
import { isRowCurrencyFkViolation } from "./db-errors"

describe("isRowCurrencyFkViolation", () => {
  const fk = { code: "23503", constraint: "transactions_account_currency_fk" }
  it("finds the FK violation down drizzle's cause chain", () => {
    expect(isRowCurrencyFkViolation(fk)).toBe(true)
    expect(isRowCurrencyFkViolation({ message: "Failed query", cause: fk })).toBe(true)
  })
  it("ignores other errors", () => {
    expect(isRowCurrencyFkViolation({ code: "23503", constraint: "transactions_client_id_fk" })).toBe(false)
    expect(isRowCurrencyFkViolation({ code: "23505", constraint: "transactions_account_currency_fk" })).toBe(false)
    expect(isRowCurrencyFkViolation(new Error("boom"))).toBe(false)
    expect(isRowCurrencyFkViolation(null)).toBe(false)
  })
})
