import { describe, expect, it } from "vitest"
import { FAN, displayIndexWhileHeld, dragOffset, fanPose, moveIntent, pxPerStep, reorderIds, reorderTarget, snapOffset } from "@/components/cards/card-fan"

describe("fanPose", () => {
  it("puts the selected card upright, full size, on top", () => {
    expect(fanPose(2, 2)).toMatchObject({ rotate: 0, scale: 1, opacity: 1, z: 100, hidden: false })
  })

  it("tilts neighbours away and fades them, symmetrically", () => {
    const left = fanPose(1, 2)
    const right = fanPose(3, 2)
    expect(left.rotate).toBe(-FAN.stepDeg)
    expect(right.rotate).toBe(FAN.stepDeg)
    expect(left.scale).toBe(right.scale)
    expect(left.scale).toBeLessThan(1)
    expect(left.opacity).toBe(right.opacity)
    expect(left.z).toBeLessThan(100)
  })

  it("hides what is past the visible band instead of painting a sliver", () => {
    expect(fanPose(0, 5).hidden).toBe(true)
    expect(fanPose(0, 5).opacity).toBe(0)
    expect(fanPose(3, 5).hidden).toBe(false)
  })

  it("interpolates mid-swipe, so the fan moves with the finger", () => {
    const mid = fanPose(1, 1.5)
    expect(mid.rotate).toBeCloseTo(-FAN.stepDeg / 2)
    expect(mid.scale).toBeGreaterThan(fanPose(1, 2).scale)
  })
})

describe("snapOffset", () => {
  it("rounds to the nearest card and never leaves the deck", () => {
    expect(snapOffset(1.4, 4)).toBe(1)
    expect(snapOffset(1.6, 4)).toBe(2)
    expect(snapOffset(-0.8, 4)).toBe(0)
    expect(snapOffset(9, 4)).toBe(3)
    expect(snapOffset(2, 0)).toBe(0)
  })
})

describe("dragOffset", () => {
  it("moves one card per step of pixels, dragging right bringing the left card in", () => {
    const px = pxPerStep()
    expect(dragOffset(2, px, 5)).toBeCloseTo(1)
    expect(dragOffset(2, -px, 5)).toBeCloseTo(3)
  })

  it("resists past either end rather than running away", () => {
    const px = pxPerStep()
    expect(dragOffset(0, px, 5)).toBeCloseTo(-1 / 3)
    expect(dragOffset(4, -px, 5)).toBeCloseTo(4 + 1 / 3)
  })
})

describe("reorderTarget", () => {
  it("lands a held card on the slot under the pointer, clamped to the deck", () => {
    const px = pxPerStep()
    expect(reorderTarget(1, px * 1.6, 5)).toBe(3)
    expect(reorderTarget(1, -px * 5, 5)).toBe(0)
    expect(reorderTarget(1, px * 50, 5)).toBe(4)
    expect(reorderTarget(1, 3, 5)).toBe(1)
  })
})

describe("reorderIds", () => {
  it("moves an item forward and backward, keeping everything else in order", () => {
    expect(reorderIds(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"])
    expect(reorderIds(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"])
  })

  it("is the same array when nothing moves or the indices are nonsense", () => {
    const ids = ["a", "b"]
    expect(reorderIds(ids, 1, 1)).toBe(ids)
    expect(reorderIds(ids, -1, 0)).toBe(ids)
    expect(reorderIds(ids, 0, 5)).toBe(ids)
  })
})

describe("displayIndexWhileHeld", () => {
  it("shifts the cards between the old and new slot to make room", () => {
    // Holding index 1 and hovering over slot 3: cards 2 and 3 slide left.
    expect([0, 1, 2, 3, 4].map((i) => displayIndexWhileHeld(i, 1, 3))).toEqual([0, 3, 1, 2, 4])
    // Holding index 3 and hovering over slot 1: cards 1 and 2 slide right.
    expect([0, 1, 2, 3, 4].map((i) => displayIndexWhileHeld(i, 3, 1))).toEqual([0, 2, 3, 1, 4])
  })

  it("changes nothing while the held card hovers over its own slot", () => {
    expect([0, 1, 2].map((i) => displayIndexWhileHeld(i, 1, 1))).toEqual([0, 1, 2])
  })
})

describe("moveIntent", () => {
  it("is a tap until the pointer leaves the slop, then commits to the dominant axis", () => {
    expect(moveIntent(3, 3)).toBe("none")
    expect(moveIntent(12, 4)).toBe("horizontal")
    expect(moveIntent(4, 12)).toBe("vertical")
    expect(moveIntent(-10, 10)).toBe("horizontal")
  })
})
