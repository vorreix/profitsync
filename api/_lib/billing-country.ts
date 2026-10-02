// The billing country — resolved ONE way for the pricing page AND checkout.
//
// They used to disagree: pricing read Vercel's IP geo, checkout preferred the
// profile country. A user whose profile says IN browsing from a US IP saw USD
// prices and was charged INR on Dodo's hosted page (MC-109). The saved profile
// country wins (it seeds the billing address the buyer confirms on the hosted
// page), then the IP geo, then US. Pure — the routes pass the two inputs.
export function billingCountry(profileCountry: string | null | undefined, ipCountry: string | string[] | undefined): string {
  for (const v of [profileCountry, ipCountry]) {
    const c = typeof v === "string" ? v.trim().toUpperCase() : ""
    if (/^[A-Z]{2}$/.test(c)) return c
  }
  return "US"
}
