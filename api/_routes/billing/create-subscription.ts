import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db"
import { plans, subscriptions, userProfiles } from "../../../src/lib/db/schema"
import { requireAuth } from "../../_lib/auth"
import { createSubscription, isDodoConfigured, productIdForPlan } from "../../_lib/dodo"

function originFromRequest(req: VercelRequest): string {
  const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host || "localhost:3000"
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")
  return `${proto}://${host}`
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

  const [existing] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))
    .orderBy(desc(subscriptions.updatedAt))

  // Free plan: just upsert the row to free/active.
  if (plan_key === "free") {
    const freeValues = {
      planKey: "free",
      status: "active" as const,
      billingCycle: null,
      provider: null,
      providerSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAt: null,
      cancelledAt: null,
      updatedAt: new Date(),
    }
    const [row] = existing
      ? await db.update(subscriptions).set(freeValues).where(eq(subscriptions.id, existing.id)).returning()
      : await db.insert(subscriptions).values({ organizationId: ctx.orgId, ...freeValues }).returning()
    if (!row) return res.status(500).json({ error: "Failed to update subscription" })
    return res.json({ subscription: serialize(row), message: "Switched to the Free plan." })
  }

  const billing = (cycle ?? "monthly") as "monthly" | "yearly"

  // Dev/test stub when Dodo isn't configured: mark active so quotas unlock for local testing.
  if (!isDodoConfigured()) {
    const expiry = new Date()
    expiry.setMonth(expiry.getMonth() + (billing === "yearly" ? 12 : 1))
    const stubValues = {
      planKey: plan_key,
      status: "active" as const,
      billingCycle: billing,
      provider: "stub",
      providerSubscriptionId: `stub_${ctx.orgId}`,
      currentPeriodEnd: expiry,
      cancelAt: null,
      cancelledAt: null,
      updatedAt: new Date(),
    }
    const [row] = existing
      ? await db.update(subscriptions).set(stubValues).where(eq(subscriptions.id, existing.id)).returning()
      : await db.insert(subscriptions).values({ organizationId: ctx.orgId, ...stubValues }).returning()
    if (!row) return res.status(500).json({ error: "Failed to update subscription" })
    return res.json({
      subscription: serialize(row),
      checkout_url: null,
      message: "Stub mode: Dodo credentials not configured. Subscription marked active for testing.",
    })
  }

  const productId = productIdForPlan(plan_key, billing)
  if (!productId) {
    return res.status(400).json({ error: `No Dodo product configured for plan "${plan_key}" (${billing}).` })
  }

  // Customer details for the hosted checkout (the buyer confirms billing on Dodo's page).
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, ctx.userId))
  const email = profile?.email ?? `${ctx.userId}@users.noreply.profitsync.app`
  const name = profile?.fullName?.trim() || email.split("@")[0]
  const country = (req.headers["x-vercel-ip-country"] as string | undefined)?.toUpperCase() || "US"

  try {
    const sub = await createSubscription({
      productId,
      quantity: 1,
      customer: { email, name },
      billing: { country },
      returnUrl: `${originFromRequest(req)}/subscription?dodo=return`,
      metadata: { organization_id: ctx.orgId, plan_key, billing_cycle: billing },
    })

    const pendingValues = {
      planKey: plan_key,
      status: "pending",
      billingCycle: billing,
      provider: "dodo",
      providerSubscriptionId: sub.subscription_id,
      currentPeriodEnd: null,
      cancelAt: null,
      cancelledAt: null,
      updatedAt: new Date(),
    }
    if (existing) {
      await db.update(subscriptions).set(pendingValues).where(eq(subscriptions.id, existing.id))
    } else {
      await db.insert(subscriptions).values({ organizationId: ctx.orgId, ...pendingValues })
    }

    return res.json({
      checkout_url: sub.payment_link,
      provider_subscription_id: sub.subscription_id,
      provider: "dodo",
    })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo Payments failure" })
  }
}
