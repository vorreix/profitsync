import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { plans } from "../../../src/lib/db/schema.js"

// Public pricing for the marketing landing page. This is the unauthenticated
// counterpart to /api/billing/pricing: it reads the SAME `plans` table and runs
// the SAME geo/discount logic, but requires no auth and returns no per-org
// subscription. Only public-safe plan fields are exposed (no Dodo product IDs,
// no raw metadata).
type GeoPricingEntry = {
  currency: string
  monthly: number
  yearly: number
  monthlyDiscountPct?: number
  yearlyDiscountPct?: number
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const country =
    (req.headers["x-vercel-ip-country"] as string | undefined)?.toUpperCase() ||
    (req.query.country as string | undefined)?.toUpperCase() ||
    "US"

  const allRows = await db.select().from(plans).orderBy(asc(plans.key))
  const rows = allRows.filter((p) => p.isActive)

  const enriched = rows.map((p) => {
    const geo = (p.geoPricing as Record<string, GeoPricingEntry>) ?? {}
    // Same display fallback as the in-app route: explicit country entry, then a
    // sensible default, then USD derived from the base price. The payment
    // provider localizes currency + tax at checkout regardless.
    const local = geo[country] ?? geo["IN"]
    const localPricing = local
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
        }

    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      monthly_price_usd: String(p.monthlyPriceUsd),
      yearly_price_usd: String(p.yearlyPriceUsd),
      monthly_discount_pct: p.monthlyDiscountPct,
      yearly_discount_pct: p.yearlyDiscountPct,
      promo_note: p.promoNote,
      limits: (p.limits as Record<string, number>) ?? {},
      feature_labels: (p.featureLabels as Record<string, string>) ?? {},
      country,
      local_pricing: localPricing,
    }
  })

  // Brief browser caching — pricing changes rarely and the response is per-user
  // (correct country), so this stays accurate while avoiding a DB hit per paint.
  res.setHeader("Cache-Control", "public, max-age=60")
  return res.json({ plans: enriched, detectedCountry: country })
}
