import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm"
import { db, serialize } from "../src/lib/db"
import { quotations } from "../src/lib/db/schema"
import { canWrite, requireAuth } from "./_lib/auth"

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"]
const PAGE_SIZE = 20

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const { search, status, page } = req.query as {
      search?: string; status?: string; page?: string
    }

    const searchFilter = search?.trim()
      ? or(
          ilike(quotations.title, `%${search.trim()}%`),
          ilike(quotations.prospectName, `%${search.trim()}%`),
          ilike(quotations.company, `%${search.trim()}%`),
          ilike(quotations.email, `%${search.trim()}%`),
        )
      : undefined

    const statusFilter = status && VALID_STATUSES.includes(status)
      ? eq(quotations.status, status)
      : undefined

    const whereClause = and(
      eq(quotations.organizationId, orgId),
      isNull(quotations.deletedAt),
      searchFilter,
      statusFilter,
    )

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const offset = (pageNum - 1) * PAGE_SIZE

      const [{ total }] = await db
        .select({ total: count() })
        .from(quotations)
        .where(whereClause)

      const rows = await db
        .select()
        .from(quotations)
        .where(whereClause)
        .orderBy(desc(quotations.createdAt))
        .limit(PAGE_SIZE)
        .offset(offset)

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select()
      .from(quotations)
      .where(whereClause)
      .orderBy(desc(quotations.createdAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { title, prospect_name, company, email, phone, amount, status, notes } = req.body as {
      title: string; prospect_name: string; company?: string; email?: string
      phone?: string; amount?: number; status?: string; notes?: string
    }
    if (!title?.trim()) return res.status(400).json({ error: "title is required" })
    if (!prospect_name?.trim()) return res.status(400).json({ error: "prospect_name is required" })
    const normalizedStatus = status ?? "draft"
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ error: "status must be draft, sent, accepted, or rejected" })
    }
    const [row] = await db
      .insert(quotations)
      .values({
        userId,
        organizationId: orgId,
        title: title.trim(),
        prospectName: prospect_name.trim(),
        company: company ?? "",
        email: email ?? "",
        phone: phone ?? "",
        amount: amount != null ? String(amount) : "0",
        status: normalizedStatus,
        notes: notes ?? "",
      })
      .returning()
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
