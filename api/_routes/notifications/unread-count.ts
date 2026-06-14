import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { notifications } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// Tiny, cheap endpoint the bell polls. Counts ALL of the recipient's unread rows
// (personal inbox — across every org they belong to), not just the active org.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))

  return res.json({ count: value })
}
