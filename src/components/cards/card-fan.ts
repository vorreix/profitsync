// The geometry and gesture arithmetic behind the mobile card fan — a hand of
// cards pivoting from a point below the screen. Pure and unit-tested, so the
// component only renders what these return.
//
// The model: every card sits at the same spot on the stage and is rotated about
// a pivot `radius` px below its centre. Card i's rotation is (i − offset) steps
// of `stepDeg`; `offset` is the fan's current rotation in card units, so the
// card whose index equals `offset` is upright at the centre. A swipe changes
// `offset` continuously, then it snaps to the nearest card.

export const FAN = {
  /** Degrees between neighbouring cards. */
  stepDeg: 6,
  /** Distance from a card's centre down to the pivot, px. Larger = flatter arc. */
  radius: 640,
  /** Cards further than this many steps from the centre are hidden entirely. */
  visible: 2,
  /** Movement below this (px) is a tap, not a swipe. */
  slop: 8,
  /** Pointer held still this long picks the centre card up for reordering. */
  holdMs: 380,
} as const

/** Horizontal pixels one card step sweeps at the card's centre. */
export function pxPerStep(radius = FAN.radius, stepDeg = FAN.stepDeg): number {
  return radius * Math.sin((stepDeg * Math.PI) / 180)
}

export type FanPose = {
  /** Degrees, positive clockwise. */
  rotate: number
  scale: number
  opacity: number
  z: number
  /** Beyond the visible band — skip painting it. */
  hidden: boolean
}

/**
 * Where card `i` sits when the fan is rotated to `offset` (continuous, in card
 * units). Neighbours shrink and fade a little so the centre card reads as the
 * one in hand; anything past the visible band is dropped from the paint.
 */
export function fanPose(i: number, offset: number): FanPose {
  const k = i - offset
  const a = Math.abs(k)
  return {
    rotate: k * FAN.stepDeg,
    scale: Math.max(0.84, 1 - 0.05 * a),
    opacity: a > FAN.visible + 0.5 ? 0 : Math.max(0.3, 1 - 0.24 * a),
    z: Math.round(100 - a * 10),
    hidden: a > FAN.visible + 1,
  }
}

/** The card index a continuous offset settles on. */
export function snapOffset(offset: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, Math.round(offset)))
}

/** The rotation a horizontal drag produces from `startOffset` (dragging right brings the left neighbour in). */
export function dragOffset(startOffset: number, dx: number, count: number, px = pxPerStep()): number {
  const raw = startOffset - dx / px
  // Soft edges: past the first/last card the fan resists rather than running away.
  if (raw < 0) return raw / 3
  if (raw > count - 1) return count - 1 + (raw - (count - 1)) / 3
  return raw
}

/** Where a held card lands after being dragged `dx` px from index `from`. */
export function reorderTarget(from: number, dx: number, count: number, px = pxPerStep()): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, from + Math.round(dx / px)))
}

/** Move the item at `from` to index `to` (the other items keep their order). */
export function reorderIds<T>(ids: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids
  const next = [...ids]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/**
 * While a card is held, the others make room for it: this is the display index
 * of every OTHER card when the held one (originally at `from`) is hovering over
 * slot `target`. The held card itself is drawn at the pointer, not here.
 */
export function displayIndexWhileHeld(i: number, from: number, target: number): number {
  if (i === from) return target
  if (from < target) return i > from && i <= target ? i - 1 : i
  return i >= target && i < from ? i + 1 : i
}

export type MoveIntent = "none" | "horizontal" | "vertical"

/** Which way a pointer has committed to moving, once it has left the tap slop. */
export function moveIntent(dx: number, dy: number, slop = FAN.slop): MoveIntent {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return "none"
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical"
}
