import { describe, expect, it } from "vitest"
import {
  AmountError,
  CurrencyMismatchError,
  addMoney,
  compareMoney,
  convertMoney,
  decimalFxRate,
  decimalMoney,
  formatDecimalMoney,
  amountInputProps,
  ledgerAmountProblem,
  moneyDecimals,
  moneyRefusal,
  multiplyMoney,
  normalizeCurrencyCode,
  reversalTransferAmounts,
  storedTransferAmounts,
  selectableCurrencyCode,
  subtractMoney,
  transferAmounts,
} from "./money"

describe("Money currency and decimal invariants", () => {
  it("normalizes supported ISO codes and rejects unknown codes", () => {
    expect(normalizeCurrencyCode(" eur ")).toBe("EUR")
    expect(normalizeCurrencyCode("inr")).toBe("INR")
    expect(() => normalizeCurrencyCode("BTC")).toThrow(RangeError)
  })

  it("performs decimal arithmetic without binary floating-point drift", () => {
    expect(addMoney(decimalMoney("0.1", "EUR"), decimalMoney("0.2", "EUR")).amount).toBe("0.3")
    expect(subtractMoney(decimalMoney("1", "EUR"), decimalMoney("0.9", "EUR")).amount).toBe("0.1")
    expect(multiplyMoney(decimalMoney("51.35", "EUR"), "10").amount).toBe("513.5")
  })

  it("refuses to add, subtract, or compare different currencies", () => {
    const eur = decimalMoney("100", "EUR")
    const inr = decimalMoney("100", "INR")
    expect(() => addMoney(eur, inr)).toThrow(CurrencyMismatchError)
    expect(() => subtractMoney(eur, inr)).toThrow(CurrencyMismatchError)
    expect(() => compareMoney(eur, inr)).toThrow(CurrencyMismatchError)
  })

  it("converts only with an explicit rate and preserves the native Money", () => {
    const source = decimalMoney("500", "EUR")
    const converted = convertMoney(source, decimalFxRate("EUR", "INR", "102.70"))
    expect(source).toEqual({ amount: "500", currency: "EUR" })
    expect(converted).toEqual({ amount: "51350", currency: "INR" })
  })

  it("rejects rate direction mistakes", () => {
    expect(() => convertMoney(decimalMoney("500", "EUR"), decimalFxRate("INR", "EUR", "0.0097")))
      .toThrow(CurrencyMismatchError)
  })

  it("uses locale-aware ISO currency precision and grouping", () => {
    expect(formatDecimalMoney(decimalMoney("123456.78", "INR"), "en-IN")).toContain("1,23,456.78")
    expect(formatDecimalMoney(decimalMoney("1234", "JPY"), "ja-JP")).not.toContain(".00")
  })
})

describe("transferAmounts", () => {
  it("preserves native principals and canonical destination-per-source rate", () => {
    const result = transferAmounts({ sourceAmount: "500", destinationAmount: "51350", sourceCurrency: "EUR", destinationCurrency: "INR" })
    expect(result).toMatchObject({ sourceAmount: "500.00", destinationAmount: "51350.00", effectiveRate: "102.7", inverseRate: "0.00973709834469" })
  })

  it("keeps a source fee outside principal FX", () => {
    const result = transferAmounts({ sourceAmount: "500", destinationAmount: "51350", sourceFeeAmount: "5", sourceCurrency: "EUR", destinationCurrency: "INR" })
    expect(result.sourceFeeAmount).toBe("5.00")
    expect(result.effectiveRate).toBe("102.7")
  })

  it("rejects missing cross-currency amounts and unequal same-currency principal", () => {
    expect(() => transferAmounts({ sourceAmount: "500", sourceCurrency: "EUR", destinationCurrency: "INR" })).toThrow(/Destination amount is required/)
    expect(() => transferAmounts({ sourceAmount: "500", destinationAmount: "499", sourceCurrency: "EUR", destinationCurrency: "EUR" })).toThrow(/must match/)
  })

  it("rejects excessive precision and negative fees", () => {
    expect(() => transferAmounts({ sourceAmount: "1.001", sourceCurrency: "EUR", destinationCurrency: "EUR" })).toThrow(/2 decimal/)
    expect(() => transferAmounts({ sourceAmount: "1", sourceFeeAmount: "-1", sourceCurrency: "EUR", destinationCurrency: "EUR" })).toThrow(/non-negative/)
  })

  it("names every refusal with its own code and never leaks Decimal.js internals (MC-152)", () => {
    const codeOf = (input: Parameters<typeof transferAmounts>[0]) => {
      try {
        transferAmounts(input)
        return null
      } catch (error) {
        expect(error).toBeInstanceOf(AmountError)
        expect((error as Error).message).not.toMatch(/DecimalError/)
        return [(error as AmountError).code, (error as AmountError).field]
      }
    }
    const same = { sourceCurrency: "EUR", destinationCurrency: "EUR" }
    expect(codeOf({ ...same, sourceAmount: "" })).toEqual(["amount_invalid", "source"])
    expect(codeOf({ ...same, sourceAmount: "abc" })).toEqual(["amount_invalid", "source"])
    expect(codeOf({ ...same, sourceAmount: "0" })).toEqual(["amount_not_positive", "source"])
    expect(codeOf({ ...same, sourceAmount: "10.555" })).toEqual(["amount_too_many_decimals", "source"])
    expect(codeOf({ ...same, sourceAmount: "99999999999999" })).toEqual(["amount_too_large", "source"])
    expect(codeOf({ ...same, sourceAmount: "10", destinationAmount: "9" })).toEqual(["same_currency_amounts_differ", "destination"])
    expect(codeOf({ ...same, sourceAmount: "10", sourceFeeAmount: "-1" })).toEqual(["fee_invalid", "fee"])
    expect(codeOf({ sourceAmount: "10", sourceCurrency: "EUR", destinationCurrency: "USD" })).toEqual(["destination_amount_required", "destination"])
    expect(codeOf({ sourceAmount: "10", destinationAmount: "1.001", sourceCurrency: "EUR", destinationCurrency: "USD" })).toEqual(["amount_too_many_decimals", "destination"])
  })

  it("lets a form run the server's amount check before it submits", () => {
    expect(ledgerAmountProblem("10.55")).toBeNull()
    expect(ledgerAmountProblem("10.555")).toBe("amount_too_many_decimals")
    expect(ledgerAmountProblem("")).toBe("amount_invalid")
    expect(ledgerAmountProblem(-1)).toBe("amount_not_positive")
  })

  it("reverses original native principals and refunds the original fee", () => {
    const reversal = reversalTransferAmounts({ sourceAmount: "500", destinationAmount: "51350", sourceFeeAmount: "5", sourceCurrency: "EUR", destinationCurrency: "INR" })
    expect(reversal).toMatchObject({ sourceAmount: "51350.00", destinationAmount: "500.00", destinationFeeRefundAmount: "5.00" })
    expect(reversal.effectiveRate).toBe("0.00973709834469")
  })
})

describe("minor units (MC-031, MC-047)", () => {
  it("writes each currency to its ISO minor units, capped at the 2 the columns keep", () => {
    expect(moneyDecimals("JPY")).toBe(0)
    expect(moneyDecimals("krw")).toBe(0)
    expect(moneyDecimals("USD")).toBe(2)
    expect(moneyDecimals("KWD")).toBe(2)
    expect(moneyDecimals(null)).toBe(2)
  })

  it("refuses what the column would silently round, with the Wave 5 codes", () => {
    expect(moneyRefusal("JPY", "1500.50")).toMatchObject({ code: "amount_whole_units" })
    expect(moneyRefusal("USD", 10.555)).toMatchObject({ code: "amount_too_many_decimals", error: "Amount supports at most 2 decimal places" })
    expect(moneyRefusal("KWD", "1.234")).toMatchObject({ code: "amount_too_many_decimals" })
    expect(moneyRefusal("INR", "abc")).toMatchObject({ code: "amount_invalid" })
    expect(moneyRefusal("INR", "99999999999999")).toMatchObject({ code: "amount_too_large" })
  })

  it("accepts every amount the column keeps exactly, any sign, and skips blanks", () => {
    expect(moneyRefusal("INR", "10.50")).toBeNull()
    expect(moneyRefusal("JPY", "1500", 1500.0, "1500.00")).toBeNull()
    expect(moneyRefusal("USD", -12.34, 0)).toBeNull()
    expect(moneyRefusal("USD", null, undefined, "")).toBeNull()
    // The first refusal wins.
    expect(moneyRefusal("JPY", "1", "2.5", "x")).toMatchObject({ code: "amount_whole_units" })
  })

  it("holds each transfer leg and the fee to its own currency", () => {
    const codeOf = (input: Parameters<typeof transferAmounts>[0]) => {
      try {
        transferAmounts(input)
        return null
      } catch (error) {
        return [(error as AmountError).code, (error as AmountError).field]
      }
    }
    expect(codeOf({ sourceAmount: "1500.5", sourceCurrency: "JPY", destinationCurrency: "JPY" })).toEqual(["amount_whole_units", "source"])
    expect(codeOf({ sourceAmount: "10", destinationAmount: "1500.5", sourceCurrency: "USD", destinationCurrency: "JPY" })).toEqual(["amount_whole_units", "destination"])
    expect(codeOf({ sourceAmount: "1500", sourceFeeAmount: "0.5", sourceCurrency: "JPY", destinationCurrency: "JPY" })).toEqual(["amount_whole_units", "fee"])
    expect(codeOf({ sourceAmount: "10", sourceFeeAmount: "0.001", sourceCurrency: "EUR", destinationCurrency: "EUR" })).toEqual(["fee_invalid", "fee"])
    expect(transferAmounts({ sourceAmount: "1500", destinationAmount: "10.25", sourceCurrency: "JPY", destinationCurrency: "USD" }).sourceAmount).toBe("1500.00")
    expect(ledgerAmountProblem("1500.5", "JPY")).toBe("amount_whole_units")
    expect(ledgerAmountProblem("1500.5")).toBeNull()
  })

  it("still reverses a legacy fractional-yen transfer", () => {
    const reversal = reversalTransferAmounts({ sourceAmount: "10.00", destinationAmount: "1497.83", sourceCurrency: "USD", destinationCurrency: "JPY" })
    expect(reversal).toMatchObject({ sourceAmount: "1497.83", destinationAmount: "10.00" })
    // createTransfer re-validates the reversal it is handed: the per-currency
    // rule refuses the ¥ leg, the stored-precision one it uses for a reversal
    // takes it unchanged.
    const leg = { sourceAmount: reversal.sourceAmount, destinationAmount: reversal.destinationAmount, sourceCurrency: "JPY", destinationCurrency: "USD" }
    expect(() => transferAmounts(leg)).toThrow(/whole/)
    expect(storedTransferAmounts(leg)).toMatchObject({ sourceAmount: "1497.83", destinationAmount: "10.00" })
    expect(() => storedTransferAmounts({ ...leg, sourceAmount: "1497.835" })).toThrow(/2 decimal/)
  })

  it("offers only storable currencies for new money, but keeps the current one", () => {
    expect(selectableCurrencyCode("eur")).toBe("EUR")
    expect(selectableCurrencyCode("KWD")).toBeNull()
    expect(selectableCurrencyCode("KWD", "kwd")).toBe("KWD")
    expect(selectableCurrencyCode("BTC")).toBeNull()
  })

  it("gives a yen input no decimal key", () => {
    expect(amountInputProps("JPY")).toEqual({ inputMode: "numeric", step: "1", placeholder: "0" })
    expect(amountInputProps("EUR")).toEqual({ inputMode: "decimal", step: "0.01", placeholder: "0.00" })
  })
})
