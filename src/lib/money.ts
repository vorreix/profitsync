// Shared monetary limits. Imported by both the client forms (validation +
// inline errors) and the API routes (defense-in-depth 400s), so the cap lives
// in exactly one place.
//
// The DB money columns are numeric(20, 2) (ceiling ~10^18), but we accept user
// input only up to MAX_MONEY — chosen so that:
//   1. amounts round-trip exactly as JS numbers (value * 100 stays below 2^53,
//      so two-decimal cents never lose precision), and
//   2. an absurd entry fails with a friendly "Amount is too large" message
//      instead of a raw Postgres numeric overflow (SQLSTATE 22003).
//
// 9,999,999,999,999.99 is ~10 trillion — comfortably above any realistic balance
// even in high-denomination currencies (e.g. IDR/VND/IRR), where 10-figure
// nominal balances are normal.
export const MAX_MONEY = 9_999_999_999_999.99

/**
 * True when `value` is a finite number whose magnitude exceeds MAX_MONEY.
 * Accepts the raw string from a form input or an already-parsed number.
 * Non-numeric / empty input returns false (those are caught by the existing
 * "amount is required" / positivity checks, not by this limit).
 */
export function amountExceedsLimit(value: number | string | null | undefined): boolean {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) && Math.abs(n) > MAX_MONEY
}
