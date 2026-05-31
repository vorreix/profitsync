import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNotNull } from "drizzle-orm"
import { db } from "../../../src/lib/db"
import { clients, quotations } from "../../../src/lib/db/schema"
import { canDelete, requireAuth } from "../../_lib/auth"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { type, id } = req.body as { type: string; id: string }
  if (!id) return res.status(400).json({ error: "id is required" })
  if (!["client", "quotation"].includes(type)) {
    return res.status(400).json({ error: "type must be client or quotation" })
  }

  if (type === "client") {
    const result = await db
      .delete(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
      .returning({ id: clients.id })
    if (!result.length) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  const result = await db
    .delete(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning({ id: quotations.id })
  if (!result.length) return res.status(404).json({ error: "Not found" })
  return res.status(204).end()
}
