import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { plans, subscriptions } from "../../src/lib/db/schema"
import { requireAuth } from "../_lib/auth"

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

  const rows = await db.select().from(plans).orderBy(asc(plans.key))

  const enriched = rows.map((p) => {
    const geo = (p.geoPricing as Record<string, GeoPricingEntry>) ?? {}
    const local = geo[country]
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
            monthly_discount_pct: p.monthlyDiscountPct,
            yearly_discount_pct: p.yearlyDiscountPct,
          },
    }
  })

  // Current org subscription
  const [currentSub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))

  return res.json({
    plans: enriched,
    currentSubscription: currentSub ? serialize(currentSub) : null,
    detectedCountry: country,
  })
}
