import { inArray, sql } from "drizzle-orm"
import { transactions } from "../../src/lib/db/schema.js"

// The SQL twins of src/lib/tx-classify.ts — the ONE definition of how a
// transaction row counts as income or expense in every aggregate (analytics,
// money flow, calendar, the transactions summary, client totals). Keep the two
// files in lockstep; tx-sql.test.ts renders these to SQL and asserts the rules.
//
//   income  = Σ amount  where type='incoming' and kind='standard'
//   expense = Σ amount  where type='outgoing' and kind='standard'
//           − Σ amount  where kind='refund'          (a refund reverses spending)
//
// Transfers (kind='transfer') — including credit-card payments — contribute to
// neither, so a card purchase is counted exactly once, when it happens, and the
// payment that later settles it is never a second expense. System
// balance-defining rows are excluded by the caller's `is_system = false`
// predicate (kept as a separate, greppable condition — see budget-spend.test.ts).

/** Reported income: standard incoming rows only (refunds and transfers are not income). */
export const incomeSumSql = sql<string>`coalesce(sum(case when ${transactions.type} = 'incoming' and ${transactions.kind} = 'standard' then ${transactions.amount}::numeric else 0 end), 0)`

/** Reported expense: standard outgoing rows, net of refunds. Can go negative in a window that only saw refunds. */
export const expenseSumSql = sql<string>`coalesce(sum(case when ${transactions.type} = 'outgoing' and ${transactions.kind} = 'standard' then ${transactions.amount}::numeric when ${transactions.kind} = 'refund' then -${transactions.amount}::numeric else 0 end), 0)`

/** Rows that take part in P&L at all (drop transfers). Pair with `eq(transactions.isSystem, false)`. */
export const pnlKindFilter = inArray(transactions.kind, ["standard", "refund"])

/** The kinds a client may submit when creating/editing a transaction (transfers only come from the transfer endpoint). */
export const USER_KINDS = ["standard", "refund"] as const
