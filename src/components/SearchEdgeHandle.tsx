import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"
import { haptic } from "@/lib/native-shell"
import {
  clampHandleTop,
  type SearchHandlePref,
} from "@/lib/search-handle"

// How far (px) an inward swipe must travel to count as "open".
const OPEN_THRESHOLD_PX = 28
// Movement below this is a tap; above it we lock onto a drag axis.
const AXIS_LOCK_PX = 8
// The bump stops following the finger past this pull distance.
const MAX_PULL_PX = 56
// The reveal circle LEADS the finger (so the thumb never covers it) and stops
// a little further out than the bump.
const LEAD_FACTOR = 1.35
const MAX_LEAD_PX = 76

/**
 * The mobile search entry point: a thin frosted "bump" hugging the screen wall
 * (WhatsApp-style edge affordance). Tap or swipe it inward to open search;
 * drag it up/down to reposition (persisted); the side is chosen in the search
 * overlay's settings. `touch-action: none` lets it own its gestures.
 *
 * Reveal choreography (transform/opacity only — stays on the compositor):
 * the search circle emerges AHEAD of the finger, growing from the wall, and
 * "arms" (primary color + haptic tick) once the pull passes the open
 * threshold — release while armed opens. Reduced motion keeps the fade but
 * drops the travel.
 */
export function SearchEdgeHandle({
  pref,
  onPrefChange,
  onOpen,
  hidden,
}: {
  pref: SearchHandlePref
  onPrefChange: (patch: Partial<SearchHandlePref>) => void
  onOpen: () => void
  hidden?: boolean
}) {
  const { t } = useTranslation()
  // Pull-out distance while horizontally dragging (drives the reveal).
  const [pullPx, setPullPx] = useState(0)
  // Live top (px) while vertically dragging; null when idle.
  const [dragTopPx, setDragTopPx] = useState<number | null>(null)
  const gesture = useRef<{ startX: number; startY: number; startTopPx: number; axis: "h" | "v" | null } | null>(null)
  const wasArmedRef = useRef(false)

  if (hidden) return null
  const onRight = pref.side === "right"

  const inwardDelta = (clientX: number, startX: number) =>
    onRight ? startX - clientX : clientX - startX

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    gesture.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTopPx: pref.topPct * window.innerHeight,
      axis: null,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.startX
    const dy = e.clientY - g.startY
    if (!g.axis) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      g.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v"
    }
    if (g.axis === "h") {
      const next = Math.max(0, Math.min(MAX_PULL_PX, inwardDelta(e.clientX, g.startX)))
      setPullPx(next)
      // A tiny tick the moment release-would-open — makes the threshold FELT.
      const armed = next >= OPEN_THRESHOLD_PX
      if (armed !== wasArmedRef.current) {
        wasArmedRef.current = armed
        if (armed) void haptic("selection")
      }
    } else {
      setDragTopPx(clampHandleTop((g.startTopPx + dy) / window.innerHeight) * window.innerHeight)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current
    gesture.current = null
    setPullPx(0)
    wasArmedRef.current = false
    if (!g) return
    if (g.axis === "v") {
      const topPx = dragTopPx ?? g.startTopPx
      setDragTopPx(null)
      onPrefChange({ topPct: clampHandleTop(topPx / window.innerHeight) })
      return
    }
    // Tap, or an inward swipe past the threshold → open.
    if (g.axis === null || inwardDelta(e.clientX, g.startX) >= OPEN_THRESHOLD_PX) {
      void haptic("light")
      onOpen()
    }
  }

  const dragging = pullPx > 0
  const armed = pullPx >= OPEN_THRESHOLD_PX
  const dir = onRight ? -1 : 1
  // The bump follows the finger; the circle leads it out of the wall.
  const bumpPull = dir * pullPx
  const lead = dir * Math.min(MAX_LEAD_PX, pullPx * LEAD_FACTOR)
  // Fully visible after just 16px of pull — the reveal reads immediately.
  const revealOpacity = Math.min(1, pullPx / 16)
  const revealScale = 0.4 + 0.6 * Math.min(1, pullPx / OPEN_THRESHOLD_PX) + (armed ? 0.08 : 0)
  // Follow the finger raw while dragging; settle with a soft spring on release.
  const settle = dragging ? "none" : "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease-out"

  return (
    <div
      className={`fixed z-50 ${onRight ? "right-0" : "left-0"}`}
      style={{ top: dragTopPx != null ? `${dragTopPx}px` : `${pref.topPct * 100}%` }}
    >
      {/* Reveal circle: emerges AHEAD of the finger, grows from the wall, and
          arms (primary) once release would open. Anchored to the WALL (not the
          translating button) so the thumb never sits on top of it. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute top-12 flex size-12 items-center justify-center rounded-full border shadow-lg backdrop-blur-xl transition-colors duration-150 motion-reduce:!transition-none ${
          onRight ? "right-0" : "left-0"
        } ${armed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/90 text-foreground"}`}
        style={{
          transform: `translate(${lead}px, -50%) scale(${revealScale})`,
          opacity: revealOpacity,
          transition: settle,
        }}
      >
        <Search className="size-5" />
      </span>

      <button
        type="button"
        aria-label={t("search.title")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { gesture.current = null; setPullPx(0); setDragTopPx(null); wasArmedRef.current = false }}
        className={`flex h-24 w-9 touch-none select-none items-center ${onRight ? "justify-end" : "justify-start"}`}
        style={{ transform: `translateX(${bumpPull}px)`, transition: dragging ? "none" : "transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
      >
        {/* The bump itself: a thin frosted bar on the wall. It hands visual
            focus to the circle as the pull progresses. */}
        <span
          className={`h-16 w-[6px] shrink-0 bg-foreground/35 shadow-sm backdrop-blur-sm transition-opacity duration-150 ${
            onRight ? "mr-0.5 rounded-l-full" : "ml-0.5 rounded-r-full"
          }`}
          style={{ opacity: dragging ? 0.15 : 1 }}
        />
      </button>
    </div>
  )
}
