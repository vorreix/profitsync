import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { plans, subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { changePlan, defaultDodoEnv, getSubscription, isDodoConfigured, type DodoEnv } from "../../_lib/dodo.js"
import { resolveScheduledChange } from "../../_lib/billing-sync.js"

/**
 * Switch the billing cycle of an active Dodo subscription (e.g. monthly → yearly).
 *
 * The change is scheduled for the next billing date: the customer keeps their
 * current plan/price until the period ends, then the new cycle takes effect and
 * is charged — no charge today. The pending switch is stored in
 * subscriptions.scheduled_change for the UI to display.
 *
 * POST body: { cycle: "monthly" | "yearly" } — the target cycle.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (ctx.role !== "owner") {
    return res.status(403).json({ error: "Only the owner can change the subscription" })
  }

  const { cycle } = req.body as { cycle?: string }
  if (!cycle || !["monthly", "yearly"].includes(cycle)) {
    return res.status(400).json({ error: "cycle must be monthly or yearly" })
  }
  const target = cycle as "monthly" | "yearly"

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))
    .orderBy(desc(subscriptions.updatedAt))

  if (!sub || sub.planKey === "free" || sub.status !== "active") {
    return res.status(400).json({ error: "No active subscription to change" })
  }
  if (sub.provider !== "dodo" || !sub.providerSubscriptionId) {
    return res.status(400).json({ error: "This subscription's billing cycle can't be changed here." })
  }
  if (sub.billingCycle === target) {
    return res.status(400).json({ error: `Already billed ${target}.` })
  }

  const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
  if (!isDodoConfigured(env)) {
    return res.status(400).json({ error: "Billing isn't configured for this plan's environment." })
  }

  const [plan] = await db.select().from(plans).where(eq(plans.key, sub.planKey))
  if (!plan) return res.status(404).json({ error: "Plan not found" })
  const productId = target === "yearly" ? plan.dodoProductYearly : plan.dodoProductMonthly
  if (!productId) {
    return res.status(400).json({ error: `No ${target} product configured for this plan.` })
  }

  try {
    // Schedule at the next billing date: the customer keeps their current plan
    // until the period ends, then the new cycle's full price is charged — no
    // charge today. Dodo requires `full_immediately` with `next_billing_date`
    // (it rejects every other proration mode for a scheduled change).
    await changePlan({
      subscriptionId: sub.providerSubscriptionId,
      productId,
      quantity: 1,
      prorationBillingMode: "full_immediately",
      effectiveAt: "next_billing_date",
      metadata: { organization_id: ctx.orgId, plan_key: sub.planKey, billing_cycle: target },
      env,
    })

    // Re-read the subscription so we capture the scheduled_change Dodo recorded.
    const remote = await getSubscription(sub.providerSubscriptionId, env)
    const scheduledChange = await resolveScheduledChange(remote.scheduled_change, sub.planKey)

    const [updated] = await db
      .update(subscriptions)
      .set({ scheduledChange, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id))
      .returning()

    return res.json({
      subscription: updated ? serialize(updated) : null,
      message: `You'll switch to ${target} billing on your next renewal. No charge today.`,
    })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo Payments error" })
  }
}
