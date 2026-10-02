import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

// Source guards (the unit gate is DB-free). "Delete tag & records" once trashed
// single transfer legs with a raw UPDATE — one-sided trash, a leg Trash could
// never restore — and stripped the tag from the rows it had just trashed.
describe("tag delete with records (MC-013 / MC-165)", () => {
  const ops = readFileSync("api/_lib/tag-ops.ts", "utf8")
  const route = readFileSync("api/_routes/tags/[id].ts", "utf8")

  it("expands tagged rows to whole ledger groups", () => {
    expect(ops).toContain("resolveTxLegs(orgId,")
  })

  it("trashes transfer-owned rows only through the transfer service", () => {
    expect(ops).toContain("setTransferTrashed(orgId, userId, transferId, false)")
    expect(ops).toContain("plan.legs.filter((l) => !l.transferId)")
  })

  it("skips transfers by the preview's predicate, not by a failed service call", () => {
    // setTransferTrashed maps every error to one 409; a transient failure must
    // abort the delete, not be reported as a kept transfer.
    expect(ops.split("liveTransferRows(orgId, plan.transferIds, true)").length - 1).toBe(2)
  })

  it("flips standard rows and moves their balances in ONE statement", () => {
    expect(ops).toContain('db.with(flipped, balanceShiftCte(ledgerMovesSql("flipped", "trash"), userId))')
    expect(ops).toContain("eq(transactions.isSystem, false)")
  })

  it("trashes the rows, the clients and the quotations in ONE batch (MC-059)", () => {
    expect(ops).toContain("const [trashedTx, trashedClients, trashedQuotations] = await dbBatch([")
  })

  it("keeps the tag on the rows it moved to Trash", () => {
    expect(route).toContain("removeTagEverywhere(orgId, tag.name, true)")
  })
})
