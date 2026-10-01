import Decimal from "decimal.js"
import { CURRENCY_LIST } from "./currencies.js"

export type CurrencyCode = string & { readonly __currencyCode: unique symbol }
export type DecimalString = string & { readonly __decimalString: unique symbol }
export type Money = Readonly<{ amount: DecimalString; currency: CurrencyCode }>

const CURRENCY_CODES = new Set(CURRENCY_LIST.map(({ code }) => code))

export class CurrencyMismatchError extends Error {
  constructor(left: string, right: string) {
    super(`Cannot combine ${left} and ${right} without an explicit exchange rate`)
    this.name = "CurrencyMismatchError"
  }
}

/** Normalize and validate a currency at an API/domain boundary. */
export function normalizeCurrencyCode(value: string): CurrencyCode {
  const code = value.trim().toUpperCase()
  if (!CURRENCY_CODES.has(code)) throw new RangeError(`Unsupported currency code: ${value}`)
  return code as CurrencyCode
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && CURRENCY_CODES.has(value.trim().toUpperCase())
}

function decimalString(value: Decimal.Value): DecimalString {
  const amount = new Decimal(value)
  if (!amount.isFinite()) throw new RangeError("Money amount must be finite")
  return amount.toFixed() as DecimalString
}

export function decimalMoney(amount: Decimal.Value, currency: string): Money {
  return Object.freeze({ amount: decimalString(amount), currency: normalizeCurrencyCode(currency) })
}

function sameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) throw new CurrencyMismatchError(left.currency, right.currency)
}

export function addMoney(left: Money, right: Money): Money {
  sameCurrency(left, right)
  return decimalMoney(new Decimal(left.amount).plus(right.amount), left.currency)
}

export function subtractMoney(left: Money, right: Money): Money {
  sameCurrency(left, right)
  return decimalMoney(new Decimal(left.amount).minus(right.amount), left.currency)
}

export function multiplyMoney(value: Money, multiplier: Decimal.Value): Money {
  return decimalMoney(new Decimal(value.amount).times(multiplier), value.currency)
}

export function compareMoney(left: Money, right: Money): number {
  sameCurrency(left, right)
  return new Decimal(left.amount).cmp(right.amount)
}

export type FxRate = Readonly<{
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  rate: DecimalString
}>

export function decimalFxRate(baseCurrency: string, quoteCurrency: string, rate: Decimal.Value): FxRate {
  const normalized = decimalString(rate)
  if (new Decimal(normalized).lte(0)) throw new RangeError("Exchange rate must be greater than zero")
  return Object.freeze({
    baseCurrency: normalizeCurrencyCode(baseCurrency),
    quoteCurrency: normalizeCurrencyCode(quoteCurrency),
    rate: normalized,
  })
}

/** Explicit conversion only. The rate means one base unit equals `rate` quote units. */
export function convertMoney(value: Money, rate: FxRate): Money {
  if (value.currency !== rate.baseCurrency) {
    throw new CurrencyMismatchError(value.currency, rate.baseCurrency)
  }
  return decimalMoney(new Decimal(value.amount).times(rate.rate), rate.quoteCurrency)
}

export function formatDecimalMoney(value: Money, locale?: string | string[]): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
  }).format(new Decimal(value.amount).toNumber())
}

export type TransferAmounts = Readonly<{
  sourceAmount: DecimalString
  destinationAmount: DecimalString
  sourceFeeAmount: DecimalString
  /** Quote direction is always destination currency units per one source currency unit. */
  effectiveRate: DecimalString | null
  inverseRate: DecimalString | null
}>

/**
 * Why a ledger amount was refused. ONE code per reason, so the API can answer
 * with it and every client can say it in the reader's language — the English
 * message on the error is only for logs and pinned old builds (MC-152).
 */
export type AmountProblem =
  | "amount_invalid"
  | "amount_not_positive"
  | "amount_too_many_decimals"
  | "amount_too_large"
  | "destination_amount_required"
  | "same_currency_amounts_differ"
  | "fee_invalid"

export type AmountField = "source" | "destination" | "fee"

/** A refused transfer amount: `code` says why, `field` which input. Still a RangeError for older catch sites. */
export class AmountError extends RangeError {
  readonly code: AmountProblem
  readonly field: AmountField
  constructor(code: AmountProblem, field: AmountField, message: string) {
    super(message)
    this.name = "AmountError"
    this.code = code
    this.field = field
  }
}

const FIELD_LABEL: Record<AmountField, string> = { source: "Source amount", destination: "Destination amount", fee: "Source fee" }

// `new Decimal("")` throws "[DecimalError] Invalid argument: " — a library
// internal that once reached the user as the whole error message. Parse here,
// so a blank or non-numeric field is an ordinary `amount_invalid`.
function parseAmount(value: unknown, field: AmountField): Decimal {
  try {
    if (value == null || String(value).trim() === "") throw new Error()
    const amount = new Decimal(value as Decimal.Value)
    if (!amount.isFinite()) throw new Error()
    return amount
  } catch {
    throw new AmountError("amount_invalid", field, `${FIELD_LABEL[field]} is not a number`)
  }
}

function positiveLedgerAmount(value: unknown, field: AmountField): Decimal {
  const label = FIELD_LABEL[field]
  const amount = parseAmount(value, field)
  if (amount.lte(0)) throw new AmountError("amount_not_positive", field, `${label} must be greater than zero`)
  if (amount.decimalPlaces() > 2) throw new AmountError("amount_too_many_decimals", field, `${label} supports at most 2 decimal places`)
  if (amount.abs().gt(MAX_MONEY)) throw new AmountError("amount_too_large", field, `${label} is too large`)
  return amount
}

/**
 * The same check the server runs on a transfer amount, for a form to run
 * before it submits: null when `value` is a valid ledger amount, else why not.
 */
export function ledgerAmountProblem(value: unknown): AmountProblem | null {
  try {
    positiveLedgerAmount(value, "source")
    return null
  } catch (error) {
    return error instanceof AmountError ? error.code : "amount_invalid"
  }
}

/** Builds immutable historical principal facts without using binary floating point. */
export function transferAmounts(input: {
  sourceAmount: unknown
  destinationAmount?: unknown
  sourceFeeAmount?: unknown
  sourceCurrency: string
  destinationCurrency: string
}): TransferAmounts {
  const sourceCurrency = normalizeCurrencyCode(input.sourceCurrency)
  const destinationCurrency = normalizeCurrencyCode(input.destinationCurrency)
  const source = positiveLedgerAmount(input.sourceAmount, "source")
  const fee = input.sourceFeeAmount == null || String(input.sourceFeeAmount).trim() === ""
    ? new Decimal(0)
    : parseAmount(input.sourceFeeAmount, "fee")
  if (fee.lt(0) || fee.decimalPlaces() > 2 || fee.gt(MAX_MONEY)) {
    throw new AmountError("fee_invalid", "fee", "Source fee must be a non-negative amount with at most 2 decimal places")
  }

  let destination: Decimal
  if (sourceCurrency === destinationCurrency) {
    destination = input.destinationAmount == null || String(input.destinationAmount).trim() === ""
      ? source
      : positiveLedgerAmount(input.destinationAmount, "destination")
    if (!destination.eq(source)) throw new AmountError("same_currency_amounts_differ", "destination", "Same-currency transfer principal amounts must match")
  } else {
    if (input.destinationAmount == null || String(input.destinationAmount).trim() === "") {
      throw new AmountError("destination_amount_required", "destination", "Destination amount is required for a cross-currency transfer")
    }
    destination = positiveLedgerAmount(input.destinationAmount, "destination")
  }

  const effectiveRate = sourceCurrency === destinationCurrency ? null : destination.div(source)
  return Object.freeze({
    sourceAmount: source.toFixed(2) as DecimalString,
    destinationAmount: destination.toFixed(2) as DecimalString,
    sourceFeeAmount: fee.toFixed(2) as DecimalString,
    effectiveRate: effectiveRate?.toDecimalPlaces(14).toFixed() as DecimalString | null,
    inverseRate: effectiveRate ? new Decimal(1).div(effectiveRate).toDecimalPlaces(14).toFixed() as DecimalString : null,
  })
}

/** Reversal facts swap the original native principals and refund the original source fee. */
export function reversalTransferAmounts(input: {
  sourceAmount: Decimal.Value
  destinationAmount: Decimal.Value
  sourceFeeAmount?: Decimal.Value | null
  sourceCurrency: string
  destinationCurrency: string
}) {
  const reversed = transferAmounts({
    sourceAmount: input.destinationAmount,
    destinationAmount: input.sourceAmount,
    sourceCurrency: input.destinationCurrency,
    destinationCurrency: input.sourceCurrency,
  })
  const originalFee = input.sourceFeeAmount == null ? new Decimal(0) : new Decimal(input.sourceFeeAmount)
  if (!originalFee.isFinite() || originalFee.lt(0) || originalFee.decimalPlaces() > 2) throw new RangeError("Original transfer fee is invalid")
  return Object.freeze({ ...reversed, destinationFeeRefundAmount: originalFee.toFixed(2) as DecimalString })
}

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
