import { describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { db } from "../../src/lib/db/index.js"
import { budgets, clients, transactions } from "../../src/lib/db/schema.js"
import { budgetSpendPredicates, capCurrency, capJoin, capRatesFor, capSpendMissingRate, capSpendSignedAmount, capWriteCurrency, inCapCurrency } from "./budget-spend.js"

// A v1 per-client cap KEEPS the currency it was set in (mig 0077): a reporting
// change converts the spend into the cap's currency, it never relabels the cap.
// DB-FREE: the SQL is rendered, never run.

describe("capCurrency", () => {
  it("is the cap's own currency, normalised", () => {
    expect(capCurrency({ currencyCode: "usd" }, "INR")).toBe("USD")
  })
  it("falls back to the reporting currency for a legacy NULL, a missing cap or garbage", () => {
    expect(capCurrency({ currencyCode: null }, "INR")).toBe("INR")
    expect(capCurrency(undefined, "INR")).toBe("INR")
    expect(capCurrency({ currencyCode: "ZZZ" }, "INR")).toBe("INR")
  })
})

describe("capWriteCurrency", () => {
  it("a new cap is born in the currency the dialog showed, else the reporting one", () => {
    expect(capWriteCurrency(undefined, "INR", null)).toBe("INR")
    expect(capWriteCurrency(undefined, "INR", "USD")).toBe("USD")
  })
  it("an existing cap keeps its currency when the amount was typed in it", () => {
    expect(capWriteCurrency({ currencyCode: "USD" }, "INR", "USD")).toBe("USD")
    expect(capWriteCurrency({ currencyCode: "INR" }, "INR", null)).toBe("INR")
    expect(capWriteCurrency({ currencyCode: null }, "INR", null)).toBe("INR")
  })
  it("refuses an amount typed against another currency — never reinterprets it", () => {
    // A $1,000 cap after a switch to INR, edited in a dialog that says ₹.
    expect(capWriteCurrency({ currencyCode: "USD" }, "INR", null)).toBeNull()
    expect(capWriteCurrency({ currencyCode: "USD" }, "INR", "INR")).toBeNull()
  })
})

describe("inCapCurrency", () => {
  it("keeps snapshots in the cap's currency and legacy NULL ones", () => {
    expect(inCapCurrency("USD", "USD")).toBe(true)
    expect(inCapCurrency("usd", "USD")).toBe(true)
    expect(inCapCurrency(null, "USD")).toBe(true)
  })
  it("drops a snapshot from an earlier life of the cap in another currency", () => {
    expect(inCapCurrency("EUR", "USD")).toBe(false)
  })
})

describe("cap spend SQL converts into each client's cap currency", () => {
  const org = "11111111-1111-1111-1111-111111111111"
  const where = and(...budgetSpendPredicates(org))
  const rates = capRatesFor(org, "INR", where)
  const { sql, params } = db
    .select({ signed: capSpendSignedAmount(rates), missing: capSpendMissingRate(rates) })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .leftJoin(budgets, capJoin(org))
    .leftJoin(rates.table, rates.on)
    .where(where)
    .toSQL()

  it("targets coalesce(cap currency, reporting) — never the reporting currency alone", () => {
    // The rate is looked up per (currency, date, CAP currency), once each (MC-167)…
    expect(sql).toMatch(/fx_rate_on\(p\.cur, p\.tgt, p\.day\)/)
    expect(sql).toMatch(/"date" as day, coalesce\("budgets"\."currency_code", \$\d+\) as tgt from "transactions" inner join "clients" on "clients"\."id" = "transactions"\."client_id" left join "budgets" on/)
    // …and joined back on the row's own cap currency.
    expect(sql).toMatch(/"fx"\.tgt = coalesce\("budgets"\."currency_code", \$\d+\)/)
    expect(sql).toMatch(/"currency_code" = coalesce\("budgets"\."currency_code", \$\d+\) then ("transactions"\.)?"amount"::numeric else round\(("transactions"\.)?"amount"::numeric \* "fx"\.rate, 2\)/)
    expect(params).toContain("INR")
    expect(sql).not.toMatch(/reporting_amount\(/)
  })

  it("a refund still subtracts", () => {
    expect(sql).toMatch(/case when ("transactions"\.)?"kind" = 'refund' then -\(case when/)
  })

  it("flags a row with no rate into the cap's currency", () => {
    expect(sql).toMatch(/"currency_code" <> coalesce\("budgets"\."currency_code", \$\d+\) and "fx"\.rate is null/)
  })

  it("joins the client's cap inside the org", () => {
    expect(sql).toMatch(/left join "budgets" on \("budgets"\."organization_id" = \$\d+ and "budgets"\."client_id" = "transactions"\."client_id"\)/)
  })

  it("both cap spend readers use it", () => {
    const src = readFileSync("api/_lib/budget-spend.ts", "utf8")
    expect(src.match(/\.leftJoin\(budgets, capJoin\(orgId\)\)\n\s+\.leftJoin\(rates\.table, rates\.on\)/g)).toHaveLength(2)
    expect(src).toContain("const rates = capRatesFor(orgId, reporting, where)")
    expect(src).toContain("const signed = capSpendSignedAmount(rates)")
    expect(src).toContain("amount: capSpendSignedAmount(rates)")
  })
})
