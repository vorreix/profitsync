import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, recurringRules, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { checkTransactionQuota, checkTransactionTagQuota } from "../_lib/quota.js"
import { logAudit } from "../_lib/audit.js"
import { balanceShiftCte, ledgerMovesSql } from "../_lib/tx-legs.js"
import { amountExceedsLimit, moneyRefusal } from "../../src/lib/money.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { notifyIfBudgetExceeded } from "../_lib/notify-budget.js"
import { cleanTransactionTags } from "../../src/lib/transaction-tags.js"
import { refundShapeValid } from "../../src/lib/tx-classify.js"
import { expenseSumSqlIn, fxFor, incomeSumSqlIn, missingRateCountSql, nativeSummarySql, pnlKindFilter, reportingAmountSql, USER_KINDS, withFx, type FxTarget } from "../_lib/tx-sql.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "../_lib/fx-rates.js"
import { groupMoneySql } from "../_lib/tx-group-sql.js"
import { attributeCard, cardTransactionFilter } from "../_lib/cards.js"
import { syncCards } from "../_lib/card-autopay.js"

const PAGE_SIZE = 20

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// An amount sort compares rows in the REPORTING currency (each converted at its
// own date) — native amounts of different currencies are not comparable (₹5,000
// is not more than €100). A row with no rate has no comparable amount and sorts
// last in both directions.
function pickOrder(sort: string | undefined, reporting: string) {
  switch (sort) {
    case "date_asc":
      return [asc(transactions.date), asc(transactions.createdAt)]
    case "amount_desc":
      return [sql`${reportingAmountSql(reporting)} desc nulls last`, desc(transactions.createdAt)]
    case "amount_asc":
      return [sql`${reportingAmountSql(reporting)} asc nulls last`, desc(transactions.createdAt)]
    case "date_desc":
    default:
      return [desc(transactions.date), desc(transactions.createdAt)]
  }
}

// A row's money is NATIVE: `amount` in `currency_code` (its account's currency).
// `reporting_amount` is the same figure converted at the row's date into the
// workspace's reporting currency — NULL when no rate is stored for that day —
// so a screen that sums rows client-side (the dashboard) can add like with like
// and count what it could not convert, instead of adding EUR to INR.
const txFieldsFor = (reporting: string) => ({
  id: transactions.id,
  clientId: transactions.clientId,
  clientName: clients.name,
  wealthAccountId: transactions.wealthAccountId,
  wealthAccountName: wealthAccounts.nickname,
  wealthAccountBankName: wealthAccounts.bankName,
  wealthAccountType: wealthAccounts.type,
  wealthAccountIcon: wealthAccounts.icon,
  // Which card paid (attribution only) — the list chip resolves it client-side.
  cardId: transactions.cardId,
  groupId: transactions.groupId,
  kind: transactions.kind,
  type: transactions.type,
  amount: transactions.amount,
  currencyCode: transactions.currencyCode,
  reportingAmount: reportingAmountSql(reporting),
  description: transactions.description,
  category: transactions.category,
  tags: transactions.tags,
  date: transactions.date,
  isSystem: transactions.isSystem,
  recurringRuleId: transactions.recurringRuleId,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
  // Drives the list paperclip badge.
  attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
  // For a transfer leg: the OTHER leg's account (same group_id) — id + type — so
  // the UI can badge a transfer to/from a Space and deep-link to it.
  counterpartAccountId: sql<string | null>`(select t2.wealth_account_id::text from transactions t2 where t2.group_id = ${transactions.groupId} and t2.id <> ${transactions.id} and ${transactions.kind} = 'transfer' limit 1)`,
  counterpartType: sql<string | null>`(select wa.type from transactions t2 join wealth_accounts wa on wa.id = t2.wealth_account_id where t2.group_id = ${transactions.groupId} and t2.id <> ${transactions.id} and ${transactions.kind} = 'transfer' limit 1)`,
})

// A split transaction's legs share a `group_id`; everywhere that isn't scoped to
// a single account we collapse them into ONE representative row. The grouping key
// is `coalesce(group_id, id)` so ordinary single-account rows (group_id NULL)
// each form their own one-row "group" and pass through unchanged.
const groupKey = sql`coalesce(${transactions.groupId}, ${transactions.id})`

const groupedFieldsFor = (reporting: string, fx: FxTarget) => ({
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
  // Card attribution of a collapsed group: real for one card, and the UI shows
  // "N cards" (like "N accounts") when card_count > 1 instead of one arbitrary chip.
  cardId: sql<string | null>`max(${transactions.cardId}::text)`,
  cardCount: sql<number>`count(distinct ${transactions.cardId})::int`,
  groupId: sql<string | null>`max(${transactions.groupId}::text)`,
  kind: sql<string>`max(${transactions.kind})`,
  legCount: sql<number>`count(*)::int`,
  accountCount: sql<number>`count(distinct ${transactions.wealthAccountId})::int`,
  type: sql<string>`max(${transactions.type})`,
  // A split's legs add up ONLY when they share a currency. Legs posted to
  // accounts in different currencies are summed in the reporting currency
  // instead (each at its own date) and the row says so via currency_code —
  // never a raw sum of EUR and INR. `amount` is NULL when a leg has no rate
  // (api/_lib/tx-group-sql.ts — shared with GET /api/transactions/:id).
  ...groupMoneySql(reporting, fx),
  description: sql<string>`max(${transactions.description})`,
  category: sql<string>`max(${transactions.category})`,
  // Group-level metadata: every leg carries the same tags, take the first leg's.
  tags: sql<string[]>`(array_agg(${transactions.tags} order by ${transactions.createdAt} asc, ${transactions.id} asc))[1]`,
  // Cast to text so the grouped row returns a plain 'YYYY-MM-DD' like the
  // non-grouped path (a raw max(date) comes back as a tz-shifted timestamp).
  date: sql<string>`max(${transactions.date})::text`,
  isSystem: sql<boolean>`bool_or(${transactions.isSystem})`,
  recurringRuleId: sql<string | null>`max(${transactions.recurringRuleId}::text)`,
  createdAt: sql<string>`max(${transactions.createdAt})`,
  updatedAt: sql<string>`max(${transactions.updatedAt})`,
  attachmentCount: sql<number>`coalesce(sum((select count(*) from transaction_attachments where transaction_id = ${transactions.id})), 0)::int`,
})

// Same rule as pickOrder: a group sorts by its total in the reporting currency,
// and a group with a leg that has no rate sorts last.
function groupedOrder(sort: string | undefined, reporting: string, fx: FxTarget) {
  switch (sort) {
    case "date_asc":
      return [asc(sql`max(${transactions.date})`), asc(sql`max(${transactions.createdAt})`)]
    case "amount_desc":
      return [sql`${groupMoneySql(reporting, fx).reportingAmount} desc nulls last`, desc(sql`max(${transactions.createdAt})`)]
    case "amount_asc":
      return [sql`${groupMoneySql(reporting, fx).reportingAmount} asc nulls last`, desc(sql`max(${transactions.createdAt})`)]
    case "date_desc":
    default:
      return [desc(sql`max(${transactions.date})`), desc(sql`max(${transactions.createdAt})`)]
  }
}

type SqlWhere = ReturnType<typeof and>

// The group money of EVERY group in scope is computed before the sort and the
// page limit, so its rates are joined once per (currency, day) when the
// workspace holds a foreign currency (MC-167; tx-sql.ts `fxFor`).
async function groupedRows(where: SqlWhere, sort: string | undefined, reporting: string, orgRates: { currencies: readonly string[] } | undefined, limit?: number, offset?: number) {
  const fx = fxFor(reporting, where, orgRates)
  const q = withFx(
    db
      .select(groupedFieldsFor(reporting, fx))
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
      .$dynamic(),
    fx,
  )
    .where(where)
    .groupBy(groupKey)
    .orderBy(...groupedOrder(sort, reporting, fx))
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
    // Materialize any due recurring occurrences BEFORE listing, so auto-created
    // rows and their balance effects are visible on first load (lazy, indexed
    // short-circuit when nothing is due — no cron needed).
    await materializeDueRecurring(orgId)
    // Card statements / autopay must have moved money before any list renders
    // (idempotent, short-circuits when the org has no open credit card).
    await syncCards(orgId).catch((err) => console.error("[cards] sync failed", err))
    // Rows stay native; the summary and each row's `reporting_amount` are in the
    // workspace's reporting currency, converted at the row's own date.
    const reporting = await reportingCurrencyFor(orgId)
    const orgRates = await ensureRatesForOrg(orgId, reporting).catch(() => undefined)
    const txFields = txFieldsFor(reporting)

    const { clientId, wealthAccountId: accountParam, cardId, recurringRuleId, groupId, search, type, page, sort, limit, category, tag, from, to, includeClosed } = req.query as {
      clientId?: string; wealthAccountId?: string; cardId?: string; recurringRuleId?: string; groupId?: string; search?: string; type?: string; page?: string; sort?: string; limit?: string; category?: string; tag?: string; from?: string; to?: string; includeClosed?: string
    }
    // `?cardId=` is an ACCOUNT-scoped view in disguise: a credit card owns its
    // whole liability account, a debit card owns the rows that carry its id.
    // Either way the list is flat and includes transfers, exactly like
    // `?wealthAccountId=` (a card payment must show on the card's own page).
    let wealthAccountId = accountParam
    let cardFilter: ReturnType<typeof eq> | undefined
    if (cardId) {
      const scope = await cardTransactionFilter(orgId, cardId)
      if (!scope) return res.status(404).json({ error: "Card not found" })
      cardFilter = scope.where
      wealthAccountId = wealthAccountId ?? "card" // marks the list as account-scoped below
    }

    // `?recurringRuleId=` — everything ONE recurring rule has created. Scoped
    // like the rule's own page: flat (a materialized occurrence is never a
    // split), transfers included (a Space auto-save materialises transfer legs)
    // and closed clients included, so the list can't disagree with the count the
    // rule itself reports.
    let recurringFilter: ReturnType<typeof eq> | undefined
    if (recurringRuleId) {
      // A non-uuid would reach Postgres as an invalid uuid literal (a 500); the
      // org check is what stops another workspace's rule id from listing rows.
      if (!UUID_RE.test(recurringRuleId)) return res.status(404).json({ error: "Recurring rule not found" })
      const [rule] = await db
        .select({ id: recurringRules.id })
        .from(recurringRules)
        .where(and(eq(recurringRules.id, recurringRuleId), eq(recurringRules.organizationId, orgId)))
      if (!rule) return res.status(404).json({ error: "Recurring rule not found" })
      recurringFilter = eq(transactions.recurringRuleId, recurringRuleId)
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

    // Scope to a single wealth account (drives the account-detail page) — or to
    // a card (its own page), which resolves to the same flat, transfer-inclusive shape.
    const accountFilter = cardFilter ?? (wealthAccountId ? eq(transactions.wealthAccountId, wealthAccountId) : undefined)
    // Collapse split legs into one row for the GLOBAL transactions list. An
    // account-scoped view (?wealthAccountId) shows the per-account leg; a
    // client-scoped view (?clientId, the client detail page) keeps its own
    // per-leg display + edit flow, so it stays flat too.
    const grouped = !wealthAccountId && !clientId && !recurringRuleId
    // Transfers are internal account-to-account moves: show them ONLY on the
    // account-detail list (so you can see the movement), never in the global or
    // client lists. The income/expense summary always excludes them.
    const listExcludesTransfers = wealthAccountId || recurringRuleId ? undefined : ne(transactions.kind, "transfer")

    const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
    const dateFromFilter = isDate(from) ? gte(transactions.date, from) : undefined
    const dateToFilter = isDate(to) ? lte(transactions.date, to) : undefined
    // Exclude transactions of closed clients from the default list/analytics;
    // `?includeClosed=1` brings them back (dashboard "show closed" toggle).
    const closedClientFilter = includeClosed === "1" || recurringRuleId ? undefined : isNull(clients.closedAt)

    const orderBy = pickOrder(sort, reporting)

    if (clientId) {
      const [client] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      if (!client) return res.status(403).json({ error: "Forbidden" })

      const clientWhere = and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt), accountFilter, listExcludesTransfers)
      const rows = grouped
        ? await groupedRows(clientWhere, sort, reporting, orgRates)
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
          sql`${transactions.tags}::text ilike ${`%${search.trim()}%`}`,
          ilike(clients.name, `%${search.trim()}%`),
        )
      : undefined

    const typeFilter = type && ["incoming", "outgoing"].includes(type)
      ? eq(transactions.type, type)
      : undefined

    const categoryFilter = category?.trim()
      ? eq(transactions.category, category.trim())
      : undefined
    // Exact tag containment (normalized to the stored "#tag" form); GIN-indexed.
    const normalizedTag = tag?.trim() ? (tag.trim().startsWith("#") ? tag.trim() : `#${tag.trim()}`) : ""
    const tagFilter = normalizedTag
      ? sql`${transactions.tags} @> ${JSON.stringify([normalizedTag])}::jsonb`
      : undefined

    const whereClause = and(
      eq(clients.organizationId, orgId),
      isNull(clients.deletedAt),
      isNull(transactions.deletedAt),
      closedClientFilter,
      accountFilter,
      recurringFilter,
      listExcludesTransfers,
      searchFilter,
      typeFilter,
      categoryFilter,
      tagFilter,
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
        recurringFilter,
        // The income/expense summary never counts internal transfers (net zero)
        // nor system Opening Balance / Balance Adjustment rows (they define a
        // balance, not P&L — same as analytics, calendar and flow); refunds are
        // in scope and net against outgoing (api/_lib/tx-sql.ts).
        pnlKindFilter,
        eq(transactions.isSystem, false),
        searchFilter,
        categoryFilter,
        tagFilter,
        dateFromFilter,
        dateToFilter,
      )
      // The summary's rates, looked up once per (currency, day) it covers, when
      // the workspace holds a foreign currency (MC-167; tx-sql.ts `fxFor`).
      const fx = fxFor(reporting, summaryWhere, orgRates)

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
          ? groupedRows(whereClause, sort, reporting, orgRates, PAGE_SIZE, offset)
          : db
              .select(txFields)
              .from(transactions)
              .innerJoin(clients, eq(transactions.clientId, clients.id))
              .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
              .where(whereClause)
              .orderBy(...orderBy)
              .limit(PAGE_SIZE)
              .offset(offset),
        withFx(
          db
            .select({
              incoming: incomeSumSqlIn(fx),
              outgoing: expenseSumSqlIn(fx),
              excluded: missingRateCountSql(fx),
              nativeIncoming: nativeSummarySql.incoming,
              nativeOutgoing: nativeSummarySql.outgoing,
              nativeCurrency: nativeSummarySql.currency,
            })
            .from(transactions)
            .innerJoin(clients, eq(transactions.clientId, clients.id))
            .$dynamic(),
          fx,
        ).where(summaryWhere),
      ])

      return res.json({
        data: rows.map(serialize),
        total,
        currency: reporting,
        summary: {
          incoming: Number(summaryRow.incoming),
          outgoing: Number(summaryRow.outgoing),
          currency: reporting,
          excluded_count: Number(summaryRow.excluded ?? 0),
          // An account's (or a card's) page reads its figures in the ACCOUNT's
          // currency — every row on it posts in that one, so nothing is
          // converted or left out (MC-009). Additive: older builds ignore it.
          ...(wealthAccountId
            ? { native: { incoming: Number(summaryRow.nativeIncoming), outgoing: Number(summaryRow.nativeOutgoing), currency: summaryRow.nativeCurrency ?? null } }
            : {}),
        },
      })
    }

    // `?limit=N` (without `page`) returns just the top N rows — used by the
    // dashboard "latest transactions" card. Capped to keep payloads small.
    if (limit !== undefined) {
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))
      const rows = grouped
        ? await groupedRows(whereClause, sort, reporting, orgRates, limitNum)
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
      ? await groupedRows(whereClause, sort, reporting, orgRates)
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
    const { client_id, type, amount, description, category, tags, date, wealth_account_id: bodyAccountId, card_id, kind: rawKind } = req.body as {
      client_id: string; type: string; amount: number
      description?: string; category?: string; tags?: unknown; date?: string; wealth_account_id?: string; card_id?: string | null; kind?: string
    }
    // Which card paid, and therefore which account the money lands on — one
    // rule for every write path (api/_lib/cards.ts attributeCard).
    const attributed = await attributeCard(orgId, { cardId: card_id, wealthAccountId: bodyAccountId })
    if (!attributed.ok) return res.status(400).json({ error: attributed.error })
    const wealth_account_id = attributed.accountId ?? undefined
    // 'standard' (default) or 'refund' — money given back for an earlier expense,
    // which reporting nets against expense instead of counting as income.
    // Transfers are never created here (POST /api/wealth/transfer).
    const kind = rawKind ?? "standard"
    if (!(USER_KINDS as readonly string[]).includes(kind)) return res.status(400).json({ error: "kind must be standard or refund" })
    if (!refundShapeValid(type, kind)) return res.status(400).json({ error: "A refund must be incoming" })

    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: "amount is required" })
    if (amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    if (!["incoming", "outgoing"].includes(type)) return res.status(400).json({ error: "type must be incoming or outgoing" })
    if (!wealth_account_id) return res.status(400).json({ error: "wealth_account_id is required" })
    const [account] = await db
      .select()
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.id, wealth_account_id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
    if (!account) return res.status(400).json({ error: "Select an active bank or cash account" })
    // A Space is a savings bucket — money only ever TRANSFERS in/out of it. You
    // can never post a standard income/expense to a Space (the security boundary;
    // the UI also hides Spaces from the account picker).
    if (account.type === "space") return res.status(400).json({ error: "You can't record a transaction on a Space — move money in or out with a transfer instead." })
    // A debt's balance only moves through repayments (principal = transfer,
    // interest/fees = expenses on the paying account) — see /api/debts/:id/payments.
    if (account.type === "loan" || account.type === "receivable") return res.status(400).json({ error: "Record a payment from the debt's page instead — that keeps principal and interest apart." })
    // A row with no currency would read as "already in the reporting currency"
    // forever, and change meaning with the next reporting change. Same refusal
    // as PATCH.
    if (!account.currencyCode) return res.status(409).json({ error: "Account currency migration is incomplete", code: "currency_missing" })
    // To the account currency's decimals (none for ¥): the row's numeric(20,2)
    // would round 1.235 while the balance below adds it unrounded (MC-047).
    const badAmount = moneyRefusal(account.currencyCode, amount)
    if (badAmount) return res.status(400).json(badAmount)

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

    // Per-plan tag ceiling — dedup/normalize first, then gate the real count.
    const cleanedTags = cleanTransactionTags(tags)
    const tagQuota = await checkTransactionTagQuota(orgId, cleanedTags.length)
    if (!tagQuota.allowed) return res.status(402).json(tagQuota)

    const today = new Date().toISOString().split("T")[0]
    // The row and its balance in ONE statement (api/_lib/tx-legs.ts): two
    // statements left a row without its balance when the second failed
    // (MC-059). Relative delta — NEVER read-compute-write the balance in JS
    // (two concurrent posts to one account lost an update). Not idempotent
    // across requests: a client retry is a new POST (MC-060).
    const created = db.$with("created").as(
      db
        .insert(transactions)
        .values({
          clientId,
          wealthAccountId: wealth_account_id,
          cardId: attributed.cardId,
          kind,
          type,
          amount: String(amount),
          currencyCode: account.currencyCode,
          description: description ?? "",
          category: category ?? "",
          tags: cleanedTags,
          date: date ?? today,
          // isSystem is server-only: user-created transactions are never system rows.
          createdBy: userId,
          updatedBy: userId,
        })
        .returning(),
    )
    const [row] = await db.with(created, balanceShiftCte(ledgerMovesSql("created", "create"), userId)).select().from(created)
    await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
    // Budget-exceeded alert (fire-and-forget): never blocks or fails the write.
    if (type === "outgoing") void notifyIfBudgetExceeded(orgId, clientId, userId, { category: row.category, date: row.date }).catch(() => {})
    return res.status(201).json(serialize(row))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
