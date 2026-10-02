// Client-side money maths on transaction LIST rows, in the reporting currency.
// A row's `amount` is native (its account's currency); anything that compares
// or totals rows goes through `reportingAmountOf` (converted at the row's own
// date by the server, null when no rate is stored) and the shared reporting
// classification (src/lib/tx-classify.ts) — never through raw `amount`.

import { pnlOf, reportingAmountOf } from "./reporting-fields"

/** GET /api/transactions?page= summary: figures in `currency`; `excluded_count` rows had no rate. */
export type TxSummary = { incoming: number; outgoing: number; currency?: string; excluded_count?: number }

type ReportingRow = {
  type: string
  kind?: string | null
  is_system?: boolean | null
  amount: number | string | null
  currency_code?: string | null
  reporting_amount?: number | string | null
}

const amountOf = (r: ReportingRow, reporting: string) =>
  r.amount === null ? null : reportingAmountOf({ ...r, amount: r.amount }, reporting)

/**
 * The summary with `removed` rows taken out — the instant half of a delete.
 * Each row leaves the figure the server put it in (a refund un-nets EXPENSE, it
 * was never income; a transfer or system row was in neither) by its REPORTING
 * amount. Returns null when that can't be known locally — a row with no rate
 * was excluded server-side, possibly only in part for a split — so the caller
 * reconciles from the server instead of guessing.
 */
export function summaryWithout(summary: TxSummary, removed: ReportingRow[], fallbackCurrency: string): TxSummary | null {
  const reporting = summary.currency || fallbackCurrency
  let { incoming, outgoing } = summary
  for (const r of removed) {
    const p = r.amount === null ? null : pnlOf({ ...r, amount: r.amount }, reporting)
    if (p === null) return null
    incoming -= p.income
    outgoing -= p.expense
  }
  return { ...summary, incoming, outgoing }
}

/**
 * Sort comparator by amount in the reporting currency — ₹5,000 (≈ $56) is not
 * more than €100 (≈ $116). A row with no rate has no comparable amount and
 * sorts LAST in both directions (the server's `nulls last`).
 */
export function compareByReportingAmount(a: ReportingRow, b: ReportingRow, reporting: string, dir: "asc" | "desc"): number {
  const x = amountOf(a, reporting)
  const y = amountOf(b, reporting)
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  return dir === "asc" ? x - y : y - x
}
