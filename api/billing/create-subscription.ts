import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { plans, subscriptions } from "../../src/lib/db/schema"
import { requireAuth } from "../_lib/auth"
import { createSubscription, getOrCreatePlan } from "../_lib/razorpay"

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (ctx.role !== "owner") {
    return res.status(403).json({ error: "Only the owner can change the subscription" })
  }

  const { plan_key, cycle } = req.body as { plan_key?: string; cycle?: string }
  if (!plan_key) return res.status(400).json({ error: "plan_key is required" })
  if (cycle && !["monthly", "yearly"].includes(cycle)) {
    return res.status(400).json({ error: "cycle must be monthly or yearly" })
  }

  const [plan] = await db.select().from(plans).where(eq(plans.key, plan_key))
  if (!plan || !plan.isActive) return res.status(404).json({ error: "Plan not available" })

  // Free plan: just upsert the row.
  if (plan_key === "free") {
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, ctx.orgId))
      .orderBy(desc(subscriptions.updatedAt))

    if (existing) {
      const [updated] = await db
        .update(subscriptions)
        .set({
          planKey: "free",
          status: "active",
          billingCycle: null,
          provider: null,
          providerSubscriptionId: null,
          currentPeriodEnd: null,
          cancelAt: null,
          cancelledAt: null,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id))
        .returning()
      return res.json({ subscription: serialize(updated) })
    }

    const [created] = await db
      .insert(subscriptions)
      .values({ organizationId: ctx.orgId, planKey: "free", status: "active" })
      .returning()
    return res.json({ subscription: serialize(created) })
  }

  // Paid plan: orchestrate Razorpay (or stub when not configured)
  const country = (req.headers["x-vercel-ip-country"] as string | undefined)?.toUpperCase() || "IN"
  const geo = (plan.geoPricing as Record<string, GeoPricingEntry>) ?? {}
  // Fall back to IN pricing when country has no entry — Razorpay only supports INR
  const local = geo[country] ?? geo["IN"]
  const billing = cycle ?? "monthly"
  const amountMinor = local
    ? billing === "yearly" ? local.yearly : local.monthly
    : Math.round(Number(billing === "yearly" ? plan.yearlyPriceUsd : plan.monthlyPriceUsd) * 100)
  const currency = local?.currency ?? "INR"

  // TEMP DEBUG — remove after we confirm Razorpay env vars are loading
  console.log("[razorpay-debug]", {
    hasKeyId: !!process.env.RAZORPAY_KEY_ID,
    keyIdPrefix: process.env.RAZORPAY_KEY_ID?.slice(0, 8) ?? null,
    hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET,
    hasWebhookSecret: !!process.env.RAZORPAY_WEBHOOK_SECRET,
  })

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    // Dev/test stub: mark as active w/o calling Razorpay so quotas unlock for testing
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, ctx.orgId))
      .orderBy(desc(subscriptions.updatedAt))

    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + (billing === "yearly" ? 12 : 1))

    const stubValues = {
      planKey: plan_key,
      status: "active" as const,
      billingCycle: billing,
      provider: "stub",
      providerSubscriptionId: `stub_${Date.now()}`,
      currentPeriodEnd: expiry,
      cancelAt: null,
      cancelledAt: null,
      updatedAt: new Date(),
    }

    const [row] = existing
      ? await db.update(subscriptions).set(stubValues).where(eq(subscriptions.id, existing.id)).returning()
      : await db.insert(subscriptions).values({ organizationId: ctx.orgId, ...stubValues }).returning()

    return res.json({
      subscription: serialize(row),
      checkout_url: null,
      message: "Stub mode: Razorpay credentials not configured. Subscription marked active for testing.",
    })
  }

  try {
    const rzpPlan = await getOrCreatePlan({
      name: `${plan.name} ${billing}`,
      amount: amountMinor,
      currency,
      interval: billing as "monthly" | "yearly",
    })
    const totalCount = billing === "yearly" ? 5 : 60
    const rzpSub = await createSubscription({
      planId: rzpPlan.id,
      totalCount,
      notes: { organization_id: ctx.orgId, plan_key },
    })

    // Upsert local subscription row in pending state until webhook activates it
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, ctx.orgId))
      .orderBy(desc(subscriptions.updatedAt))

    const upsertValues = {
      planKey: plan_key,
      status: "pending",
      billingCycle: billing,
      provider: "razorpay",
      providerSubscriptionId: rzpSub.id,
      currentPeriodEnd: rzpSub.current_end ? new Date(rzpSub.current_end * 1000) : null,
      updatedAt: new Date(),
    }

    if (existing) {
      await db.update(subscriptions).set(upsertValues).where(eq(subscriptions.id, existing.id))
    } else {
      await db.insert(subscriptions).values({ organizationId: ctx.orgId, ...upsertValues })
    }

    return res.json({
      checkout_url: rzpSub.short_url,
      provider_subscription_id: rzpSub.id,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID,
    })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Razorpay failure" })
  }
}
