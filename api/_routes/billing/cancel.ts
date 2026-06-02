import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { cancelSubscription, defaultDodoEnv, mapDodoStatus, type DodoEnv } from "../../_lib/dodo.js"

/**
 * Cancel at the end of the current paid period. The subscription STAYS active
 * (so the workspace keeps its plan + features) until the period ends, then it
 * drops to free. We record the end date in `cancel_at` and leave `status` active
 * — the row only becomes "cancelled" when Dodo actually terminates it at period
 * end (via webhook / reconcile). Reversible via /api/billing/resume.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (ctx.role !== "owner") {
    return res.status(403).json({ error: "Only the owner can cancel the subscription" })
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1)

  if (!sub) return res.status(404).json({ error: "No active subscription" })
  if (sub.planKey === "free") {
    return res.status(400).json({ error: "Free plan cannot be cancelled" })
  }

  // Default end-of-access = the current period end; Dodo gives us the authoritative
  // date below for real subscriptions.
  let status = sub.status
  let cancelAt = sub.currentPeriodEnd ?? new Date()

  if (sub.provider === "dodo" && sub.providerSubscriptionId) {
    const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
    try {
      const remote = await cancelSubscription(sub.providerSubscriptionId, env, false)
      status = mapDodoStatus(remote.status) // stays "active" — cancels at period end
      if (remote.next_billing_date) cancelAt = new Date(remote.next_billing_date)
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo Payments error" })
    }
  }

  const [updated] = await db
    .update(subscriptions)
    .set({
      status,
      cancelAt,
      cancelledAt: null, // not terminated yet — only scheduled to end
      currentPeriodEnd: cancelAt,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id))
    .returning()

  if (!updated) return res.status(404).json({ error: "Subscription not found" })
  return res.json({
    subscription: serialize(updated),
    cancel_at: cancelAt.toISOString(),
    message: "Subscription set to cancel at the end of the current period.",
  })
}
