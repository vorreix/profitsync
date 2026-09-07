import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useDataRefresh } from "@/lib/data-refresh-context"
import type { BudgetView } from "@/lib/types"

/**
 * The single source of budget state for the whole app.
 *
 * Budget v1 had no hook at all: six-plus components each called
 * `apiGet("/api/budgets")` in their own effect and built their own Map, so
 * coherence rested entirely on the 30 s GET cache. This provider replaces that
 * fan-out with ONE request per org (spec §11.5).
 *
 * It also owns the self-heal for the read-purity rule (§8.10): budget reads
 * never write, so when the API reports `sync_required` we call the idempotent
 * sync endpoint ONCE and swap in the returned view. The user sees a brief
 * "updating…" state rather than a number we know to be stale.
 */
type BudgetContextValue = {
  data: BudgetView | null
  loading: boolean
  /** True once the first fetch has settled — gate empty states on this, never on `!data`. */
  loaded: boolean
  syncing: boolean
  error: string | null
  refresh: () => Promise<void>
  sync: () => Promise<void>
}

const BudgetContext = createContext<BudgetContextValue>({
  data: null,
  loading: false,
  loaded: false,
  syncing: false,
  error: null,
  refresh: async () => {},
  sync: async () => {},
})

export function BudgetProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { revision } = useDataRefresh()

  const [data, setData] = useState<BudgetView | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // At most ONE automatic sync per mount, so a persistent `sync_required` (a
  // rule the materializer keeps refusing, say) can never become a request loop.
  const autoSyncedFor = useRef<string | null>(null)

  const orgId = activeOrg?.id ?? null

  const fetchView = useCallback(async (): Promise<BudgetView | null> => {
    const token = await getToken()
    if (!token) return null
    return await apiGet<BudgetView>("/api/budgets/v2", token)
  }, [getToken])

  const refresh = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const view = await fetchView()
      if (view) setData(view)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your budget")
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [fetchView, orgId])

  const sync = useCallback(async () => {
    if (!orgId) return
    setSyncing(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiPost<{ view?: BudgetView }>("/api/budgets/v2/sync", token, {})
      if (res?.view) setData(res.view)
      else await refresh()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your budget")
    } finally {
      setSyncing(false)
      setLoaded(true)
    }
  }, [getToken, orgId, refresh])

  // Initial load + refetch when the org changes or any mutation bumps `revision`
  // (250 ms-debounced, driven by emitDataChanged on every write).
  useEffect(() => {
    setLoaded(false)
    autoSyncedFor.current = null
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    if (revision > 0) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  // Self-heal: a read told us it is stale, so resolve it with the one write
  // endpoint rather than rendering a figure we know to be out of date.
  useEffect(() => {
    if (!data?.sync_required || !orgId) return
    if (autoSyncedFor.current === orgId) return
    if (!data.capabilities?.can_write) return // a viewer cannot sync; show what we have
    autoSyncedFor.current = orgId
    void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sync_required, orgId])

  const value = useMemo<BudgetContextValue>(
    () => ({ data, loading, loaded, syncing, error, refresh, sync }),
    [data, loading, loaded, syncing, error, refresh, sync],
  )

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
}

export const useBudget = () => useContext(BudgetContext)
