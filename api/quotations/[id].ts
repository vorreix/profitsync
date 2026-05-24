import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../../src/lib/db"
import { quotations } from "../../src/lib/db/schema"
import { and, eq, isNull } from "drizzle-orm"

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"]

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
    const [row] = await db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.userId, userId), isNull(quotations.deletedAt)))
    if (!row) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(row))
  }

  if (req.method === "PATCH") {
    const { title, prospect_name, company, email, phone, amount, status, notes } = req.body as {
      title?: string; prospect_name?: string; company?: string; email?: string
      phone?: string; amount?: number; status?: string; notes?: string
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "status must be draft, sent, accepted, or rejected" })
    }
    const [updated] = await db
      .update(quotations)
      .set({
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(prospect_name !== undefined ? { prospectName: prospect_name.trim() } : {}),
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(quotations.id, id), eq(quotations.userId, userId), isNull(quotations.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const [updated] = await db
      .update(quotations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(quotations.id, id), eq(quotations.userId, userId), isNull(quotations.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
