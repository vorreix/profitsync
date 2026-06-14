import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { notifications } from "../../../src/lib/db/schema.js"
import { requireAuth } from "../../_lib/auth.js"

// Per-notification mutations. Always scoped by user_id (the recipient owns their
// notifications) — never by org alone, so one user can't touch another's rows.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return

  const id = req.query.id as string
  if (!id) return res.status(400).json({ error: "Missing id" })

  const owned = and(eq(notifications.id, id), eq(notifications.userId, ctx.userId))

  if (req.method === "PATCH") {
    const read = (req.body as { read?: unknown })?.read
    const readAt = read === false ? null : new Date()
    const [updated] = await db.update(notifications).set({ readAt }).where(owned).returning()
    if (!updated) return res.status(404).json({ error: "Notification not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const [deleted] = await db.delete(notifications).where(owned).returning({ id: notifications.id })
    if (!deleted) return res.status(404).json({ error: "Notification not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
