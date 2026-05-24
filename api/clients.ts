import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../src/lib/db"
import { clients, transactions } from "../src/lib/db/schema"
import { canWrite, requireAuth } from "./_lib/auth"
import { checkClientQuota, checkNoteLength } from "./_lib/quota"

const VALID_STATUSES = ["active", "inactive", "archived"]
const PAGE_SIZE = 20

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const { search, sort, page } = req.query as {
      search?: string; sort?: string; page?: string
    }

    const searchFilter = search?.trim()
      ? or(
          ilike(clients.name, `%${search.trim()}%`),
          ilike(clients.company, `%${search.trim()}%`),
          ilike(clients.email, `%${search.trim()}%`),
        )
      : undefined

    const whereClause = and(
      eq(clients.organizationId, orgId),
      isNull(clients.deletedAt),
      searchFilter,
    )

    const orderBy = (() => {
      switch (sort) {
        case "name_asc": return asc(clients.name)
        case "name_desc": return desc(clients.name)
        case "date_asc": return asc(clients.createdAt)
        default: return desc(clients.createdAt)
      }
    })()

    const selectFields = {
      id: clients.id,
      userId: clients.userId,
      organizationId: clients.organizationId,
      name: clients.name,
      company: clients.company,
      email: clients.email,
      phone: clients.phone,
      status: clients.status,
      notes: clients.notes,
      onboardDate: clients.onboardDate,
      deletedAt: clients.deletedAt,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
      totalIncoming: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`,
      totalOutgoing: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`,
    }

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const offset = (pageNum - 1) * PAGE_SIZE

      const [{ total }] = await db
        .select({ total: count() })
        .from(clients)
        .where(whereClause)

      const rows = await db
        .select(selectFields)
        .from(clients)
        .leftJoin(transactions, eq(transactions.clientId, clients.id))
        .where(whereClause)
        .groupBy(clients.id)
        .orderBy(orderBy)
        .limit(PAGE_SIZE)
        .offset(offset)

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select(selectFields)
      .from(clients)
      .leftJoin(transactions, eq(transactions.clientId, clients.id))
      .where(whereClause)
      .groupBy(clients.id)
      .orderBy(orderBy)
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, company, email, phone, status, notes, onboard_date } = req.body as {
      name: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string; onboard_date?: string
    }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    const normalizedStatus = status ?? "active"
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ error: "status must be active, inactive, or archived" })
    }
    const quota = await checkClientQuota(orgId)
    if (!quota.allowed) return res.status(402).json(quota)
    const noteCheck = await checkNoteLength(orgId, notes)
    if (!noteCheck.allowed) return res.status(402).json(noteCheck)
    const [row] = await db
      .insert(clients)
      .values({
        userId,
        organizationId: orgId,
        name: name.trim(),
        company: company ?? "",
        email: email ?? "",
        phone: phone ?? "",
        status: normalizedStatus,
        notes: notes ?? "",
        onboardDate: onboard_date ?? null,
      })
      .returning()
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
