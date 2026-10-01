import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { db } from "../../src/lib/db/index.js"
import { transactions } from "../../src/lib/db/schema.js"
import * as txSql from "./tx-sql.js"
import {
  expenseSumSql,
  expenseSumSqlIn,
  incomeSumSql,
  incomeSumSqlIn,
  missingRateCountSql,
  nativeSummarySql,
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

describe("tx-sql — an account's own figures stay native (MC-009)", () => {
  const { sql } = db
    .select({ income: nativeSummarySql.incoming, expense: nativeSummarySql.outgoing, currency: nativeSummarySql.currency })
    .from(transactions)
    .toSQL()

  it("sums the stored amounts — nothing converted, so nothing can be left out", () => {
    expect(sql).not.toMatch(/reporting_amount\(/)
    expect(sql).toMatch(/"kind" = 'refund' then -("transactions"\.)?"amount"::numeric/)
  })

  it("names a currency only when every row carries the same one", () => {
    expect(sql).toMatch(/count\(distinct ("transactions"\.)?"currency_code"\) = 1 and count\(("transactions"\.)?"currency_code"\) = count\(\*\) then max\(("transactions"\.)?"currency_code"\) end/)
  })
})

describe("tx-sql — no second 'today' valuation path (MC-100)", () => {
  // Today's balances are valued ONLY by buildWealthSummary (currentRate). A SQL
  // fx_rate_on(current_date) can pick a different snapshot of the same day, and
  // money flow once showed a balance $1.54 away from /wealth's net worth (MC-FL01).
  it("exports no current_date conversion", () => {
    expect(Object.keys(txSql)).not.toContain("accountBalanceInSql")
    expect(readFileSync("api/_lib/tx-sql.ts", "utf8")).not.toMatch(/current_date/)
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

  it("the money-flow root balance IS /wealth's net worth — one valuation path, both modes", () => {
    // Intentional (MC-FL01/MC-092): it therefore also leaves out settled debts
    // (paid off / refinanced / written off) exactly as net worth does — a
    // written-off loan's leftover balance is not "fixed" back into the flow.
    const src = readFileSync("api/_routes/flow.ts", "utf8")
    expect(src.match(/buildWealthSummary\(orgId, \{ reporting \}\)/g)).toHaveLength(2)
    expect(src).toMatch(/const balanceT = wealthT\.net_worth/)
    expect(src).toMatch(/const balance = wealth\.net_worth/)
    // No SQL conversion of a balance at today's date, and no raw sum of current_balance.
    expect(src).not.toMatch(/current_date/)
    expect(src).not.toMatch(/reduce\(\(s(um)?, a\) => s(um)? \+ Number\(a\.current/)
  })
})

describe("fx_rate_on (mig 0078) — the lookup every converted figure goes through", () => {
  // Executed against the dev DB in a rolled-back transaction when written; this
  // pins the rules so a later CREATE OR REPLACE cannot quietly drop one.
  const src = readFileSync("drizzle/0078_fx_rate_lookup.sql", "utf8")
  const fxRateOn = src.slice(src.indexOf("CREATE OR REPLACE FUNCTION fx_rate_on"), src.indexOf("--> statement-breakpoint"))

  it("looks at BOTH directions in one candidate set, the inverse inverted (MC-098)", () => {
    expect(fxRateOn).toMatch(/s\.base_currency = p_from AND s\.quote_currency = p_to/)
    expect(fxRateOn).toMatch(/SELECT 1 \/ s\.rate,[\s\S]*s\.base_currency = p_to AND s\.quote_currency = p_from/)
    expect(fxRateOn).toMatch(/UNION ALL/)
    expect(fxRateOn).not.toMatch(/COALESCE/)
  })

  it("never carries a rate more than 10 days (MC-099) — both directions", () => {
    // Floor from the earlier of the row's date and today: a future-dated row
    // still gets today's rate, a past one never one older than 10 days.
    expect(fxRateOn.match(/s\.rate_date BETWEEN least\(p_on, current_date\) - 10 AND p_on/g)).toHaveLength(2)
    // A carried-forward fill is dated on the day it FILLS — carried again by the
    // window it would pass a rate up to 20 days old, so it counts on its own day only.
    expect(fxRateOn.match(/AND \(NOT s\.is_fallback OR s\.rate_date = p_on\)/g)).toHaveLength(2)
    expect(fxRateOn).not.toMatch(/rate_date <= p_on/)
  })

  it("newest date first, then manual, then real over fill, then the strong side, then direct, then newest fetch", () => {
    // The strong side (stored >= 1) keeps the provider's digits; an old weak-side
    // row (IDR->USD 0.000056) has two significant ones.
    expect(fxRateOn).toMatch(/SELECT s\.rate, s\.rate AS stored,/)
    expect(fxRateOn).toMatch(/SELECT 1 \/ s\.rate, s\.rate,/)
    expect(fxRateOn).toMatch(/ORDER BY c\.rate_date DESC, \(c\.source_type = 'manual'\) DESC, c\.is_fallback ASC, \(c\.stored >= 1\) DESC, c\.direct DESC, c\.fetched_at DESC\s+LIMIT 1/)
  })

  it("both functions stay STABLE SQL and PARALLEL SAFE; NULL currency keeps its meaning (MC-123)", () => {
    expect(src.match(/LANGUAGE sql STABLE PARALLEL SAFE/g)).toHaveLength(2)
    expect(src).toMatch(/WHEN p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN p_amount/)
  })
})
