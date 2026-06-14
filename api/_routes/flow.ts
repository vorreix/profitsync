import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, organizations, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { logoDataUrl } from "../../src/lib/logo-data.js"

// SQL for "the account's display name" — reused to label leaves with the
// account the money moved through (to/from).
const accountLabelSql = sql<string | null>`coalesce(nullif(${wealthAccounts.nickname}, ''), nullif(${wealthAccounts.bankName}, ''))`

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
const fmt = (d: Date) => d.toISOString().slice(0, 10)

type GroupBy = "account" | "client" | "category"
const GROUP_BYS: GroupBy[] = ["account", "client", "category"]

// How many transaction leaves to attach per group node. The group node always
// shows EXACT totals + count from the aggregate query; leaves are an
// illustrative sample (most-recent), and `more_count` + a deep link cover the
// rest — so the canvas never renders thousands of nodes.
const LEAVES_PER_GROUP = 8
// Ceiling on the recent-transactions pool we bucket leaves from. Aggregates are
// never capped by this; only the sampled leaves are.
const LEAF_POOL = 600

function csv(v: string | string[] | undefined): string[] {
  if (!v) return []
  const raw = Array.isArray(v) ? v.join(",") : v
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

/**
 * GET /api/flow — the money-flow graph for the active org.
 *
 * Filters: ?from&to (ISO), ?groupBy=account|client|category, and multi-value
 * ?category=, ?clientId=, ?accountId= (comma-separated). Returns workspace
 * totals (root), one aggregate node per group (exact income/expense/net/count,
 * plus start/end balance for accounts), and a capped sample of recent
 * transactions per group. Org-scoped; excludes soft-deleted rows, closed
 * clients and internal transfers — same rules as analytics.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  // Recurring occurrences due in range must exist before we aggregate.
  await materializeDueRecurring(orgId)

  const q = req.query as Record<string, string | string[] | undefined>
  const personal = isPersonalAccount(ctx)
  const groupBy: GroupBy = GROUP_BYS.includes(q.groupBy as GroupBy)
    ? (q.groupBy as GroupBy)
    : personal
      ? "category"
      : "client"

  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1)
  const fromDate = isDate(q.from as string) ? (q.from as string) : fmt(defaultFrom)
  const toDate = isDate(q.to as string) ? (q.to as string) : fmt(today)

  const categories = csv(q.category)
  const clientIds = csv(q.clientId)
  const accountIds = csv(q.accountId)

  const conds: SQL[] = [
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    isNull(clients.closedAt),
    isNull(transactions.deletedAt),
    ne(transactions.kind, "transfer"),
    gte(transactions.date, fromDate),
    lte(transactions.date, toDate),
  ]
  if (categories.length) {
    conds.push(sql`coalesce(nullif(${transactions.category}, ''), 'Uncategorized') in (${sql.join(categories.map((c) => sql`${c}`), sql`, `)})`)
  }
  if (clientIds.length) conds.push(inArray(transactions.clientId, clientIds))
  if (accountIds.length) conds.push(inArray(transactions.wealthAccountId, accountIds))
  const where = and(...conds)

  const incomeSum = sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`
  const expenseSum = sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`
  // Count LOGICAL transactions: a split (shared group_id) counts once, matching
  // how the canvas collapses its legs into a single node.
  const countExpr = sql<number>`count(distinct coalesce(${transactions.groupId}::text, ${transactions.id}::text))::int`

  // ── Paginated leaves for ONE group/period (the canvas "load more" action) ───
  // Returns the next page of transaction leaves for a single group key (account/
  // client/category) or timeline period, honoring the same filters. Bounded by
  // offset/limit so the graph grows on demand instead of shipping everything.
  if (q.leaves) {
    const limit = Math.min(40, Math.max(1, Number.parseInt(String(q.limit ?? "12"), 10) || 12))
    // Clamp the offset: it's deep-pagination of ONE group, so a sane ceiling
    // (50k ≈ 4000 pages) is plenty and stops a crafted ?offset=1e9 from making
    // Postgres skip-scan millions of rows. Offset pagination is safe to use here
    // because any mutation triggers a silent flow refresh that resets paging.
    const offset = Math.min(50000, Math.max(0, Number.parseInt(String(q.offset ?? "0"), 10) || 0))
    const key = typeof q.key === "string" ? q.key : ""
    let extra: SQL
    if (q.mode === "timeline") {
      const BUCKETS = ["day", "week", "month", "year"] as const
      const bucket = (BUCKETS as readonly string[]).includes(q.bucket as string) ? (q.bucket as string) : "month"
      // bucket is whitelisted → safe to inline as a literal (a bound param makes
      // Postgres treat the two date_trunc copies as distinct; see timeline mode).
      extra = sql`to_char(date_trunc(${sql.raw(`'${bucket}'`)}, ${transactions.date}::timestamp), 'YYYY-MM-DD') = ${key}`
    } else if (groupBy === "account") {
      extra = key && key !== "__none__" ? eq(transactions.wealthAccountId, key) : isNull(transactions.wealthAccountId)
    } else if (groupBy === "client") {
      extra = eq(transactions.clientId, key)
    } else {
      extra = sql`coalesce(nullif(${transactions.category}, ''), 'Uncategorized') = ${key}`
    }
    // Fetch limit+1 so we know whether another page exists without a count query.
    const rows = await db
      .select({
        id: transactions.id,
        type: transactions.type,
        amount: transactions.amount,
        description: transactions.description,
        category: transactions.category,
        date: sql<string>`${transactions.date}::text`,
        clientName: clients.name,
        accountName: accountLabelSql,
        groupId: transactions.groupId,
        recurringRuleId: transactions.recurringRuleId,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
      .where(and(where, extra))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(limit + 1)
      .offset(offset)
    const hasMore = rows.length > limit
    const leaves = rows.slice(0, limit).map((l) => ({
      id: l.id,
      type: l.type,
      amount: Number(l.amount),
      description: l.description,
      category: l.category,
      date: l.date,
      client_name: l.clientName,
      account_name: l.accountName,
      group_id: l.groupId,
      recurring: !!l.recurringRuleId,
    }))
    return res.json({ leaves, has_more: hasMore })
  }

  // ── TIMELINE mode: a chronological chain of period buckets, each carrying a
  // running cumulative net (before → net → after), ending at the entity. ─────
  const mode = q.mode === "timeline" ? "timeline" : "grouped"
  if (mode === "timeline") {
    const BUCKETS = ["day", "week", "month", "year"] as const
    const bucket = (BUCKETS as readonly string[]).includes(q.bucket as string) ? (q.bucket as string) : "month"
    // Inline the bucket as a LITERAL (safe — whitelisted above): a bound param
    // here makes Postgres treat the SELECT and GROUP BY copies of this
    // expression as different, triggering "column date must appear in GROUP BY".
    const periodExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucket}'`)}, ${transactions.date}::timestamp), 'YYYY-MM-DD')`

    const [periodRows, accountMetaT, ownerOrgT, leafPoolT] = await Promise.all([
      db
        .select({ key: periodExpr, income: incomeSum, expense: expenseSum, txCount: countExpr })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(where)
        .groupBy(periodExpr)
        .orderBy(sql`1 asc`),
      db
        .select({ current: wealthAccounts.currentBalance })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt))),
      db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)),
      db
        .select({
          id: transactions.id,
          type: transactions.type,
          amount: transactions.amount,
          description: transactions.description,
          category: transactions.category,
          date: sql<string>`${transactions.date}::text`,
          periodKey: periodExpr,
          clientName: clients.name,
          accountName: accountLabelSql,
          groupId: transactions.groupId,
          recurringRuleId: transactions.recurringRuleId,
        })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
        .where(where)
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .limit(LEAF_POOL),
    ])

    // Cap at LEAVES_PER_GROUP *logical* txs per period; keep all legs of a split.
    const leavesByPeriod = new Map<string, typeof leafPoolT>()
    const logicalByPeriod = new Map<string, Set<string>>()
    for (const l of leafPoolT) {
      const logical = l.groupId ?? l.id
      const seen = logicalByPeriod.get(l.periodKey) ?? new Set<string>()
      if (!seen.has(logical) && seen.size >= LEAVES_PER_GROUP) continue
      seen.add(logical)
      logicalByPeriod.set(l.periodKey, seen)
      const arr = leavesByPeriod.get(l.periodKey) ?? []
      arr.push(l)
      leavesByPeriod.set(l.periodKey, arr)
    }

    let running = 0
    let totalIn = 0
    let totalOut = 0
    const periods = periodRows.map((p) => {
      const income = Number(p.income)
      const expense = Number(p.expense)
      const net = income - expense
      const before = running
      running += net
      totalIn += income
      totalOut += expense
      const leaves = (leavesByPeriod.get(p.key) ?? []).map((l) => ({
        id: l.id,
        type: l.type,
        amount: Number(l.amount),
        description: l.description,
        category: l.category,
        date: l.date,
        client_name: l.clientName,
        account_name: l.accountName,
        group_id: l.groupId,
        recurring: !!l.recurringRuleId,
      }))
      return {
        key: p.key,
        label: p.key,
        bucket,
        income,
        expense,
        net,
        before,
        after: running,
        tx_count: Number(p.txCount),
        leaves,
        more_count: Math.max(0, Number(p.txCount) - (logicalByPeriod.get(p.key)?.size ?? 0)),
      }
    })

    return res.json({
      mode: "timeline",
      bucket,
      personal,
      range: { from: fromDate, to: toDate },
      periods,
      final: {
        label: ownerOrgT[0]?.name ?? "Workspace",
        total_in: totalIn,
        total_out: totalOut,
        total_net: totalIn - totalOut,
        balance: accountMetaT.reduce((s, a) => s + Number(a.current), 0),
      },
      filters: { category: categories, client_id: clientIds, account_id: accountIds },
    })
  }

  // ── Summary (root) + grouped aggregates + a recent-leaf pool, in parallel ──
  const groupKeyExpr =
    groupBy === "account"
      ? sql<string | null>`${transactions.wealthAccountId}::text`
      : groupBy === "client"
        ? sql<string | null>`${transactions.clientId}::text`
        : sql<string | null>`coalesce(nullif(${transactions.category}, ''), 'Uncategorized')`

  const [summaryRows, groupRows, accountMeta, ownerOrg, leafPool] = await Promise.all([
    db
      .select({ income: incomeSum, expense: expenseSum, txCount: countExpr })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(where),
    db
      .select({ key: groupKeyExpr, income: incomeSum, expense: expenseSum, txCount: countExpr })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .groupBy(groupKeyExpr)
      .orderBy(sql`(${incomeSum} + ${expenseSum}) desc`),
    // Account labels + balances for the accounts dimension (and the root balance).
    db
      .select({
        id: wealthAccounts.id,
        label: sql<string>`coalesce(nullif(${wealthAccounts.nickname}, ''), ${wealthAccounts.bankName})`,
        type: wealthAccounts.type,
        icon: wealthAccounts.icon,
        opening: wealthAccounts.openingBalance,
        current: wealthAccounts.currentBalance,
        logoUrl: wealthAccounts.logoUrl,
        logoData: wealthAccounts.logoData,
      })
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt))),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)),
    db
      .select({
        id: transactions.id,
        type: transactions.type,
        amount: transactions.amount,
        description: transactions.description,
        category: transactions.category,
        date: sql<string>`${transactions.date}::text`,
        clientId: transactions.clientId,
        clientName: clients.name,
        accountId: transactions.wealthAccountId,
        groupId: transactions.groupId,
        recurringRuleId: transactions.recurringRuleId,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(LEAF_POOL),
  ])

  const accById = new Map(accountMeta.map((a) => [a.id, a]))
  const clientNameByLeaf = new Map(leafPool.map((l) => [l.clientId, l.clientName]))

  // Bucket the recent-leaf pool by the active group key. We cap at
  // LEAVES_PER_GROUP *logical* transactions (a split counts once) and always
  // keep ALL legs of an included split, so the client can collapse them cleanly.
  const leafKeyOf = (l: (typeof leafPool)[number]): string | null =>
    groupBy === "account"
      ? l.accountId
      : groupBy === "client"
        ? l.clientId
        : (l.category?.trim() || "Uncategorized")
  const leavesByKey = new Map<string, typeof leafPool>()
  const logicalByKey = new Map<string, Set<string>>()
  for (const l of leafPool) {
    const k = leafKeyOf(l) ?? "__none__"
    const logical = l.groupId ?? l.id
    const seen = logicalByKey.get(k) ?? new Set<string>()
    if (!seen.has(logical) && seen.size >= LEAVES_PER_GROUP) continue
    seen.add(logical)
    logicalByKey.set(k, seen)
    const arr = leavesByKey.get(k) ?? []
    arr.push(l)
    leavesByKey.set(k, arr)
  }

  const labelForGroup = (key: string | null): string => {
    if (groupBy === "account") return key ? (accById.get(key)?.label ?? "Account") : "Unassigned"
    if (groupBy === "client") return key ? (clientNameByLeaf.get(key) ?? "Client") : "—"
    return key ?? "Uncategorized"
  }

  const groups = groupRows.map((g) => {
    const income = Number(g.income)
    const expense = Number(g.expense)
    const count = Number(g.txCount)
    const bucketKey = g.key ?? "__none__"
    const leaves = (leavesByKey.get(bucketKey) ?? []).map((l) => ({
      id: l.id,
      type: l.type,
      amount: Number(l.amount),
      description: l.description,
      category: l.category,
      date: l.date,
      client_name: l.clientName,
      account_name: l.accountId ? (accById.get(l.accountId)?.label ?? null) : null,
      group_id: l.groupId,
      recurring: !!l.recurringRuleId,
    }))
    const acc = groupBy === "account" && g.key ? accById.get(g.key) : undefined
    return {
      key: g.key ?? null,
      kind: groupBy,
      label: labelForGroup(g.key),
      icon: acc?.icon ?? null,
      logo_src: acc ? logoDataUrl(acc.logoData) || acc.logoUrl || null : null,
      account_type: acc?.type ?? null,
      income,
      expense,
      net: income - expense,
      tx_count: count,
      opening_balance: acc ? Number(acc.opening) : null,
      current_balance: acc ? Number(acc.current) : null,
      leaves,
      // count is logical txs; subtract the logical txs already sampled (a split
      // is one), not the raw leg count.
      more_count: Math.max(0, count - (logicalByKey.get(bucketKey)?.size ?? 0)),
    }
  })

  const s = summaryRows[0] ?? { income: "0", expense: "0", txCount: 0 }
  const income = Number(s.income)
  const expense = Number(s.expense)
  const balance = accountMeta.reduce((sum, a) => sum + Number(a.current), 0)

  return res.json({
    mode: "grouped",
    group_by: groupBy,
    personal,
    range: { from: fromDate, to: toDate },
    root: {
      label: ownerOrg[0]?.name ?? "Workspace",
      income,
      expense,
      net: income - expense,
      tx_count: Number(s.txCount),
      balance,
    },
    groups,
    filters: { category: categories, client_id: clientIds, account_id: accountIds },
  })
}
