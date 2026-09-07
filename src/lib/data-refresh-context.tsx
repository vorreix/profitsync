import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { invalidateKeys } from "@/lib/api"
import { MONEY_PREFIXES } from "@/lib/api-cache"
import { DATA_CHANGED_EVENT } from "@/lib/data-events"

/**
 * A tiny app-wide "something changed, refresh in place" signal. Every successful
 * mutation in the API client emits DATA_CHANGED_EVENT (src/lib/data-events.ts);
 * the provider coalesces bursts (e.g. a category diff saving several rows) into
 * one `revision` bump ~250 ms later. Pages that show derived data (dashboard,
 * analytics, calendar, money flow, budget cards) watch `revision` and do a
 * SILENT refetch — no skeleton, no navigation, no full-screen reload.
 * `bump()` stays available for manual signaling. The default context is a no-op
 * so consumers rendered outside the provider (tests, isolated stories) don't crash.
 * Returning to a tab that has been hidden for a while also bumps, after dropping
 * the balance-bearing reads — see below.
 */
type DataRefreshContext = { revision: number; bump: () => void }

const Ctx = createContext<DataRefreshContext>({ revision: 0, bump: () => {} })

const DEBOUNCE_MS = 250
/** How long a tab must have been hidden before returning to it forces fresh money. */
const AWAY_MS = 60_000

export function DataRefreshProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const bump = useCallback(() => setRevision((r) => r + 1), [])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const onChanged = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        setRevision((r) => r + 1)
      }, DEBOUNCE_MS)
    }
    window.addEventListener(DATA_CHANGED_EVENT, onChanged)
    return () => {
      window.removeEventListener(DATA_CHANGED_EVENT, onChanged)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  // A tab left open all afternoon is the one case the cache can't reach on its
  // own: nothing is fetching, so nothing revalidates, and the figures on screen
  // quietly age. Coming back to it drops the balance-bearing reads and bumps,
  // so the visible pages refetch for real rather than repainting what they had.
  // Gated on a long absence — an alt-tab to check something costs nothing.
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now()
        return
      }
      const since = hiddenAt.current
      hiddenAt.current = null
      if (since === null || Date.now() - since < AWAY_MS) return
      invalidateKeys(MONEY_PREFIXES)
      setRevision((r) => r + 1)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  const value = useMemo(() => ({ revision, bump }), [revision, bump])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useDataRefresh = () => useContext(Ctx)
