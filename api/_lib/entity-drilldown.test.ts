import { describe, expect, it } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { quotations } from "../../src/lib/db/schema.js"
import { inReporting, sortDrilldown, type DrilldownItem } from "./entity-drilldown.js"

const item = (id: string, amount: string | null, currency: string | null, reporting: string | null, date = "2026-09-01"): DrilldownItem => ({
  entity_type: amount == null ? "client" : "transaction",
  id,
  title: id,
  subtitle: "",
  amount,
  tx_type: amount == null ? null : "outgoing",
  tx_kind: amount == null ? null : "standard",
  currency_code: currency,
  reporting_amount: reporting,
  status: null,
  date,
  category: "",
  tags: [],
  link: "",
})

describe("sortDrilldown — amounts compare in the reporting currency (MC-051)", () => {
  // A € workspace: ₹9,000 is worth ~€98, so it ranks BELOW €100 even though 9000 > 100.
  const inr = item("inr", "9000", "INR", "98.10")
  const eur = item("eur", "100", "EUR", "100")
  const noRate = item("no-rate", "50000", "IDR", null)
  const client = item("client", null, null, null)

  it("ranks by the converted figure, high → low", () => {
    expect(sortDrilldown([inr, eur], "amount_desc").map((i) => i.id)).toEqual(["eur", "inr"])
  })

  it("ranks by the converted figure, low → high", () => {
    expect(sortDrilldown([eur, inr], "amount_asc").map((i) => i.id)).toEqual(["inr", "eur"])
  })

  it("puts what has no comparable figure last in both directions, never as zero", () => {
    expect(sortDrilldown([noRate, client, inr, eur], "amount_desc").map((i) => i.id).slice(0, 2)).toEqual(["eur", "inr"])
    expect(sortDrilldown([noRate, client, eur, inr], "amount_asc").map((i) => i.id).slice(0, 2)).toEqual(["inr", "eur"])
  })
})

describe("inReporting — converts in the same query, no separate currency lookup", () => {
  it("reads the target from the org row (reporting, else base currency) inside reporting_amount()", () => {
    const { sql, params } = new PgDialect().sqlToQuery(inReporting("org-1", quotations.amount, quotations.currencyCode, quotations.date))
    expect(sql).toMatch(/^reporting_amount\(("quotations"\.)?"amount"::numeric, ("quotations"\.)?"currency_code", ("quotations"\.)?"date", \(select coalesce\(("organizations"\.)?"reporting_currency", ("organizations"\.)?"currency", 'USD'\) from "organizations" where ("organizations"\.)?"id" = \$1\)\)$/)
    expect(params).toEqual(["org-1"])
  })
})
