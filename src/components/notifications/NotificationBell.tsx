import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Bell, CheckCheck, Loader as Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { useNotifications } from "@/lib/notification-context"
import type { AppNotification, NotificationListResponse } from "@/lib/types"
import { NotificationItem } from "./NotificationItem"

const PANEL_LIMIT = 8

export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation("notifications")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { unreadCount, setUnreadCount, refresh } = useNotifications()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Lazy: the recent list is only fetched when the panel opens.
  const loadRecent = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<NotificationListResponse>(`/api/notifications?limit=${PANEL_LIMIT}`, token)
      setItems(res.notifications)
      setUnreadCount(res.unread_count)
      setLoaded(true)
    } catch {
      // non-fatal; the panel shows whatever it had
    } finally {
      setLoading(false)
    }
  }, [getToken, setUnreadCount])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void loadRecent()
  }

  const markRead = useCallback(
    async (n: AppNotification) => {
      if (n.read_at) return
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
      try {
        const token = await getToken()
        if (token) await apiPatch(`/api/notifications/${n.id}`, token, { read: true })
      } catch {
        refresh()
      }
    },
    [getToken, setUnreadCount, refresh],
  )

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })))
    setUnreadCount(0)
    try {
      const token = await getToken()
      if (token) await apiPost("/api/notifications/read-all", token, {})
    } catch {
      refresh()
    }
  }, [getToken, setUnreadCount, refresh])

  const onItemClick = useCallback(
    (n: AppNotification) => {
      void markRead(n)
      if (n.link) {
        setOpen(false)
        navigate(n.link)
      }
    },
    [markRead, navigate],
  )

  const badge = unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("bell_label")}
          className={cn("relative size-9 rounded-full text-muted-foreground hover:text-foreground", className)}
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[60] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">{t("title")}</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <CheckCheck className="size-3.5" />
              {t("mark_all_read")}
            </button>
          )}
        </div>

        {loading && !loaded ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="size-5" />
            </span>
            <p className="text-sm font-medium">{t("empty")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("empty_hint")}</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[min(24rem,60vh)]">
            <div className="divide-y">
              {items.map((n) => (
                <NotificationItem key={n.id} notification={n} onClick={onItemClick} />
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
