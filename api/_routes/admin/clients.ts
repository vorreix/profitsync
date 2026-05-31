import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db"
import { clients, organizations, transactions } from "../../../src/lib/db/schema"
import { requireAdmin } from "../../_lib/admin"

const PAGE_SIZE = 30
const VALID_STATUSES = ["active", "inactive", "archived"]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    const { organization_id, search, status, page } = req.query as {
      organization_id?: string
      search?: string
      status?: string
      page?: string
    }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const searchFilter = search?.trim()
      ? or(
          ilike(clients.name, `%${search.trim()}%`),
          ilike(clients.company, `%${search.trim()}%`),
          ilike(clients.email, `%${search.trim()}%`),
        )
      : undefined

    const statusFilter =
      status && VALID_STATUSES.includes(status) ? eq(clients.status, status) : undefined

    const whereClause = and(
      eq(clients.organizationId, organization_id),
      isNull(clients.deletedAt),
      searchFilter,
      statusFilter,
    )

    const [{ total }] = await db
      .select({ total: count() })
      .from(clients)
      .where(whereClause)

    const rows = await db
      .select({
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
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
        totalIncoming: sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`,
        totalOutgoing: sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`,
        transactionCount: sql<number>`count(${transactions.id})::int`,
      })
      .from(clients)
      .leftJoin(transactions, eq(transactions.clientId, clients.id))
      .where(whereClause)
      .groupBy(clients.id)
      .orderBy(desc(clients.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE })
  }

  if (req.method === "POST") {
    const { organization_id, name, company, email, phone, status, notes, onboard_date } =
      req.body as {
        organization_id?: string
        name?: string
        company?: string
        email?: string
        phone?: string
        status?: string
        notes?: string
        onboard_date?: string
      }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    const normalizedStatus = status ?? "active"
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ error: "status must be active, inactive, or archived" })
    }

    const [org] = await db
      .select({ id: organizations.id, ownerUserId: organizations.ownerUserId })
      .from(organizations)
      .where(eq(organizations.id, organization_id))
    if (!org) return res.status(404).json({ error: "Organization not found" })

    const [row] = await db
      .insert(clients)
      .values({
        userId: org.ownerUserId,
        organizationId: organization_id,
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

  if (req.method === "PATCH") {
    const { client_id, name, company, email, phone, status, notes, onboard_date } = req.body as {
      client_id?: string
      name?: string
      company?: string
      email?: string
      phone?: string
      status?: string
      notes?: string
      onboard_date?: string | null
    }
    if (!client_id) return res.status(400).json({ error: "client_id is required" })

    const patch: Partial<typeof clients.$inferInsert> = { updatedAt: new Date() }
    if (typeof name === "string" && name.trim()) patch.name = name.trim()
    if (typeof company === "string") patch.company = company
    if (typeof email === "string") patch.email = email
    if (typeof phone === "string") patch.phone = phone
    if (typeof notes === "string") patch.notes = notes
    if (typeof onboard_date === "string" || onboard_date === null) {
      patch.onboardDate = onboard_date
    }
    if (typeof status === "string") {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: "status must be active, inactive, or archived" })
      }
      patch.status = status
    }

    const [updated] = await db
      .update(clients)
      .set(patch)
      .where(and(eq(clients.id, client_id), isNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const { client_id, hard } = req.body as { client_id?: string; hard?: boolean }
    if (!client_id) return res.status(400).json({ error: "client_id is required" })

    if (hard) {
      const result = await db.delete(clients).where(eq(clients.id, client_id)).returning({ id: clients.id })
      if (!result.length) return res.status(404).json({ error: "Not found" })
      return res.status(204).end()
    }

    const [updated] = await db
      .update(clients)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(clients.id, client_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
