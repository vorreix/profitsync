import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { invoices, subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"
import { defaultDodoEnv, isDodoConfigured, type DodoEnv } from "../../_lib/dodo.js"
import { reconcileSubscriptionFromDodo } from "../../_lib/billing-sync.js"

/**
 * Billing history for the active org: the invoices Dodo has produced for this
 * workspace, plus the current subscription so the page can render billing detail.
 * Org-scoped — only the workspace's own data is returned.
 *
 * Self-healing: when the workspace has a Dodo subscription, this reconciles it
 * with Dodo first (period dates, scheduled changes, payment history → invoices).
 * That keeps the page correct even when the `payment.succeeded` webhook isn't
 * configured for the subscription's environment — without it, invoices would
 * stay empty and dates stale on a normal page visit (sync only runs on the
 * checkout-return path). Best-effort: a Dodo hiccup falls back to stored rows.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, ctx.orgId))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1)

  let subscription = sub ?? null
  if (sub) {
    const env = (sub.dodoEnvironment ?? defaultDodoEnv()) as DodoEnv
    if (sub.provider === "dodo" && sub.providerSubscriptionId && isDodoConfigured(env)) {
      try {
        const result = await reconcileSubscriptionFromDodo(sub, env)
        subscription = result.subscription
      } catch {
        // Best-effort: keep showing stored data if Dodo is unreachable.
      }
    }
  }

  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.organizationId, ctx.orgId))
    .orderBy(desc(invoices.issuedAt))

  return res.json({
    invoices: rows.map(serialize),
    subscription: subscription ? serialize(subscription) : null,
  })
}
