import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { organizations, plans, subscriptions, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { billingCountry } from "../../_lib/billing-country.js"
import { localPricingFor, resolveBillingCurrency, type GeoPrice } from "../../../src/lib/billing-currency.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  // Plans list, the org's current subscription, the org's currency and the
  // viewer's profile country are independent — fetch together.
  const [allRows, subRows, [org], [profile]] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.key)),
    db.select().from(subscriptions).where(eq(subscriptions.organizationId, ctx.orgId)),
    db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    db.select({ country: userProfiles.country }).from(userProfiles).where(eq(userProfiles.id, ctx.userId)),
  ])
  // The SAME country checkout bills (create-subscription), or the price shown
  // and the currency charged can differ (MC-109).
  const country = billingCountry(profile?.country, req.headers["x-vercel-ip-country"])

  // Display the same currency the checkout will charge in (org preference with
  // the country/India safety net) so the pricing page and Dodo's hosted page
  // never disagree. See src/lib/billing-currency.ts.
  const resolved = resolveBillingCurrency(org?.currency, country)

  // Surface only the plans relevant to this workspace's account type (plus the
  // shared free tier). Account-type feature gating is enforced separately; this
  // just keeps the pricing screen focused on plans the org can actually buy.
  const rows = allRows.filter(
    (p) => p.isActive && (p.key === "free" || !p.accountType || p.accountType === ctx.accountType),
  )

  // Only a price in the currency checkout charges — never another country's.
  const enriched = rows.map((p) => ({
    ...serialize(p),
    country,
    local_pricing: localPricingFor(p.geoPricing as Record<string, GeoPrice> | null, country, resolved.currency, {
      monthlyUsd: Number(p.monthlyPriceUsd),
      yearlyUsd: Number(p.yearlyPriceUsd),
      monthlyDiscountPct: p.monthlyDiscountPct ?? 0,
      yearlyDiscountPct: p.yearlyDiscountPct ?? 0,
    }),
  }))

  const [currentSub] = subRows

  return res.json({
    plans: enriched,
    currentSubscription: currentSub ? serialize(currentSub) : null,
    detectedCountry: country,
    // The currency the checkout will charge in (org preference, country-safe).
    // A plan priced in another currency (the USD base) shows it beside the price.
    billing_currency: resolved.currency,
    billing_currency_source: resolved.source,
  })
}
