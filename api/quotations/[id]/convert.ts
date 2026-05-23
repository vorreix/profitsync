import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../../../src/lib/db"
import { clients, quotations } from "../../../src/lib/db/schema"
import { and, eq, isNull } from "drizzle-orm"

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

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { id } = req.query as { id: string }

  const [quotation] = await db
    .select()
    .from(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.userId, userId), isNull(quotations.deletedAt)))
  if (!quotation) return res.status(404).json({ error: "Not found" })
  if (quotation.linkedClientId) {
    return res.status(409).json({ error: "Quotation already converted to a client" })
  }

  const [newClient] = await db
    .insert(clients)
    .values({
      userId,
      name: quotation.prospectName,
      company: quotation.company ?? "",
      email: quotation.email ?? "",
      phone: quotation.phone ?? "",
      status: "active",
      notes: quotation.notes ?? "",
    })
    .returning()

  await db
    .update(quotations)
    .set({ linkedClientId: newClient.id, status: "accepted", updatedAt: new Date() })
    .where(eq(quotations.id, id))

  return res.status(201).json(serialize(newClient))
}
