import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { plans } from "../../src/lib/db/schema"
import { requireAdmin } from "../_lib/admin"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    const rows = await db.select().from(plans).orderBy(asc(plans.key))
    return res.json(rows.map(serialize))
  }

  if (req.method === "PATCH") {
    const {
      plan_id,
      name,
      is_active,
      monthly_price_usd,
      yearly_price_usd,
      monthly_discount_pct,
      yearly_discount_pct,
      limits,
      geo_pricing,
    } = req.body as {
      plan_id?: string
      name?: string
      is_active?: boolean
      monthly_price_usd?: number | string
      yearly_price_usd?: number | string
      monthly_discount_pct?: number
      yearly_discount_pct?: number
      limits?: Record<string, unknown>
      geo_pricing?: Record<string, unknown>
    }
    if (!plan_id) return res.status(400).json({ error: "plan_id is required" })

    const [updated] = await db
      .update(plans)
      .set({
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(is_active !== undefined ? { isActive: is_active } : {}),
        ...(monthly_price_usd !== undefined ? { monthlyPriceUsd: String(monthly_price_usd) } : {}),
        ...(yearly_price_usd !== undefined ? { yearlyPriceUsd: String(yearly_price_usd) } : {}),
        ...(monthly_discount_pct !== undefined ? { monthlyDiscountPct: monthly_discount_pct } : {}),
        ...(yearly_discount_pct !== undefined ? { yearlyDiscountPct: yearly_discount_pct } : {}),
        ...(limits !== undefined ? { limits } : {}),
        ...(geo_pricing !== undefined ? { geoPricing: geo_pricing } : {}),
        updatedAt: new Date(),
      })
      .where(eq(plans.id, plan_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
