import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"
import { eq } from "drizzle-orm"
import { groupMoneySql } from "./tx-group-sql.js"
import { fxFor, withFx } from "./tx-sql.js"

// DB-FREE: drizzle renders the expressions to SQL without executing them.

describe("groupMoneySql — a split group's money", () => {
  const { sql, params } = db.select(groupMoneySql("USD")).from(transactions).toSQL()

  it("adds native amounts only when the legs share ONE currency", () => {
    expect(sql).toMatch(/case when count\(distinct coalesce\(("transactions"\.)?"currency_code", ''\)\) <= 1 then sum\(("transactions"\.)?"amount"::numeric\) else case when bool_or\(reporting_amount\(/)
  })

  it("a mixed-currency amount is NULL as soon as one leg has no rate (sum would skip it silently)", () => {
    // amount + reporting_amount both carry the bool_or(... is null) → null rule.
    expect(sql.match(/case when bool_or\(reporting_amount\([^)]*\) is null\) then null else sum\(reporting_amount\(/g)?.length).toBe(2)
  })

  it("labels a mixed group with the reporting currency it was converted into", () => {
    expect(sql).toMatch(/then max\(("transactions"\.)?"currency_code"\) else \$\d+ end/)
    expect(params).toContain("USD")
  })
})

describe("groupMoneySql — the list's gated rates (MC-167)", () => {
  const scope = eq(clients.organizationId, "11111111-1111-1111-1111-111111111111")
  const render = (fx: ReturnType<typeof fxFor>) =>
    withFx(db.select(groupMoneySql("USD", fx)).from(transactions).innerJoin(clients, eq(transactions.clientId, clients.id)).$dynamic(), fx)
      .where(scope)
      .toSQL()

  it("no foreign currency → byte for byte the per-row statement (no join)", () => {
    const perRow = db.select(groupMoneySql("USD")).from(transactions).innerJoin(clients, eq(transactions.clientId, clients.id)).where(scope).toSQL()
    expect(render(fxFor("USD", scope, { currencies: [] }))).toEqual(perRow)
  })

  it("a foreign currency → one fx_rate_on in the joined rate set, none per leg", () => {
    const { sql } = render(fxFor("USD", scope, { currencies: ["EUR"] }))
    expect(sql.match(/fx_rate_on\(/g) ?? []).toHaveLength(1)
    expect(sql).not.toMatch(/reporting_amount\(/)
    expect(sql).toMatch(/left join \(with r as materialized/)
    // The NULL rule survives the join: a leg with no rate still nulls its group.
    expect(sql.match(/case when bool_or\(\(case when [^]*? is null\) then null else sum\(/g)?.length).toBe(2)
  })
})

describe("transaction + client routes keep system rows out of P&L and sort by comparable amounts", () => {
  const read = (p: string) => readFileSync(p, "utf8")

  it("the /transactions summary filters is_system = false next to the P&L kind filter", () => {
    expect(read("api/_routes/transactions.ts")).toMatch(/pnlKindFilter,\s*eq\(transactions\.isSystem, false\)/)
  })

  it("client totals (list join + detail) filter is_system = false", () => {
    expect(read("api/_routes/clients.ts")).toMatch(/const clientTotalsJoin = and\([^\n]*eq\(transactions\.isSystem, false\)\)/)
    expect(read("api/_routes/clients.ts")).not.toMatch(/leftJoin\(transactions, and\(/)
    expect(read("api/_routes/clients/[id].ts")).toMatch(/eq\(transactions\.clientId, id\), isNull\(transactions\.deletedAt\), eq\(transactions\.isSystem, false\)/)
  })

  it("the client detail totals use the converted shared sums, like the list (tx-sql.test.ts route rules)", () => {
    const src = read("api/_routes/clients/[id].ts")
    for (const re of [/incomeSumSqlIn\(/, /expenseSumSqlIn\(/, /missingRateCountSql\(/, /ensureRatesForOrg\(/, /reportingCurrencyFor\(/]) expect(src).toMatch(re)
    expect(src).not.toMatch(/\bincomeSumSql\b(?!In)/)
    expect(src).not.toMatch(/\bexpenseSumSql\b(?!In)/)
  })

  it("an amount sort orders by the reporting amount, rows without a rate last — never the native amount", () => {
    const src = read("api/_routes/transactions.ts")
    expect(src).toMatch(/reportingAmountSql\(reporting\)\} desc nulls last/)
    expect(src).toMatch(/reportingAmountSql\(reporting\)\} asc nulls last/)
    expect(src).toMatch(/groupMoneySql\(reporting, fx\)\.reportingAmount\} desc nulls last/)
    expect(src).not.toMatch(/sum\(\$\{transactions\.amount\}::numeric\)`\)/)
    expect(src).not.toMatch(/(asc|desc)\(sql`\$\{transactions\.amount\}::numeric`\)/)
  })

  it("the list and the detail GET share the group money expressions", () => {
    const list = read("api/_routes/transactions.ts")
    expect(list).toMatch(/\.\.\.groupMoneySql\(reporting, fx\)/)
    // The grouped list joins its gated rates (every group's money is computed before the page limit).
    expect(list).toMatch(/const fx = fxFor\(reporting, where, orgRates\)\n {2}const q = withFx\(/)
    const detail = read("api/_routes/transactions/[id].ts")
    expect(detail).toMatch(/\.\.\.groupMoneySql\(reporting\)/)
    expect(detail).toMatch(/currencyCode: transactions\.currencyCode/)
    expect(detail).toMatch(/reportingAmount: reportingAmountSql\(reporting\)/)
  })

  it("the admin client list and org detail convert through gated joined rates, like the workspace's own (MC-167)", () => {
    for (const file of ["api/_routes/admin/clients.ts", "api/_routes/admin/org-detail.ts"]) {
      const src = read(file)
      expect(src).toMatch(/const orgRates = await ensureRatesForOrg\(/)
      expect(src).toMatch(/const fx = fxFor\(reporting, .*orgRates\)/)
      expect(src).toMatch(/withFx\(/)
      expect(src).not.toMatch(/(incomeSumSqlIn|expenseSumSqlIn|missingRateCountSql)\(reporting\)/)
    }
  })
})
