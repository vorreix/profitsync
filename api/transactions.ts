import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { db, serialize } from "../src/lib/db"
import { clients, transactions } from "../src/lib/db/schema"
import { and, eq, desc, isNull, ilike, or, count } from "drizzle-orm"

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

const PAGE_SIZE = 20

const txFields = {
  id: transactions.id,
  clientId: transactions.clientId,
  clientName: clients.name,
  type: transactions.type,
  amount: transactions.amount,
  description: transactions.description,
  category: transactions.category,
  date: transactions.date,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getAuth(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  if (req.method === "GET") {
    const { clientId, search, type, page } = req.query as {
      clientId?: string; search?: string; type?: string; page?: string
    }

    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.userId, userId), isNull(clients.deletedAt)))
      if (!client) return res.status(403).json({ error: "Forbidden" })

      const rows = await db
        .select(txFields)
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(eq(transactions.clientId, clientId))
        .orderBy(desc(transactions.date))
      return res.json(rows.map(serialize))
    }

    const searchFilter = search?.trim()
      ? or(
          ilike(transactions.description, `%${search.trim()}%`),
          ilike(transactions.category, `%${search.trim()}%`),
          ilike(clients.name, `%${search.trim()}%`),
        )
      : undefined

    const typeFilter = type && ["incoming", "outgoing"].includes(type)
      ? eq(transactions.type, type)
      : undefined

    const whereClause = and(
      eq(clients.userId, userId),
      isNull(clients.deletedAt),
      searchFilter,
      typeFilter,
    )

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const offset = (pageNum - 1) * PAGE_SIZE

      const [{ total }] = await db
        .select({ total: count() })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(whereClause)

      const rows = await db
        .select(txFields)
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(whereClause)
        .orderBy(desc(transactions.date))
        .limit(PAGE_SIZE)
        .offset(offset)

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select(txFields)
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(whereClause)
      .orderBy(desc(transactions.date))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const { client_id, type, amount, description, category, date } = req.body as {
      client_id: string; type: string; amount: number
      description?: string; category?: string; date?: string
    }

    if (!client_id) return res.status(400).json({ error: "client_id is required" })
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "amount is required" })
    if (!["incoming", "outgoing"].includes(type)) return res.status(400).json({ error: "type must be incoming or outgoing" })

    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, client_id), eq(clients.userId, userId), isNull(clients.deletedAt)))
    if (!client) return res.status(403).json({ error: "Forbidden" })

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
