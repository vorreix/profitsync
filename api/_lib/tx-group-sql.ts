import { sql } from "drizzle-orm"
import { transactions } from "../../src/lib/db/schema.js"
import { reportingAmountSql } from "./tx-sql.js"

// The money of a collapsed split group (the legs sharing a `group_id`), as
// aggregate expressions over those legs. ONE definition for the list
// (GET /api/transactions) and the detail (GET /api/transactions/:id), so a
// deep-linked split shows exactly the figure its list row does.
//
//   one currency  → the native sum, labelled with that currency;
//   several       → each leg converted at its own date into the reporting
//                   currency and summed, labelled with it — and NULL as soon
//                   as one leg has no rate: SQL `sum` skips NULLs, so a plain
//                   sum would present the converted legs as the whole split.
//
// `reporting_amount` is the whole group converted (same NULL rule) — what an
// amount sort orders by, so ₹5,000 never outranks €100 in a USD workspace.
export function groupMoneySql(reporting: string) {
  const rep = reportingAmountSql(reporting)
  // How many currencies the legs were posted in (NULL = legacy, one bucket).
  const currencyCount = sql<number>`count(distinct coalesce(${transactions.currencyCode}, ''))`
  const reportingAmount = sql<string | null>`case when bool_or(${rep} is null) then null else sum(${rep}) end`
  return {
    amount: sql<string | null>`case when ${currencyCount} <= 1 then sum(${transactions.amount}::numeric) else ${reportingAmount} end`,
    currencyCode: sql<string | null>`case when ${currencyCount} <= 1 then max(${transactions.currencyCode}) else ${reporting} end`,
    currencyCount: sql<number>`${currencyCount}::int`,
    reportingAmount,
  }
}
