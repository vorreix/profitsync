// Billing-currency resolution for Dodo checkout.
//
// The organization's currency is the user's *preference* for what the checkout
// charges in; the billing country decides what Dodo's payment connectors can
// actually process. Getting this wrong breaks real payments (the original
// "Missing connector response" failure for Indian cards happened because a
// USD-only charge has no eligible Indian-card connector — and it fails on the
// HOSTED page, after checkout creation, where we can't retry). So:
//
//   1. Org currency and country currency agree → use it.
//   2. Billing country is IN → ALWAYS bill in INR (UPI + Indian card connectors
//      require it). The org-currency preference must never re-break India.
//   3. Org currency is Dodo-supported → honor the preference.
//   4. Otherwise → the country-derived currency (itself falling back to USD).
//
// Pure + DB-free so the committed test suite can lock the chain.

import { COUNTRY_TO_CURRENCY, currencyForCountry } from "./currencies"

/**
 * Currencies we know Dodo Payments can bill subscriptions in. Dodo documents
 * 80+; this conservative allowlist is every currency the checkout already
 * passes today (each derived from a billing country), so none of them can
 * regress an existing payment path.
 */
export const DODO_SUPPORTED_CURRENCIES: ReadonlySet<string> = new Set(Object.values(COUNTRY_TO_CURRENCY))

export type BillingCurrencyResolution = {
  currency: string
  /** Which rule produced the currency: the org preference or the billing country. */
  source: "org" | "country"
}

export function resolveBillingCurrency(
  orgCurrency: string | null | undefined,
  billingCountry: string | null | undefined,
): BillingCurrencyResolution {
  const org = (orgCurrency ?? "").trim().toUpperCase()
  const country = (billingCountry ?? "").trim().toUpperCase()
  const countryCurrency = currencyForCountry(country || undefined)

  if (org && org === countryCurrency) return { currency: org, source: "org" }
  if (country === "IN") return { currency: countryCurrency, source: "country" }
  if (org && DODO_SUPPORTED_CURRENCIES.has(org)) return { currency: org, source: "org" }
  return { currency: countryCurrency, source: "country" }
}

/**
 * Ordered list of `billing_currency` values to attempt at checkout creation:
 * the resolved preference first, then the country-derived currency, then
 * omitting the field entirely (Dodo bills in the product's base currency).
 * Deduped — a checkout must never fail just because of a currency preference.
 */
export function billingCurrencyAttempts(
  orgCurrency: string | null | undefined,
  billingCountry: string | null | undefined,
): (string | undefined)[] {
  const resolved = resolveBillingCurrency(orgCurrency, billingCountry).currency
  const countryCurrency = currencyForCountry((billingCountry ?? "").trim().toUpperCase() || undefined)
  const attempts: (string | undefined)[] = []
  for (const c of [resolved, countryCurrency]) if (!attempts.includes(c)) attempts.push(c)
  attempts.push(undefined)
  return attempts
}
