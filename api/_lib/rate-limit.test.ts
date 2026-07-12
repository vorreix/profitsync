import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearRateLimits, rateLimit } from "./rate-limit.js"

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearRateLimits()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows up to max hits in a window, then blocks", () => {
    expect(rateLimit("k", 3, 1000)).toBe(true)
    expect(rateLimit("k", 3, 1000)).toBe(true)
    expect(rateLimit("k", 3, 1000)).toBe(true)
    expect(rateLimit("k", 3, 1000)).toBe(false)
    expect(rateLimit("k", 3, 1000)).toBe(false)
  })

  it("resets after the window elapses", () => {
    for (let i = 0; i < 4; i++) rateLimit("k", 3, 1000)
    expect(rateLimit("k", 3, 1000)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(rateLimit("k", 3, 1000)).toBe(true)
  })

  it("tracks keys independently", () => {
    expect(rateLimit("a", 1, 1000)).toBe(true)
    expect(rateLimit("a", 1, 1000)).toBe(false)
    expect(rateLimit("b", 1, 1000)).toBe(true)
  })
})
