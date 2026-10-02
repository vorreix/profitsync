import { describe, expect, it } from "vitest"
import { amountFailure, raisedFailure, raisedToken } from "./wealth-accounts"
import { transferAmounts } from "../../src/lib/money"

// What the neon-http driver throws for `RAISE EXCEPTION 'token' USING ERRCODE = 'P0001'`,
// bare and as Drizzle wraps it.
const pgRaise = (token: string) => Object.assign(new Error(token), { code: "P0001" })
const wrapped = (cause: unknown) => Object.assign(new Error("Failed query: select * from set_transfer_trashed(...)"), { cause })

describe("a bare amount across currencies (MC-105)", () => {
  const thrown = (() => {
    try { transferAmounts({ sourceAmount: "10", sourceCurrency: "EUR", destinationCurrency: "USD" }) } catch (e) { return e }
  })()
  const pair = { fromAccountId: "a", toAccountId: "b" }

  it("tells a build that only knows `amount` to update — same code", () => {
    expect(amountFailure(thrown, { ...pair, amount: 10 })).toMatchObject({ status: 400, body: { code: "destination_amount_required", error: expect.stringMatching(/Update the app/) } })
  })

  it("keeps the plain sentence for a current client that names its currencies", () => {
    const body = amountFailure(thrown, { ...pair, sourceAmount: "10", sourceCurrency: "EUR", destinationCurrency: "USD" }).body
    expect(body.code).toBe("destination_amount_required")
    expect(body.error).not.toMatch(/Update the app/)
  })
})

describe("ledger-function refusals (MC-154, MC-067)", () => {
  it("reads the raised token however it is wrapped", () => {
    expect(raisedToken(pgRaise("reversal_linked_transfer_is_immutable"))).toBe("reversal_linked_transfer_is_immutable")
    expect(raisedToken(wrapped(pgRaise("transfer_account_currency_changed")))).toBe("transfer_account_currency_changed")
    expect(raisedToken(Object.assign(new Error("function set_transfer_trashed does not exist"), { code: "42883" }))).toBeNull()
  })

  it("gives each known refusal its own code", () => {
    expect(raisedFailure(wrapped(pgRaise("reversal_linked_transfer_is_immutable")))).toMatchObject({ status: 409, body: { code: "reversal_linked_transfer_is_immutable" } })
    expect(raisedFailure(pgRaise("transfer_account_currency_changed"))).toMatchObject({ status: 409, body: { code: "transfer_account_currency_changed" } })
    expect(raisedFailure(pgRaise("transfer_account_unavailable"))).toMatchObject({ status: 409, body: { code: "transfer_account_unavailable" } })
    expect(raisedFailure(pgRaise("transfer_not_found"))).toMatchObject({ status: 404 })
  })

  it("re-throws an outage or a missing function instead of hiding it as a 409", () => {
    const missing = Object.assign(new Error("function set_transfer_trashed(uuid) does not exist"), { code: "42883" })
    expect(() => raisedFailure(wrapped(missing))).toThrow(/Failed query/)
    expect(() => raisedFailure(new Error("fetch failed"))).toThrow("fetch failed")
    expect(() => raisedFailure(pgRaise("some_new_unmapped_token"))).toThrow("some_new_unmapped_token")
  })
})
