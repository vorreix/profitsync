import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { notifications } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// Mark every unread notification as read (personal inbox — across all the
// recipient's orgs). Optional body { category } limits it to one category.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const category = typeof (req.body as { category?: unknown })?.category === "string"
    ? (req.body as { category: string }).category
    : undefined

  const conditions = [
    eq(notifications.userId, ctx.userId),
    isNull(notifications.readAt),
  ]
  if (category) conditions.push(eq(notifications.category, category))

  await db.update(notifications).set({ readAt: new Date() }).where(and(...conditions))

  return res.json({ ok: true })
}
