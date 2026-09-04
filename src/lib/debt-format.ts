// Small presentation helpers for Debt & Loans (client only).
import type { Debt } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"

export const formatMonthYear = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })

export const formatShortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })

export const formatLongDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/** Money in the debt's own currency (never converted). */
export const debtMoney = (amount: number, debt: Pick<Debt, "currency">, visible = true) => formatMoney(amount, debt.currency, visible)

/** "€24,820 + ₹900,000" — one figure per currency, largest first. */
export function formatByCurrency(parts: { currency: string; amount: number }[], visible = true): string {
  if (parts.length === 0) return ""
  return parts.map((p) => formatMoney(p.amount, p.currency, visible)).join(" + ")
}

/** Add `months` to today's date and return a month-year label. */
export function monthsFromNow(months: number, today: string): string {
  const [y, m] = today.split("-").map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return formatMonthYear(`${ny}-${String(nm).padStart(2, "0")}-01`)
}
