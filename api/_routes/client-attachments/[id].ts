import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clientAttachments, clients } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { sanitizeAttachmentMeta, setDownloadHeaders } from "../../_lib/attachments.js"

function metaOf(a: typeof clientAttachments.$inferSelect) {
  return {
    id: a.id,
    clientId: a.clientId,
    userId: a.userId,
    fileName: a.fileName,
    fileType: a.fileType,
    fileSize: a.fileSize,
    displayName: a.displayName,
    tags: a.tags,
    category: a.category,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }
}

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

  // Defense-in-depth: scope mutations to attachments whose client is in this org.
  const orgScoped = and(
    eq(clientAttachments.id, id),
    inArray(
      clientAttachments.clientId,
      db.select({ id: clients.id }).from(clients).where(eq(clients.organizationId, orgId)),
    ),
  )

  if (req.method === "GET") {
    if (req.query.metadata === "1") {
      return res.json(serialize(metaOf(attachment)))
    }
    const buffer = Buffer.from(attachment.fileData, "base64")
    setDownloadHeaders(res, attachment.fileName, buffer.length)
    return res.send(buffer)
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const updates = sanitizeAttachmentMeta(req.body ?? {})
    const [updated] = await db
      .update(clientAttachments)
      .set({ ...updates, updatedAt: new Date() })
      .where(orgScoped)
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(metaOf(updated)))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [deleted] = await db
      .delete(clientAttachments)
      .where(orgScoped)
      .returning({ id: clientAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
