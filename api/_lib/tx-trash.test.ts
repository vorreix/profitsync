import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// DB-free guards for the trash invariants (MC-002 / MC-003 / MC-012): a balance
// moves exactly once per ledger movement, and every row a logical transfer owns
// (legs AND fee rows) moves only with its transfer.
const read = (file: string) => readFileSync(file, "utf8")

describe("claim-first trash (api/_lib/tx-trash.ts)", () => {
  const src = read("api/_lib/tx-trash.ts")

  it("flips only rows still in the other state, and never a transfer-owned row", () => {
    expect(src).toContain("${restore ? sql`deleted_at is not null` : sql`deleted_at is null and not is_system`}")
    expect(src).toContain("and transfer_id is null")
  })

  it("moves balances from the rows the UPDATE returned, by the shared trash/restore rules", () => {
    // tx-legs.ts ledgerMovesSql: trash takes back what the row applied, restore
    // re-applies it, both skipping system rows (tested in tx-legs.test.ts).
    expect(src).toContain('balanceShiftSql(ledgerMovesSql("flipped", restore ? "restore" : "trash"), userId)')
  })
})

describe("transfer-owned rows go through the transfer service", () => {
  const routes = ["api/_routes/transactions/[id].ts", "api/_routes/transactions/bulk-delete.ts", "api/_routes/trash/restore.ts"]
  for (const file of routes) {
    it(`${file} keys on transfer_id, not kind (a fee row is kind 'standard')`, () => {
      const src = read(file)
      expect(src).toContain("setTransferTrashed(")
      expect(src).toContain("setRowsTrashed(")
      expect(src).not.toMatch(/kind === "transfer" && \w+\.transferId/)
    })
  }

  it("PATCH and DELETE never act on a trashed row", () => {
    const src = read("api/_routes/transactions/[id].ts")
    // before-lookups of PATCH and DELETE + PATCH's claiming UPDATE
    expect(src.match(/eq\(transactions\.id, id\), isNull\(transactions\.deletedAt\)/g)?.length).toBe(3)
  })

  it("PATCH claims the row only in the state its balance math read (no double reversal on a retried save)", () => {
    const src = read("api/_routes/transactions/[id].ts")
    expect(src).toContain("eq(transactions.amount, before.amount)")
    expect(src).toContain("eq(transactions.type, before.type)")
    expect(src).toContain('code: "transaction_changed"')
  })

  it("a fee row is never trashed alone, and never takes its transfer along", () => {
    expect(read("api/_routes/transactions/[id].ts")).toContain('if (before.kind !== "transfer")')
    const bulk = read("api/_routes/transactions/bulk-delete.ts")
    expect(bulk).toContain('leg.kind === "transfer"')
    // a refused transfer is skipped, not a 409 halfway through the batch
    expect(bulk).not.toContain("return res.status(result.status)")
  })
})

describe("purge takes the whole transfer with its header (api/_lib/tx-trash.ts purgeTrashedTransfers)", () => {
  const src = read("api/_lib/tx-trash.ts")

  it("deletes every row and the header in one statement, only when no row is live", () => {
    expect(src).toContain("not exists (select 1 from transactions x where x.transfer_id = h.id and x.deleted_at is null)")
    expect(src).toContain("delete from transactions where transfer_id in (select id from header) and deleted_at is not null")
  })

  it("purges legacy live 'completed' headers whose rows are all trashed, but never one a restore just flipped", () => {
    expect(src).toContain("h.status = 'completed'")
    expect(src).toContain("h.deleted_at is not distinct from header.deleted_at")
  })

  it("single purge and empty-trash both go through it; clear never deletes a transfer row by itself", () => {
    expect(read("api/_routes/trash/purge.ts")).toContain("purgeTrashedTransfers(orgId, tx.transferId)")
    expect(read("api/_routes/trash/purge.ts")).toContain('code: "transfer_not_trashed"')
    const clear = read("api/_routes/trash/clear.ts")
    expect(clear).toContain("purgeTrashedTransfers(orgId)")
    expect(clear).toContain("isNull(transactions.transferId)")
  })
})

describe("system rows keep explaining the balance (MC-054)", () => {
  it("are never trashed: DELETE says why, the shared flip skips them", () => {
    const route = read("api/_routes/transactions/[id].ts")
    expect(route).toContain("if (before.isSystem) {")
    expect(route).toContain('code: "system_row"')
    expect(read("api/_lib/tx-trash.ts")).toContain("deleted_at is null and not is_system")
  })

  it("one already in Trash is never purged while its account exists — single purge refuses, empty-trash keeps it", () => {
    const purge = read("api/_routes/trash/purge.ts")
    expect(purge).toContain("if (tx.isSystem && tx.wealthAccountId) {")
    expect(purge).toContain('code: "system_row"')
    const clear = read("api/_routes/trash/clear.ts")
    expect(clear).toContain("or(eq(transactions.isSystem, false), isNull(transactions.wealthAccountId))")
    // …and says how many stayed, instead of implying the Trash is empty.
    expect(clear).toContain("kept: { transactions: kept }")
  })
})

describe("migration 0080: legacy transfers already in Trash get a trashed header (MC-116)", () => {
  const sql = read("drizzle/0080_legacy_transfer_trash_repair.sql")

  it("stamps only live completed headers whose every row is trashed, with the latest row's deleted_at", () => {
    expect(sql).toContain('HAVING bool_and(t."deleted_at" IS NOT NULL)')
    // only a WHOLE transfer: restoring one missing a leg would re-apply one side
    expect(sql).toContain(`AND count(*) FILTER (WHERE t."kind" = 'transfer') = 2`)
    expect(sql).toContain('AND r."fee_rows" = h."source_fee_amount"')
    expect(sql).toContain('max(t."deleted_at")')
    expect(sql).toContain(`AND h."status" = 'completed'`)
    // the re-run guard: a repaired header no longer matches
    expect(sql).toContain('AND h."deleted_at" IS NULL')
    expect(sql).not.toMatch(/wealth_accounts|current_balance/)
  })

  it("is in the journal (the migrator never lists the folder)", () => {
    expect(read("drizzle/meta/_journal.json")).toContain('"tag": "0080_legacy_transfer_trash_repair"')
  })
})
