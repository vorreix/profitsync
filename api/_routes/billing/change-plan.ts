import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { plans, subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { cancelScheduledChange, changePlan, defaultDodoEnv, isDodoConfigured, listPayments, type DodoEnv } from "../../_lib/dodo.js"
import { reconcileSubscriptionFromDodo } from "../../_lib/billing-sync.js"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Switch the billing cycle of an active Dodo subscription (e.g. monthly → yearly).
 *
 * The switch takes effect immediately and the new cycle's full price is charged
 * right away, so the payment (and its invoice) appears at once. We then reconcile
 * from Dodo to record the new cycle + period dates and pull the fresh payment into
 * the invoices list.
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
    // Baseline payment count so we can detect the new charge below.
    const paymentsBefore = (await listPayments(sub.providerSubscriptionId, env)).length

    // A subscription can hold only one pending change; clear any leftover
    // scheduled change first (Dodo 409s otherwise). No-op when none exists.
    await cancelScheduledChange(sub.providerSubscriptionId, env)
    // Switch now and bill the new cycle's full price immediately, so the customer
    // pays for the yearly term today. effective_at: immediately permits any
    // proration mode; full_immediately charges the full new price now.
    await changePlan({
      subscriptionId: sub.providerSubscriptionId,
      productId,
      quantity: 1,
      prorationBillingMode: "full_immediately",
      effectiveAt: "immediately",
      metadata: { organization_id: ctx.orgId, plan_key: sub.planKey, billing_cycle: target },
      env,
    })

    // Dodo records the upgrade charge asynchronously (a few seconds), so wait for
    // it to appear before reconciling — that way the response (and the invoices
    // list) already includes the new payment. Best-effort: if it doesn't land in
    // time, the self-healing invoices GET will pick it up on the next page load.
    for (let i = 0; i < 8; i++) {
      const now = (await listPayments(sub.providerSubscriptionId, env)).length
      if (now > paymentsBefore) break
      await sleep(1500)
    }

    // Reconcile the now-current state from Dodo (status, period dates) and pull the
    // fresh charge into the invoices list, then record the new billing cycle. The
    // switch is immediate, so there's no pending scheduled change.
    await reconcileSubscriptionFromDodo(sub, env)
    const [updated] = await db
      .update(subscriptions)
      .set({ billingCycle: target, scheduledChange: null, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id))
      .returning()

    return res.json({
      subscription: updated ? serialize(updated) : null,
      message: `Switched to ${target} billing — you've been charged the ${target} price.`,
    })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo Payments error" })
  }
}
