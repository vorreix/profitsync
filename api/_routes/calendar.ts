import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"
import { ensureRatesForOrg, reportingCurrencyFor } from "../_lib/fx-rates.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"
import { expenseSumSqlIn, incomeSumSqlIn, missingRateCountSql, pnlKindFilter } from "../_lib/tx-sql.js"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 400 // a year view + slack; keeps the scan bounded

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — per-day money activity for
 * the calendar view: incoming/outgoing sums + transaction count per day, plus
 * range totals. Mirrors the global transactions list's scope (org-scoped via
 * the client join, excludes soft-deleted rows, trashed/closed clients, and
 * transfer legs — same filters as flow.ts/analytics.ts).
 *
 * Figures are in the workspace's reporting currency (`currency`), each row
 * converted at its own date; rows with no rate for their day are left out and
 * counted in `excluded_count` per day and on the summary.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { from, to } = req.query as { from?: string; to?: string }
  if (!from || !ISO_DATE.test(from) || !to || !ISO_DATE.test(to)) {
    return res.status(400).json({ error: "from and to must be YYYY-MM-DD" })
  }
  if (to < from) return res.status(400).json({ error: "to must be on or after from" })
  const rangeDays = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (rangeDays > MAX_RANGE_DAYS) return res.status(400).json({ error: "Range is too large" })

  // Recurring occurrences due in this window must exist before we aggregate.
  await materializeDueRecurring(ctx.orgId)
  const reporting = await reportingCurrencyFor(ctx.orgId)
  await ensureRatesForOrg(ctx.orgId, reporting).catch(() => undefined)

  const rows = await db
    .select({
      date: sql<string>`${transactions.date}::text`,
      // Shared reporting rules (api/_lib/tx-sql.ts): refunds reduce outgoing, never count as incoming.
      incoming: incomeSumSqlIn(reporting),
      outgoing: expenseSumSqlIn(reporting),
      count: sql<number>`count(*)::int`,
      excluded: missingRateCountSql(reporting),
    })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .where(
      and(
        eq(clients.organizationId, ctx.orgId),
        isNull(clients.deletedAt),
        isNull(clients.closedAt),
        isNull(transactions.deletedAt),
        pnlKindFilter,
        // See api/_routes/analytics.ts — system balance-defining rows are not
        // income/expense, and budgets exclude them too.
        eq(transactions.isSystem, false),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .groupBy(transactions.date)
    .orderBy(transactions.date)

  let incoming = 0
  let outgoing = 0
  let count = 0
  let excludedTotal = 0
  const days = rows.map((r) => {
    const inc = Number(r.incoming)
    const out = Number(r.outgoing)
    const excluded = Number(r.excluded ?? 0)
    incoming += inc
    outgoing += out
    count += r.count
    excludedTotal += excluded
    return { date: r.date, incoming: inc, outgoing: out, count: r.count, excluded_count: excluded }
  })

  return res.json({ days, summary: { incoming, outgoing, count, excluded_count: excludedTotal }, currency: reporting, excluded_count: excludedTotal })
}
