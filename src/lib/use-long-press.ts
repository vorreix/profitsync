import { useCallback, useRef } from "react"

/**
 * Press-and-hold detection for touch/pen that fires after `delay` ms unless the
 * pointer is released or moves too far first (so it never fights with scrolling).
 *
 * Call once per list; `bind(onLongPress)` returns the props to spread on each
 * row (closing over shared timer refs — only one press happens at a time). Use
 * `didLongPress()` inside the row's onClick to suppress the normal tap action
 * right after a long-press. Mouse is ignored (desktop uses checkboxes).
 */
export function useLongPress({
  delay = 450,
  moveTolerance = 10,
}: { delay?: number; moveTolerance?: number } = {}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    start.current = null
  }, [])

  const bind = useCallback(
    (onLongPress: () => void) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") return
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          fired.current = true
          onLongPress()
        }, delay)
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!start.current) return
        if (
          Math.abs(e.clientX - start.current.x) > moveTolerance ||
          Math.abs(e.clientY - start.current.y) > moveTolerance
        ) {
          clearTimer()
        }
      },
      onPointerUp: clearTimer,
      onPointerLeave: clearTimer,
      onPointerCancel: clearTimer,
      onContextMenu: (e: React.MouseEvent) => {
        if (fired.current) e.preventDefault()
      },
    }),
    [delay, moveTolerance, clearTimer],
  )

  const didLongPress = useCallback(() => fired.current, [])

  return { bind, didLongPress }
}
