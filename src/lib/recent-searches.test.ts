import { describe, expect, it } from "vitest"
import { clearRecents, loadRecents, recordRecent, RECENTS_LIMIT } from "./recent-searches"

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe("recent-searches", () => {
  it("returns [] when nothing is stored", () => {
    expect(loadRecents(memoryStorage(), "org1")).toEqual([])
  })

  it("returns [] for corrupt or non-array JSON", () => {
    const s = memoryStorage({ ps_recent_search_org1: "{not json" })
    expect(loadRecents(s, "org1")).toEqual([])
    const s2 = memoryStorage({ ps_recent_search_org1: '{"a":1}' })
    expect(loadRecents(s2, "org1")).toEqual([])
  })

  it("records newest first and persists", () => {
    const s = memoryStorage()
    recordRecent(s, "org1", "acme")
    recordRecent(s, "org1", "invoice")
    expect(loadRecents(s, "org1")).toEqual(["invoice", "acme"])
  })

  it("de-dupes case-insensitively, moving the term to the front", () => {
    const s = memoryStorage()
    recordRecent(s, "org1", "acme")
    recordRecent(s, "org1", "invoice")
    recordRecent(s, "org1", "ACME")
    expect(loadRecents(s, "org1")).toEqual(["ACME", "invoice"])
  })

  it("caps the list at RECENTS_LIMIT", () => {
    const s = memoryStorage()
    for (let i = 0; i < RECENTS_LIMIT + 3; i++) recordRecent(s, "org1", `term${i}`)
    const list = loadRecents(s, "org1")
    expect(list).toHaveLength(RECENTS_LIMIT)
    expect(list[0]).toBe(`term${RECENTS_LIMIT + 2}`)
  })

  it("ignores blank input", () => {
    const s = memoryStorage()
    recordRecent(s, "org1", "   ")
    expect(loadRecents(s, "org1")).toEqual([])
  })

  it("keeps orgs isolated and clears only the given org", () => {
    const s = memoryStorage()
    recordRecent(s, "org1", "alpha")
    recordRecent(s, "org2", "beta")
    clearRecents(s, "org1")
    expect(loadRecents(s, "org1")).toEqual([])
    expect(loadRecents(s, "org2")).toEqual(["beta"])
  })
})
