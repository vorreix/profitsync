import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
 */
type DataRefreshContext = { revision: number; bump: () => void }

const Ctx = createContext<DataRefreshContext>({ revision: 0, bump: () => {} })

const DEBOUNCE_MS = 250

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

  const value = useMemo(() => ({ revision, bump }), [revision, bump])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useDataRefresh = () => useContext(Ctx)
