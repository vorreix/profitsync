import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../../../src/lib/db"
import { quotations, quotationAttachments } from "../../../src/lib/db/schema"
import { and, eq, desc } from "drizzle-orm"

const MAX_SIZE_BYTES = 2 * 1024 * 1024

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

async function verifyQuotationOwner(quotationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: quotations.id })
    .from(quotations)
    .where(and(eq(quotations.id, quotationId), eq(quotations.userId, userId)))
  return !!row
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const { id } = req.query as { id: string }

  if (req.method === "GET") {
    const owned = await verifyQuotationOwner(id, userId)
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
      .where(and(eq(quotationAttachments.quotationId, id), eq(quotationAttachments.userId, userId)))
      .orderBy(desc(quotationAttachments.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const owned = await verifyQuotationOwner(id, userId)
    if (!owned) return res.status(404).json({ error: "Not found" })

    const { file_name, file_type, file_size, file_data } = req.body as {
      file_name: string; file_type: string; file_size: number; file_data: string
    }

    if (!file_name || !file_type || !file_data) {
      return res.status(400).json({ error: "file_name, file_type, and file_data are required" })
    }
    if (file_size > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: "File exceeds 2MB limit" })
    }
    const byteLength = Buffer.byteLength(file_data, "base64")
    if (byteLength > MAX_SIZE_BYTES) {
      return res.status(400).json({ error: "File exceeds 2MB limit" })
    }

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
