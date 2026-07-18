import { describe, expect, it } from "vitest"
import {
  clampHandleTop,
  HANDLE_TOP_MAX,
  HANDLE_TOP_MIN,
  loadSearchHandlePref,
  saveSearchHandlePref,
} from "./search-handle"

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

describe("search-handle prefs", () => {
  it("defaults to the right edge in the thumb zone", () => {
    const pref = loadSearchHandlePref(memoryStorage())
    expect(pref.side).toBe("right")
    expect(pref.topPct).toBeGreaterThanOrEqual(HANDLE_TOP_MIN)
    expect(pref.topPct).toBeLessThanOrEqual(HANDLE_TOP_MAX)
  })

  it("round-trips a saved pref", () => {
    const s = memoryStorage()
    saveSearchHandlePref(s, { side: "left", topPct: 0.4 })
    expect(loadSearchHandlePref(s)).toEqual({ side: "left", topPct: 0.4 })
  })

  it("falls back to defaults on corrupt JSON or invalid side", () => {
    expect(loadSearchHandlePref(memoryStorage({ ps_search_handle: "{nope" })).side).toBe("right")
    expect(
      loadSearchHandlePref(memoryStorage({ ps_search_handle: '{"side":"top","topPct":0.5}' })).side,
    ).toBe("right")
  })

  it("clamps out-of-range stored positions", () => {
    const low = loadSearchHandlePref(memoryStorage({ ps_search_handle: '{"side":"left","topPct":-2}' }))
    const high = loadSearchHandlePref(memoryStorage({ ps_search_handle: '{"side":"left","topPct":9}' }))
    expect(low.topPct).toBe(HANDLE_TOP_MIN)
    expect(high.topPct).toBe(HANDLE_TOP_MAX)
  })

  it("clampHandleTop bounds and passes through valid values", () => {
    expect(clampHandleTop(0.5)).toBe(0.5)
    expect(clampHandleTop(0)).toBe(HANDLE_TOP_MIN)
    expect(clampHandleTop(1)).toBe(HANDLE_TOP_MAX)
    expect(clampHandleTop(Number.NaN)).toBe(HANDLE_TOP_MIN)
  })
})
