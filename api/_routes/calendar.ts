import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, gte, isNull, lte, ne, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"
import { materializeDueRecurring } from "../_lib/recurring-materialize.js"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 400 // a year view + slack; keeps the scan bounded

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — per-day money activity for
 * the calendar view: incoming/outgoing sums + transaction count per day, plus
 * range totals. Mirrors the global transactions list's scope (org-scoped via
 * the client join, excludes soft-deleted rows and transfer legs).
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

  const rows = await db
    .select({
      date: sql<string>`${transactions.date}::text`,
      incoming: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.type} = 'incoming'), 0)`,
      outgoing: sql<string>`coalesce(sum(${transactions.amount}::numeric) filter (where ${transactions.type} = 'outgoing'), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .where(
      and(
        eq(clients.organizationId, ctx.orgId),
        isNull(transactions.deletedAt),
        ne(transactions.kind, "transfer"),
        gte(transactions.date, from),
        lte(transactions.date, to),
      ),
    )
    .groupBy(transactions.date)
    .orderBy(transactions.date)

  let incoming = 0
  let outgoing = 0
  let count = 0
  const days = rows.map((r) => {
    const inc = Number(r.incoming)
    const out = Number(r.outgoing)
    incoming += inc
    outgoing += out
    count += r.count
    return { date: r.date, incoming: inc, outgoing: out, count: r.count }
  })

  return res.json({ days, summary: { incoming, outgoing, count } })
}
