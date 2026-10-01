import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// DB-free guards for the trash invariants (MC-002 / MC-003 / MC-012): a balance
// moves exactly once per ledger movement, and every row a logical transfer owns
// (legs AND fee rows) moves only with its transfer.
const read = (file: string) => readFileSync(file, "utf8")

describe("claim-first trash (api/_lib/tx-trash.ts)", () => {
  const src = read("api/_lib/tx-trash.ts")

  it("flips only rows still in the other state, and never a transfer-owned row", () => {
    expect(src).toContain("${restore ? sql`deleted_at is not null` : sql`deleted_at is null`}")
    expect(src).toContain("and transfer_id is null")
  })

  it("moves balances from the rows the UPDATE returned, skipping system rows", () => {
    expect(src).toContain("from flipped")
    expect(src).toContain("not is_system")
    // Trash subtracts what the row applied (incoming +, outgoing -); restore adds it back.
    expect(src).toContain("case when type = 'incoming' then amount else -amount end")
    expect(src).toContain("${restore ? sql`+` : sql`-`} shifts.applied")
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
