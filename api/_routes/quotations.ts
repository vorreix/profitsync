import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, getTableColumns, ilike, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { quotations } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth, requireBusinessFeature } from "../_lib/auth.js"
import { checkNoteLength, checkQuotationQuota } from "../_lib/quota.js"

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"]
const PAGE_SIZE = 20

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  // Quotations are a business-only feature.
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const { search, status, page, dateFrom, dateTo } = req.query as {
      search?: string; status?: string; page?: string; dateFrom?: string; dateTo?: string
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

    // Date range filters on created_at; `dateTo` is inclusive of the whole day.
    const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
    const dateFromFilter = isDate(dateFrom) ? sql`${quotations.createdAt} >= ${dateFrom}::date` : undefined
    const dateToFilter = isDate(dateTo) ? sql`${quotations.createdAt} < (${dateTo}::date + interval '1 day')` : undefined

    const whereClause = and(
      eq(quotations.organizationId, orgId),
      isNull(quotations.deletedAt),
      searchFilter,
      statusFilter,
      dateFromFilter,
      dateToFilter,
    )

    // All quotation columns + a direct attachment count for the list badge.
    const selectFields = {
      ...getTableColumns(quotations),
      attachmentCount: sql<number>`(select count(*)::int from quotation_attachments where quotation_id = ${quotations.id})`,
    }

    if (page !== undefined) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const offset = (pageNum - 1) * PAGE_SIZE

      // Count and page rows are independent — run them as one parallel batch.
      const [[{ total }], rows] = await Promise.all([
        db.select({ total: count() }).from(quotations).where(whereClause),
        db
          .select(selectFields)
          .from(quotations)
          .where(whereClause)
          .orderBy(desc(quotations.createdAt), desc(quotations.id))
          .limit(PAGE_SIZE)
          .offset(offset),
      ])

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select(selectFields)
      .from(quotations)
      .where(whereClause)
      .orderBy(desc(quotations.createdAt), desc(quotations.id))
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
    const quota = await checkQuotationQuota(orgId)
    if (!quota.allowed) return res.status(402).json(quota)
    const noteCheck = await checkNoteLength(orgId, notes)
    if (!noteCheck.allowed) return res.status(402).json(noteCheck)
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
