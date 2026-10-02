import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, getTableColumns, ilike, isNull, or, sql, type SQL } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { quotations } from "../../src/lib/db/schema.js"
import { canWrite, requireAuth, requireBusinessFeature } from "../_lib/auth.js"
import { checkNoteLength, checkQuotationQuota } from "../_lib/quota.js"
import { logAudit } from "../_lib/audit.js"
import { moneyRefusal, selectableCurrencyCode } from "../../src/lib/money.js"
import { reportingCurrencyFor } from "../_lib/fx-rates.js"
import { inReporting } from "../_lib/entity-drilldown.js"
import { cleanTags, normalizeTagName } from "../../src/lib/tags.js"

const VALID_STATUSES = ["draft", "sent", "accepted", "rejected"]
const PAGE_SIZE = 20

const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Server-side ordering for the table view's sortable columns. Default keeps the
 * historical `created_at desc` order (what the card/list grid shows). `id` is the
 * stable tie-breaker so pages don't drift when rows share a sort value.
 *
 * An amount sort compares quotes in the REPORTING currency (each converted at
 * its own date, as the transactions list does — MC-130): ₹50,000 is not more
 * than $5,000. A quote with no rate has no comparable amount and sorts last in
 * both directions, grouped by currency so its own figures still read in order.
 */
export function orderForSort(sort: string | undefined, orgId: string): SQL[] {
  const reporting = () => inReporting(orgId, quotations.amount, quotations.currencyCode, quotations.date)
  switch (sort) {
    case "created_asc": return [asc(quotations.createdAt), asc(quotations.id)]
    case "date_desc": return [desc(quotations.date), desc(quotations.id)]
    case "date_asc": return [asc(quotations.date), asc(quotations.id)]
    case "amount_desc": return [sql`${reporting()} desc nulls last`, asc(quotations.currencyCode), desc(quotations.amount), desc(quotations.id)]
    case "amount_asc": return [sql`${reporting()} asc nulls last`, asc(quotations.currencyCode), asc(quotations.amount), asc(quotations.id)]
    case "title_asc": return [asc(quotations.title), asc(quotations.id)]
    case "title_desc": return [desc(quotations.title), desc(quotations.id)]
    case "prospect_asc": return [asc(quotations.prospectName), asc(quotations.id)]
    case "prospect_desc": return [desc(quotations.prospectName), desc(quotations.id)]
    case "status_asc": return [asc(quotations.status), asc(quotations.id)]
    case "status_desc": return [desc(quotations.status), desc(quotations.id)]
    case "created_desc":
    default: return [desc(quotations.createdAt), desc(quotations.id)]
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  // Quotations are a business-only feature.
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const { search, status, page, dateFrom, dateTo, closed, includeClosed, tag, sort } = req.query as {
      search?: string; status?: string; page?: string; dateFrom?: string; dateTo?: string; closed?: string; includeClosed?: string; tag?: string; sort?: string
    }
    const orderBy = orderForSort(sort, orgId)

    // `?tag=#x` → jsonb containment on the GIN-indexed tags array (normalized).
    const normalizedTag = tag ? normalizeTagName(tag) : ""
    const tagFilter = normalizedTag ? sql`${quotations.tags} @> ${JSON.stringify([normalizedTag])}::jsonb` : undefined

    const closedFilter =
      closed === "1"
        ? sql`${quotations.closedAt} is not null`
        : includeClosed === "1"
          ? undefined
          : isNull(quotations.closedAt)

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
      closedFilter,
      searchFilter,
      statusFilter,
      dateFromFilter,
      dateToFilter,
      tagFilter,
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
          .orderBy(...orderBy)
          .limit(PAGE_SIZE)
          .offset(offset),
      ])

      return res.json({ data: rows.map(serialize), total })
    }

    const rows = await db
      .select(selectFields)
      .from(quotations)
      .where(whereClause)
      .orderBy(...orderBy)
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { title, prospect_name, company, email, phone, amount, date, status, notes, category, tags, currency_code } = req.body as {
      title: string; prospect_name: string; company?: string; email?: string
      phone?: string; amount?: number; date?: string; status?: string; notes?: string; category?: string; tags?: unknown
      currency_code?: string
    }
    if (!title?.trim()) return res.status(400).json({ error: "title is required" })
    if (!prospect_name?.trim()) return res.status(400).json({ error: "prospect_name is required" })
    const normalizedStatus = status ?? "draft"
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({ error: "status must be draft, sent, accepted, or rejected" })
    }
    // A quote KEEPS the currency it was written in (the workspace's reporting
    // currency unless the caller names one): a later reporting change must not
    // relabel a sent €12,000 quote as ₹12,000.
    const [quota, reporting] = await Promise.all([checkQuotationQuota(orgId), reportingCurrencyFor(orgId)])
    // A new quote is new money: a currency whose decimals the column keeps, or
    // the workspace's own (MC-031) — the AI may hear "Kuwaiti dinars".
    const currencyCode = currency_code != null ? selectableCurrencyCode(currency_code, reporting) : reporting
    if (!currencyCode) return res.status(400).json({ error: "Invalid currency code", code: "invalid_currency" })
    // To that currency's decimals (none for ¥) and within MAX_MONEY: numeric(20,2)
    // would store ¥1,500.50 that every view prints as ¥1,501 (MC-031/047).
    const badAmount = moneyRefusal(currencyCode, amount)
    if (badAmount) return res.status(400).json(badAmount)
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
        currencyCode,
        date: isIsoDate(date) ? date : new Date().toISOString().split("T")[0],
        status: normalizedStatus,
        notes: notes ?? "",
        category: typeof category === "string" ? category.trim().slice(0, 60) : "",
        tags: cleanTags(tags),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
    await logAudit({ orgId, entityType: "quotation", entityId: row.id, action: "create", actorId: userId })
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
