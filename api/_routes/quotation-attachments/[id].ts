import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { quotationAttachments, quotations } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { sanitizeAttachmentMeta, setDownloadHeaders } from "../../_lib/attachments.js"

function metaOf(a: typeof quotationAttachments.$inferSelect) {
  return {
    id: a.id,
    quotationId: a.quotationId,
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
  const { orgId, role } = ctx

  const { id } = req.query as { id: string }

  const [row] = await db
    .select({ attachment: quotationAttachments, orgId: quotations.organizationId })
    .from(quotationAttachments)
    .innerJoin(quotations, eq(quotations.id, quotationAttachments.quotationId))
    .where(eq(quotationAttachments.id, id))

  if (!row || row.orgId !== orgId) return res.status(404).json({ error: "Not found" })

  const attachment = row.attachment

  // Defense-in-depth: scope mutations to attachments whose quotation is in this org.
  const orgScoped = and(
    eq(quotationAttachments.id, id),
    inArray(
      quotationAttachments.quotationId,
      db.select({ id: quotations.id }).from(quotations).where(eq(quotations.organizationId, orgId)),
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
      .update(quotationAttachments)
      .set({ ...updates, updatedAt: new Date() })
      .where(orgScoped)
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(metaOf(updated)))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [deleted] = await db
      .delete(quotationAttachments)
      .where(orgScoped)
      .returning({ id: quotationAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
