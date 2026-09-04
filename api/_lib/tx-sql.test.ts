import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { db } from "../../src/lib/db/index.js"
import { transactions } from "../../src/lib/db/schema.js"
import { expenseSumSql, incomeSumSql, pnlKindFilter } from "./tx-sql.js"

// DB-FREE: drizzle renders the aggregate expressions to SQL without executing
// them, so the reporting rules (the SQL twins of src/lib/tx-classify.ts) are
// pinned without opening a connection.

function render() {
  return db
    .select({ income: incomeSumSql, expense: expenseSumSql })
    .from(transactions)
    .where(and(pnlKindFilter, eq(transactions.isSystem, false)))
    .toSQL()
}

describe("tx-sql — reporting aggregates", () => {
  const { sql, params } = render()

  it("income counts only standard incoming rows", () => {
    expect(sql).toMatch(/"type" = 'incoming' and ("transactions"\.)?"kind" = 'standard'/)
  })

  it("expense counts standard outgoing rows and SUBTRACTS refunds (a refund is never income)", () => {
    expect(sql).toMatch(/"type" = 'outgoing' and ("transactions"\.)?"kind" = 'standard' then/)
    expect(sql).toMatch(/"kind" = 'refund' then -("transactions"\.)?"amount"::numeric/)
  })

  it("the P&L filter keeps standard + refund and drops transfers (card payments count nowhere)", () => {
    expect(sql).toMatch(/"kind" in \(\$1, \$2\)/)
    expect(params).toEqual(["standard", "refund", false])
  })
})

describe("every P&L aggregate route uses the shared expressions", () => {
  // Cross-file convention check (same spirit as budget-spend.test.ts): if a
  // route re-inlines `case when type = 'incoming'`, refunds silently become
  // income there again.
  const routes = [
    "api/_routes/analytics.ts",
    "api/_routes/calendar.ts",
    "api/_routes/flow.ts",
    "api/_routes/transactions.ts",
    "api/_routes/clients.ts",
  ]
  for (const route of routes) {
    it(`${route} imports from tx-sql and does not inline a type-only sum`, () => {
      const src = readFileSync(route, "utf8")
      expect(src).toMatch(/from "\.\.\/_lib\/tx-sql\.js"/)
      expect(src).not.toMatch(/case when \$\{transactions\.type\} = 'incoming' then/)
      expect(src).not.toMatch(/filter \(where \$\{transactions\.type\} = 'incoming'\)/)
    })
  }
})
