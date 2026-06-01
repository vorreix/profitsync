import { cn } from "../lib/cn"
import { useSpaNav } from "../lib/useSpaNav"

// Brand lockup. The current logo.png is a square mark + wordmark on white; we
// show it inside a light "chip" (zoomed to the mark) next to a text wordmark so
// it reads as a clean horizontal lockup in both light and dark mode. When the
// logo is replaced later, only this component changes.
export function Logo({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  const spaNav = useSpaNav()
  return (
    <a
      href="/"
      onClick={spaNav("/")}
      aria-label="ProfitSync — home"
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-border dark:ring-white/15">
        <img
          src="/logo-mark.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none size-7 select-none object-contain"
        />
      </span>
      {wordmark && (
        <span className="ps-display text-[17px] font-bold tracking-tight text-foreground">
          ProfitSync
        </span>
      )}
    </a>
  )
}
