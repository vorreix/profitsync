import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

// Single-line text that shrinks to fit its container's width. Used for currency
// figures in summary cards: a large amount — or a currency that renders a wide
// code such as "PKR"/"CHF", or wider grouping like "₹1,23,45,678" — would
// otherwise be clipped with an ellipsis on a narrow mobile tile (or even a
// desktop column for big numbers). This keeps the whole figure visible by
// scaling it down just enough to fit.
//
// Only ever scales DOWN (to `minScale`), never up past the CSS font size. The
// scale is applied with a CSS transform, which does not affect layout — so the
// measured `scrollWidth` stays at full size and the ResizeObserver can't feed
// back into itself.
export function FitText({
  children,
  className,
  textClassName,
  minScale = 0.5,
}: {
  children: ReactNode
  className?: string
  textClassName?: string
  minScale?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const container = containerRef.current
    const text = textRef.current
    if (!container || !text) return
    let cancelled = false

    const fit = () => {
      if (cancelled) return
      const available = container.clientWidth
      const needed = text.scrollWidth
      if (!available || !needed) return
      setScale(Math.min(1, Math.max(minScale, available / needed)))
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(container)
    // Re-fit once web fonts settle — their glyph metrics differ from the
    // fallback fonts measured on first paint.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(fit).catch(() => {})
    }
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [children, minScale])

  return (
    <div ref={containerRef} className={cn("min-w-0 overflow-hidden", className)}>
      <span
        ref={textRef}
        className={cn("inline-block origin-left whitespace-nowrap", textClassName)}
        style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
      >
        {children}
      </span>
    </div>
  )
}
