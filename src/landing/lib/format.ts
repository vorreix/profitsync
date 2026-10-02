import { minorUnits } from "@/lib/currencies"

// Currency helpers — mirror the app's billing display so the landing shows the
// exact same numbers. Amounts from the pricing API are in the currency's minor
// units (cents, but whole yen and thousandths of a dinar).
export function formatMinor(amount: number, currency: string, locale?: string): string {
  const major = amount / 10 ** minorUnits(currency)
  try {
    // Mirror the app's billing formatter: minimumFractionDigits 0 (so $5.00 → "$5")
    // but keep cents when present (so $4.99 stays "$4.99" — never rounded to "$5").
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).format(major)
  } catch {
    // Fall back gracefully if a currency code is unknown to the runtime.
    return `${major.toLocaleString(locale)} ${currency}`
  }
}

// Round discounted cents like the payment provider does, so the displayed price
// matches the actual charge.
export function discountedAmount(amount: number, discountPct: number): number {
  return Math.round(amount * (1 - discountPct / 100))
}
