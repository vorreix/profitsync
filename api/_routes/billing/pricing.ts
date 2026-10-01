import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { organizations, plans, subscriptions, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { billingCountry } from "../../_lib/billing-country.js"
import { resolveBillingCurrency } from "../../../src/lib/billing-currency.js"

type GeoPricingEntry = {
  currency: string
  monthly: number
  yearly: number
  monthlyDiscountPct?: number
  yearlyDiscountPct?: number
}

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

  const enriched = rows.map((p) => {
    const geo = (p.geoPricing as Record<string, GeoPricingEntry>) ?? {}
    // Pick the geo entry matching the currency the checkout will actually use:
    // the country's own entry when it matches, else any entry priced in the
    // resolved currency, else the legacy country/IN fallback. Dodo (Merchant of
    // Record) computes the final localized price + tax at checkout regardless.
    const byCountry = geo[country]
    const local =
      byCountry && byCountry.currency === resolved.currency
        ? byCountry
        : Object.values(geo).find((g) => g?.currency === resolved.currency) ??
          (resolved.currency === "USD" ? undefined : byCountry ?? geo["IN"])
    return {
      ...serialize(p),
      country,
      local_pricing: local
        ? {
            currency: local.currency,
            monthly: local.monthly,
            yearly: local.yearly,
            monthly_discount_pct: local.monthlyDiscountPct ?? 0,
            yearly_discount_pct: local.yearlyDiscountPct ?? 0,
          }
        : {
            currency: "USD",
            monthly: Math.round(Number(p.monthlyPriceUsd) * 100),
            yearly: Math.round(Number(p.yearlyPriceUsd) * 100),
            monthly_discount_pct: p.monthlyDiscountPct ?? 0,
            yearly_discount_pct: p.yearlyDiscountPct ?? 0,
          },
    }
  })

  const [currentSub] = subRows

  return res.json({
    plans: enriched,
    currentSubscription: currentSub ? serialize(currentSub) : null,
    detectedCountry: country,
    // The currency the checkout will charge in (org preference, country-safe).
    billing_currency: resolved.currency,
    billing_currency_source: resolved.source,
  })
}
