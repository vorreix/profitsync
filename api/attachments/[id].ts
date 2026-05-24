import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db } from "../../src/lib/db"
import { transactionAttachments } from "../../src/lib/db/schema"
import { and, eq } from "drizzle-orm"

async function getAuth(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! })
    return payload.sub
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const [attachment] = await db
      .select()
      .from(transactionAttachments)
      .where(and(eq(transactionAttachments.id, id), eq(transactionAttachments.userId, userId)))
    if (!attachment) return res.status(404).json({ error: "Not found" })

    const buffer = Buffer.from(attachment.fileData, "base64")
    res.setHeader("Content-Type", attachment.fileType)
    res.setHeader("Content-Disposition", `attachment; filename="${attachment.fileName}"`)
    res.setHeader("Content-Length", buffer.length)
    return res.send(buffer)
  }

  if (req.method === "DELETE") {
    const [deleted] = await db
      .delete(transactionAttachments)
      .where(and(eq(transactionAttachments.id, id), eq(transactionAttachments.userId, userId)))
      .returning({ id: transactionAttachments.id })
    if (!deleted) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
