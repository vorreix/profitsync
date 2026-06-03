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

function metaOf(a: typeof transactionAttachments.$inferSelect) {
  return {
    id: a.id,
    transactionId: a.transactionId,
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

  // Resolve attachment and confirm it belongs to this org
  const [row] = await db
    .select({
      attachment: transactionAttachments,
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
      .update(transactionAttachments)
      .set({ ...updates, updatedAt: new Date() })
      .where(orgScoped)
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(metaOf(updated)))
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
