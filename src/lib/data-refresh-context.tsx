import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

/**
 * A tiny app-wide "something changed, refresh in place" signal. The global + FAB
 * creates transactions through the shared AddTransactionDialog, which lives in the
 * layout — not on the page being viewed. So after a create it `bump()`s a revision
 * counter here, and pages that show derived data (dashboard, analytics) watch
 * `revision` and do a SILENT refetch (no skeleton). Cheap, decoupled, and avoids a
 * full-screen reload. The default `bump` is a no-op so consumers rendered outside
 * the provider (tests, isolated stories) don't crash.
 */
type DataRefreshContext = { revision: number; bump: () => void }

const Ctx = createContext<DataRefreshContext>({ revision: 0, bump: () => {} })

export function DataRefreshProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0)
  const bump = useCallback(() => setRevision((r) => r + 1), [])
  const value = useMemo(() => ({ revision, bump }), [revision, bump])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useDataRefresh = () => useContext(Ctx)
