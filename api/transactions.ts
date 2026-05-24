import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../src/lib/db"
import { clients, transactions } from "../src/lib/db/schema"
import { canWrite, requireAuth } from "./_lib/auth"
import { checkTransactionQuota } from "./_lib/quota"

const PAGE_SIZE = 20

function pickOrder(sort: string | undefined) {
  switch (sort) {
    case "date_asc":
      return [asc(transactions.date), asc(transactions.createdAt)]
    case "amount_desc":
      return [desc(sql`${transactions.amount}::numeric`), desc(transactions.createdAt)]
    case "amount_asc":
      return [asc(sql`${transactions.amount}::numeric`), desc(transactions.createdAt)]
    case "date_desc":
    default:
      return [desc(transactions.date), desc(transactions.createdAt)]
  }
}

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
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method === "GET") {
    const { clientId, search, type, page, sort } = req.query as {
      clientId?: string; search?: string; type?: string; page?: string; sort?: string
    }

    const orderBy = pickOrder(sort)

    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      if (!client) return res.status(403).json({ error: "Forbidden" })

      const rows = await db
        .select(txFields)
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(eq(transactions.clientId, clientId))
        .orderBy(...orderBy)
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
      eq(clients.organizationId, orgId),
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
        .orderBy(...orderBy)
        .limit(PAGE_SIZE)
        .offset(offset)

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select(txFields)
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(whereClause)
      .orderBy(...orderBy)
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
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
      .where(and(eq(clients.id, client_id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    if (!client) return res.status(403).json({ error: "Forbidden" })

    const quota = await checkTransactionQuota(orgId, client_id)
    if (!quota.allowed) return res.status(402).json(quota)

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
