import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { subscriptions } from "../../src/lib/db/schema"
import { requireAuth } from "../_lib/auth"
import { getSubscription, isDodoConfigured, mapDodoStatus } from "../_lib/dodo"

/**
 * Reconcile the org's latest subscription with Dodo. Called when the user returns
 * from the hosted checkout (return_url), so the plan activates immediately without
 * waiting for the webhook. Idempotent and safe to call repeatedly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))
    .orderBy(desc(subscriptions.updatedAt))

  if (!sub) return res.status(404).json({ error: "No subscription to sync" })
  if (sub.provider !== "dodo" || !sub.providerSubscriptionId || !isDodoConfigured()) {
    return res.json({ subscription: serialize(sub), synced: false })
  }

  try {
    const remote = await getSubscription(sub.providerSubscriptionId)
    const mapped = mapDodoStatus(remote.status)
    const updates: Record<string, unknown> = { status: mapped, updatedAt: new Date() }
    if (remote.next_billing_date) updates.currentPeriodEnd = new Date(remote.next_billing_date)
    if (remote.cancel_at_next_billing_date) {
      updates.cancelAt = remote.next_billing_date ? new Date(remote.next_billing_date) : new Date()
    }
    if (remote.cancelled_at) updates.cancelledAt = new Date(remote.cancelled_at)

    const [updated] = await db
      .update(subscriptions)
      .set(updates)
      .where(eq(subscriptions.id, sub.id))
      .returning()

    return res.json({ subscription: serialize(updated), synced: true, dodo_status: remote.status })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo sync failed" })
  }
}
