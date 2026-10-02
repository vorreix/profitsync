// The money a NEW account carries, checked before createWealthAccount runs.
//
// createWealthAccount (wealth-accounts.ts) is shared by POST /api/wealth/accounts
// and the Cards API, and creates rows as it goes; its numeric(20,2) columns
// round whatever they are given. So a KWD opening of 1.234 became 1.23 with a
// 201, and ¥1,500.50 was stored for a currency with no fractions (MC-031,
// MC-W07). Both callers ask this first.
//
// NOTE: relative imports keep the .js extension (unbundled ESM on @vercel/node).
import { moneyRefusal, selectableCurrencyCode, type AmountRefusal } from "../../src/lib/money.js"
import type { CreateAccountInput } from "./wealth-accounts.js"

export type NewAccountRefusal = AmountRefusal | { error: string; code: "invalid_currency" }

/**
 * Null when `input` can be created exactly as sent: its currency is one new
 * money may be created in (src/lib/currencies.ts SELECTABLE_CURRENCY_LIST, or
 * the workspace's own `reporting`, which is also the default), and every
 * amount — opening balance, a card's limit, debt and statement — fits that
 * currency's decimals. Otherwise the 400 body to send.
 */
export function newAccountRefusal(input: CreateAccountInput, reporting: string): NewAccountRefusal | null {
  const currency = input.currency_code == null ? reporting : selectableCurrencyCode(input.currency_code, reporting)
  if (!currency) return { error: "Invalid currency code", code: "invalid_currency" }
  return moneyRefusal(currency, input.openingBalance ?? input.opening_balance, input.credit_limit, input.current_debt, input.statement?.balance)
}
