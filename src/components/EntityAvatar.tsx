import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Image-or-initials avatar for organizations and users. Renders the stored
 * image (a durable data: URL from the API) when present, otherwise up to two
 * initials derived from the name, otherwise the provided fallback icon.
 */
export function EntityAvatar({
  name,
  src,
  className = "size-7",
  rounded = "rounded-md",
  fallbackIcon,
}: {
  name: string
  src?: string | null
  className?: string
  rounded?: string
  fallbackIcon?: ReactNode
}) {
  const [failed, setFailed] = useState(false)

  if (src && !failed) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden border bg-card", rounded, className)}>
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      </span>
    )
  }

  const initials = initialsOf(name)
  return (
    <span
      className={cn(
        "flex shrink-0 select-none items-center justify-center border bg-muted text-[0.6em] font-semibold uppercase text-muted-foreground",
        rounded,
        className,
      )}
      aria-hidden
    >
      {initials || fallbackIcon}
    </span>
  )
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  if (words.length === 1) return words[0].slice(0, 2)
  return (words[0][0] ?? "") + (words[1][0] ?? "")
}
