import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { defaultDodoEnv, mapDodoStatus, resumeSubscription, type DodoEnv } from "../../_lib/dodo.js"

/**
 * Undo a pending end-of-period cancellation, so the subscription keeps renewing.
 * Only valid while the subscription is still active (within the paid period).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (ctx.role !== "owner") {
    return res.status(403).json({ error: "Only the owner can resume the subscription" })
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1)

  if (!sub || sub.planKey === "free") {
    return res.status(400).json({ error: "No subscription to resume" })
  }
  if (!sub.cancelAt) {
    return res.status(400).json({ error: "This subscription isn't scheduled to cancel." })
  }

  let status = sub.status
  let periodEnd = sub.currentPeriodEnd

  if (sub.provider === "dodo" && sub.providerSubscriptionId) {
    const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
    try {
      const remote = await resumeSubscription(sub.providerSubscriptionId, env)
      status = mapDodoStatus(remote.status)
      if (remote.next_billing_date) periodEnd = new Date(remote.next_billing_date)
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo Payments error" })
    }
  }

  const [updated] = await db
    .update(subscriptions)
    .set({
      status,
      cancelAt: null,
      cancelledAt: null,
      ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id))
    .returning()

  if (!updated) return res.status(404).json({ error: "Subscription not found" })
  return res.json({
    subscription: serialize(updated),
    message: "Subscription resumed — it will keep renewing as usual.",
  })
}
