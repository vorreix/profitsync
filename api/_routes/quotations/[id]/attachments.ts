import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { quotationAttachments, quotations } from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth, requireBusinessFeature } from "../../../_lib/auth.js"
import { checkAttachmentQuota, checkOrgAttachmentQuota } from "../../../_lib/quota.js"
import { validateUpload } from "../../../_lib/attachments.js"

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
  if (!requireBusinessFeature(res, ctx, "quotations")) return
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

    // Validate type/size/filename before trusting any of it (see _lib/attachments).
    const validation = validateUpload(req.body ?? {})
    if (!validation.ok) return res.status(400).json({ error: validation.error })
    const { fileName, fileType, fileSize, byteLength } = validation.value
    const fileData = (req.body as { file_data: string }).file_data

    const orgQuota = await checkOrgAttachmentQuota(orgId, byteLength)
    if (!orgQuota.allowed) return res.status(402).json(orgQuota)

    const quota = await checkAttachmentQuota(orgId, {
      kind: "quotation",
      parentId: id,
      sizeBytes: byteLength,
    })
    if (!quota.allowed) return res.status(402).json(quota)

    const [row] = await db
      .insert(quotationAttachments)
      .values({
        quotationId: id,
        userId,
        fileName,
        fileType,
        fileSize,
        fileData,
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
