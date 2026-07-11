import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Bell, CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { useNotifications } from "@/lib/notification-context"
import type { AppNotification, NotificationListResponse } from "@/lib/types"
import { NotificationItem } from "./NotificationItem"
import { openNotificationLink } from "./notification-ui"

const PANEL_LIMIT = 8

export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation("notifications")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { unreadCount, setUnreadCount, refresh } = useNotifications()
  const isMobile = useIsMobile()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Reopens render the cached rows instantly and reconcile with a SILENT
  // background refetch — the skeleton only ever shows on the first open.
  const loadRecent = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true)
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
        if (!silent) setLoading(false)
      }
    },
    [getToken, setUnreadCount],
  )

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) void loadRecent({ silent: loaded })
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
        openNotificationLink(n, navigate)
      }
    },
    [markRead, navigate],
  )

  const onViewAll = () => {
    setOpen(false)
    navigate("/notifications")
  }

  const badge = unreadCount > 99 ? "99+" : String(unreadCount)

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("bell_label")}
      className={cn("relative size-9 rounded-full text-muted-foreground hover:text-foreground", className)}
    >
      <Bell className="size-[18px]" />
      {unreadCount > 0 && (
        <span
          // Remount on count change so the badge pops when something new lands.
          key={badge}
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200"
        >
          {badge}
        </span>
      )}
    </Button>
  )

  const panel = (
    <>
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2.5">
        {isMobile ? (
          <DrawerTitle className="text-sm font-semibold">{t("title")}</DrawerTitle>
        ) : (
          <p className="text-sm font-semibold">{t("title")}</p>
        )}
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
        <div className="flex-1 space-y-0 divide-y overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-3 py-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bell className="size-5" />
          </span>
          <p className="text-sm font-medium">{t("empty")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("empty_hint")}</p>
        </div>
      ) : (
        // Plain native scroll: a percentage-height Radix viewport cannot resolve
        // against a max-h auto-height parent, which let rows paint underneath the
        // footer (the prod overlap bug). flex-1 + min-h-0 keeps the footer as a
        // reserved, never-overlapped sibling on both the popover and the drawer.
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="divide-y">
            {items.map((n, i) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onClick={onItemClick}
                className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:fill-mode-both motion-safe:duration-200"
                style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 border-t p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onViewAll}
          className="w-full rounded-md px-3 py-2 text-center text-sm font-medium text-primary transition-colors hover:bg-accent"
        >
          {t("view_all")}
        </button>
      </div>
    </>
  )

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent className="flex max-h-[85vh] flex-col" aria-describedby={undefined}>
          {panel}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[60] flex max-h-[min(28rem,70vh)] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0"
      >
        {panel}
      </PopoverContent>
    </Popover>
  )
}
