import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"

const PAGE_SIZE = 30

const txFields = {
  id: transactions.id,
  clientId: transactions.clientId,
  clientName: clients.name,
  organizationId: clients.organizationId,
  type: transactions.type,
  amount: transactions.amount,
  description: transactions.description,
  category: transactions.category,
  date: transactions.date,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Super-admin-only surface: regular admins must not even see org transactions
  // (the org-detail Transactions tab is hidden for them too).
  const ctx = await requireAdminCap(req, res, "org_transactions")
  if (!ctx) return

  if (req.method === "GET") {
    const { organization_id, client_id, search, type, page } = req.query as {
      organization_id?: string
      client_id?: string
      search?: string
      type?: string
      page?: string
    }
    if (!organization_id && !client_id) {
      return res.status(400).json({ error: "organization_id or client_id is required" })
    }

    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const orgFilter = organization_id ? eq(clients.organizationId, organization_id) : undefined
    const clientFilter = client_id ? eq(transactions.clientId, client_id) : undefined

    const searchFilter = search?.trim()
      ? or(
          ilike(transactions.description, `%${search.trim()}%`),
          ilike(transactions.category, `%${search.trim()}%`),
          ilike(clients.name, `%${search.trim()}%`),
        )
      : undefined

    const typeFilter =
      type && ["incoming", "outgoing"].includes(type) ? eq(transactions.type, type) : undefined

    const whereClause = and(orgFilter, clientFilter, isNull(clients.deletedAt), searchFilter, typeFilter)

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
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE })
  }

  if (req.method === "POST") {
    const { client_id, type, amount, description, category, date } = req.body as {
      client_id?: string
      type?: string
      amount?: number | string
      description?: string
      category?: string
      date?: string
    }
    if (!client_id) return res.status(400).json({ error: "client_id is required" })
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return res.status(400).json({ error: "amount is required" })
    }
    if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    if (!type || !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }

    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, client_id), isNull(clients.deletedAt)))
    if (!client) return res.status(404).json({ error: "Client not found" })

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

  if (req.method === "PATCH") {
    const { transaction_id, type, amount, description, category, date } = req.body as {
      transaction_id?: string
      type?: string
      amount?: number | string
      description?: string
      category?: string
      date?: string
    }
    if (!transaction_id) return res.status(400).json({ error: "transaction_id is required" })

    const patch: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() }
    if (type) {
      if (!["incoming", "outgoing"].includes(type)) {
        return res.status(400).json({ error: "type must be incoming or outgoing" })
      }
      patch.type = type
    }
    if (amount !== undefined && amount !== null) {
      if (isNaN(Number(amount))) return res.status(400).json({ error: "amount must be numeric" })
      if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
      patch.amount = String(amount)
    }
    if (typeof description === "string") patch.description = description
    if (typeof category === "string") patch.category = category
    if (typeof date === "string" && date.trim()) patch.date = date

    const [updated] = await db
      .update(transactions)
      .set(patch)
      .where(eq(transactions.id, transaction_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const { transaction_id } = req.body as { transaction_id?: string }
    if (!transaction_id) return res.status(400).json({ error: "transaction_id is required" })
    const result = await db
      .delete(transactions)
      .where(eq(transactions.id, transaction_id))
      .returning({ id: transactions.id })
    if (!result.length) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
