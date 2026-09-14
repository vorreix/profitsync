import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { db } from "../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import {
  accountBalanceInSql,
  expenseSumSql,
  expenseSumSqlIn,
  incomeSumSql,
  incomeSumSqlIn,
  missingAccountRateCountSql,
  missingRateCountSql,
  pnlKindFilter,
  reportingAmountSql,
} from "./tx-sql.js"

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

// ── Reporting-currency twins ─────────────────────────────────────────────────
// Every row is converted AT ITS OWN DATE into the target currency by the SQL
// function reporting_amount() (mig 0074); a row with no stored rate for its day
// is NULL — skipped by the sum — and must be COUNTED by missingRateCountSql so a
// partial total is never presented as complete.

function renderIn(reporting: string) {
  return db
    .select({
      income: incomeSumSqlIn(reporting),
      expense: expenseSumSqlIn(reporting),
      excluded: missingRateCountSql(reporting),
      row: reportingAmountSql(reporting),
    })
    .from(transactions)
    .where(and(pnlKindFilter, eq(transactions.isSystem, false)))
    .toSQL()
}

describe("tx-sql — reporting-currency twins convert each row at its own date", () => {
  const { sql, params } = renderIn("EUR")

  it("converts through reporting_amount(amount, currency_code, date, <reporting>) — never a raw amount", () => {
    expect(sql).toMatch(/reporting_amount\(("transactions"\.)?"amount"::numeric, ("transactions"\.)?"currency_code", ("transactions"\.)?"date", \$\d+\)/)
    // The target currency is a bound parameter, and it is the one we asked for.
    expect(params).toContain("EUR")
  })

  it("income is still only standard incoming rows, but converted", () => {
    expect(sql).toMatch(/"type" = 'incoming' and ("transactions"\.)?"kind" = 'standard' then reporting_amount\(/)
  })

  it("expense still SUBTRACTS a refund — the converted refund, negated", () => {
    expect(sql).toMatch(/"type" = 'outgoing' and ("transactions"\.)?"kind" = 'standard' then reporting_amount\(/)
    expect(sql).toMatch(/"kind" = 'refund' then -reporting_amount\(/)
  })

  it("transfers are still excluded — the P&L filter is unchanged", () => {
    expect(sql).toMatch(/"kind" in \(\$\d+, \$\d+\)/)
    expect(params.slice(-3)).toEqual(["standard", "refund", false])
  })

  it("the excluded count asks fx_rate_on(currency_code, <reporting>, date) is null, and only for P&L kinds", () => {
    expect(sql).toMatch(/count\(\*\) filter \(where ("transactions"\.)?"kind" in \('standard', 'refund'\) and \(("transactions"\.)?"currency_code" is not null and ("transactions"\.)?"currency_code" <> \$\d+ and fx_rate_on\(("transactions"\.)?"currency_code", \$\d+, ("transactions"\.)?"date"\) is null\)\)::int/)
  })

  it("the same target currency is bound everywhere it appears", () => {
    const eur = params.filter((p) => p === "EUR")
    // income (1) + expense (2: outgoing + refund) + excluded (2: <> and fx_rate_on) + row (1)
    expect(eur.length).toBe(6)
  })
})

describe("tx-sql — a wealth account's balance converts at TODAY's rate", () => {
  const { sql, params } = db
    .select({ balance: accountBalanceInSql("INR"), missing: missingAccountRateCountSql("INR") })
    .from(wealthAccounts)
    .toSQL()

  it("uses current_date, not a row date — today's market rate is filed under today", () => {
    expect(sql).toMatch(/reporting_amount\(("wealth_accounts"\.)?"current_balance"::numeric, ("wealth_accounts"\.)?"currency_code", current_date, \$\d+\)/)
    expect(sql).toMatch(/fx_rate_on\(("wealth_accounts"\.)?"currency_code", \$\d+, current_date\) is null/)
    expect(params).toEqual(["INR", "INR", "INR"])
  })
})

describe("every P&L aggregate route uses the shared expressions", () => {
  // Cross-file convention check (same spirit as budget-spend.test.ts): if a
  // route re-inlines `case when type = 'incoming'`, refunds silently become
  // income there again — and if it goes back to the unconverted sums, EUR rows
  // are added to INR rows again.
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

    it(`${route} sums in the reporting currency and surfaces what it could not convert`, () => {
      const src = readFileSync(route, "utf8")
      expect(src).toMatch(/incomeSumSqlIn\(/)
      expect(src).toMatch(/expenseSumSqlIn\(/)
      expect(src).toMatch(/missingRateCountSql\(/)
      // The unconverted twins must not be used for a displayed total any more.
      expect(src).not.toMatch(/\bincomeSumSql\b(?!In)/)
      expect(src).not.toMatch(/\bexpenseSumSql\b(?!In)/)
      // Rates are made sure of before the sums run.
      expect(src).toMatch(/ensureRatesForOrg\(/)
      expect(src).toMatch(/reportingCurrencyFor\(/)
    })
  }

  it("the money-flow root balance converts every account at today's rate", () => {
    const src = readFileSync("api/_routes/flow.ts", "utf8")
    expect(src).toMatch(/accountBalanceInSql\(reporting\)/)
    // No raw sum of current_balance across accounts survives.
    expect(src).not.toMatch(/reduce\(\(s(um)?, a\) => s(um)? \+ Number\(a\.current\)/)
  })
})
