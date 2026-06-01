import type { ReactNode } from "react"
import { cn } from "../lib/cn"
import { useReveal } from "../lib/useReveal"

// Fades + lifts content into view on scroll. Reduced-motion users see it
// immediately (handled inside useReveal).
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const { ref, inView } = useReveal<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
        inView ? "translate-y-0 opacity-100 blur-0" : "translate-y-6 opacity-0 blur-[2px]",
        className,
      )}
      style={{ transitionDelay: inView ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  )
}
