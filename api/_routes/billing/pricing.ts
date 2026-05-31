import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { plans, subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

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

  const country = (req.headers["x-vercel-ip-country"] as string | undefined)?.toUpperCase() ||
                  (req.query.country as string | undefined)?.toUpperCase() ||
                  "US"

  // Plans list and the org's current subscription are independent — fetch together.
  const [allRows, subRows] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.key)),
    db.select().from(subscriptions).where(eq(subscriptions.organizationId, ctx.orgId)),
  ])

  // Surface only the plans relevant to this workspace's account type (plus the
  // shared free tier). Account-type feature gating is enforced separately; this
  // just keeps the pricing screen focused on plans the org can actually buy.
  const rows = allRows.filter(
    (p) => p.isActive && (p.key === "free" || !p.accountType || p.accountType === ctx.accountType),
  )

  const enriched = rows.map((p) => {
    const geo = (p.geoPricing as Record<string, GeoPricingEntry>) ?? {}
    // Display fallback when a country has no explicit entry. Dodo (Merchant of Record)
    // presents localized currency + tax at checkout regardless of this displayed value.
    const local = geo[country] ?? geo["IN"]
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
  })
}
