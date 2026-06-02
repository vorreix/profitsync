import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import {
  clients,
  transactionAttachments,
  transactions,
} from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { checkAttachmentQuota, checkOrgAttachmentQuota } from "../../../_lib/quota.js"
import { validateUpload } from "../../../_lib/attachments.js"

async function verifyTransactionOrg(transactionId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ clientOrgId: clients.organizationId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, transactionId))
  return !!row && row.clientOrgId === orgId
}

// Metadata fields returned to clients (never includes fileData).
const metaFields = {
  id: transactionAttachments.id,
  transactionId: transactionAttachments.transactionId,
  userId: transactionAttachments.userId,
  fileName: transactionAttachments.fileName,
  fileType: transactionAttachments.fileType,
  fileSize: transactionAttachments.fileSize,
  displayName: transactionAttachments.displayName,
  tags: transactionAttachments.tags,
  category: transactionAttachments.category,
  createdAt: transactionAttachments.createdAt,
  updatedAt: transactionAttachments.updatedAt,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const owned = await verifyTransactionOrg(id, orgId)
    if (!owned) return res.status(404).json({ error: "Not found" })

    const rows = await db
      .select(metaFields)
      .from(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, id))
      .orderBy(desc(transactionAttachments.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const owned = await verifyTransactionOrg(id, orgId)
    if (!owned) return res.status(404).json({ error: "Not found" })

    // Validate type/size/filename before trusting any of it (see _lib/attachments).
    const validation = validateUpload(req.body ?? {})
    if (!validation.ok) return res.status(400).json({ error: validation.error })
    const { fileName, fileType, fileSize, byteLength } = validation.value
    const fileData = (req.body as { file_data: string }).file_data

    const orgQuota = await checkOrgAttachmentQuota(orgId, byteLength)
    if (!orgQuota.allowed) return res.status(402).json(orgQuota)

    const quota = await checkAttachmentQuota(orgId, {
      kind: "transaction",
      parentId: id,
      sizeBytes: byteLength,
    })
    if (!quota.allowed) return res.status(402).json(quota)

    const [row] = await db
      .insert(transactionAttachments)
      .values({
        transactionId: id,
        userId,
        fileName,
        fileType,
        fileSize,
        fileData,
      })
      .returning(metaFields)
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
