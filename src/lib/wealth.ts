import { useEffect, useMemo, useState } from "react"
import type { WealthAccount } from "@/lib/types"

const PRIVACY_KEY = "ps_wealth_balances_visible"

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
