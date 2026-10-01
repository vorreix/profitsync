// Reading the multi-currency facts a payload carries, without assuming they are
// there. Every aggregate route now answers in the workspace's REPORTING currency
// (`currency`) and says how many rows it could not convert (`excluded_count`);
// every transaction row keeps its NATIVE `amount` + `currency_code` and adds
// `reporting_amount` (converted at the row's own date, null when no rate is
// stored). A cached body from before this shipped has none of these, so each
// accessor falls back — to the org currency, to zero, to "not convertible".

import type { Client, Transaction, WealthAccount } from "@/lib/types"
import { expenseContribution, incomeContribution } from "@/lib/tx-classify"
import { accountCurrency, formatMoney, summarizeWealth } from "@/lib/wealth"

/** A payload that may carry the reporting-currency facts. */
export type ReportingMeta = { currency?: string | null; excluded_count?: number | null }

/** The currency an aggregate's figures are in — the response's, else the workspace's. */
export const reportingCurrencyOf = (body: ReportingMeta | null | undefined, fallback: string): string => body?.currency || fallback

/** Rows an aggregate had to leave out (no exchange rate for their day). */
export const excludedCountOf = (body: ReportingMeta | null | undefined): number => Math.max(0, Number(body?.excluded_count ?? 0) || 0)

/** The currency a transaction row's `amount` is in — its account's, else the workspace's. */
export const rowCurrency = (tx: Pick<Transaction, "currency_code"> | null | undefined, fallback: string): string => tx?.currency_code || fallback

type WithReportingAmount = { reporting_amount?: number | string | null; currency_code?: string | null; amount: number | string | null }

/**
 * A row's amount in the reporting currency, or null when it cannot be given:
 * the server's `reporting_amount` when present; the native amount when the row
 * is already in the reporting currency (or predates tagging); null otherwise —
 * a foreign row with no rate, or a mixed-currency split with no total (amount
 * null), which a total must COUNT rather than add raw.
 */
export function reportingAmountOf(tx: WithReportingAmount, reporting: string): number | null {
  if (tx.reporting_amount !== undefined) {
    if (tx.reporting_amount === null) return null
    const n = Number(tx.reporting_amount)
    return Number.isFinite(n) ? n : null
  }
  if (tx.amount == null) return null
  if (!tx.currency_code || tx.currency_code === reporting) return Number(tx.amount)
  return null
}

/**
 * Sum rows in the reporting currency, skipping — and counting — the ones that
 * cannot be converted. The one honest way to add a list of mixed-currency rows.
 */
export function sumInReporting<T extends WithReportingAmount>(rows: T[], reporting: string, pick: (tx: T) => boolean = () => true): { total: number; excluded: number } {
  let total = 0
  let excluded = 0
  for (const tx of rows) {
    if (!pick(tx)) continue
    const v = reportingAmountOf(tx, reporting)
    if (v === null) excluded += 1
    else total += v
  }
  return { total, excluded }
}

type PnlRow = WithReportingAmount & { type: string; kind?: string | null; is_system?: boolean | null }

/**
 * One row's contribution to reported income and expense, in the reporting
 * currency, under the shared classification (src/lib/tx-classify.ts): a system
 * row (Opening Balance, Balance Adjustment) and a transfer count as neither, a
 * refund is a NEGATIVE expense — never income. `null` when the row counts but
 * has no rate: the caller must COUNT it, not add it.
 */
export function pnlOf(tx: PnlRow, reporting: string): { income: number; expense: number } | null {
  // At unit amount the classifier gives the row's bucket and sign; the money
  // itself comes from reportingAmountOf.
  const leg = { type: tx.type, kind: tx.kind, isSystem: tx.is_system, amount: 1 }
  const income = incomeContribution(leg)
  const expense = expenseContribution(leg)
  if (income === 0 && expense === 0) return { income: 0, expense: 0 }
  const v = reportingAmountOf(tx, reporting)
  if (v === null) return null
  return { income: income * v, expense: expense * v }
}

/** Income / expense of a list of rows in the reporting currency; `excluded` counts the P&L rows with no rate. */
export function pnlInReporting(rows: PnlRow[], reporting: string): { income: number; expense: number; excluded: number } {
  let income = 0
  let expense = 0
  let excluded = 0
  for (const tx of rows) {
    const p = pnlOf(tx, reporting)
    if (p === null) excluded += 1
    else {
      income += p.income
      expense += p.expense
    }
  }
  return { income, expense, excluded }
}

/** An amount in a named currency — one part of a figure that spans currencies. */
export type CurrencyAmount = { currency: string; amount: number }

/**
 * Add amounts WITHIN each currency, never across: one entry per currency, zero
 * totals dropped, largest first. What a screen shows instead of a total when
 * the amounts are in more than one currency and no converted figure is
 * available (formatted with formatByCurrency).
 */
export function sumByCurrency(parts: CurrencyAmount[]): CurrencyAmount[] {
  const by = new Map<string, number>()
  for (const p of parts) by.set(p.currency, (by.get(p.currency) ?? 0) + p.amount)
  return [...by]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }))
    .filter((p) => p.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

/**
 * A figure that may span currencies: one formatted amount per currency
 * ("€1,000 + ₹75,000"), or a zero in `fallback` when there is nothing. A part
 * after the first carries its own operator, so a negative one reads
 * "₹75,000 − €300", never "₹75,000 + -€300" (whose minus could be read as
 * applying to the whole list). Hidden balances always join with " + " — the
 * operator would give the sign away. One part reads exactly like formatMoney.
 */
export function formatParts(parts: CurrencyAmount[], fallback: string, visible = true): string {
  if (parts.length === 0) return formatMoney(0, fallback, visible)
  return parts
    .map((p, i) => (i === 0 ? formatMoney(p.amount, p.currency, visible) : `${visible && p.amount < 0 ? " − " : " + "}${formatMoney(Math.abs(p.amount), p.currency, visible)}`))
    .join("")
}

/**
 * `summarizeWealth` run separately per native currency. The browser may only
 * add balances within one currency, so before (or without) the server's
 * converted summary this is the honest local picture: one group for a
 * single-currency workspace — the familiar total — and one per currency for a
 * mixed one, never the meaningless sum of €1,000 and ₹75,000.
 */
export function summarizeWealthByCurrency(accounts: WealthAccount[], fallback: string) {
  const groups = new Map<string, WealthAccount[]>()
  for (const a of accounts) {
    const c = accountCurrency(a, fallback)
    groups.set(c, [...(groups.get(c) ?? []), a])
  }
  return [...groups].map(([currency, rows]) => ({ currency, ...summarizeWealth(rows) }))
}

type ClientTotals = Pick<Client, "total_incoming" | "total_outgoing"> & { totals_currency?: string | null; excluded_count?: number | null }

/** The currency a client's `total_incoming`/`total_outgoing` are in. */
export const clientTotalsCurrency = (c: ClientTotals | null | undefined, fallback: string): string => c?.totals_currency || fallback
