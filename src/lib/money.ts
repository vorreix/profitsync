import Decimal from "decimal.js"
import { CURRENCY_LIST, isSelectableCurrency, minorUnits } from "./currencies.js"

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

/**
 * A currency NEW money may be created in (src/lib/currencies.ts
 * SELECTABLE_CURRENCY_LIST) — or null. `current` is the one the entity or its
 * workspace already uses, and always passes: re-saving an existing KWD
 * account, or adding a wallet to a KWD workspace, must keep working.
 */
export function selectableCurrencyCode(value: unknown, current?: string | null): CurrencyCode | null {
  if (!isCurrencyCode(value)) return null
  const code = normalizeCurrencyCode(value)
  return isSelectableCurrency(code) || code === current?.trim().toUpperCase() ? code : null
}

// The money columns are numeric(20, 2): a third decimal is not storable.
const STORED_DECIMALS = 2

/**
 * How many decimals an amount in `currency` may be WRITTEN with: its ISO 4217
 * minor units (JPY 0, USD 2), capped at the 2 the money columns keep. Finer
 * input was rounded by Postgres in the row while the balance statement applied
 * it unrounded, so row and balance drifted apart (MC-047), and ¥1,000.50 was
 * stored for a currency with no fractions (MC-031). Legacy null → 2.
 */
export function moneyDecimals(currency: string | null | undefined): number {
  return Math.min(minorUnits(currency ?? ""), STORED_DECIMALS)
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
  | "amount_whole_units"
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
function parseAmount(value: unknown, field: AmountField, label = FIELD_LABEL[field]): Decimal {
  try {
    if (value == null || String(value).trim() === "") throw new Error()
    const amount = new Decimal(value as Decimal.Value)
    if (!amount.isFinite()) throw new Error()
    return amount
  } catch {
    throw new AmountError("amount_invalid", field, `${label} is not a number`)
  }
}

// A currency with no minor unit gets its own code: "at most 2 decimal places"
// is the wrong thing to tell someone typing ¥1,000.50.
function tooManyDecimals(places: number, field: AmountField, label: string): AmountError {
  return places === 0
    ? new AmountError("amount_whole_units", field, `${label} must be a whole number in this currency`)
    : new AmountError("amount_too_many_decimals", field, `${label} supports at most ${places} decimal places`)
}

function ledgerAmount(value: unknown, field: AmountField, places: number, positive: boolean, label = FIELD_LABEL[field]): Decimal {
  const amount = parseAmount(value, field, label)
  if (positive && amount.lte(0)) throw new AmountError("amount_not_positive", field, `${label} must be greater than zero`)
  if (amount.decimalPlaces() > places) throw tooManyDecimals(places, field, label)
  if (amount.abs().gt(MAX_MONEY)) throw new AmountError("amount_too_large", field, `${label} is too large`)
  return amount
}

const positiveLedgerAmount = (value: unknown, field: AmountField, places: number) => ledgerAmount(value, field, places, true)

/**
 * The same check the server runs on a transfer amount, for a form to run
 * before it submits: null when `value` is a valid ledger amount in `currency`
 * (its decimal places — none for JPY), else why not.
 */
export function ledgerAmountProblem(value: unknown, currency?: string | null): AmountProblem | null {
  try {
    positiveLedgerAmount(value, "source", moneyDecimals(currency))
    return null
  } catch (error) {
    return error instanceof AmountError ? error.code : "amount_invalid"
  }
}

/** A refused amount as a route's 400 body: `{ error, code }`. */
export type AmountRefusal = { error: string; code: AmountProblem }

/**
 * The ONE check every money writer runs before it stores amounts in
 * `currency`: each is a number, has no more decimals than the currency's
 * (moneyDecimals) and is within MAX_MONEY. Any sign — a balance may be
 * negative; positivity stays the caller's rule. Blank values (null, "") are
 * skipped: whether a field is required is the caller's rule too. Returns the
 * first refusal, or null when every amount can be stored exactly.
 *
 *   const bad = moneyRefusal(account.currencyCode, amount)
 *   if (bad) return res.status(400).json(bad)
 */
export function moneyRefusal(currency: string | null | undefined, ...values: unknown[]): AmountRefusal | null {
  const places = moneyDecimals(currency)
  for (const value of values) {
    if (value == null || String(value).trim() === "") continue
    try {
      ledgerAmount(value, "source", places, false, "Amount")
    } catch (error) {
      if (error instanceof AmountError) return { error: error.message, code: error.code }
      throw error
    }
  }
  return null
}

/**
 * Props for an amount <Input> in `currency`: no decimal key and a whole-number
 * step where it has no minor unit (¥, ₩), two places elsewhere. A hint only —
 * the server (moneyRefusal) is the rule.
 */
export function amountInputProps(currency: string | null | undefined) {
  const places = moneyDecimals(currency)
  return {
    inputMode: places === 0 ? ("numeric" as const) : ("decimal" as const),
    step: places === 0 ? "1" : "0.01",
    placeholder: (0).toFixed(places),
  }
}

type TransferInput = {
  sourceAmount: unknown
  destinationAmount?: unknown
  sourceFeeAmount?: unknown
  sourceCurrency: string
  destinationCurrency: string
}

/**
 * Builds immutable historical principal facts without using binary floating
 * point. Each amount is held to its own currency's decimal places (a JPY leg
 * takes none), so createTransfer and every planned/completed transfer get the
 * same rule as a plain transaction.
 */
export function transferAmounts(input: TransferInput): TransferAmounts {
  return buildTransferAmounts(input, moneyDecimals)
}

/**
 * transferAmounts held only to what the columns keep (2 decimals), for
 * re-validating facts that are ALREADY stored: a reversal swaps a legacy
 * transfer's legs, and one recorded before minor units were enforced
 * (USD 10.00 → ¥1,497.83, which the old wizard filled as rate × sent) must
 * still be reversible — reversing is the only way to undo a transfer. So
 * createTransfer validates with this, not transferAmounts, when it is
 * writing a reversal (`reversesTransferId`).
 */
export function storedTransferAmounts(input: TransferInput): TransferAmounts {
  return buildTransferAmounts(input, () => STORED_DECIMALS)
}

function buildTransferAmounts(input: TransferInput, placesOf: (currency: string) => number): TransferAmounts {
  const sourceCurrency = normalizeCurrencyCode(input.sourceCurrency)
  const destinationCurrency = normalizeCurrencyCode(input.destinationCurrency)
  const sourcePlaces = placesOf(sourceCurrency)
  const source = positiveLedgerAmount(input.sourceAmount, "source", sourcePlaces)
  const fee = input.sourceFeeAmount == null || String(input.sourceFeeAmount).trim() === ""
    ? new Decimal(0)
    : parseAmount(input.sourceFeeAmount, "fee")
  const feeInvalid = () => new AmountError("fee_invalid", "fee", "Source fee must be a non-negative amount with at most 2 decimal places")
  if (fee.lt(0) || fee.gt(MAX_MONEY)) throw feeInvalid()
  if (fee.decimalPlaces() > sourcePlaces) throw sourcePlaces === 0 ? tooManyDecimals(0, "fee", FIELD_LABEL.fee) : feeInvalid()

  let destination: Decimal
  if (sourceCurrency === destinationCurrency) {
    destination = input.destinationAmount == null || String(input.destinationAmount).trim() === ""
      ? source
      : positiveLedgerAmount(input.destinationAmount, "destination", sourcePlaces)
    if (!destination.eq(source)) throw new AmountError("same_currency_amounts_differ", "destination", "Same-currency transfer principal amounts must match")
  } else {
    if (input.destinationAmount == null || String(input.destinationAmount).trim() === "") {
      throw new AmountError("destination_amount_required", "destination", "Destination amount is required for a cross-currency transfer")
    }
    destination = positiveLedgerAmount(input.destinationAmount, "destination", placesOf(destinationCurrency))
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
  // The original's STORED facts (storedTransferAmounts): a legacy ¥1,000.50
  // transfer must still be reversible.
  const reversed = storedTransferAmounts({
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
