import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { defaultDodoEnv, isDodoConfigured, type DodoEnv } from "../../_lib/dodo.js"
import { reconcileSubscriptionFromDodo } from "../../_lib/billing-sync.js"

/**
 * Reconcile the org's latest subscription with Dodo. Called when the user returns
 * from the hosted checkout (return_url), so the plan activates immediately without
 * waiting for the webhook. Idempotent and safe to call repeatedly.
 *
 * Pulls status, period start/end, any scheduled plan change, and the payment
 * history (→ invoice rows) so the subscription page is fully populated without
 * depending on webhooks being configured.
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
    .limit(1)

  if (!sub) return res.status(404).json({ error: "No subscription to sync" })
  const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
  if (sub.provider !== "dodo" || !sub.providerSubscriptionId || !isDodoConfigured(env)) {
    return res.json({ subscription: serialize(sub), synced: false })
  }

  try {
    const { subscription, remoteStatus } = await reconcileSubscriptionFromDodo(sub, env)
    return res.json({ subscription: serialize(subscription), synced: true, dodo_status: remoteStatus })
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Dodo sync failed" })
  }
}
