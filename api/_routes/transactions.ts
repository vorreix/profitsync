import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { checkTransactionQuota } from "../_lib/quota.js"

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
  // Drives the list paperclip badge.
  attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const { clientId, search, type, page, sort, limit, category, from, to, includeClosed } = req.query as {
      clientId?: string; search?: string; type?: string; page?: string; sort?: string; limit?: string; category?: string; from?: string; to?: string; includeClosed?: string
    }

    const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
    const dateFromFilter = isDate(from) ? gte(transactions.date, from) : undefined
    const dateToFilter = isDate(to) ? lte(transactions.date, to) : undefined
    // Exclude transactions of closed clients from the default list/analytics;
    // `?includeClosed=1` brings them back (dashboard "show closed" toggle).
    const closedClientFilter = includeClosed === "1" ? undefined : isNull(clients.closedAt)

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
        .where(and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt)))
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

    const categoryFilter = category?.trim()
      ? eq(transactions.category, category.trim())
      : undefined

    const whereClause = and(
      eq(clients.organizationId, orgId),
      isNull(clients.deletedAt),
      isNull(transactions.deletedAt),
      closedClientFilter,
      searchFilter,
      typeFilter,
      categoryFilter,
      dateFromFilter,
      dateToFilter,
    )

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const offset = (pageNum - 1) * PAGE_SIZE

      // The income/expense summary ignores the type tab (so both totals always
      // show) but respects search + category, so the cards reflect the filters.
      const summaryWhere = and(
        eq(clients.organizationId, orgId),
        isNull(clients.deletedAt),
        isNull(transactions.deletedAt),
        closedClientFilter,
        searchFilter,
        categoryFilter,
        dateFromFilter,
        dateToFilter,
      )

      // Count, page rows and summary are independent — run as one parallel batch.
      const [[{ total }], rows, [summaryRow]] = await Promise.all([
        db
          .select({ total: count() })
          .from(transactions)
          .innerJoin(clients, eq(transactions.clientId, clients.id))
          .where(whereClause),
        db
          .select(txFields)
          .from(transactions)
          .innerJoin(clients, eq(transactions.clientId, clients.id))
          .where(whereClause)
          .orderBy(...orderBy)
          .limit(PAGE_SIZE)
          .offset(offset),
        db
          .select({
            incoming: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`,
            outgoing: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`,
          })
          .from(transactions)
          .innerJoin(clients, eq(transactions.clientId, clients.id))
          .where(summaryWhere),
      ])

      return res.json({
        data: rows.map(serialize),
        total,
        summary: { incoming: Number(summaryRow.incoming), outgoing: Number(summaryRow.outgoing) },
      })
    }

    // `?limit=N` (without `page`) returns just the top N rows — used by the
    // dashboard "latest transactions" card. Capped to keep payloads small.
    const baseQuery = db
      .select(txFields)
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(whereClause)
      .orderBy(...orderBy)

    if (limit !== undefined) {
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))
      const rows = await baseQuery.limit(limitNum)
      return res.json(rows.map(serialize))
    }

    const rows = await baseQuery
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { client_id, type, amount, description, category, date } = req.body as {
      client_id: string; type: string; amount: number
      description?: string; category?: string; date?: string
    }

    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "amount is required" })
    if (!["incoming", "outgoing"].includes(type)) return res.status(400).json({ error: "type must be incoming or outgoing" })

    // Personal accounts have a single hidden default client that every
    // transaction anchors to; the client picker isn't shown, so resolve it here.
    let clientId: string
    if (isPersonalAccount(ctx)) {
      clientId = await ensureDefaultClient(orgId, userId)
    } else {
      if (!client_id) return res.status(400).json({ error: "client_id is required" })
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, client_id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      if (!client) return res.status(403).json({ error: "Forbidden" })
      clientId = client_id
    }

    const quota = await checkTransactionQuota(orgId, clientId)
    if (!quota.allowed) return res.status(402).json(quota)

    const today = new Date().toISOString().split("T")[0]
    const [row] = await db
      .insert(transactions)
      .values({
        clientId,
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
