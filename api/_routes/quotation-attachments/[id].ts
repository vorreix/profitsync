import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db } from "../../../src/lib/db"
import { quotationAttachments, quotations } from "../../../src/lib/db/schema"
import { canDelete, requireAuth } from "../../_lib/auth"

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
      .delete(quotationAttachments)
      .where(eq(quotationAttachments.id, id))
      .returning({ id: quotationAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
