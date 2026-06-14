import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { Bell, CheckCheck, Loader as Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { useNotifications } from "@/lib/notification-context"
import type { AppNotification, NotificationListResponse } from "@/lib/types"
import { NotificationItem } from "@/components/notifications/NotificationItem"

const PAGE_SIZE = 20

type Filter = "all" | "unread"

export function NotificationsPage() {
  const { t } = useTranslation("notifications")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { unreadCount, setUnreadCount, refresh } = useNotifications()

  const [filter, setFilter] = useState<Filter>("all")
  const [items, setItems] = useState<AppNotification[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Load a page. `reset` replaces the list (initial load / filter change);
  // otherwise it appends the next cursor page.
  const load = useCallback(
    async (opts: { reset: boolean; cursor?: string | null }) => {
      if (opts.reset) setLoading(true)
      else setLoadingMore(true)
      try {
        const token = await getToken()
        if (!token) return
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), filter })
        if (opts.cursor) params.set("cursor", opts.cursor)
        const res = await apiGet<NotificationListResponse>(`/api/notifications?${params.toString()}`, token)
        setItems((prev) => (opts.reset ? res.notifications : [...prev, ...res.notifications]))
        setCursor(res.next_cursor)
        setUnreadCount(res.unread_count)
      } catch {
        // non-fatal; user can retry
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [getToken, filter, setUnreadCount],
  )

  useEffect(() => {
    void load({ reset: true })
  }, [load])

  const onItemClick = useCallback(
    async (n: AppNotification) => {
      if (!n.read_at) {
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
        setUnreadCount((c) => Math.max(0, c - 1))
        try {
          const token = await getToken()
          if (token) await apiPatch(`/api/notifications/${n.id}`, token, { read: true })
        } catch {
          refresh()
        }
      }
      if (n.link) navigate(n.link)
    },
    [getToken, navigate, setUnreadCount, refresh],
  )

  const onDelete = useCallback(
    async (n: AppNotification) => {
      setItems((prev) => prev.filter((x) => x.id !== n.id))
      if (!n.read_at) setUnreadCount((c) => Math.max(0, c - 1))
      try {
        const token = await getToken()
        if (token) await apiDelete(`/api/notifications/${n.id}`, token)
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
      if (filter === "unread") void load({ reset: true })
    } catch {
      refresh()
    }
  }, [getToken, filter, load, setUnreadCount, refresh])

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("settings.description")}</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="size-4" />
            <span className="hidden sm:inline">{t("mark_all_read")}</span>
          </Button>
        )}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">{t("filter.all")}</TabsTrigger>
          <TabsTrigger value="unread">
            {t("filter.unread")}
            {unreadCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="border rounded-xl overflow-hidden divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-3 py-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bell className="size-6" />
          </span>
          <p className="text-sm font-medium">{t("empty")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("empty_hint")}</p>
        </div>
      ) : (
        <>
          <div className="border rounded-xl overflow-hidden divide-y">
            {items.map((n) => (
              <NotificationItem key={n.id} notification={n} onClick={onItemClick} onDelete={onDelete} />
            ))}
          </div>
          {cursor && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => load({ reset: false, cursor })} disabled={loadingMore}>
                {loadingMore && <Loader2 className="size-4 animate-spin" />}
                {t("load_more")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
