import { useTranslation } from "react-i18next"
import { Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AppNotification } from "@/lib/types"
import { categoryIcon, categoryTone, notificationBody, notificationTitle, relativeTime } from "./notification-ui"

type Props = {
  notification: AppNotification
  onClick?: (n: AppNotification) => void
  onDelete?: (n: AppNotification) => void
  className?: string
}

// A single notification row, shared by the bell dropdown and the history page.
export function NotificationItem({ notification: n, onClick, onDelete, className }: Props) {
  const { t, i18n } = useTranslation("notifications")
  const Icon = categoryIcon(n.category)
  const unread = !n.read_at
  const title = notificationTitle(n, t)
  const body = notificationBody(n, t)

  return (
    <div
      className={cn(
        "group/notif relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors",
        onClick && "cursor-pointer hover:bg-accent",
        unread && "bg-primary/5",
        className,
      )}
      onClick={onClick ? () => onClick(n) : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onClick(n)
              }
            }
          : undefined
      }
    >
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", categoryTone(n.category))}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{title}</p>
        {body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{body}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">{relativeTime(n.created_at, t, i18n.language)}</p>
      </div>
      {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
      {onDelete && (
        <button
          type="button"
          aria-label={t("delete")}
          className="absolute right-2 top-2 hidden rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground group-hover/notif:block"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(n)
          }}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}
