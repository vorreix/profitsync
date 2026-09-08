import { describe, expect, it } from "vitest"
import { SNOOZE_MS, isSnoozed, loadSnoozed, snooze } from "./alert-dismissals"

const NOW = 1_800_000_000_000

describe("alert snoozing", () => {
  it("forgets a snooze once it expires — a dismissal is never permanent", () => {
    const fresh = snooze({}, "posted:r1:2026-03-10", NOW)
    expect(isSnoozed(fresh, "posted:r1:2026-03-10", NOW)).toBe(true)
    expect(isSnoozed(fresh, "posted:r1:2026-03-10", NOW + SNOOZE_MS)).toBe(false)
  })

  it("drops expired and malformed entries on read", () => {
    const raw = JSON.stringify({ old: NOW - SNOOZE_MS - 1, ok: NOW - 1000, bad: "nope", worse: null })
    expect(loadSnoozed(raw, NOW)).toEqual({ ok: NOW - 1000 })
  })

  it("survives anything at all in storage", () => {
    for (const raw of [null, "", "not json", "[]", '"string"', "123"]) {
      expect(loadSnoozed(raw, NOW)).toEqual({})
    }
  })

  it("keeps the newest entries when a long-lived browser accumulates too many", () => {
    let map = {}
    for (let i = 0; i < 60; i++) map = snooze(map, `id${i}`, NOW - (60 - i))
    const kept = Object.keys(map)
    expect(kept).toHaveLength(50)
    expect(kept).toContain("id59")
    expect(kept).not.toContain("id0")
  })
})
