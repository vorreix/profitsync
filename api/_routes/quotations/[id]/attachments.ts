import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db"
import { quotationAttachments, quotations } from "../../../../src/lib/db/schema"
import { canWrite, requireAuth } from "../../../_lib/auth"
import { checkAttachmentQuota } from "../../../_lib/quota"

async function verifyQuotationOrg(quotationId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: quotations.id })
    .from(quotations)
    .where(and(eq(quotations.id, quotationId), eq(quotations.organizationId, orgId)))
  return !!row
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const owned = await verifyQuotationOrg(id, orgId)
    if (!owned) return res.status(404).json({ error: "Not found" })

    const rows = await db
      .select({
        id: quotationAttachments.id,
        quotationId: quotationAttachments.quotationId,
        userId: quotationAttachments.userId,
        fileName: quotationAttachments.fileName,
        fileType: quotationAttachments.fileType,
        fileSize: quotationAttachments.fileSize,
        createdAt: quotationAttachments.createdAt,
      })
      .from(quotationAttachments)
      .where(eq(quotationAttachments.quotationId, id))
      .orderBy(desc(quotationAttachments.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const owned = await verifyQuotationOrg(id, orgId)
    if (!owned) return res.status(404).json({ error: "Not found" })

    const { file_name, file_type, file_size, file_data } = req.body as {
      file_name: string; file_type: string; file_size: number; file_data: string
    }

    if (!file_name || !file_type || !file_data) {
      return res.status(400).json({ error: "file_name, file_type, and file_data are required" })
    }
    const byteLength = Buffer.byteLength(file_data, "base64")
    const effectiveSize = Math.max(file_size ?? 0, byteLength)

    const quota = await checkAttachmentQuota(orgId, {
      kind: "quotation",
      parentId: id,
      sizeBytes: effectiveSize,
    })
    if (!quota.allowed) return res.status(402).json(quota)

    const [row] = await db
      .insert(quotationAttachments)
      .values({
        quotationId: id,
        userId,
        fileName: file_name,
        fileType: file_type,
        fileSize: file_size,
        fileData: file_data,
      })
      .returning({
        id: quotationAttachments.id,
        quotationId: quotationAttachments.quotationId,
        userId: quotationAttachments.userId,
        fileName: quotationAttachments.fileName,
        fileType: quotationAttachments.fileType,
        fileSize: quotationAttachments.fileSize,
        createdAt: quotationAttachments.createdAt,
      })
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
