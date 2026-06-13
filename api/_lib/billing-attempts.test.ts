// Pure-logic tests for the billing-attempt lifecycle (DB-free — the committed
// gate must never open a database connection).
import { describe, expect, it } from "vitest"
import { ABANDONED_AFTER_MS, canTransition, effectiveStatus } from "./billing-attempts"

describe("canTransition", () => {
  it("advances the happy path", () => {
    expect(canTransition("created", "redirected")).toBe(true)
    expect(canTransition("redirected", "completed")).toBe(true)
    expect(canTransition("created", "failed")).toBe(true)
    expect(canTransition("redirected", "failed")).toBe(true)
  })

  it("is idempotent — same status is not a transition", () => {
    expect(canTransition("completed", "completed")).toBe(false)
    expect(canTransition("created", "created")).toBe(false)
  })

  it("never regresses out of completed/abandoned", () => {
    expect(canTransition("completed", "failed")).toBe(false)
    expect(canTransition("completed", "redirected")).toBe(false)
    expect(canTransition("abandoned", "created")).toBe(false)
  })

  it("allows failed → completed (payment retry / dunning recovery)", () => {
    expect(canTransition("failed", "completed")).toBe(true)
    expect(canTransition("failed", "redirected")).toBe(false)
  })
})

describe("effectiveStatus", () => {
  const now = new Date("2026-06-10T12:00:00Z")

  it("keeps terminal statuses as-is regardless of age", () => {
    const old = new Date(now.getTime() - 10 * ABANDONED_AFTER_MS)
    expect(effectiveStatus("completed", old, now)).toBe("completed")
    expect(effectiveStatus("failed", old, now)).toBe("failed")
  })

  it("shows fresh in-flight attempts as their stored status", () => {
    const recent = new Date(now.getTime() - 60_000)
    expect(effectiveStatus("created", recent, now)).toBe("created")
    expect(effectiveStatus("redirected", recent, now)).toBe("redirected")
  })

  it("shows stale in-flight attempts as abandoned", () => {
    const stale = new Date(now.getTime() - ABANDONED_AFTER_MS - 1)
    expect(effectiveStatus("created", stale, now)).toBe("abandoned")
    expect(effectiveStatus("redirected", stale, now)).toBe("abandoned")
  })

  it("tolerates missing/invalid created_at", () => {
    expect(effectiveStatus("created", null, now)).toBe("created")
    expect(effectiveStatus("created", "not-a-date", now)).toBe("created")
  })
})
