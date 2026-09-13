import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Expand/collapse to the content's natural height, on the compositor.
 *
 * `height: auto` cannot be animated, so this animates `grid-template-rows`
 * from `0fr` to `1fr` with an `overflow-hidden` child — no measuring, no
 * layout thrash, and it works for content whose height nobody knows.
 *
 * `inert` while closed so the hidden content keeps neither focus nor a place
 * in the accessibility tree.
 */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      inert={open ? undefined : true}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}
