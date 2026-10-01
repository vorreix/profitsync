import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// DB-free guards for the client cascade (api/_lib/client-trash.ts): a balance
// moves exactly once, a transfer is only ever trashed whole, and a client
// restore can find exactly the rows its delete took.
const read = (file: string) => readFileSync(file, "utf8")

describe("trashClients", () => {
  const src = read("api/_lib/client-trash.ts")

  it("claims on the UPDATE's own row, so a concurrent loser claims nothing", () => {
    expect(src).toContain("and deleted_at is null and not is_own`")
    expect(src).toMatch(/update clients set deleted_at = \$\{at\}[^]*where \$\{claimable\}/)
  })

  it("flips only live, non-transfer rows and moves balances from the flipped rows", () => {
    expect(src).toContain("t.deleted_at is null and t.transfer_id is null")
    expect(src).toContain('balanceShiftSql(ledgerMovesSql("flipped", "trash"), userId)')
  })

  it("hands transfer-owned rows to the transfer service and stops on a refusal", () => {
    expect(src).toContain("setTransferTrashed(orgId, userId, transfer_id, false)")
    expect(src).toContain("if (!result.ok) return result")
  })

  it("stamps clients and rows with one timestamp (restore takes back the rows carrying the client's)", () => {
    expect(src).toContain("new Date().toISOString()}::timestamp")
    expect(src).not.toContain("deleted_at = now()")
  })
})

describe("every client delete goes through trashClients", () => {
  for (const file of ["api/_routes/clients/[id].ts", "api/_routes/clients/bulk-delete.ts", "api/_routes/admin/clients.ts"]) {
    it(file, () => {
      const src = read(file)
      expect(src).toContain("trashClients(")
      expect(src).not.toContain("reversalsByAccount")
    })
  }

  it("the admin hard delete refuses a client with ledger rows", () => {
    const src = read("api/_routes/admin/clients.ts")
    expect(src).toContain('code: "admin_ledger_row_locked"')
    expect(src).toContain("t.wealth_account_id is not null or t.transfer_id is not null or t.is_system")
  })
})
