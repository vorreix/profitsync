import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import { useOrg } from "@/lib/org-context"

// App-wide unread-notification state. Deliberately LIGHTWEIGHT: at boot and on a
// ~60s poll it fetches only the tiny /unread-count endpoint — never the list. The
// bell dropdown and the history page fetch the actual rows lazily on demand. This
// keeps the cold path cheap (one cheap COUNT) per the "optimized + lazy loading"
// requirement.

type NotificationContextValue = {
  unreadCount: number
  /** Refetch the unread count from the server. */
  refresh: () => void
  /** Optimistically set/adjust the badge (the dropdown/page call this on mutations). */
  setUnreadCount: (next: number | ((prev: number) => number)) => void
}

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  refresh: () => {},
  setUnreadCount: () => {},
})

const POLL_INTERVAL_MS = 60_000

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { getToken, isSignedIn } = useAuth()
  const { activeOrg } = useOrg()
  const [unreadCount, setUnreadCount] = useState(0)

  // Keep the latest fetch in a ref so the interval/visibility listeners always
  // call the current closure without re-subscribing on every count change.
  const fetchRef = useRef<() => void>(() => {})

  const refresh = useCallback(() => {
    if (!isSignedIn) {
      setUnreadCount(0)
      return
    }
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ count: number }>("/api/notifications/unread-count", token)
        setUnreadCount(res.count ?? 0)
      } catch {
        // Non-fatal: keep the last known count; the next poll will retry.
      }
    })()
  }, [getToken, isSignedIn])

  useEffect(() => {
    fetchRef.current = refresh
  }, [refresh])

  // Initial fetch + refetch whenever the active org changes (counts are org-scoped).
  useEffect(() => {
    refresh()
  }, [refresh, activeOrg?.id])

  // Poll on an interval and whenever the app returns to the foreground — an
  // installed PWA can sit backgrounded for a long time.
  useEffect(() => {
    if (!isSignedIn) return
    const tick = () => fetchRef.current()
    const interval = window.setInterval(tick, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [isSignedIn])

  const value = useMemo(
    () => ({ unreadCount, refresh, setUnreadCount }),
    [unreadCount, refresh],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export const useNotifications = () => useContext(NotificationContext)
