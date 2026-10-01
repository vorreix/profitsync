import { describe, expect, it } from "vitest"
import { newAccountRefusal } from "./new-account-money"

describe("newAccountRefusal (MC-031, MC-W07)", () => {
  it("refuses what numeric(20,2) would silently round, in the account's currency", () => {
    expect(newAccountRefusal({ currency_code: "JPY", opening_balance: "1500.5" }, "USD")).toMatchObject({ code: "amount_whole_units" })
    expect(newAccountRefusal({ currency_code: "USD", opening_balance: 10.555 }, "USD")).toMatchObject({ code: "amount_too_many_decimals" })
    expect(newAccountRefusal({ currency_code: "INR", opening_balance: "10.50" }, "USD")).toBeNull()
    // No currency sent → the workspace's, and its decimals.
    expect(newAccountRefusal({ openingBalance: "1500.5" }, "JPY")).toMatchObject({ code: "amount_whole_units" })
  })

  it("checks a card's limit, debt and statement too", () => {
    expect(newAccountRefusal({ currency_code: "JPY", credit_limit: "100000", current_debt: "10.5" }, "USD")).toMatchObject({ code: "amount_whole_units" })
    expect(newAccountRefusal({ currency_code: "EUR", credit_limit: "1000", statement: { balance: "1.001" } }, "USD")).toMatchObject({ code: "amount_too_many_decimals" })
  })

  it("offers KWD only to a workspace already in it, and then to cents", () => {
    expect(newAccountRefusal({ currency_code: "KWD", opening_balance: "1" }, "USD")).toMatchObject({ code: "invalid_currency" })
    expect(newAccountRefusal({ currency_code: "KWD", opening_balance: "1.23" }, "KWD")).toBeNull()
    expect(newAccountRefusal({ currency_code: "KWD", opening_balance: "1.234" }, "KWD")).toMatchObject({ code: "amount_too_many_decimals" })
  })
})
