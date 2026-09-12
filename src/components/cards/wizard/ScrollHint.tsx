import { useEffect, useState, type RefObject } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import "./scroll-hint.css"


/**
 * "There is more below" — a small chevron that bobs in the bottom-end corner of
 * a scroll area, over a short fade, and dissolves as the last rows come into
 * view. Purely an affordance: `aria-hidden` + `pointer-events-none`, because a
 * real 44px button in that corner would sit on top of the last field and steal
 * its taps; dragging anywhere in the area already scrolls it.
 *
 * Sizing is measured, not guessed: the scroll element for the viewport and the
 * (stable) content element for its height, so a step swap, a bank list arriving
 * late or a phone keyboard opening all re-evaluate it.
 */
export function ScrollHint({
  scrollRef,
  contentRef,
  className,
}: {
  scrollRef: RefObject<HTMLElement | null>
  contentRef?: RefObject<HTMLElement | null>
  className?: string
}) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // A few pixels of slack: rounding and sub-pixel heights should not keep the
    // hint alive at the very bottom.
    const update = () => setShow(el.scrollHeight - el.scrollTop - el.clientHeight > 24)
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const content = contentRef?.current
    if (content) ro.observe(content)
    // Images (bank logos) and fonts land after layout.
    const timer = window.setTimeout(update, 400)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
      window.clearTimeout(timer)
    }
  }, [scrollRef, contentRef])

  return (
    <div
      aria-hidden
      data-scroll-hint={show ? "on" : "off"}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 transition-opacity duration-300 ease-out motion-reduce:transition-none",
        show ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <div className="h-10 bg-gradient-to-t from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-2 flex justify-end pe-3">
        <span className="ps-scroll-bob flex size-7 items-center justify-center rounded-full border bg-background/85 text-muted-foreground shadow-sm backdrop-blur-sm">
          <ChevronDown className="size-4" />
        </span>
      </div>
    </div>
  )
}
