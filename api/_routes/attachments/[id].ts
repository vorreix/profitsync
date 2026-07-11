import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import {
  clients,
  transactionAttachments,
  transactions,
} from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { sanitizeAttachmentMeta, setDownloadHeaders } from "../../_lib/attachments.js"

// Metadata projection — everything EXCEPT file_data. The base64 blob (often
// megabytes) is selected only on the actual download path, so metadata reads,
// renames and deletes never drag it out of the database.
const metaColumns = {
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
  const { orgId, role } = ctx

  const { id } = req.query as { id: string }

  // Resolve attachment METADATA and confirm it belongs to this org (file_data
  // deliberately excluded — see metaColumns).
  const [row] = await db
    .select({
      attachment: metaColumns,
      clientOrgId: clients.organizationId,
    })
    .from(transactionAttachments)
    .innerJoin(transactions, eq(transactions.id, transactionAttachments.transactionId))
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .where(eq(transactionAttachments.id, id))

  if (!row || row.clientOrgId !== orgId) return res.status(404).json({ error: "Not found" })

  const attachment = row.attachment

  // Defense-in-depth: scope every mutation to this org directly (not just the
  // ownership check above), so a UPDATE/DELETE can only ever touch an attachment
  // whose transaction belongs to an org-owned client.
  const orgScoped = and(
    eq(transactionAttachments.id, id),
    inArray(
      transactionAttachments.transactionId,
      db
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(clients, eq(clients.id, transactions.clientId))
        .where(eq(clients.organizationId, orgId)),
    ),
  )

  if (req.method === "GET") {
    // `?metadata=1` returns the row's metadata as JSON (never the file bytes);
    // otherwise the file is streamed as a forced download.
    if (req.query.metadata === "1") {
      return res.json(serialize(attachment))
    }
    // Download path: fetch the blob only now that we know it's wanted.
    const [file] = await db
      .select({ fileData: transactionAttachments.fileData })
      .from(transactionAttachments)
      .where(eq(transactionAttachments.id, id))
    if (!file) return res.status(404).json({ error: "Not found" })
    const buffer = Buffer.from(file.fileData, "base64")
    setDownloadHeaders(res, attachment.fileName, buffer.length)
    return res.send(buffer)
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const updates = sanitizeAttachmentMeta(req.body ?? {})
    const [updated] = await db
      .update(transactionAttachments)
      .set({ ...updates, updatedAt: new Date() })
      .where(orgScoped)
      .returning(metaColumns)
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [deleted] = await db
      .delete(transactionAttachments)
      .where(orgScoped)
      .returning({ id: transactionAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
