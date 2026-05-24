import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { subscriptions } from "../../src/lib/db/schema"
import { requireAuth } from "../_lib/auth"
import { cancelSubscription } from "../_lib/razorpay"

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

  if (!sub) return res.status(404).json({ error: "No active subscription" })
  if (sub.planKey === "free") {
    return res.status(400).json({ error: "Free plan cannot be cancelled" })
  }

  if (sub.provider === "razorpay" && sub.providerSubscriptionId) {
    try {
      await cancelSubscription(sub.providerSubscriptionId, true)
    } catch (err) {
      return res.status(502).json({ error: err instanceof Error ? err.message : "Razorpay error" })
    }
  }

  const [updated] = await db
    .update(subscriptions)
    .set({
      status: "cancelled",
      cancelAt: sub.currentPeriodEnd ?? new Date(),
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, sub.id))
    .returning()

  return res.json({ subscription: serialize(updated), message: "Subscription cancelled. Access continues until end of current period." })
}
