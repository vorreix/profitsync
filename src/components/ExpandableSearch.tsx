import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

// A search control that sits collapsed as an icon button and expands into a full
// input with a smooth width animation when activated. Used app-wide so every
// search behaves and animates the same way. Controlled via value/onChange.
export function ExpandableSearch({
  value,
  onChange,
  placeholder = "Search…",
  className,
  expandedClassName = "w-44 sm:w-64",
  autoCollapse = true,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  // Width while expanded (animated to from the collapsed icon size).
  expandedClassName?: string
  // Collapse back to an icon on blur when the query is empty.
  autoCollapse?: boolean
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Stay expanded whenever there's an active query (e.g. set from outside).
  useEffect(() => {
    if (value) setOpen(true)
  }, [value])

  function expand() {
    setOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function collapse() {
    onChange("")
    setOpen(false)
  }

  return (
    <div
      className={cn(
        "relative flex h-9 items-center overflow-hidden rounded-md border bg-background transition-[width] duration-300 ease-out",
        open ? expandedClassName : "w-9",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => (open ? inputRef.current?.focus() : expand())}
        aria-label="Search"
        tabIndex={open ? -1 : 0}
        className="absolute left-0 z-10 grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search className="size-4" />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (autoCollapse && !value) setOpen(false) }}
        onKeyDown={(e) => { if (e.key === "Escape") collapse() }}
        className={cn(
          "h-9 w-full rounded-md bg-transparent pl-9 pr-8 text-sm outline-none transition-opacity duration-200",
          open ? "opacity-100 delay-100" : "pointer-events-none opacity-0",
        )}
      />
      {open && (
        <button
          type="button"
          onClick={collapse}
          aria-label="Clear search"
          className="absolute right-1.5 z-10 grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
