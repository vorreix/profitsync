import { Paperclip } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Compact "this record has files" indicator for list rows/cards: a paperclip
 * with a small superscript count. Renders nothing when there are no files.
 */
export function AttachmentBadge({ count, className }: { count?: number; className?: string }) {
  if (!count || count < 1) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-muted-foreground shrink-0",
        className,
      )}
      title={`${count}`}
      aria-label={`${count} attachment${count === 1 ? "" : "s"}`}
    >
      <Paperclip className="size-3.5" />
      <span className="text-[10px] font-semibold leading-none tabular-nums">{count}</span>
    </span>
  )
}
