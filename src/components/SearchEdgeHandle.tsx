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
// The reveal circle stops following the finger past this pull distance.
const MAX_PULL_PX = 56

/**
 * The mobile search entry point: a thin frosted "bump" hugging the screen wall
 * (WhatsApp-style edge affordance). Tap or swipe it inward to open search;
 * drag it up/down to reposition (persisted); the side is chosen in the search
 * overlay's settings. `touch-action: none` lets it own its gestures.
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
  // Pull-out distance while horizontally dragging (drives the reveal circle).
  const [pullPx, setPullPx] = useState(0)
  // Live top (px) while vertically dragging; null when idle.
  const [dragTopPx, setDragTopPx] = useState<number | null>(null)
  const gesture = useRef<{ startX: number; startY: number; startTopPx: number; axis: "h" | "v" | null } | null>(null)

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
      setPullPx(Math.max(0, Math.min(MAX_PULL_PX, inwardDelta(e.clientX, g.startX))))
    } else {
      setDragTopPx(clampHandleTop((g.startTopPx + dy) / window.innerHeight) * window.innerHeight)
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const g = gesture.current
    gesture.current = null
    setPullPx(0)
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

  const pull = onRight ? -pullPx : pullPx
  return (
    <div
      className={`fixed z-50 ${onRight ? "right-0" : "left-0"}`}
      style={{ top: dragTopPx != null ? `${dragTopPx}px` : `${pref.topPct * 100}%` }}
    >
      <button
        type="button"
        aria-label={t("search.title")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { gesture.current = null; setPullPx(0); setDragTopPx(null) }}
        className={`flex h-24 w-9 touch-none select-none items-center ${onRight ? "justify-end" : "justify-start"}`}
        style={{ transform: `translateX(${pull}px)`, transition: pullPx === 0 ? "transform 150ms ease-out" : "none" }}
      >
        {/* Reveal circle: slides out from the wall as the bump is pulled inward. */}
        <span
          className={`absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border bg-background/80 shadow-lg backdrop-blur-xl ${onRight ? "left-1" : "right-1"}`}
          style={{ opacity: Math.min(1, pullPx / OPEN_THRESHOLD_PX), pointerEvents: "none" }}
        >
          <Search className="size-4" />
        </span>
        {/* The bump itself: a thin frosted bar on the wall. */}
        <span
          className={`h-16 w-[6px] shrink-0 bg-foreground/35 shadow-sm backdrop-blur-sm ${
            onRight ? "mr-0.5 rounded-l-full" : "ml-0.5 rounded-r-full"
          }`}
        />
      </button>
    </div>
  )
}
