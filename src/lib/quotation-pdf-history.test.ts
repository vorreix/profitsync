import { describe, it, expect } from "vitest"
import { partitionPdfHistory, isPdfStale, MAX_PDF_HISTORY } from "./quotation-pdf-history"

const mk = (id: string, generatedAt: string | Date | null) => ({ id, generatedAt })

describe("partitionPdfHistory", () => {
  it("keeps the newest MAX and prunes the oldest, newest-first", () => {
    const rows = [
      mk("a", "2026-01-01T00:00:00Z"),
      mk("b", "2026-01-06T00:00:00Z"),
      mk("c", "2026-01-03T00:00:00Z"),
      mk("d", "2026-01-05T00:00:00Z"),
      mk("e", "2026-01-02T00:00:00Z"),
      mk("f", "2026-01-04T00:00:00Z"),
    ]
    const { keep, prune } = partitionPdfHistory(rows) // default max = 5
    expect(keep.map((r) => r.id)).toEqual(["b", "d", "f", "c", "e"])
    expect(prune.map((r) => r.id)).toEqual(["a"])
  })

  it("keeps all rows when count <= max", () => {
    const { keep, prune } = partitionPdfHistory([mk("a", "2026-01-01T00:00:00Z"), mk("b", "2026-01-02T00:00:00Z")])
    expect(keep).toHaveLength(2)
    expect(prune).toHaveLength(0)
  })

  it("sorts null timestamps last and accepts Date objects", () => {
    const { keep } = partitionPdfHistory([mk("a", null), mk("b", new Date("2026-01-02T00:00:00Z"))])
    expect(keep[0].id).toBe("b")
    expect(keep[1].id).toBe("a")
  })

  it("does not mutate its input", () => {
    const rows = [mk("a", "2026-01-02T00:00:00Z"), mk("b", "2026-01-01T00:00:00Z")]
    const snapshot = rows.map((r) => r.id)
    partitionPdfHistory(rows)
    expect(rows.map((r) => r.id)).toEqual(snapshot)
  })

  it("respects a custom max; default is 5", () => {
    expect(MAX_PDF_HISTORY).toBe(5)
    const rows = Array.from({ length: 8 }, (_, i) => mk(String(i), `2026-01-0${i + 1}T00:00:00Z`))
    expect(partitionPdfHistory(rows, 3).keep).toHaveLength(3)
    expect(partitionPdfHistory(rows, 3).prune).toHaveLength(5)
  })
})

describe("isPdfStale", () => {
  it("is stale when there is no prior hash", () => {
    expect(isPdfStale(null, "x")).toBe(true)
    expect(isPdfStale(undefined, "x")).toBe(true)
  })
  it("is stale when the hashes differ", () => {
    expect(isPdfStale("a", "b")).toBe(true)
  })
  it("is fresh when the hashes match", () => {
    expect(isPdfStale("a", "a")).toBe(false)
  })
})
