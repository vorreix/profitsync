import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

/**
 * Lets a list/dashboard page publish its current applied-filter count and a way
 * to open its filter sheet, so the mobile shell can render a floating filter
 * shortcut just above the FAB (req: "filter icon with number of filters applied
 * as an overlay just above the + icon"). The page owns the sheet + state; the
 * shell only needs the count and an opener.
 *
 * Split into two contexts on purpose: the *state* context changes on every
 * filter update (re-rendering the shell), while the *api* context is stable so a
 * page's registration effect doesn't re-fire on every keystroke.
 */
type PageFilterState = { count: number; onOpen: (() => void) | null }

const PageFilterStateContext = createContext<PageFilterState>({ count: 0, onOpen: null })
const PageFilterApiContext = createContext<{
  set: (s: PageFilterState) => void
  clear: () => void
}>({ set: () => {}, clear: () => {} })

export function PageFilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageFilterState>({ count: 0, onOpen: null })
  const api = useMemo(
    () => ({
      set: (s: PageFilterState) => setState(s),
      clear: () => setState({ count: 0, onOpen: null }),
    }),
    [],
  )
  return (
    <PageFilterApiContext.Provider value={api}>
      <PageFilterStateContext.Provider value={state}>{children}</PageFilterStateContext.Provider>
    </PageFilterApiContext.Provider>
  )
}

/** Read by the shell (MobileAppLayout) to render the floating filter button. */
export function usePageFilterState() {
  return useContext(PageFilterStateContext)
}

/**
 * Called by a page to publish its filter state. `onOpen` may be a fresh closure
 * every render — it's stored in a ref so we only re-register when `count` or
 * `enabled` actually change (no churn from typing in a search box).
 */
export function useRegisterPageFilter({
  count,
  onOpen,
  enabled = true,
}: {
  count: number
  onOpen: () => void
  enabled?: boolean
}) {
  const api = useContext(PageFilterApiContext)
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  useEffect(() => {
    if (!enabled) {
      api.clear()
      return
    }
    api.set({ count, onOpen: () => onOpenRef.current() })
    return () => api.clear()
  }, [api, count, enabled])
}
