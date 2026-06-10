import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, organizations, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { isPersonalAccount, requireAuth } from "../_lib/auth.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"

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
  const countExpr = sql<number>`count(*)::int`

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

  // Bucket the recent-leaf pool by the active group key.
  const leafKeyOf = (l: (typeof leafPool)[number]): string | null =>
    groupBy === "account"
      ? l.accountId
      : groupBy === "client"
        ? l.clientId
        : (l.category?.trim() || "Uncategorized")
  const leavesByKey = new Map<string, typeof leafPool>()
  for (const l of leafPool) {
    const k = leafKeyOf(l) ?? "__none__"
    const arr = leavesByKey.get(k) ?? []
    if (arr.length < LEAVES_PER_GROUP) arr.push(l)
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
      recurring: !!l.recurringRuleId,
    }))
    const acc = groupBy === "account" && g.key ? accById.get(g.key) : undefined
    return {
      key: g.key ?? null,
      kind: groupBy,
      label: labelForGroup(g.key),
      icon: acc?.icon ?? null,
      account_type: acc?.type ?? null,
      income,
      expense,
      net: income - expense,
      tx_count: count,
      opening_balance: acc ? Number(acc.opening) : null,
      current_balance: acc ? Number(acc.current) : null,
      leaves,
      more_count: Math.max(0, count - leaves.length),
    }
  })

  const s = summaryRows[0] ?? { income: "0", expense: "0", txCount: 0 }
  const income = Number(s.income)
  const expense = Number(s.expense)
  const balance = accountMeta.reduce((sum, a) => sum + Number(a.current), 0)

  return res.json({
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
