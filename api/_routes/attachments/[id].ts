import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import {
  clients,
  transactionAttachments,
  transactions,
} from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"

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

  if (req.method === "GET") {
    const buffer = Buffer.from(attachment.fileData, "base64")
    res.setHeader("Content-Type", attachment.fileType)
    res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`)
    res.setHeader("Content-Length", buffer.length)
    return res.send(buffer)
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [deleted] = await db
      .delete(transactionAttachments)
      .where(eq(transactionAttachments.id, id))
      .returning({ id: transactionAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
