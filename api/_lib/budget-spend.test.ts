import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { budgetSpendMissingRate, budgetSpendPredicates, budgetSpendSignedAmount, budgetSpendSignedAmountIn } from "./budget-spend.js"

// Phase 0 regression suite for the live Budget v1 correctness repairs.
//
// These assertions are DB-FREE by design (the committed gate must never open a
// connection): drizzle can render a query to SQL without executing it, so the
// *predicates* are verifiable without a database.

/** Render the SQL a budget-spend query would issue, without running it. */
function renderSpendSql(): string {
  return db
    .select({ clientId: transactions.clientId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(...budgetSpendPredicates("11111111-1111-1111-1111-111111111111")))
    .toSQL().sql
}

describe("budget spend predicates (defect #1 — is_system must not consume budgets)", () => {
  const sql = renderSpendSql()

  it("excludes system balance-defining rows", () => {
    // "Opening Balance" / "Balance Adjustment" rows assert what a balance IS;
    // they are not spending. Zeroing a wallet used to consume the budget.
    expect(sql).toMatch(/"is_system"/)
  })

  it("still excludes transfers, trashed rows and income", () => {
    expect(sql).toMatch(/"kind" in \(/) // kind in ('standard','refund') — transfers (card payments) never match
    expect(sql).toMatch(/"deleted_at" is null/)
    expect(sql).toMatch(/"type" = \$\d+ or "transactions"\."kind" = \$\d+/) // outgoing, or a refund
  })

  it("a refund is in scope and SUBTRACTS (credit-card returns reverse spend, never count as income)", () => {
    const signed = db
      .select({ amount: budgetSpendSignedAmount })
      .from(transactions)
      .toSQL().sql
    expect(signed).toMatch(/case when ("transactions"\.)?"kind" = 'refund' then -("transactions"\.)?"amount"::numeric else ("transactions"\.)?"amount"::numeric end/)
  })

  it("is org-scoped through the clients join", () => {
    // All budget queries scope by organization_id via clients, never by user.
    expect(sql).toMatch(/"clients"\."organization_id"/)
  })

  it("exposes exactly the seven shared predicates", () => {
    // A guard against someone adding a condition here but not to both queries.
    expect(budgetSpendPredicates("x")).toHaveLength(7)
  })

  it("leaves a closed client out, exactly as analytics does", () => {
    expect(sql).toMatch(/"clients"\."closed_at" is null/)
  })
})

describe("budget spend in the BUDGET's currency (every row converted at its own date)", () => {
  const { sql, params } = db
    .select({ signed: budgetSpendSignedAmountIn("EUR"), missing: budgetSpendMissingRate("EUR") })
    .from(transactions)
    .toSQL()

  it("converts through reporting_amount(amount, currency_code, date, <target>) — never the raw amount", () => {
    expect(sql).toMatch(/reporting_amount\(("transactions"\.)?"amount"::numeric, ("transactions"\.)?"currency_code", ("transactions"\.)?"date", \$\d+\)/)
    expect(params[0]).toBe("EUR")
  })

  it("a refund still SUBTRACTS — the converted refund, negated", () => {
    expect(sql).toMatch(/case when ("transactions"\.)?"kind" = 'refund' then -reporting_amount\(/)
    expect(sql).toMatch(/else reporting_amount\(/)
  })

  it("flags a row with no rate for its day so the caller can count it as excluded", () => {
    expect(sql).toMatch(/fx_rate_on\(("transactions"\.)?"currency_code", \$\d+, ("transactions"\.)?"date"\) is null/)
  })

  it("the spending-budget aggregate uses the converted amount, per budget currency", () => {
    const src = readFileSync("api/_lib/spending-budgets.ts", "utf8")
    expect(src).toContain("budgetSpendSignedAmountIn(cur)")
    expect(src).toContain("budgetSpendMissingRate(cur)")
    // The unconverted sum is gone from every budget figure.
    expect(src).not.toMatch(/\bbudgetSpendSignedAmount\b(?!In)/)
    // Every budget carries what it could not convert.
    expect(src).toContain("excluded_count: excludedOf(authoredCol)")
  })

  it("the v1 client caps convert to the reporting currency and report the excluded rows", () => {
    for (const route of ["api/_routes/budgets.ts", "api/_routes/budgets/overview.ts"]) {
      const src = readFileSync(route, "utf8")
      expect(src).toMatch(/outgoingByClient\(orgId, now, reporting\)/)
      expect(src).toContain("excludedFor(")
    }
    const detail = readFileSync("api/_routes/budgets/detail.ts", "utf8")
    expect(detail).toMatch(/spendForWindows\(orgId, clientId, windows, reporting\)/)
  })
})

describe("aggregate routes exclude system rows too (defect #18)", () => {
  // Budgets and analytics must agree on what counts as income/expense. This is a
  // cross-file *convention* check, in the same spirit as scripts/check-route-guards.mjs:
  // if someone drops the filter from one route, the suite fails loudly.
  const routes = [
    "api/_routes/analytics.ts",
    "api/_routes/calendar.ts",
    "api/_routes/flow.ts",
  ]

  for (const route of routes) {
    it(`${route} filters transactions.isSystem`, () => {
      const src = readFileSync(route, "utf8")
      expect(src).toContain("eq(transactions.isSystem, false)")
    })
  }
})

describe("wealth tag-ops selects isSystem (balance-reversal safety)", () => {
  it("selects isSystem so reversesOnTrash can skip balance-defining rows", () => {
    // reversalsByAccount() skips system rows via reversesOnTrash(leg). If the
    // column is not selected the flag reads undefined, reversesOnTrash returns
    // true, and deleting a tag silently moves money. Every other reversal call
    // site already selects it; this one did not.
    const src = readFileSync("api/_lib/tag-ops.ts", "utf8")
    expect(src).toContain("isSystem: transactions.isSystem")
  })
})
