import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { requireAuth, isPersonalAccount } from "../_lib/auth.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "../_lib/fx-rates.js"
import { expenseSumSqlIn, fxFor, incomeSumSqlIn, missingRateCountSql, pnlKindFilter, withFx } from "../_lib/tx-sql.js"

const GRANULARITIES = ["day", "week", "month", "year"] as const
type Granularity = (typeof GRANULARITIES)[number]

const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
const fmt = (d: Date) => d.toISOString().slice(0, 10)

// Aggregated analytics for the active org. Always excludes soft-deleted rows and
// closed clients (their transactions never count). Income/expense/profit trends
// over a date range bucketed by the chosen granularity, plus top categories and
// (for business orgs) top clients.
//
// Every figure is in the workspace's REPORTING currency: each row is converted
// at its own date (api/_lib/tx-sql.ts reporting_amount). A row whose currency
// has no stored rate for that day is left out of the sum and counted in
// `excluded_count` — on the summary, and per bucket/category/client — so a
// partial total never looks complete.
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

  // Rates first (best effort, cheap when already covered), then the sums.
  const reporting = await reportingCurrencyFor(orgId)
  const orgRates = await ensureRatesForOrg(orgId, reporting).catch(() => undefined)

  const where = and(
    eq(clients.organizationId, orgId),
    isNull(clients.deletedAt),
    isNull(clients.closedAt),
    isNull(transactions.deletedAt),
    // Internal account-to-account transfers (incl. credit-card payments) aren't
    // income/expense — exclude them. Refunds stay in: they net against expense.
    pnlKindFilter,
    // Balance-DEFINING system entries ("Opening Balance", "Balance Adjustment")
    // are not income or expense — they assert what an account balance IS at a
    // point in time (src/lib/wealth-ledger.ts reversesOnTrash). Counting an
    // opening balance as income overstated revenue. Budgets exclude them too
    // (api/_lib/budget-spend.ts), so the two now agree.
    eq(transactions.isSystem, false),
    gte(transactions.date, fromDate),
    lte(transactions.date, toDate),
  )

  // Shared reporting rules (api/_lib/tx-sql.ts): refunds reduce expense, never
  // income — and every row converted into the reporting currency at its date,
  // through rates looked up once per (currency, day) of the range when the
  // workspace holds a foreign currency (MC-167; tx-sql.ts `fxFor`).
  const fx = fxFor(reporting, where, orgRates)
  const incomeSum = incomeSumSqlIn(fx)
  const expenseSum = expenseSumSqlIn(fx)
  const excluded = missingRateCountSql(fx)
  const categoryKey = sql<string | null>`nullif(${transactions.category}, '')` // '' and NULL are both "no category"

  const [summaryRows, seriesRows, categoryRows, clientRows] = await Promise.all([
    withFx(
      db
        .select({ income: incomeSum, expense: expenseSum, txCount: sql<number>`count(*)::int`, excluded })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .$dynamic(),
      fx,
    ).where(where),
    withFx(
      db
        .select({
          period: sql<string>`to_char(date_trunc(${gran}, ${transactions.date}::timestamp), 'YYYY-MM-DD')`,
          income: incomeSum,
          expense: expenseSum,
          excluded,
        })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .$dynamic(),
      fx,
    )
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    withFx(
      db
        .select({
          // Grouped by `categoryKey`, so a real "Uncategorized" stays its own row.
          // `category` keeps the legacy English name ONLY for store-pinned builds,
          // which render it raw; current clients name the no-category bucket from
          // `uncategorized`, in the reader's language.
          category: sql<string>`coalesce(${categoryKey}, 'Uncategorized')`,
          uncategorized: sql<boolean>`${categoryKey} is null`,
          income: incomeSum,
          expense: expenseSum,
          excluded,
        })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .$dynamic(),
      fx,
    )
      .where(where)
      .groupBy(categoryKey)
      .orderBy(sql`(${incomeSum} + ${expenseSum}) desc`)
      .limit(8),
    isPersonalAccount(ctx)
      ? Promise.resolve([] as { id: string; name: string; income: string; expense: string; excluded: number }[])
      : withFx(
          db
            .select({ id: clients.id, name: clients.name, income: incomeSum, expense: expenseSum, excluded })
            .from(transactions)
            .innerJoin(clients, eq(transactions.clientId, clients.id))
            .$dynamic(),
          fx,
        )
          .where(where)
          .groupBy(clients.id, clients.name)
          .orderBy(sql`(${incomeSum} + ${expenseSum}) desc`)
          .limit(8),
  ])

  const s = summaryRows[0] ?? { income: "0", expense: "0", txCount: 0, excluded: 0 }
  const income = Number(s.income)
  const expense = Number(s.expense)

  return res.json({
    range: { from: fromDate, to: toDate, granularity: gran },
    currency: reporting,
    excluded_count: Number(s.excluded ?? 0),
    summary: {
      income,
      expense,
      profit: income - expense,
      tx_count: Number(s.txCount),
      excluded_count: Number(s.excluded ?? 0),
    },
    series: seriesRows.map((r) => ({
      period: r.period,
      income: Number(r.income),
      expense: Number(r.expense),
      profit: Number(r.income) - Number(r.expense),
      excluded_count: Number(r.excluded ?? 0),
    })),
    by_category: categoryRows.map((r) => ({
      category: r.category,
      uncategorized: r.uncategorized,
      income: Number(r.income),
      expense: Number(r.expense),
      excluded_count: Number(r.excluded ?? 0),
    })),
    by_client: clientRows.map((r) => ({
      id: r.id,
      name: r.name,
      income: Number(r.income),
      expense: Number(r.expense),
      profit: Number(r.income) - Number(r.expense),
      excluded_count: Number(r.excluded ?? 0),
    })),
  })
}
