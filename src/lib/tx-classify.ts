// How a transaction leg counts in REPORTING (income / expense / neither) — the
// single place that knows what `type`, `kind` and `is_system` mean together.
//
//   type  : incoming | outgoing          — which way the ACCOUNT BALANCE moves
//   kind  : standard | transfer | refund — what the movement IS
//   system: opening balance / balance adjustment — defines a balance, not P&L
//
// The balance effect of a leg is `balanceDelta(type, amount)` regardless of
// kind (src/lib/wealth-ledger.ts). Reporting is stricter:
//
//   • standard outgoing → EXPENSE   (a card purchase, a fee, interest…)
//   • standard incoming → INCOME
//   • refund  incoming  → NEGATIVE EXPENSE — never income. A returned purchase
//                          reverses spending; the SQL twins of these rules live
//                          in api/_lib/tx-sql.ts and must stay identical.
//   • transfer          → NEITHER (nets to zero across the org). Paying a credit
//                          card is a transfer bank → card, so the purchase is the
//                          only expense — the payment is never counted again.
//   • system            → NEITHER
//
// Budgets consume exactly the EXPENSE rows (minus refunds) — see
// api/_lib/budget-spend.ts / spending-budgets.ts.

export const TRANSACTION_KINDS = ["standard", "transfer", "refund"] as const
export type TransactionKind = (typeof TRANSACTION_KINDS)[number]

/** Kinds a client may create directly. Transfers only come from the transfer endpoint. */
export const USER_TRANSACTION_KINDS: readonly TransactionKind[] = ["standard", "refund"]

export function isTransactionKind(v: unknown): v is TransactionKind {
  return typeof v === "string" && (TRANSACTION_KINDS as readonly string[]).includes(v)
}

export type ClassifiableLeg = {
  type: string
  kind?: string | null
  isSystem?: boolean | null
  amount: number | string
}

const num = (v: number | string): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const isTransferLeg = (leg: Pick<ClassifiableLeg, "kind">): boolean => leg.kind === "transfer"
export const isRefundLeg = (leg: Pick<ClassifiableLeg, "kind">): boolean => leg.kind === "refund"

/** Counts toward reported EXPENSE: a standard outgoing that isn't a balance-defining system row. */
export function isExpenseLeg(leg: ClassifiableLeg): boolean {
  return !leg.isSystem && (leg.kind ?? "standard") === "standard" && leg.type === "outgoing"
}

/** Counts toward reported INCOME: a standard incoming that isn't a system row. Refunds are NOT income. */
export function isIncomeLeg(leg: ClassifiableLeg): boolean {
  return !leg.isSystem && (leg.kind ?? "standard") === "standard" && leg.type === "incoming"
}

/** Signed contribution to reported expense: +amount for an expense, −amount for a refund, 0 otherwise. */
export function expenseContribution(leg: ClassifiableLeg): number {
  if (isExpenseLeg(leg)) return num(leg.amount)
  if (!leg.isSystem && isRefundLeg(leg)) return -num(leg.amount)
  return 0
}

/** Contribution to reported income: +amount for an income leg, 0 otherwise. */
export function incomeContribution(leg: ClassifiableLeg): number {
  return isIncomeLeg(leg) ? num(leg.amount) : 0
}

export type PnlTotals = { income: number; expense: number; net: number }

/** Income / expense / net for a set of legs under the reporting rules above. */
export function pnlTotals(legs: ClassifiableLeg[]): PnlTotals {
  let income = 0
  let expense = 0
  for (const leg of legs) {
    income += incomeContribution(leg)
    expense += expenseContribution(leg)
  }
  const r = (n: number) => Math.round(n * 100) / 100
  return { income: r(income), expense: r(expense), net: r(income - expense) }
}

/** Budget spend for a set of legs: expenses net of refunds — a card payment (transfer) counts 0. */
export function budgetSpend(legs: ClassifiableLeg[]): number {
  return pnlTotals(legs).expense
}

/** A refund must be an incoming leg — money comes BACK. Anything else is a validation error. */
export function refundShapeValid(type: string, kind: string | undefined | null): boolean {
  return kind !== "refund" || type === "incoming"
}
