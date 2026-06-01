import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { invoices, subscriptions } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

/**
 * Billing history for the active org: the invoices Dodo has produced for this
 * workspace (populated by the payment.succeeded webhook), plus a pointer to the
 * current subscription so the page can render billing details. Org-scoped — only
 * the workspace's own invoices are returned.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [rows, subRows] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(eq(invoices.organizationId, ctx.orgId))
      .orderBy(desc(invoices.issuedAt)),
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, ctx.orgId))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(1),
  ])

  return res.json({
    invoices: rows.map(serialize),
    subscription: subRows[0] ? serialize(subRows[0]) : null,
  })
}
