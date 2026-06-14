import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, or } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { notifications } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// Mark every unread notification (in the recipient's active-org scope) as read.
// Optional body { category } limits it to one category.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const category = typeof (req.body as { category?: unknown })?.category === "string"
    ? (req.body as { category: string }).category
    : undefined

  const conditions = [
    eq(notifications.userId, ctx.userId),
    or(eq(notifications.organizationId, ctx.orgId), isNull(notifications.organizationId)),
    isNull(notifications.readAt),
  ]
  if (category) conditions.push(eq(notifications.category, category))

  await db.update(notifications).set({ readAt: new Date() }).where(and(...conditions))

  return res.json({ ok: true })
}
