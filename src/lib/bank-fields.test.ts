import { describe, expect, it } from "vitest"
import { accountFieldsForCountry, IBAN_COUNTRIES } from "./bank-fields"

describe("accountFieldsForCountry", () => {
  it("uses IBAN for SEPA/IBAN countries", () => {
    expect(accountFieldsForCountry("IT")).toEqual({ usesIban: true, primaryKey: "iban" })
    expect(accountFieldsForCountry("DE")).toEqual({ usesIban: true, primaryKey: "iban" })
    expect(accountFieldsForCountry("AE")).toEqual({ usesIban: true, primaryKey: "iban" })
  })

  it("uses Account Number + the right secondary for non-IBAN markets", () => {
    expect(accountFieldsForCountry("US")).toEqual({ usesIban: false, primaryKey: "accountNumber", secondaryKey: "routing" })
    expect(accountFieldsForCountry("IN")).toEqual({ usesIban: false, primaryKey: "accountNumber", secondaryKey: "ifsc" })
    expect(accountFieldsForCountry("AU")).toEqual({ usesIban: false, primaryKey: "accountNumber", secondaryKey: "bsb" })
    expect(accountFieldsForCountry("CA")).toEqual({ usesIban: false, primaryKey: "accountNumber", secondaryKey: "transit" })
  })

  it("treats the UK as account number + sort code despite IBAN membership", () => {
    expect(accountFieldsForCountry("GB")).toEqual({ usesIban: true, primaryKey: "accountNumber", secondaryKey: "sortCode" })
  })

  it("is case-insensitive and trims", () => {
    expect(accountFieldsForCountry(" it ")).toEqual({ usesIban: true, primaryKey: "iban" })
  })

  it("falls back to Account Number for unknown/blank countries", () => {
    expect(accountFieldsForCountry("")).toEqual({ usesIban: false, primaryKey: "accountNumber" })
    expect(accountFieldsForCountry("ZZ")).toEqual({ usesIban: false, primaryKey: "accountNumber" })
    expect(accountFieldsForCountry(null)).toEqual({ usesIban: false, primaryKey: "accountNumber" })
  })

  it("has a plausible IBAN country set", () => {
    expect(IBAN_COUNTRIES.has("IT")).toBe(true)
    expect(IBAN_COUNTRIES.has("US")).toBe(false)
    expect(IBAN_COUNTRIES.size).toBeGreaterThan(60)
  })
})
