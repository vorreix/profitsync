import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { requireAuth, isPersonalAccount } from "../_lib/auth.js"

const GRANULARITIES = ["day", "week", "month", "year"] as const
type Granularity = (typeof GRANULARITIES)[number]

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
const fmt = (d: Date) => d.toISOString().slice(0, 10)

// Aggregated analytics for the active org. Always excludes soft-deleted rows and
// closed clients (their transactions never count). Income/expense/profit trends
// over a date range bucketed by the chosen granularity, plus top categories and
// (for business orgs) top clients.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { from, to, granularity } = req.query as { from?: string; to?: string; granularity?: string }
  const gran: Granularity = GRANULARITIES.includes(granularity as Granularity) ? (granularity as Granularity) : "month"

  // Default range: last 12 months ending today.
  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1)
  const fromDate = isDate(from) ? from : fmt(defaultFrom)
  const toDate = isDate(to) ? to : fmt(today)

  const where = and(
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    isNull(clients.closedAt),
    isNull(transactions.deletedAt),
    gte(transactions.date, fromDate),
    lte(transactions.date, toDate),
  )

  const incomeSum = sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' then ${transactions.amount}::numeric else 0 end), 0)`
  const expenseSum = sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' then ${transactions.amount}::numeric else 0 end), 0)`

  const [summaryRows, seriesRows, categoryRows, clientRows] = await Promise.all([
    db
      .select({ income: incomeSum, expense: expenseSum, txCount: sql<number>`count(*)::int` })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(where),
    db
      .select({
        period: sql<string>`to_char(date_trunc(${gran}, ${transactions.date}::timestamp), 'YYYY-MM-DD')`,
        income: incomeSum,
        expense: expenseSum,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        category: sql<string>`coalesce(nullif(${transactions.category}, ''), 'Uncategorized')`,
        income: incomeSum,
        expense: expenseSum,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`(${incomeSum} + ${expenseSum}) desc`)
      .limit(8),
    isPersonalAccount(ctx)
      ? Promise.resolve([] as { id: string; name: string; income: string; expense: string }[])
      : db
          .select({ id: clients.id, name: clients.name, income: incomeSum, expense: expenseSum })
          .from(transactions)
          .innerJoin(clients, eq(transactions.clientId, clients.id))
          .where(where)
          .groupBy(clients.id, clients.name)
          .orderBy(sql`(${incomeSum} + ${expenseSum}) desc`)
          .limit(8),
  ])

  const s = summaryRows[0] ?? { income: "0", expense: "0", txCount: 0 }
  const income = Number(s.income)
  const expense = Number(s.expense)

  return res.json({
    range: { from: fromDate, to: toDate, granularity: gran },
    summary: {
      income,
      expense,
      profit: income - expense,
      tx_count: Number(s.txCount),
    },
    series: seriesRows.map((r) => ({
      period: r.period,
      income: Number(r.income),
      expense: Number(r.expense),
      profit: Number(r.income) - Number(r.expense),
    })),
    by_category: categoryRows.map((r) => ({
      category: r.category,
      income: Number(r.income),
      expense: Number(r.expense),
    })),
    by_client: clientRows.map((r) => ({
      id: r.id,
      name: r.name,
      income: Number(r.income),
      expense: Number(r.expense),
      profit: Number(r.income) - Number(r.expense),
    })),
  })
}
