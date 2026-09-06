import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useDataRefresh } from "@/lib/data-refresh-context"
import { accountTypeAllows, type BudgetView, type BudgetViewWindow } from "@/lib/types"

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
  /**
   * The view window the budgets LIST is read through (week / month / year).
   * `null` until the user picks one: the server then answers in the plan's
   * natural window and reports which in `data.budgets.window`.
   */
  window: BudgetViewWindow | null
  setWindow: (w: BudgetViewWindow) => void
}

const BudgetContext = createContext<BudgetContextValue>({
  data: null,
  loading: false,
  loaded: false,
  syncing: false,
  error: null,
  refresh: async () => {},
  sync: async () => {},
  window: null,
  setWindow: () => {},
})

const WINDOWS: BudgetViewWindow[] = ["week", "month", "year"]
const windowKey = (orgId: string) => `ps_budget_window_${orgId}`

/** The window this browser last chose for this workspace, if any. */
function storedWindow(orgId: string | null): BudgetViewWindow | null {
  if (!orgId) return null
  try {
    const v = localStorage.getItem(windowKey(orgId))
    return WINDOWS.includes(v as BudgetViewWindow) ? (v as BudgetViewWindow) : null
  } catch {
    return null
  }
}

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

  // A business (or legacy) workspace has no household plan by rule — the API
  // 403s it (§23) — so fetching the view there is a wasted round trip on every
  // page load. Treat it as "no plan" locally.
  const orgId = activeOrg && accountTypeAllows(activeOrg.account_type, "budget_plan") ? activeOrg.id : null
  // The workspace a response must belong to before it may land: a late reply
  // from the PREVIOUS org (its fetch was in flight when the user switched) must
  // never render as the active org's figures.
  const orgRef = useRef(orgId)
  orgRef.current = orgId

  // The list's view window. Remembered per workspace in this browser, so the
  // page reopens the way it was left. It only ever changes what the budgets
  // LIST shows; the four numbers stay on the open period.
  const [viewWindow, setWindowState] = useState<BudgetViewWindow | null>(() => storedWindow(orgId))
  const windowRef = useRef(viewWindow)
  windowRef.current = viewWindow
  const setWindow = useCallback(
    (w: BudgetViewWindow) => {
      setWindowState(w)
      if (!orgId) return
      try {
        localStorage.setItem(windowKey(orgId), w)
      } catch {
        /* private mode */
      }
    },
    [orgId],
  )

  const fetchView = useCallback(async (): Promise<BudgetView | null> => {
    const token = await getToken()
    if (!token) return null
    const w = windowRef.current
    return await apiGet<BudgetView>(w ? `/api/budgets/v2?window=${w}` : "/api/budgets/v2", token)
  }, [getToken])

  const refresh = useCallback(async () => {
    if (!orgId) return
    const target = orgId
    setLoading(true)
    try {
      const view = await fetchView()
      if (orgRef.current !== target) return // the user switched workspace meanwhile
      if (view) {
        // A clean read re-arms the self-heal for the NEXT staleness episode (a
        // period boundary or a rule coming due while this session lives).
        // Loop-safe: a persistently stale plan never passes through a
        // `sync_required: false` read, so its guard is never released.
        if (!view.sync_required) autoSyncedFor.current = null
        setData(view)
      }
      setError(null)
    } catch (err) {
      if (orgRef.current !== target) return
      setError(err instanceof Error ? err.message : "Could not load your budget")
    } finally {
      if (orgRef.current === target) {
        setLoading(false)
        setLoaded(true)
      }
    }
  }, [fetchView, orgId])

  const sync = useCallback(async () => {
    if (!orgId) return
    const target = orgId
    setSyncing(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiPost<{ view?: BudgetView }>("/api/budgets/v2/sync", token, {}, ["/api/budgets"])
      if (orgRef.current !== target) return
      // Sync answers in the plan's natural window. Adopt its view only when
      // that is the window on screen; otherwise re-read in the chosen one, so
      // a sync never silently flips the list from "this year" to "this month".
      const w = windowRef.current
      if (res?.view && (!w || res.view.budgets?.window === w)) setData(res.view)
      else await refresh()
      setError(null)
    } catch (err) {
      if (orgRef.current !== target) return
      setError(err instanceof Error ? err.message : "Could not update your budget")
    } finally {
      if (orgRef.current === target) {
        setSyncing(false)
        setLoaded(true)
      }
    }
  }, [getToken, orgId, refresh])

  // Initial load + refetch when the org changes or any mutation bumps `revision`
  // (250 ms-debounced, driven by emitDataChanged on every write). A workspace
  // change CLEARS the view: the previous org's plan must never render under
  // the new org, even for the instant before (or after a failed) fetch.
  useEffect(() => {
    setData(null)
    setError(null)
    setLoaded(false)
    autoSyncedFor.current = null
    // The ref is what the fetch reads, and the state update lands after this
    // effect — set both, or the first read of the new workspace would use the
    // previous workspace's window.
    const remembered = storedWindow(orgId)
    windowRef.current = remembered
    setWindowState(remembered)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    if (revision > 0) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision])

  // A new window is a new read. The previous view stays on screen until the
  // next one lands (no flash to skeletons for a toggle).
  useEffect(() => {
    if (viewWindow && loaded) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewWindow])

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
    () => ({ data, loading, loaded, syncing, error, refresh, sync, window: viewWindow, setWindow }),
    [data, loading, loaded, syncing, error, refresh, sync, viewWindow, setWindow],
  )

  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
}

export const useBudget = () => useContext(BudgetContext)
