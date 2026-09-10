import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { organizations, recurringRules, spendingBudgets, transactions, transfers, wealthAccounts } from "./db/schema"

const migration = readFileSync("drizzle/0069_multi_currency_foundation.sql", "utf8")
const transferMigration = readFileSync("drizzle/0071_logical_transfers.sql", "utf8")
const transferExecutionMigration = readFileSync("drizzle/0072_transfer_execution.sql", "utf8")
const transferLifecycleMigration = readFileSync("drizzle/0073_transfer_lifecycle.sql", "utf8")

describe("multi-currency foundation migration", () => {
  it("declares every staged currency column in the Drizzle schema", () => {
    expect(organizations.reportingCurrency.name).toBe("reporting_currency")
    expect(wealthAccounts.currencyCode.name).toBe("currency_code")
    expect(transactions.currencyCode.name).toBe("currency_code")
    expect(recurringRules.currencyCode.name).toBe("currency_code")
    expect(spendingBudgets.currencyCode.name).toBe("currency_code")
  })

  it("assigns currency metadata without rewriting stored financial amounts", () => {
    expect(migration).toMatch(/SET "currency_code" = upper/)
    expect(migration).not.toMatch(/SET\s+"(?:amount|opening_balance|current_balance|credit_limit|goal_amount)"/i)
  })

  it("backfills account-linked transactions before the deterministic org fallback", () => {
    const accountBackfill = migration.indexOf('FROM "wealth_accounts" wa')
    const detachedBackfill = migration.indexOf('FROM "clients" c')
    expect(accountBackfill).toBeGreaterThan(-1)
    expect(detachedBackfill).toBeGreaterThan(accountBackfill)
  })

  it("permits multiple cash wallets while keeping the lazy default unique", () => {
    expect(migration).toContain('DROP INDEX IF EXISTS "wealth_accounts_one_active_cash_idx"')
    expect(migration).toContain('"bank_name" = \'Cash in Hand\'')
  })

  it("links both ledger legs to a first-class logical transfer", () => {
    expect(transfers.groupId.name).toBe("group_id")
    expect(transactions.transferId.name).toBe("transfer_id")
    expect(transferMigration).toContain('HAVING count(*) = 2')
    expect(transferMigration).toContain("count(*) FILTER (WHERE t.\"type\" = 'outgoing') = 1")
    expect(transferMigration).toContain("count(*) FILTER (WHERE t.\"type\" = 'incoming') = 1")
    expect(transferMigration).toContain('count(DISTINCT t."currency_code") = 1')
    expect(transferMigration).toContain('ON CONFLICT ("group_id") DO NOTHING')
  })

  it("persists fee and rate provenance while enforcing same-currency equality", () => {
    expect(transfers.sourceFeeAmount.name).toBe("source_fee_amount")
    expect(transfers.rateSource.name).toBe("rate_source")
    expect(transferExecutionMigration).toContain("source_currency <> destination_currency OR source_amount = destination_amount")
    expect(transferExecutionMigration).toContain("'effective_transfer'")
  })

  it("uses a row lock and one database function as the completion execution guard", () => {
    expect(transferLifecycleMigration).toContain("FOR UPDATE")
    expect(transferLifecycleMigration).toContain("tr.status NOT IN ('planned', 'pending')")
    expect(transferLifecycleMigration).toContain("current_balance = current_balance - tr.source_amount - tr.source_fee_amount")
    expect(transferLifecycleMigration).toContain("current_balance = current_balance + tr.destination_amount")
    expect(transferLifecycleMigration).toContain("transition_unsettled_transfer")
    expect(transferLifecycleMigration).toContain("transfers_one_reversal_idx")
    expect(transferLifecycleMigration).toContain("set_transfer_trashed")
    expect(transferLifecycleMigration).toContain("WHERE transfer_id = tr.id")
  })
})
