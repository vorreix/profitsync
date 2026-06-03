import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth, requireBusinessFeature } from "../_lib/auth.js"
import { checkClientQuota, checkNoteLength } from "../_lib/quota.js"

const VALID_STATUSES = ["active", "inactive", "archived"]
const PAGE_SIZE = 20

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    // Every workspace has exactly one "own"/internal client (the personal anchor,
    // or the business own-company client). Make sure it exists before listing.
    await ensureDefaultClient(orgId, userId)

    const { search, sort, page, closed, includeClosed } = req.query as {
      search?: string; sort?: string; page?: string; closed?: string; includeClosed?: string
    }

    const searchFilter = search?.trim()
      ? or(
          ilike(clients.name, `%${search.trim()}%`),
          ilike(clients.company, `%${search.trim()}%`),
          ilike(clients.email, `%${search.trim()}%`),
        )
      : undefined

    // Closed filtering: by default only active (closed_at IS NULL). `?closed=1`
    // returns only closed (the list's "Closed" section); `?includeClosed=1`
    // returns both (the dashboard "show closed" toggle).
    const closedFilter =
      closed === "1"
        ? sql`${clients.closedAt} is not null`
        : includeClosed === "1"
          ? undefined
          : isNull(clients.closedAt)

    const whereClause = and(
      eq(clients.organizationId, orgId),
      isNull(clients.deletedAt),
      closedFilter,
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
      category: clients.category,
      isOwn: clients.isOwn,
      onboardDate: clients.onboardDate,
      deletedAt: clients.deletedAt,
      closedAt: clients.closedAt,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
      totalIncoming: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`,
      totalOutgoing: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`,
      // Direct attachments on the client (correlated subquery → no row fan-out
      // from the transactions LEFT JOIN above). Drives the list paperclip badge.
      attachmentCount: sql<number>`(select count(*)::int from client_attachments where client_id = ${clients.id})`,
    }

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const offset = (pageNum - 1) * PAGE_SIZE

      // Count and page rows are independent — run them as one parallel batch.
      const [[{ total }], rows] = await Promise.all([
        db.select({ total: count() }).from(clients).where(whereClause),
        db
          .select(selectFields)
          .from(clients)
          .leftJoin(transactions, and(eq(transactions.clientId, clients.id), isNull(transactions.deletedAt)))
          .where(whereClause)
          .groupBy(clients.id)
          .orderBy(desc(clients.isOwn), orderBy, desc(clients.id))
          .limit(PAGE_SIZE)
          .offset(offset),
      ])

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select(selectFields)
      .from(clients)
      .leftJoin(transactions, and(eq(transactions.clientId, clients.id), isNull(transactions.deletedAt)))
      .where(whereClause)
      .groupBy(clients.id)
      .orderBy(desc(clients.isOwn), orderBy)
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    // Personal accounts can't manage clients — they get exactly one default client.
    if (!requireBusinessFeature(res, ctx, "clients")) return
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { name, company, email, phone, status, notes, onboard_date, category } = req.body as {
      name: string; company?: string; email?: string
      phone?: string; status?: string; notes?: string; onboard_date?: string; category?: string
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
        category: typeof category === "string" ? category.trim().slice(0, 60) : "",
        onboardDate: onboard_date ?? null,
      })
      .returning()
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
