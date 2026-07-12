import { describe, expect, it } from "vitest"
import { shouldLoadMore } from "./use-infinite-scroll"

const base = { isIntersecting: true, hasMore: true, loading: false, enabled: true }

describe("shouldLoadMore", () => {
  it("loads when the sentinel is visible, more remain, idle, and enabled", () => {
    expect(shouldLoadMore(base)).toBe(true)
  })

  it("does not load while the sentinel is off-screen", () => {
    expect(shouldLoadMore({ ...base, isIntersecting: false })).toBe(false)
  })

  it("does not load when there are no more pages", () => {
    expect(shouldLoadMore({ ...base, hasMore: false })).toBe(false)
  })

  it("does not double-fire while a page is already loading", () => {
    expect(shouldLoadMore({ ...base, loading: true })).toBe(false)
  })

  it("stays idle when disabled (e.g. while searching)", () => {
    expect(shouldLoadMore({ ...base, enabled: false })).toBe(false)
  })
})
