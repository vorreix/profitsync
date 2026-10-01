// Pure currency guards for the row and rule write paths. No I/O, so the rules
// are unit-tested (currency-guards.test.ts) instead of only living in routes.

type Refusal = { error: string; code: string }

/**
 * A move into another currency must restate the amount.
 *
 * Moving a €50 expense (or a €15 rule) onto an INR account keeps the NUMBER
 * and changes what it means — €50 silently becomes ₹50. So a write whose
 * currency changes is only accepted when the request itself carries `amount`:
 * the client clears the field and asks for it again in the new currency, and
 * an older build or a bare API call that only sends the account is refused.
 * A legacy row with no stamped currency is being stamped, not changed.
 */
export function currencyChangeRefusal(
  stored: string | null | undefined,
  next: string | null | undefined,
  amountSent: boolean,
): Refusal | null {
  if (amountSent || !stored || !next || stored.toUpperCase() === next.toUpperCase()) return null
  return {
    error: `This moves it from ${stored.toUpperCase()} to ${next.toUpperCase()} — enter the amount again in ${next.toUpperCase()}.`,
    code: "amount_required_for_currency_change",
  }
}

/**
 * Every leg of a split is one purchase, so it has ONE currency. Legs on
 * accounts in different currencies cannot be added up (₹600 + €400 is not
 * ₹1,000), and an account with no currency would post a row whose meaning
 * changes with the next reporting-currency change.
 */
export function splitCurrencyRefusal(codes: readonly (string | null | undefined)[]): { status: 400 | 409; body: Refusal } | null {
  if (codes.some((c) => !c)) return { status: 409, body: { error: "Account currency migration is incomplete", code: "currency_missing" } }
  if (new Set(codes.map((c) => c!.toUpperCase())).size > 1) {
    return { status: 400, body: { error: "Every account in a split must be in the same currency", code: "split_currency_mismatch" } }
  }
  return null
}
