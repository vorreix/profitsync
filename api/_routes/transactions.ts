import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { checkTransactionQuota } from "../_lib/quota.js"
import { logAudit } from "../_lib/audit.js"
import { balanceDelta } from "../../src/lib/wealth-ledger.js"
import { amountExceedsLimit } from "../../src/lib/money.js"

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
  wealthAccountId: transactions.wealthAccountId,
  wealthAccountName: wealthAccounts.nickname,
  wealthAccountBankName: wealthAccounts.bankName,
  wealthAccountType: wealthAccounts.type,
  wealthAccountIcon: wealthAccounts.icon,
  groupId: transactions.groupId,
  kind: transactions.kind,
  type: transactions.type,
  amount: transactions.amount,
  description: transactions.description,
  category: transactions.category,
  date: transactions.date,
  isSystem: transactions.isSystem,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
  // Drives the list paperclip badge.
  attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
}

// A split transaction's legs share a `group_id`; everywhere that isn't scoped to
// a single account we collapse them into ONE representative row. The grouping key
// is `coalesce(group_id, id)` so ordinary single-account rows (group_id NULL)
// each form their own one-row "group" and pass through unchanged.
const groupKey = sql`coalesce(${transactions.groupId}, ${transactions.id})`

const groupedFields = {
  // Representative leg id (earliest-created) — used to open the detail view.
  id: sql<string>`(array_agg(${transactions.id} order by ${transactions.createdAt} asc, ${transactions.id} asc))[1]`,
  clientId: sql<string>`max(${transactions.clientId}::text)`,
  clientName: sql<string>`max(${clients.name})`,
  // For a single-leg group these are the account's real values; the UI ignores
  // them when account_count > 1 (it shows "N accounts" instead).
  wealthAccountId: sql<string | null>`max(${transactions.wealthAccountId}::text)`,
  wealthAccountName: sql<string | null>`max(${wealthAccounts.nickname})`,
  wealthAccountBankName: sql<string | null>`max(${wealthAccounts.bankName})`,
  wealthAccountType: sql<string | null>`max(${wealthAccounts.type})`,
  wealthAccountIcon: sql<string | null>`max(${wealthAccounts.icon})`,
  groupId: sql<string | null>`max(${transactions.groupId}::text)`,
  kind: sql<string>`max(${transactions.kind})`,
  legCount: sql<number>`count(*)::int`,
  accountCount: sql<number>`count(distinct ${transactions.wealthAccountId})::int`,
  type: sql<string>`max(${transactions.type})`,
  amount: sql<string>`sum(${transactions.amount}::numeric)`,
  description: sql<string>`max(${transactions.description})`,
  category: sql<string>`max(${transactions.category})`,
  // Cast to text so the grouped row returns a plain 'YYYY-MM-DD' like the
  // non-grouped path (a raw max(date) comes back as a tz-shifted timestamp).
  date: sql<string>`max(${transactions.date})::text`,
  isSystem: sql<boolean>`bool_or(${transactions.isSystem})`,
  createdAt: sql<string>`max(${transactions.createdAt})`,
  updatedAt: sql<string>`max(${transactions.updatedAt})`,
  attachmentCount: sql<number>`coalesce(sum((select count(*) from transaction_attachments where transaction_id = ${transactions.id})), 0)::int`,
}

function groupedOrder(sort: string | undefined) {
  switch (sort) {
    case "date_asc":
      return [asc(sql`max(${transactions.date})`), asc(sql`max(${transactions.createdAt})`)]
    case "amount_desc":
      return [desc(sql`sum(${transactions.amount}::numeric)`), desc(sql`max(${transactions.createdAt})`)]
    case "amount_asc":
      return [asc(sql`sum(${transactions.amount}::numeric)`), desc(sql`max(${transactions.createdAt})`)]
    case "date_desc":
    default:
      return [desc(sql`max(${transactions.date})`), desc(sql`max(${transactions.createdAt})`)]
  }
}

type SqlWhere = ReturnType<typeof and>

async function groupedRows(where: SqlWhere, sort: string | undefined, limit?: number, offset?: number) {
  const q = db
    .select(groupedFields)
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
    .where(where)
    .groupBy(groupKey)
    .orderBy(...groupedOrder(sort))
  if (limit !== undefined && offset !== undefined) return await q.limit(limit).offset(offset)
  if (limit !== undefined) return await q.limit(limit)
  return await q
}

async function groupedTotal(where: SqlWhere): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`count(distinct coalesce(${transactions.groupId}, ${transactions.id}))::int` })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(where)
  return Number(r?.total ?? 0)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method === "GET") {
    const { clientId, wealthAccountId, groupId, search, type, page, sort, limit, category, from, to, includeClosed } = req.query as {
      clientId?: string; wealthAccountId?: string; groupId?: string; search?: string; type?: string; page?: string; sort?: string; limit?: string; category?: string; from?: string; to?: string; includeClosed?: string
    }

    // Fetch every leg of one split group (drives the detail breakdown). Always
    // flat + org-scoped.
    if (groupId) {
      const legs = await db
        .select(txFields)
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
        .where(and(eq(transactions.groupId, groupId), eq(clients.organizationId, orgId), isNull(transactions.deletedAt)))
        .orderBy(asc(transactions.createdAt), asc(transactions.id))
      return res.json(legs.map(serialize))
    }

    // Scope to a single wealth account (drives the account-detail page).
    const accountFilter = wealthAccountId ? eq(transactions.wealthAccountId, wealthAccountId) : undefined
    // Collapse split legs into one row for the GLOBAL transactions list. An
    // account-scoped view (?wealthAccountId) shows the per-account leg; a
    // client-scoped view (?clientId, the client detail page) keeps its own
    // per-leg display + edit flow, so it stays flat too.
    const grouped = !wealthAccountId && !clientId
    // Transfers are internal account-to-account moves: show them ONLY on the
    // account-detail list (so you can see the movement), never in the global or
    // client lists. The income/expense summary always excludes them.
    const listExcludesTransfers = wealthAccountId ? undefined : ne(transactions.kind, "transfer")

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

      const clientWhere = and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt), accountFilter, listExcludesTransfers)
      const rows = grouped
        ? await groupedRows(clientWhere, sort)
        : await db
            .select(txFields)
            .from(transactions)
            .innerJoin(clients, eq(transactions.clientId, clients.id))
            .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
            .where(clientWhere)
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
      accountFilter,
      listExcludesTransfers,
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
        accountFilter,
        // The income/expense summary never counts internal transfers (net zero).
        ne(transactions.kind, "transfer"),
        searchFilter,
        categoryFilter,
        dateFromFilter,
        dateToFilter,
      )

      // Count (of groups, when grouping), page rows and summary are independent —
      // run as one parallel batch. The summary sums RAW legs: a split's legs add
      // up to the group total, so income/expense figures are unchanged by grouping.
      const [total, rows, [summaryRow]] = await Promise.all([
        grouped
          ? groupedTotal(whereClause)
          : db
              .select({ total: count() })
              .from(transactions)
              .innerJoin(clients, eq(transactions.clientId, clients.id))
              .where(whereClause)
              .then((r) => Number(r[0]?.total ?? 0)),
        grouped
          ? groupedRows(whereClause, sort, PAGE_SIZE, offset)
          : db
              .select(txFields)
              .from(transactions)
              .innerJoin(clients, eq(transactions.clientId, clients.id))
              .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
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
    if (limit !== undefined) {
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))
      const rows = grouped
        ? await groupedRows(whereClause, sort, limitNum)
        : await db
            .select(txFields)
            .from(transactions)
            .innerJoin(clients, eq(transactions.clientId, clients.id))
            .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
            .where(whereClause)
            .orderBy(...orderBy)
            .limit(limitNum)
      return res.json(rows.map(serialize))
    }

    const rows = grouped
      ? await groupedRows(whereClause, sort)
      : await db
          .select(txFields)
          .from(transactions)
          .innerJoin(clients, eq(transactions.clientId, clients.id))
          .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
          .where(whereClause)
          .orderBy(...orderBy)
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { client_id, type, amount, description, category, date, wealth_account_id, is_system } = req.body as {
      client_id: string; type: string; amount: number
      description?: string; category?: string; date?: string; wealth_account_id?: string; is_system?: boolean
    }

    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "amount is required" })
    if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    if (!["incoming", "outgoing"].includes(type)) return res.status(400).json({ error: "type must be incoming or outgoing" })
    if (!wealth_account_id) return res.status(400).json({ error: "wealth_account_id is required" })
    const [account] = await db
      .select()
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.id, wealth_account_id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
    if (!account) return res.status(400).json({ error: "Select an active bank or cash account" })

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
        wealthAccountId: wealth_account_id,
        type,
        amount: String(amount),
        description: description ?? "",
        category: category ?? "",
        date: date ?? today,
        isSystem: !!is_system,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
    const nextBalance = Number(account.currentBalance) + balanceDelta(type, amount)
    await db
      .update(wealthAccounts)
      .set({ currentBalance: String(nextBalance), updatedBy: userId, updatedAt: new Date() })
      .where(eq(wealthAccounts.id, wealth_account_id))
    await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
