import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, serialize } from "../../../../../src/lib/db/index.js"
import { wealthAccountAttachments, wealthAccounts } from "../../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../../_lib/auth.js"
import { checkAttachmentQuota, checkOrgAttachmentQuota } from "../../../../_lib/quota.js"
import { validateUpload } from "../../../../_lib/attachments.js"

async function verifyAccountOrg(accountId: string, orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: wealthAccounts.id })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, accountId), eq(wealthAccounts.organizationId, orgId)))
  return !!row
}

// Metadata fields returned to clients (never includes fileData).
const metaFields = {
  id: wealthAccountAttachments.id,
  wealthAccountId: wealthAccountAttachments.wealthAccountId,
  userId: wealthAccountAttachments.userId,
  fileName: wealthAccountAttachments.fileName,
  fileType: wealthAccountAttachments.fileType,
  fileSize: wealthAccountAttachments.fileSize,
  displayName: wealthAccountAttachments.displayName,
  tags: wealthAccountAttachments.tags,
  category: wealthAccountAttachments.category,
  createdAt: wealthAccountAttachments.createdAt,
  updatedAt: wealthAccountAttachments.updatedAt,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    if (!(await verifyAccountOrg(id, orgId))) return res.status(404).json({ error: "Not found" })
    const rows = await db
      .select(metaFields)
      .from(wealthAccountAttachments)
      .where(eq(wealthAccountAttachments.wealthAccountId, id))
      .orderBy(desc(wealthAccountAttachments.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    if (!(await verifyAccountOrg(id, orgId))) return res.status(404).json({ error: "Not found" })

    const validation = validateUpload(req.body ?? {})
    if (!validation.ok) return res.status(400).json({ error: validation.error })
    const { fileName, fileType, fileSize, byteLength } = validation.value
    const fileData = (req.body as { file_data: string }).file_data

    const orgQuota = await checkOrgAttachmentQuota(orgId, byteLength)
    if (!orgQuota.allowed) return res.status(402).json(orgQuota)
    const quota = await checkAttachmentQuota(orgId, { kind: "wealth_account", parentId: id, sizeBytes: byteLength })
    if (!quota.allowed) return res.status(402).json(quota)

    const [row] = await db
      .insert(wealthAccountAttachments)
      .values({ wealthAccountId: id, userId, fileName, fileType, fileSize, fileData })
      .returning(metaFields)
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
