import { describe, expect, it } from "vitest"
import {
  CurrencyMismatchError,
  addMoney,
  compareMoney,
  convertMoney,
  decimalFxRate,
  decimalMoney,
  formatDecimalMoney,
  multiplyMoney,
  normalizeCurrencyCode,
  reversalTransferAmounts,
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

  it("reverses original native principals and refunds the original fee", () => {
    const reversal = reversalTransferAmounts({ sourceAmount: "500", destinationAmount: "51350", sourceFeeAmount: "5", sourceCurrency: "EUR", destinationCurrency: "INR" })
    expect(reversal).toMatchObject({ sourceAmount: "51350.00", destinationAmount: "500.00", destinationFeeRefundAmount: "5.00" })
    expect(reversal.effectiveRate).toBe("0.00973709834469")
  })
})
