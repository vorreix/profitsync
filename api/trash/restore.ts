import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNotNull } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { clients, quotations } from "../../src/lib/db/schema"
import { canDelete, requireAuth } from "../_lib/auth"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { type, id } = req.body as { type: string; id: string }
  if (!id) return res.status(400).json({ error: "id is required" })
  if (!["client", "quotation"].includes(type)) {
    return res.status(400).json({ error: "type must be client or quotation" })
  }

  if (type === "client") {
    const [updated] = await db
      .update(clients)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  const [updated] = await db
    .update(quotations)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning()
  if (!updated) return res.status(404).json({ error: "Not found" })
  return res.json(serialize(updated))
}
