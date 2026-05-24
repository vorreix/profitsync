import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../../src/lib/db"
import { clients, transactions } from "../../src/lib/db/schema"
import { eq } from "drizzle-orm"

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

  // Verify ownership: transaction's client must belong to this user
  const [row] = await db
    .select({ clientUserId: clients.userId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, id))

  if (!row || row.clientUserId !== userId) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    const { type, amount, description, category, date } = req.body as {
      type?: string; amount?: number; description?: string; category?: string; date?: string
    }
    if (type !== undefined && !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }
    const [updated] = await db
      .update(transactions)
      .set({
        ...(type !== undefined ? { type } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(date !== undefined ? { date } : {}),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning()
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    await db.delete(transactions).where(eq(transactions.id, id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
