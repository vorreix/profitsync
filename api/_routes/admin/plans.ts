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

/**
 * Discounted price (USD string) from a base USD string + percentage.
 * Rounds the discounted cents the same way Dodo does, so the figure shown here
 * matches what Dodo actually charges (its `recurring_pre_tax_amount`).
 */
function discountedUsd(priceUsd: string, pct: number): string {
  const minor = Math.round(parseFloat(priceUsd || "0") * 100)
  const disc = Math.round(minor * (1 - pct / 100))
  return (disc / 100).toFixed(2)
}

type CycleInfo = {
  product_id: string
  name: string
  description: string
  price_usd: string
  discount_pct: number
  discounted_usd: string
  interval: "monthly" | "yearly" | null
  trial_days: number
  recurring: boolean
  currency: string
  image: string | null
  tax_category: string | null
  metadata: Record<string, string>
}

type Preview = {
  name?: string
  description?: string
  currency: string
  monthly: CycleInfo | null
  yearly: CycleInfo | null
  // Raw, full data synced from Dodo (per cycle) — stored on the plan for display.
  dodo_metadata: { monthly?: CycleInfo; yearly?: CycleInfo }
  warnings: string[]
}

/**
 * Pull everything we can about a plan from its Dodo product IDs: name,
 * description, per-cycle price + discount (and the resulting discounted price),
 * currency, billing interval and trial. Never throws — failures become warnings.
 */
async function previewFromDodo(monthlyId?: string | null, yearlyId?: string | null): Promise<Preview> {
  const warnings: string[] = []
  const out: Preview = { currency: "USD", monthly: null, yearly: null, dodo_metadata: {}, warnings }
  if (!isDodoConfigured()) {
    warnings.push("Dodo Payments isn't configured — enter the values manually.")
    return out
  }

  const cycles: Array<["monthly" | "yearly", string | null | undefined]> = [
    ["monthly", monthlyId],
    ["yearly", yearlyId],
  ]
  for (const [cycle, id] of cycles) {
    if (!id) continue
    try {
      const product = await getProduct(id)
      const d = priceFromProduct(product)
      out.currency = d.currency || out.currency
      // Sync the plan name + description from Dodo (first product that has them).
      if (!out.name && d.name) out.name = cleanProductName(d.name)
      if (!out.description && d.description) out.description = d.description
      const priceUsd = (d.minor / 100).toFixed(2)
      const info: CycleInfo = {
        product_id: id,
        name: d.name,
        description: d.description,
        price_usd: priceUsd,
        discount_pct: d.discountPct,
        discounted_usd: discountedUsd(priceUsd, d.discountPct),
        interval: d.interval,
        trial_days: d.trialDays,
        recurring: d.recurring,
        currency: d.currency,
        image: d.image,
        tax_category: d.taxCategory,
        metadata: d.metadata,
      }
      out.dodo_metadata[cycle] = info
      if (cycle === "monthly") {
        out.monthly = info
        if (d.interval && d.interval !== "monthly") warnings.push(`Monthly product bills ${d.interval}, not monthly.`)
      } else {
        out.yearly = info
        if (d.interval && d.interval !== "yearly") warnings.push(`Yearly product bills ${d.interval}, not yearly.`)
      }
    } catch (err) {
      warnings.push(`${cycle} product: ${err instanceof Error ? err.message : "lookup failed"}`)
    }
  }
  return out
}

/** Map a preview onto plan DB columns (only the fields Dodo provides). */
function previewToColumns(p: Preview): Record<string, unknown> {
  const cols: Record<string, unknown> = {}
  if (p.name !== undefined) cols.name = p.name
  if (p.description !== undefined) cols.description = p.description
  if (p.monthly) {
    cols.monthlyPriceUsd = p.monthly.price_usd
    cols.monthlyDiscountPct = p.monthly.discount_pct
  }
  if (p.yearly) {
    cols.yearlyPriceUsd = p.yearly.price_usd
    cols.yearlyDiscountPct = p.yearly.discount_pct
  }
  cols.dodoMetadata = p.dodo_metadata
  return cols
}

type PlanBody = {
  plan_id?: string
  key?: string
  name?: string
  description?: string
  account_type?: string
  is_active?: boolean
  monthly_price_usd?: number | string
  yearly_price_usd?: number | string
  monthly_discount_pct?: number
  yearly_discount_pct?: number
  dodo_product_monthly?: string | null
  dodo_product_yearly?: string | null
  limits?: Record<string, unknown>
  feature_labels?: Record<string, unknown>
  dodo_metadata?: Record<string, unknown>
  geo_pricing?: Record<string, unknown>
  derive?: boolean
  preview?: boolean
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

    // Wizard preview: fetch Dodo product data and return it WITHOUT saving.
    if (body.preview) {
      const preview = await previewFromDodo(body.dodo_product_monthly, body.dodo_product_yearly)
      return res.json(preview)
    }

    const key = body.key?.trim().toLowerCase()
    if (!key) return res.status(400).json({ error: "key is required" })
    if (!/^[a-z0-9_-]+$/.test(key)) return res.status(400).json({ error: "key must be lowercase alphanumeric" })
    if (body.account_type !== undefined && body.account_type !== null && !VALID_ACCOUNT_TYPES.has(body.account_type)) {
      return res.status(400).json({ error: "account_type must be personal or business" })
    }
    const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, key))
    if (existing) return res.status(409).json({ error: `A plan with key "${key}" already exists` })

    const derived = body.derive ? await previewFromDodo(body.dodo_product_monthly, body.dodo_product_yearly) : null
    const dcols = derived ? previewToColumns(derived) : {}

    const [created] = await db
      .insert(plans)
      .values({
        key,
        name: ((dcols.name as string) ?? body.name ?? key).trim(),
        description: (dcols.description as string) ?? body.description ?? "",
        accountType: body.account_type ?? null,
        isActive: body.is_active ?? true,
        monthlyPriceUsd: String((dcols.monthlyPriceUsd as string) ?? body.monthly_price_usd ?? "0"),
        yearlyPriceUsd: String((dcols.yearlyPriceUsd as string) ?? body.yearly_price_usd ?? "0"),
        monthlyDiscountPct: (dcols.monthlyDiscountPct as number) ?? body.monthly_discount_pct ?? 0,
        yearlyDiscountPct: (dcols.yearlyDiscountPct as number) ?? body.yearly_discount_pct ?? 0,
        dodoProductMonthly: body.dodo_product_monthly ?? null,
        dodoProductYearly: body.dodo_product_yearly ?? null,
        limits: body.limits ?? {},
        featureLabels: body.feature_labels ?? {},
        dodoMetadata: (dcols.dodoMetadata as Record<string, unknown>) ?? body.dodo_metadata ?? {},
        geoPricing: body.geo_pricing ?? {},
      })
      .returning()
    return res.status(201).json({ ...serialize(created), _warnings: derived?.warnings ?? [] })
  }

  if (req.method === "PATCH") {
    const body = req.body as PlanBody
    const { plan_id } = body
    if (!plan_id) return res.status(400).json({ error: "plan_id is required" })
    if (body.account_type !== undefined && body.account_type !== null && !VALID_ACCOUNT_TYPES.has(body.account_type)) {
      return res.status(400).json({ error: "account_type must be personal or business" })
    }

    // When asked to derive, fetch name/description/price/discount from Dodo.
    const derived = body.derive ? await previewFromDodo(body.dodo_product_monthly, body.dodo_product_yearly) : null
    const dcols = derived ? previewToColumns(derived) : {}

    const [updated] = await db
      .update(plans)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.account_type !== undefined ? { accountType: body.account_type } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
        ...(body.monthly_price_usd !== undefined ? { monthlyPriceUsd: String(body.monthly_price_usd) } : {}),
        ...(body.yearly_price_usd !== undefined ? { yearlyPriceUsd: String(body.yearly_price_usd) } : {}),
        ...(body.monthly_discount_pct !== undefined ? { monthlyDiscountPct: body.monthly_discount_pct } : {}),
        ...(body.yearly_discount_pct !== undefined ? { yearlyDiscountPct: body.yearly_discount_pct } : {}),
        ...(body.dodo_product_monthly !== undefined ? { dodoProductMonthly: body.dodo_product_monthly } : {}),
        ...(body.dodo_product_yearly !== undefined ? { dodoProductYearly: body.dodo_product_yearly } : {}),
        ...(body.limits !== undefined ? { limits: body.limits } : {}),
        ...(body.feature_labels !== undefined ? { featureLabels: body.feature_labels } : {}),
        ...(body.dodo_metadata !== undefined ? { dodoMetadata: body.dodo_metadata } : {}),
        ...(body.geo_pricing !== undefined ? { geoPricing: body.geo_pricing } : {}),
        ...dcols, // derived values win when derive=true
        updatedAt: new Date(),
      })
      .where(eq(plans.id, plan_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json({ ...serialize(updated), _warnings: derived?.warnings ?? [] })
  }

  if (req.method === "DELETE") {
    // Removes the plan row from ProfitSync only. The Dodo product is intentionally
    // left untouched (we never call Dodo's delete API here).
    const plan_id = (req.body as PlanBody)?.plan_id ?? (req.query.plan_id as string | undefined)
    if (!plan_id) return res.status(400).json({ error: "plan_id is required" })
    // The Free plan is mandatory for every user/org and must never be removed.
    // Guarded here, and again by a BEFORE DELETE trigger at the database level.
    const [target] = await db.select({ key: plans.key }).from(plans).where(eq(plans.id, plan_id))
    if (!target) return res.status(404).json({ error: "Not found" })
    if (target.key === "free") {
      return res.status(403).json({ error: "The Free plan is required and cannot be deleted." })
    }
    const [deleted] = await db
      .delete(plans)
      .where(eq(plans.id, plan_id))
      .returning({ id: plans.id, key: plans.key })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.json({ deleted: true, id: deleted.id, key: deleted.key })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
