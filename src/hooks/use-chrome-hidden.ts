import { useEffect, useState } from "react"
import {
  CHROME_MIN_SCROLLABLE,
  chromeFromGesture,
  initialChromeState,
  nextChromeState,
  type ChromeScrollState,
} from "@/lib/scroll-chrome"

/**
 * True while the mobile shell's chrome should be folded away.
 *
 * TWO INPUTS, ONE ANSWER. A page with something to scroll is driven by the
 * scroll position, measured once per painted frame on a rAF (a phone fires
 * scroll events far faster than it draws). A page with nothing to scroll — the
 * money-flow canvas, a budgets page with three budgets on it — never fires a
 * scroll event at all, so there the finger drives it directly. Without that
 * second path the chrome was undismissable on exactly the screens where a
 * phone is most cramped.
 *
 * The two never compete: the gesture path is consulted only while the document
 * cannot scroll, so a scrollable page keeps its tuned scroll behaviour rather
 * than folding the header away 28px into the first swipe.
 *
 * `locked` is for anything that must keep the chrome on screen wherever the
 * page is scrolled — above all the quick-actions menu, whose close button IS
 * the floating action button. Hiding it would strand the user in a menu with no
 * way out. Sheets and dialogs lock body scroll anyway, so they fire no events;
 * locking is what makes the chrome correct the moment one of them CLOSES.
 *
 * `resetKey` (the pathname) brings the chrome back on navigation: arriving on a
 * new screen with its header already gone reads as a broken page, not a
 * feature.
 */
export function useChromeHidden({ locked = false, resetKey = "" }: { locked?: boolean; resetKey?: string } = {}): boolean {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setHidden(false)
    if (locked) return

    let state: ChromeScrollState = { ...initialChromeState, y: window.scrollY, anchor: window.scrollY }
    let frame = 0

    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight
    const canScroll = () => maxScroll() >= CHROME_MIN_SCROLLABLE

    const apply = (next: boolean) => {
      if (next === state.hidden) return false
      state = { ...state, hidden: next }
      setHidden(next)
      return true
    }

    // ── Scroll path ────────────────────────────────────────────────────────
    const read = () => {
      frame = 0
      state = nextChromeState(state, window.scrollY, maxScroll())
      setHidden(state.hidden)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }

    // ── Gesture path (pages that cannot scroll) ────────────────────────────
    let touchY: number | null = null
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches.length === 1 ? e.touches[0].clientY : null
    }
    const onTouchMove = (e: TouchEvent) => {
      if (touchY === null || e.touches.length !== 1 || canScroll()) return
      const y = e.touches[0].clientY
      // Re-anchor on every change so a reversal mid-gesture answers at once
      // instead of first having to undo the travel that got us here.
      if (apply(chromeFromGesture(state.hidden, touchY - y))) touchY = y
    }
    const endTouch = () => {
      touchY = null
    }

    // Trackpads and mice emit wheel deltas on an unscrollable page too, so the
    // same affordance works when the shell is used in a narrow window.
    let wheel = 0
    const onWheel = (e: WheelEvent) => {
      if (canScroll()) return
      wheel += e.deltaY
      if (apply(chromeFromGesture(state.hidden, wheel))) wheel = 0
    }

    window.addEventListener("scroll", schedule, { passive: true })
    // A page that grows (data lands, a section expands) or a rotation can turn
    // an unscrollable page into a scrollable one and back.
    window.addEventListener("resize", schedule, { passive: true })
    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchmove", onTouchMove, { passive: true })
    window.addEventListener("touchend", endTouch, { passive: true })
    window.addEventListener("touchcancel", endTouch, { passive: true })
    window.addEventListener("wheel", onWheel, { passive: true })
    read()

    return () => {
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", endTouch)
      window.removeEventListener("touchcancel", endTouch)
      window.removeEventListener("wheel", onWheel)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [locked, resetKey])

  return hidden
}
