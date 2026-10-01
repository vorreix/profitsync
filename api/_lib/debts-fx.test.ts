import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

// DB-FREE convention checks for the Debt Hub's money (same spirit as the route
// sweep in tx-sql.test.ts, which only scans api/_routes): the pure halves are
// pinned in src/lib/debt-status.test.ts; these pin the SQL halves by source.

describe("debt hub — the income behind the pressure ratio is converted (MC-091)", () => {
  const src = readFileSync("api/_lib/debts.ts", "utf8")

  it("sums income in the reporting currency through tx-sql and counts what it could not convert", () => {
    expect(src).toMatch(/from "\.\/tx-sql\.js"/)
    expect(src).toMatch(/incomeSumSqlIn\(reporting\)/)
    expect(src).toMatch(/missingRateCountSql\(reporting\)/)
    expect(src).toMatch(/ensureRatesForOrg\(/)
  })

  it("never adds raw transaction amounts across currencies", () => {
    expect(src).not.toMatch(/sum\(\$\{transactions\.amount\}/)
  })
})

describe("net worth counts only the debts /debts counts (MC-092)", () => {
  const src = readFileSync("api/_lib/wealth-summary.ts", "utf8")

  it("filters debt accounts on the shared OPEN_LIFECYCLES list, keeping every non-debt account", () => {
    expect(src).toMatch(/import \{ OPEN_LIFECYCLES \} from "\.\.\/\.\.\/src\/lib\/debt-status\.js"/)
    expect(src).toMatch(/leftJoin\(debtDetails, eq\(debtDetails\.wealthAccountId, wealthAccounts\.id\)\)/)
    expect(src).toMatch(/or\(isNull\(debtDetails\.id\), inArray\(debtDetails\.lifecycle, \[\.\.\.OPEN_LIFECYCLES\]\)\)/)
  })
})
