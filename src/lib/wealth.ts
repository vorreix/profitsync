import { useCallback, useEffect, useMemo, useState } from "react"
import type { WealthAccount } from "@/lib/types"
import { cardCredit, cardDebt, creditUsage, isLiabilityType } from "@/lib/credit-card"

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

/**
 * Net-worth arithmetic for a set of accounts. `total` is the signed sum of every
 * active balance (assets − liabilities): a credit card's negative balance
 * reduces it, and its AVAILABLE credit is never part of it. `liquid` is the
 * money the user actually holds (cash + bank, i.e. non-liability accounts) —
 * what the dashboard calls "Total available". `liabilities` is the total owed on
 * cards (positive number). Any card in credit counts toward liquid.
 */
export function summarizeWealth(accounts: WealthAccount[]) {
  const active = accounts.filter((a) => !a.archived_at)
  let liquid = 0
  let liabilities = 0
  for (const a of active) {
    const bal = Number(a.current_balance)
    if (isLiabilityType(a.type)) {
      liabilities += cardDebt(bal)
      liquid += cardCredit(bal)
    } else {
      liquid += bal
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    active,
    total: round(liquid - liabilities),
    assets: round(liquid),
    liquid: round(liquid),
    liabilities: round(liabilities),
    cards: active.filter((a) => isLiabilityType(a.type)),
  }
}

export function useWealthSummary(accounts: WealthAccount[]) {
  return useMemo(() => summarizeWealth(accounts), [accounts])
}

/**
 * The one-line balance every list/picker shows for an account. Banks/cash show
 * the balance; a credit card shows what is OWED ("€950 owed") or its credit —
 * never a bare negative number. Callers pass the translated templates so this
 * stays a pure formatter.
 */
export function accountBalanceLabel(
  account: Pick<WealthAccount, "type" | "current_balance">,
  currency: string,
  visible: boolean,
  labels: { owed: (amount: string) => string; credit: (amount: string) => string; nothingOwed: string },
): string {
  const bal = Number(account.current_balance)
  if (!isLiabilityType(account.type)) return formatMoney(bal, currency, visible)
  if (!visible) return formatMoney(0, currency, false)
  const debt = cardDebt(bal)
  if (debt > 0) return labels.owed(formatMoney(debt, currency, true))
  const credit = cardCredit(bal)
  if (credit > 0) return labels.credit(formatMoney(credit, currency, true))
  return labels.nothingOwed
}

/**
 * What an account can still put TOWARD a payment — the figure a picker needs.
 *
 * The mirror of `accountBalanceLabel`. That one answers the wealth screens'
 * question, "what is this worth, what do I owe". In front of a payment the
 * question is the opposite one: how much can come out of this? For cash and a
 * bank that is the balance. For a credit card it is the credit still LEFT —
 * never the debt, which answers a question nobody asked while picking, and
 * never the raw negative balance, which is the one thing no component may read
 * (src/lib/credit-card.ts owns that minus sign).
 *
 * A card with no credit limit set has no available figure to give, so it falls
 * back to what it owes: the only number it actually has.
 */
export function accountSpendableLabel(
  // Structural, not Pick<WealthAccount>: the card pickers hold a Card row whose
  // account figures are plain strings, and a real WealthAccount satisfies this too.
  account: { type: string | null | undefined; current_balance: number | string | null | undefined; credit_limit?: number | string | null },
  currency: string,
  visible: boolean,
  labels: { available: (amount: string) => string; owed: (amount: string) => string; nothingOwed: string },
): string {
  if (!isLiabilityType(account.type)) return formatMoney(Number(account.current_balance), currency, visible)
  const { debt, available } = creditUsage(account.credit_limit, account.current_balance)
  if (available !== null) return labels.available(formatMoney(available, currency, visible))
  if (!visible) return labels.owed(formatMoney(0, currency, false))
  return debt > 0 ? labels.owed(formatMoney(debt, currency, true)) : labels.nothingOwed
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
