import { useCallback, useEffect, useMemo, useState } from "react"
import type { WealthAccount } from "@/lib/types"

const PRIVACY_KEY = "ps_wealth_balances_visible"
const COLLAPSED_KEY = "ps_wealth_overview_collapsed"

/**
 * Disclosure (open/closed) state for a collapsible, persisted to localStorage so
 * the user's choice survives navigation AND a full restart. Keyed (e.g. by account
 * id) so each surface remembers its own state independently; re-reads when the key
 * changes (the component may be reused across accounts without remounting).
 */
export function usePersistedOpen(key: string, fallback = true) {
  const read = (k: string) => {
    try {
      const v = localStorage.getItem(k)
      return v === null ? fallback : v === "1"
    } catch {
      return fallback
    }
  }
  const [open, setOpenState] = useState(() => read(key))

  useEffect(() => {
    setOpenState(read(key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      try {
        localStorage.setItem(key, next ? "1" : "0")
      } catch {
        // Ignore storage failures (private mode, etc.).
      }
    },
    [key],
  )

  return [open, setOpen] as const
}

export function useBalancePrivacy() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(PRIVACY_KEY) !== "0"
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(PRIVACY_KEY, visible ? "1" : "0")
    } catch {
      // Ignore storage failures.
    }
  }, [visible])

  return { balancesVisible: visible, setBalancesVisible: setVisible }
}

// Whether the dashboard Wealth Overview's account list is collapsed. Persisted
// so the user's choice (e.g. "keep it tucked away") survives reloads/sessions.
export function useWealthOverviewCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1"
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0")
    } catch {
      // Ignore storage failures.
    }
  }, [collapsed])

  return { collapsed, setCollapsed }
}

export function currencySymbol(currency: string) {
  const part = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).formatToParts(0).find((p) => p.type === "currency")
  return part?.value ?? currency
}

export function formatMoney(amount: number, currency: string, visible = true) {
  if (!visible) return `${currencySymbol(currency)} *****`
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function accountDisplayName(account: Pick<WealthAccount, "bank_name" | "nickname">) {
  return account.nickname.trim() || account.bank_name
}

export function useWealthSummary(accounts: WealthAccount[]) {
  return useMemo(() => {
    const active = accounts.filter((a) => !a.archived_at)
    const total = active.reduce((sum, account) => sum + Number(account.current_balance), 0)
    return { active, total }
  }, [accounts])
}

// Immutable move of arr[from] to land *before* index `before` (in the original
// indexing). Used for drag-to-reorder; order is persisted server-side.
export function moveBefore<T>(arr: T[], from: number, before: number): T[] {
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  const idx = from < before ? before - 1 : before
  next.splice(idx, 0, item)
  return next
}
