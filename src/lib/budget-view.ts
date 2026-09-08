import { useCallback, useEffect, useState } from "react"
import { isViewWindow } from "@/lib/budget"
import type { SpendingViewWindow } from "@/lib/types"

const KEY = (orgId: string | undefined) => `ps_budget_view_${orgId ?? ""}`

/**
 * The window budgets are read in, remembered per workspace.
 *
 * MONTHLY is the default, and deliberately so: rent, salary and most
 * subscriptions arrive in months, so it is the one rhythm where an unfamiliar
 * budget's figure needs no translation before it means something.
 *
 * The dashboard card reads this same preference rather than each budget's own
 * rhythm, which is the only way the two surfaces can agree on what "left"
 * means — a weekly budget shown next to a monthly one, each in its own window,
 * puts two numbers of different sizes side by side and invites them to be
 * compared.
 *
 * Switching workspace RESETS to monthly when the new one has no saved choice.
 * Carrying the previous workspace's window over would silently re-scale every
 * figure on a screen the user has never set a preference on.
 */
export function useBudgetView(orgId: string | undefined) {
  const [view, setViewState] = useState<SpendingViewWindow>("monthly")

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY(orgId))
      setViewState(isViewWindow(saved) ? saved : "monthly")
    } catch {
      setViewState("monthly")
    }
  }, [orgId])

  const setView = useCallback(
    (next: SpendingViewWindow) => {
      setViewState(next)
      try {
        localStorage.setItem(KEY(orgId), next)
      } catch {
        /* private mode — the choice just does not survive the reload */
      }
    },
    [orgId],
  )

  return [view, setView] as const
}
