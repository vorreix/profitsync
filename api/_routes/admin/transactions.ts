import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, desc, eq, ilike, isNull, not, or, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { currencyForFinancialWrite } from "../../_lib/transaction-currency.js"

const PAGE_SIZE = 30

/**
 * A row this console must not write directly: it moves (or explains) an
 * account balance, belongs to a logical transfer (legs AND fee rows), or
 * anchors a debt repayment. Those are owned by the ledger services — the
 * balance delta, the transfer header and the debt allocation all have to move
 * with the row, and a plain UPDATE/DELETE here moved none of them. Only the
 * account-less rows this console itself creates stay editable. ONE predicate:
 * the list flags rows with it and PATCH/DELETE refuse with it.
 *
 * Qualified by hand: drizzle renders column refs BARE in a join-less select,
 * and a bare `id` / `group_id` inside the debt_payments subquery would bind to
 * debt_payments' own columns (every row would then read as locked).
 */
const ledgerLocked = sql<boolean>`(
  transactions.wealth_account_id is not null
  or transactions.transfer_id is not null
  or transactions.is_system
  or exists (
    select 1 from debt_payments dp
    where dp.transaction_id = transactions.id
      or (transactions.group_id is not null and dp.group_id = transactions.group_id)
  )
)`

/** 404 when the row is gone, else 409: it exists but the ledger owns it. */
async function refuseLocked(res: VercelResponse, transactionId: string) {
  const [row] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.id, transactionId)).limit(1)
  if (!row) return res.status(404).json({ error: "Not found" })
  return res.status(409).json({
    error: "This row moves an account balance, a transfer or a debt — change it from the workspace so everything stays in step.",
    code: "admin_ledger_row_locked",
  })
}

const txFields = {
  id: transactions.id,
  clientId: transactions.clientId,
  clientName: clients.name,
  organizationId: clients.organizationId,
  type: transactions.type,
  amount: transactions.amount,
  // The row's own currency (its account's), never the org's.
  currencyCode: transactions.currencyCode,
  ledgerLocked,
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
      .select({ id: clients.id, organizationId: clients.organizationId })
      .from(clients)
      .where(and(eq(clients.id, client_id), isNull(clients.deletedAt)))
    if (!client) return res.status(404).json({ error: "Client not found" })
    if (!client.organizationId) return res.status(409).json({ error: "Client organization is missing", code: "organization_missing" })
    const currencyCode = await currencyForFinancialWrite(client.organizationId)
    if (!currencyCode) return res.status(409).json({ error: "Organization currency migration is incomplete", code: "currency_missing" })

    const today = new Date().toISOString().split("T")[0]
    const [row] = await db
      .insert(transactions)
      .values({
        clientId: client_id,
        type,
        amount: String(amount),
        currencyCode,
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

    // The lock is part of the WHERE, so a row that gains an account between a
    // check and the write can never be written here.
    const [updated] = await db
      .update(transactions)
      .set(patch)
      .where(and(eq(transactions.id, transaction_id), not(ledgerLocked)))
      .returning()
    if (!updated) return refuseLocked(res, transaction_id)
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const { transaction_id } = req.body as { transaction_id?: string }
    if (!transaction_id) return res.status(400).json({ error: "transaction_id is required" })
    const result = await db
      .delete(transactions)
      .where(and(eq(transactions.id, transaction_id), not(ledgerLocked)))
      .returning({ id: transactions.id })
    if (!result.length) return refuseLocked(res, transaction_id)
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
