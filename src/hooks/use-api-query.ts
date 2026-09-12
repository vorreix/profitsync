import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, peekApiCache, subscribeApiPath } from "@/lib/api"
import { useDataRefresh } from "@/lib/data-refresh-context"

export type ApiQuery<T> = {
  data: T | undefined
  /** No usable copy yet — this is the only state that should show a skeleton. */
  loading: boolean
  /** Showing something while a newer copy is on its way. Style it quietly, or not at all. */
  refreshing: boolean
  error: Error | null
  refetch: () => void
}

/**
 * Read one API path, painted from cache the instant it can be.
 *
 * The point is the first render: `peekApiCache` is synchronous, so a screen the
 * user has already visited comes back with its data in hand and never shows a
 * skeleton — `loading` is true only when there is genuinely nothing to draw.
 * Anything already on screen stays on screen while a fresher copy arrives.
 *
 * It refetches on three signals: the path changing, any mutation anywhere (the
 * shared `revision`), and a background revalidation landing under it — that
 * last one is why this subscribes rather than just awaiting a promise, since a
 * promise resolves once and the fresher body arrives after it.
 *
 * Pass `null` as the path to stand down (a dependency isn't ready, a dialog is
 * closed) without breaking the rules of hooks.
 */
export function useApiQuery<T>(path: string | null): ApiQuery<T> {
  const { getToken, userId } = useAuth()
  const { revision } = useDataRefresh()
  const [data, setData] = useState<T | undefined>(() => (path ? peekApiCache<T>(path, userId) : undefined))
  const [error, setError] = useState<Error | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [nonce, setNonce] = useState(0)
  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  // Which path the state in `data` belongs to. Without this, switching paths
  // shows the previous path's body until the new one lands — on a detail page
  // that means one client's figures under another's name.
  const shownFor = useRef<string | null>(path)
  if (shownFor.current !== path) {
    shownFor.current = path
    const cached = path ? peekApiCache<T>(path, userId) : undefined
    setData(cached)
    setError(null)
  }

  useEffect(() => {
    if (!path) return
    let alive = true
    setRefreshing(true)
    void (async () => {
      try {
        const token = await getToken()
        if (!token) throw new Error("Not authenticated")
        const next = await apiGet<T>(path, token)
        if (!alive) return
        setData(next)
        setError(null)
      } catch (err) {
        if (!alive) return
        // Keep whatever is on screen. A failed refresh of a list the user is
        // already reading is not a reason to replace it with an error.
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (alive) setRefreshing(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [path, getToken, revision, nonce])

  // A background revalidation writing a different body under this path.
  useEffect(() => {
    if (!path) return
    return subscribeApiPath(path, () => {
      const fresh = peekApiCache<T>(path, userId)
      if (fresh !== undefined) setData(fresh)
    })
  }, [path, userId])

  return { data, loading: data === undefined && !error, refreshing, error, refetch }
}
