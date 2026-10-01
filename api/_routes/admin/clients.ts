import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, organizations, transactions } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { trashClients } from "../../_lib/client-trash.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "../../_lib/fx-rates.js"
import { expenseSumSqlIn, incomeSumSqlIn, missingRateCountSql } from "../../_lib/tx-sql.js"

const PAGE_SIZE = 30
const VALID_STATUSES = ["active", "inactive", "archived"]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, req.method === "GET" ? "read" : "write")
  if (!ctx) return

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

    // Totals exactly as the workspace's own client list computes them
    // (api/_routes/clients.ts, MC-112): live non-system rows only — a trashed
    // row or an Opening Balance is no client's income — each converted at its
    // own date into the reporting currency (`totals_currency`), and a row
    // with no rate left out and counted in `excluded_count`.
    const reporting = await reportingCurrencyFor(organization_id)
    await ensureRatesForOrg(organization_id, reporting).catch(() => undefined)

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
        totalIncoming: incomeSumSqlIn(reporting),
        totalOutgoing: expenseSumSqlIn(reporting),
        totalsCurrency: sql<string>`${reporting}::text`,
        excludedCount: missingRateCountSql(reporting),
        transactionCount: sql<number>`count(${transactions.id})::int`,
      })
      .from(clients)
      .leftJoin(transactions, and(eq(transactions.clientId, clients.id), isNull(transactions.deletedAt), eq(transactions.isSystem, false)))
      .where(whereClause)
      .groupBy(clients.id)
      .orderBy(desc(clients.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    return res.json({ data: rows.map(serialize), total, pageSize: PAGE_SIZE, currency: reporting })
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
      // The FK cascade deletes the client's rows with no balance reversal, no
      // transfer header and no debt allocation following them, so a client
      // carrying any row the ledger owns is refused — the same predicate and
      // code as api/_routes/admin/transactions.ts, live or trashed (a trashed
      // transfer leg still has a header). Soft delete it, then purge from the
      // workspace's Trash. In the WHERE, so the check and the delete are one.
      const result = await db
        .delete(clients)
        .where(and(eq(clients.id, client_id), sql`not exists (
          select 1 from transactions t
          where t.client_id = ${client_id}
            and (t.wealth_account_id is not null or t.transfer_id is not null or t.is_system
              or exists (select 1 from debt_payments dp
                where dp.transaction_id = t.id or (t.group_id is not null and dp.group_id = t.group_id)))
        )`))
        .returning({ id: clients.id })
      if (result.length) return res.status(204).end()
      const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, client_id)).limit(1)
      if (!row) return res.status(404).json({ error: "Not found" })
      return res.status(409).json({
        error: "This client has rows that move an account balance, a transfer or a debt — move it to Trash and purge it from the workspace instead.",
        code: "admin_ledger_row_locked",
      })
    }

    // Soft delete takes the client's rows to Trash with it, balances reversed,
    // exactly as the workspace DELETE does — flagging the client alone left its
    // rows live in the balances but gone from every report.
    const [target] = await db
      .select({ organizationId: clients.organizationId, isOwn: clients.isOwn })
      .from(clients)
      .where(and(eq(clients.id, client_id), isNull(clients.deletedAt)))
    if (!target) return res.status(404).json({ error: "Not found" })
    if (target.isOwn) return res.status(403).json({ error: "Your own company client can't be deleted." })
    if (!target.organizationId) return res.status(409).json({ error: "Client organization is missing", code: "organization_missing" })
    const result = await trashClients(target.organizationId, ctx.userId, [client_id])
    if (!result.ok) return res.status(result.status).json(result.body)
    if (!result.ids.length) return res.status(404).json({ error: "Not found" })
    const [updated] = await db.select().from(clients).where(eq(clients.id, client_id))
    return res.json(serialize(updated))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
