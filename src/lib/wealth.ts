import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { WealthAccount } from "@/lib/types"
import { cardCredit, cardDebt, creditUsage, isLiabilityType } from "@/lib/credit-card"
import i18n from "@/lib/i18n"
import { intlCurrencySymbol } from "@/lib/currencies"

const PRIVACY_KEY = "ps_wealth_balances_visible"

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

/**
 * Fires when ANY component flips the privacy toggle, so every other one on the
 * page follows. Without it the state was per-component: one dashboard used to
 * carry five separate copies, and hiding balances on the Wealth card left the
 * totals beside it in plain view — which is not privacy, it is a decoration.
 */
const PRIVACY_EVENT = "ps:balance-privacy"

export function useBalancePrivacy() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(PRIVACY_KEY) !== "0"
    } catch {
      return true
    }
  })

  useEffect(() => {
    const onChange = (e: Event) => setVisible((e as CustomEvent<boolean>).detail)
    window.addEventListener(PRIVACY_EVENT, onChange)
    // Another TAB can change it too; `storage` only fires in the others.
    const onStorage = (e: StorageEvent) => { if (e.key === PRIVACY_KEY) setVisible(e.newValue !== "0") }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(PRIVACY_EVENT, onChange)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  // Read through a ref so the setter can resolve `v => !v` WITHOUT doing its
  // work inside a state updater: React double-invokes those, and dispatching an
  // event from one re-enters setState during render.
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  const setBalancesVisible = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(visibleRef.current) : next
    try {
      localStorage.setItem(PRIVACY_KEY, value ? "1" : "0")
    } catch {
      // Ignore storage failures (private mode, etc.).
    }
    // Only the broadcast sets state — for the caller too, so every instance on
    // the page goes through the exact same path and none can drift.
    window.dispatchEvent(new CustomEvent<boolean>(PRIVACY_EVENT, { detail: value }))
  }, [])

  return { balancesVisible: visible, setBalancesVisible }
}

/**
 * The symbol for a masked figure or an amount INPUT prefix ("$", "CA$", "A$",
 * "€", "KWD") — the one `formatMoney` prints in English. Pass the currency the
 * value will be SAVED in. Never throws. (`getCurrencySymbol` in
 * "@/lib/currencies" is the input-prefix variant that keeps a currency's own
 * sign — "₦" not "NGN" — when no other currency shares it.)
 */
export const currencySymbol = intlCurrencySymbol

// UI language -> number locale. Money is formatted the way the reader's language
// groups digits; rupees under an English UI use Indian grouping (₹1,23,456.78).
const LOCALE_FOR_LANGUAGE: Record<string, string> = { en: "en-US", it: "it-IT", de: "de-DE", hi: "hi-IN", ml: "ml-IN", ta: "ta-IN", te: "te-IN", ar: "ar-AE" }

export function moneyLocale(currency: string): string {
  const lang = (i18n.language ?? "en").split("-")[0]
  if (currency === "INR" && lang === "en") return "en-IN"
  return LOCALE_FOR_LANGUAGE[lang] ?? "en-US"
}

/**
 * Format an amount IN ITS OWN CURRENCY. The currency's ISO minor-unit count
 * decides the decimals (JPY has none, KWD has three), and the symbol is the
 * locale's — "CA$" / "A$" beside a plain "$" so two dollar accounts never look
 * alike. Callers must pass the money's native currency (an account's
 * `currency_code`), never the workspace currency by habit.
 */
export function formatMoney(amount: number, currency: string, visible = true) {
  if (!visible) return `${currencySymbol(currency)} *****`
  return safeCurrencyFormat(amount, currency)
}

/**
 * "$1.2K", "€87", "₹12L" — for chart axes and calendar day cells, where the
 * full figure does not fit. Same locale and symbol as `formatMoney`; the full
 * value belongs in the tooltip or drill-down beside it.
 */
export function formatMoneyCompact(amount: number, currency: string, visible = true) {
  if (!visible) return `${currencySymbol(currency)} *****`
  // Never more decimals than the currency has: "¥88", not "¥87.5".
  return safeCurrencyFormat(amount, currency, { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: Math.min(1, currencyDigits(currency)) })
}

/**
 * "$12,345" — whole units, for KPI tiles and dense lists that always showed
 * them. Only for currencies whose minor unit is a cent or less: a three-decimal
 * currency (KWD, BHD, OMR, JOD, TND) keeps its decimals, so "KWD 1.250" never
 * becomes "KWD 1" (MC-129). Anything matching a document (a quotation, a PDF)
 * uses `formatMoney`.
 */
export function formatMoneyWhole(amount: number, currency: string, visible = true) {
  if (!visible || currencyDigits(currency) > 2) return formatMoney(amount, currency, visible)
  return safeCurrencyFormat(amount, currency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** The currency's ISO minor-unit count (JPY 0, USD 2, KWD 3); 2 when unknown. */
function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/**
 * The one place money meets Intl, built so it cannot take a page down.
 * WebViews before iOS 15.4 (the app targets 15.0) throw a RangeError when a
 * fraction option crosses the currency's own default — `maximumFractionDigits:
 * 0` alone against KWD's three decimals, or even USD's two — so callers pass
 * BOTH bounds, and any refusal still falls back to the currency's plain default
 * format before giving up on Intl entirely.
 */
function safeCurrencyFormat(amount: number, currency: string, options?: Intl.NumberFormatOptions): string {
  const n = Number.isFinite(amount) ? amount : 0 // NaN would print "$NaN"
  // Anything that rounds to zero at the shown precision prints as zero: -0,
  // float residue (0.3 - 0.1 - 0.2) and a -0.004 remainder all came out "-$0.00".
  // Only the zero test rounds — every other value keeps Intl's own rounding.
  const zeroAt = (digits: number) => (Math.abs(n) * 10 ** digits < 0.5 ? 0 : n)
  for (const extra of options ? [options, {}] : [{}]) {
    try {
      const f = new Intl.NumberFormat(moneyLocale(currency), { style: "currency", currency, ...extra })
      return f.format(zeroAt(f.resolvedOptions().maximumFractionDigits ?? 2))
    } catch {
      // Try the next, plainer option set.
    }
  }
  return `${currency ?? ""} ${zeroAt(2).toFixed(2)}`.trim()
}

/** "≈ €730" — the approximate value of a foreign-currency figure in the reporting currency. */
export function formatApprox(amount: number, currency: string, visible = true) {
  return visible ? `≈ ${formatMoney(amount, currency, true)}` : `≈ ${currencySymbol(currency)} *****`
}

/** The locale the UI language reads dates in (mirrors moneyLocale, minus the INR special case). */
export function uiLocale(): string {
  const lang = (i18n.language ?? "en").split("-")[0]
  return LOCALE_FOR_LANGUAGE[lang] ?? "en-US"
}

/** "45.3%" / "45,3 %" — a share given in PERCENT (45.3, not 0.453), in the UI language. */
export function formatPercent(percent: number) {
  try {
    return new Intl.NumberFormat(uiLocale(), { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(percent / 100)
  } catch {
    return `${percent}%`
  }
}

/** "USD, EUR and GBP" in the UI language — Arabic gets its own comma and "و", not ", ". */
export function formatList(items: string[]) {
  try {
    return new Intl.ListFormat(uiLocale(), { type: "conjunction" }).format(items)
  } catch {
    return items.join(", ")
  }
}

/**
 * "9 Sep 2026" in the UI language. Accepts a plain YYYY-MM-DD (rate dates,
 * transfer dates) or a full ISO timestamp; a date-only value is pinned to local
 * midnight so it never slips a day west of UTC.
 */
export function formatDateLabel(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(uiLocale(), opts)
}

/**
 * "1 INR = €0.0103" — one unit of `base` in `quote`. Rates of 1 or more read
 * like money (two decimals). Under 1 they keep four SIGNIFICANT digits: a fixed
 * four decimals printed IDR→USD (0.0000559) as "$0.0001", 79% off, and VND as
 * "$0.00". The digits are counted into `maximumFractionDigits` rather than
 * passed as `maximumSignificantDigits`, which on older engines overrides the
 * two-decimal minimum (so 0.5 would lose its "$0.50").
 */
export function formatRate(base: string, quote: string, rate: string | number) {
  const r = Number(rate)
  if (!Number.isFinite(r) || r <= 0) return `1 ${base} = ${quote} ${rate}`
  try {
    const formatted = new Intl.NumberFormat(moneyLocale(quote), {
      style: "currency",
      currency: quote,
      minimumFractionDigits: 2,
      maximumFractionDigits: r >= 1 ? 2 : Math.min(20, Math.max(2, Math.ceil(-Math.log10(r)) + 3)),
    }).format(r)
    return `1 ${base} = ${formatted}`
  } catch {
    return `1 ${base} = ${quote} ${r}`
  }
}

/** The currency an account's balances are IN — its own, falling back to the workspace's during the legacy rollout. */
export function accountCurrency(account: Pick<WealthAccount, "currency_code"> | null | undefined, fallback: string) {
  return account?.currency_code ?? fallback
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
  let receivables = 0
  let liabilities = 0
  for (const a of active) {
    const bal = Number(a.current_balance)
    if (isLiabilityType(a.type)) {
      // Credit cards and loans: what is owed is a liability; a credit is liquid.
      liabilities += cardDebt(bal)
      liquid += cardCredit(bal)
    } else if (a.type === "receivable") {
      // Money owed TO the user: an asset, but not money in hand.
      receivables += Math.max(0, bal)
    } else {
      liquid += bal
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    active,
    total: round(liquid + receivables - liabilities),
    assets: round(liquid + receivables),
    liquid: round(liquid),
    receivables: round(receivables),
    liabilities: round(liabilities),
    cards: active.filter((a) => a.type === "credit_card"),
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
