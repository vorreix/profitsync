import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clientAttachments, clients } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { setDownloadHeaders } from "../../_lib/attachments.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "clients")) return
  const { orgId, role } = ctx

  const { id } = req.query as { id: string }

  // Resolve attachment and confirm its client belongs to this org.
  const [row] = await db
    .select({ attachment: clientAttachments, clientOrgId: clients.organizationId })
    .from(clientAttachments)
    .innerJoin(clients, eq(clients.id, clientAttachments.clientId))
    .where(eq(clientAttachments.id, id))

  if (!row || row.clientOrgId !== orgId) return res.status(404).json({ error: "Not found" })

  const attachment = row.attachment

  if (req.method === "GET") {
    const buffer = Buffer.from(attachment.fileData, "base64")
    setDownloadHeaders(res, attachment.fileName, buffer.length)
    return res.send(buffer)
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [deleted] = await db
      .delete(clientAttachments)
      .where(eq(clientAttachments.id, id))
      .returning({ id: clientAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
