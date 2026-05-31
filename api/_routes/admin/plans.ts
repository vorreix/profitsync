import type { VercelRequest, VercelResponse } from "@vercel/node"
import { asc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { plans } from "../../../src/lib/db/schema.js"
import { requireAdmin } from "../../_lib/admin.js"
import { getProduct, isDodoConfigured, priceFromProduct } from "../../_lib/dodo.js"

const VALID_ACCOUNT_TYPES = new Set(["personal", "business"])

/** Strip cycle/TEST suffixes from a Dodo product name to get a clean plan name. */
function cleanProductName(name: string): string {
  return name
    .replace(/\s*\((monthly|yearly|month|year|annual)\)\s*/gi, " ")
    .replace(/\s*[-–]\s*test\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
}

type Derived = {
  name?: string
  monthlyPriceUsd?: string
  yearlyPriceUsd?: string
  warnings: string[]
}

/**
 * Best-effort derivation of plan name/price from Dodo products. The product IDs
 * are the source of truth; everything else is derived from Dodo where possible.
 * Never throws — failures surface as warnings so the admin can still save IDs.
 */
async function deriveFromDodo(monthlyId?: string | null, yearlyId?: string | null): Promise<Derived> {
  const warnings: string[] = []
  const out: Derived = { warnings }
  if (!isDodoConfigured()) {
    warnings.push("Dodo Payments isn't configured — saved the product IDs, kept entered price/name.")
    return out
  }
  if (monthlyId) {
    try {
      const product = await getProduct(monthlyId)
      const { minor, interval } = priceFromProduct(product)
      out.monthlyPriceUsd = (minor / 100).toFixed(2)
      if (product.name) out.name = cleanProductName(product.name)
      if (interval && interval !== "monthly") warnings.push(`Monthly product bills ${interval}, not monthly.`)
    } catch (err) {
      warnings.push(`Monthly product: ${err instanceof Error ? err.message : "lookup failed"}`)
    }
  }
  if (yearlyId) {
    try {
      const product = await getProduct(yearlyId)
      const { minor, interval } = priceFromProduct(product)
      out.yearlyPriceUsd = (minor / 100).toFixed(2)
      if (interval && interval !== "yearly") warnings.push(`Yearly product bills ${interval}, not yearly.`)
    } catch (err) {
      warnings.push(`Yearly product: ${err instanceof Error ? err.message : "lookup failed"}`)
    }
  }
  return out
}

type PlanBody = {
  plan_id?: string
  key?: string
  name?: string
  account_type?: string
  is_active?: boolean
  monthly_price_usd?: number | string
  yearly_price_usd?: number | string
  monthly_discount_pct?: number
  yearly_discount_pct?: number
  dodo_product_monthly?: string | null
  dodo_product_yearly?: string | null
  limits?: Record<string, unknown>
  geo_pricing?: Record<string, unknown>
  derive?: boolean
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    const rows = await db.select().from(plans).orderBy(asc(plans.key))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const body = req.body as PlanBody
    const key = body.key?.trim().toLowerCase()
    if (!key) return res.status(400).json({ error: "key is required" })
    if (!/^[a-z0-9_-]+$/.test(key)) return res.status(400).json({ error: "key must be lowercase alphanumeric" })
    if (body.account_type !== undefined && body.account_type !== null && !VALID_ACCOUNT_TYPES.has(body.account_type)) {
      return res.status(400).json({ error: "account_type must be personal or business" })
    }
    const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, key))
    if (existing) return res.status(409).json({ error: `A plan with key "${key}" already exists` })

    const derived = body.derive ? await deriveFromDodo(body.dodo_product_monthly, body.dodo_product_yearly) : { warnings: [] as string[] }

    const [created] = await db
      .insert(plans)
      .values({
        key,
        name: (derived.name ?? body.name ?? key).trim(),
        accountType: body.account_type ?? null,
        isActive: body.is_active ?? true,
        monthlyPriceUsd: String(derived.monthlyPriceUsd ?? body.monthly_price_usd ?? "0"),
        yearlyPriceUsd: String(derived.yearlyPriceUsd ?? body.yearly_price_usd ?? "0"),
        monthlyDiscountPct: body.monthly_discount_pct ?? 0,
        yearlyDiscountPct: body.yearly_discount_pct ?? 0,
        dodoProductMonthly: body.dodo_product_monthly ?? null,
        dodoProductYearly: body.dodo_product_yearly ?? null,
        limits: body.limits ?? {},
        geoPricing: body.geo_pricing ?? {},
      })
      .returning()
    return res.status(201).json({ ...serialize(created), _warnings: derived.warnings })
  }

  if (req.method === "PATCH") {
    const body = req.body as PlanBody
    const { plan_id } = body
    if (!plan_id) return res.status(400).json({ error: "plan_id is required" })
    if (body.account_type !== undefined && body.account_type !== null && !VALID_ACCOUNT_TYPES.has(body.account_type)) {
      return res.status(400).json({ error: "account_type must be personal or business" })
    }

    // When the admin asks to derive, fetch name/price from Dodo using the
    // (possibly newly entered) product IDs.
    const derived = body.derive ? await deriveFromDodo(body.dodo_product_monthly, body.dodo_product_yearly) : { warnings: [] as string[] }

    const [updated] = await db
      .update(plans)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(derived.name !== undefined ? { name: derived.name } : {}),
        ...(body.account_type !== undefined ? { accountType: body.account_type } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
        ...(body.monthly_price_usd !== undefined ? { monthlyPriceUsd: String(body.monthly_price_usd) } : {}),
        ...(body.yearly_price_usd !== undefined ? { yearlyPriceUsd: String(body.yearly_price_usd) } : {}),
        ...(derived.monthlyPriceUsd !== undefined ? { monthlyPriceUsd: derived.monthlyPriceUsd } : {}),
        ...(derived.yearlyPriceUsd !== undefined ? { yearlyPriceUsd: derived.yearlyPriceUsd } : {}),
        ...(body.monthly_discount_pct !== undefined ? { monthlyDiscountPct: body.monthly_discount_pct } : {}),
        ...(body.yearly_discount_pct !== undefined ? { yearlyDiscountPct: body.yearly_discount_pct } : {}),
        ...(body.dodo_product_monthly !== undefined ? { dodoProductMonthly: body.dodo_product_monthly } : {}),
        ...(body.dodo_product_yearly !== undefined ? { dodoProductYearly: body.dodo_product_yearly } : {}),
        ...(body.limits !== undefined ? { limits: body.limits } : {}),
        ...(body.geo_pricing !== undefined ? { geoPricing: body.geo_pricing } : {}),
        updatedAt: new Date(),
      })
      .where(eq(plans.id, plan_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json({ ...serialize(updated), _warnings: derived.warnings })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
