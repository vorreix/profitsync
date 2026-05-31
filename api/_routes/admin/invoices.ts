import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { invoices, organizations, userProfiles } from "../../../src/lib/db/schema.js"
import { requireAdmin } from "../../_lib/admin.js"

const PAGE_SIZE = 30
const VALID_STATUSES = ["draft", "open", "paid", "uncollectible", "void", "refunded"]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const adminId = await requireAdmin(req, res)
  if (!adminId) return

  if (req.method === "GET") {
    const { search, status, page } = req.query as { search?: string; status?: string; page?: string }
    const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1)
    const offset = (pageNum - 1) * PAGE_SIZE

    const searchFilter = search?.trim()
      ? ilike(organizations.name, `%${search.trim()}%`)
      : undefined
    const statusFilter =
      status && VALID_STATUSES.includes(status) ? eq(invoices.status, status) : undefined

    const whereClause = and(searchFilter, statusFilter)

    const [{ total }] = await db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
      .where(whereClause)

    const rows = await db
      .select({
        id: invoices.id,
        subscriptionId: invoices.subscriptionId,
        organizationId: invoices.organizationId,
        organizationName: organizations.name,
        ownerEmail: userProfiles.email,
        amount: invoices.amount,
        currency: invoices.currency,
        status: invoices.status,
        provider: invoices.provider,
        providerInvoiceId: invoices.providerInvoiceId,
        pdfUrl: invoices.pdfUrl,
        issuedAt: invoices.issuedAt,
        paidAt: invoices.paidAt,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
      .leftJoin(userProfiles, eq(userProfiles.id, organizations.ownerUserId))
      .where(whereClause)
      .orderBy(desc(invoices.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE })
  }

  if (req.method === "POST") {
    const { organization_id, subscription_id, amount, currency, status } = req.body as {
      organization_id?: string
      subscription_id?: string
      amount?: number | string
      currency?: string
      status?: string
    }
    if (!organization_id) return res.status(400).json({ error: "organization_id is required" })

    const [created] = await db
      .insert(invoices)
      .values({
        organizationId: organization_id,
        subscriptionId: subscription_id ?? null,
        amount: String(amount ?? "0"),
        currency: currency ?? "USD",
        status: status && VALID_STATUSES.includes(status) ? status : "draft",
        ...(status === "paid" ? { paidAt: new Date() } : {}),
      })
      .returning()
    return res.status(201).json(serialize(created))
  }

  if (req.method === "PATCH") {
    const { invoice_id, status, pdf_url } = req.body as {
      invoice_id?: string
      status?: string
      pdf_url?: string
    }
    if (!invoice_id) return res.status(400).json({ error: "invoice_id is required" })
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status" })
    }
    const [updated] = await db
      .update(invoices)
      .set({
        ...(status !== undefined ? { status } : {}),
        ...(status === "paid" ? { paidAt: new Date() } : {}),
        ...(pdf_url !== undefined ? { pdfUrl: pdf_url } : {}),
      })
      .where(eq(invoices.id, invoice_id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const { invoice_id } = req.query as { invoice_id?: string }
    if (!invoice_id) return res.status(400).json({ error: "invoice_id is required" })
    const result = await db.delete(invoices).where(eq(invoices.id, invoice_id)).returning({ id: invoices.id })
    if (!result.length) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
