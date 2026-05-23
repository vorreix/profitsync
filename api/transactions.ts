import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../src/lib/db"
import { clients, transactions } from "../src/lib/db/schema"
import { and, eq, desc } from "drizzle-orm"

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

  if (req.method === "GET") {
    const { clientId } = req.query as { clientId?: string }

    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.userId, userId)))
      if (!client) return res.status(403).json({ error: "Forbidden" })
    }

    const rows = await db
      .select()
      .from(transactions)
      .where(clientId ? eq(transactions.clientId, clientId) : undefined)
      .orderBy(desc(transactions.date))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const { client_id, type, amount, description, category, date } = req.body as {
      client_id: string; type: string; amount: number
      description?: string; category?: string; date?: string
    }

    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, client_id), eq(clients.userId, userId)))
    if (!client) return res.status(403).json({ error: "Forbidden" })

    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "amount is required" })
    if (!["incoming", "outgoing"].includes(type)) return res.status(400).json({ error: "type must be incoming or outgoing" })

    const today = new Date().toISOString().split("T")[0]
    const [row] = await db
      .insert(transactions)
      .values({
        clientId: client_id,
        type,
        amount: String(amount),
        description: description ?? "",
        category: category ?? "",
        date: date ?? today,
      })
      .returning()
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
