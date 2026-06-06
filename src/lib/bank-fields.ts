// Resolves which bank-account identifier fields to show (and how to label them)
// for a given country. The STORAGE is generic (account_number + routing_number +
// swift on wealth_accounts); only the LABELS change per country. Labels are
// returned as i18n keys (wealth namespace) so the UI translates them.
//
// Sources: the ~80 IBAN countries (ISO 3166-1 alpha-2) and per-market overrides
// for the formats users actually expect (IFSC in India, Sort Code in the UK,
// Routing/ABA in the US, BSB in Australia, Transit in Canada, CLABE in Mexico…).

/** ISO-3166 alpha-2 codes of countries on the IBAN standard. */
export const IBAN_COUNTRIES = new Set<string>([
  "AD", "AE", "AL", "AT", "AZ", "BA", "BE", "BG", "BH", "BR", "BY", "CH", "CR",
  "CY", "CZ", "DE", "DK", "DO", "EE", "EG", "ES", "FI", "FO", "FR", "GB", "GE",
  "GI", "GL", "GR", "GT", "HR", "HU", "IE", "IL", "IS", "IT", "JO", "KW", "KZ",
  "LB", "LC", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MR", "MT", "MU",
  "NL", "NO", "PK", "PL", "PS", "PT", "QA", "RO", "RS", "SA", "SE", "SI", "SK",
  "SM", "TN", "TR", "UA", "VA", "VG", "XK",
])

export type PrimaryFieldKey = "iban" | "accountNumber"
export type SecondaryFieldKey =
  | "ifsc"
  | "sortCode"
  | "routing"
  | "bsb"
  | "transit"
  | "bankCode"
  | "clabe"

export type AccountFieldsConfig = {
  /** Whether the country is on the IBAN standard (drives the primary field). */
  usesIban: boolean
  /** i18n key (wealth ns) for the primary identifier label. */
  primaryKey: PrimaryFieldKey
  /** i18n key (wealth ns) for the secondary identifier label, if any. */
  secondaryKey?: SecondaryFieldKey
}

// Markets where the everyday user-facing format differs from "IBAN" or needs a
// specific secondary code. Everything else falls back to IBAN-vs-account-number.
const OVERRIDES: Record<string, AccountFieldsConfig> = {
  GB: { usesIban: true, primaryKey: "accountNumber", secondaryKey: "sortCode" }, // domestic = a/c no + sort code
  US: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "routing" },
  IN: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "ifsc" },
  AU: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "bsb" },
  CA: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "transit" },
  MX: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "clabe" },
  BR: { usesIban: true, primaryKey: "accountNumber", secondaryKey: "bankCode" },
  SG: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "bankCode" },
  HK: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "bankCode" },
  JP: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "bankCode" },
  NZ: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "bankCode" },
  ZA: { usesIban: false, primaryKey: "accountNumber", secondaryKey: "bankCode" },
}

/**
 * Resolve the account-field config for a country. Unknown/blank → a sensible
 * default (Account Number, no secondary). SWIFT/BIC is always shown separately
 * (it is country-independent), so it is not part of this config.
 */
export function accountFieldsForCountry(iso2: string | null | undefined): AccountFieldsConfig {
  const cc = (iso2 ?? "").trim().toUpperCase()
  if (OVERRIDES[cc]) return OVERRIDES[cc]
  if (IBAN_COUNTRIES.has(cc)) return { usesIban: true, primaryKey: "iban" }
  return { usesIban: false, primaryKey: "accountNumber" }
}

// i18n keys (wealth namespace) for each field, so the label tracks the country.
export const PRIMARY_LABEL_KEY: Record<PrimaryFieldKey, string> = {
  iban: "fieldIban",
  accountNumber: "fieldAccountNumber",
}
export const SECONDARY_LABEL_KEY: Record<SecondaryFieldKey, string> = {
  ifsc: "fieldIfsc",
  sortCode: "fieldSortCode",
  routing: "fieldRouting",
  bsb: "fieldBsb",
  transit: "fieldTransit",
  bankCode: "fieldBankCode",
  clabe: "fieldClabe",
}
