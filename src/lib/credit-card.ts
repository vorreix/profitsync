// Pure credit-card (liability account) math. No I/O, no DB — shared by the API
// (statement closing, card summary), the UI (card screen, pickers, net worth)
// and the unit tests, so every surface agrees to the cent.
//
// ── SIGN CONVENTION (the one rule everything else follows) ───────────────────
// `wealth_accounts.current_balance` is the SIGNED, ASSET-EQUIVALENT value of an
// account for EVERY account type. The existing ledger moves it with
// `balanceDelta(type, amount)` (+incoming / −outgoing, src/lib/wealth-ledger.ts)
// and never looks at the account type. A credit card is a liability, so its
// balance is normally NEGATIVE: −950 means "€950 owed". That is exactly what
// makes the rest of the app correct with no special cases:
//   • a purchase is an ordinary outgoing on the card → balance −100 → debt +100
//   • a card payment is an ordinary transfer bank→card → bank −500, card +500
//   • net worth = Σ balances → debt reduces it, available credit never enters
//   • delete/restore/edit reuse the ledger's existing reversal helpers verbatim
// Nothing outside this module may reason about that minus sign: UI and API code
// call cardDebt()/cardCredit()/availableCredit()/signedBalanceFromDebt().

export const CREDIT_CARD_TYPE = "credit_card" as const

/** Account types whose stored balance is a DEBT the user owes (asset-equivalent < 0). */
export function isLiabilityType(type: string | null | undefined): boolean {
  return type === CREDIT_CARD_TYPE
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const num = (v: number | string | null | undefined): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── Debt / credit / availability ─────────────────────────────────────────────

/** Amount currently OWED on the card (≥ 0). A positive balance (overpayment) is 0 debt. */
export function cardDebt(currentBalance: number | string | null | undefined): number {
  return round2(Math.max(0, -num(currentBalance)))
}

/** Positive card credit after an overpayment/refund (≥ 0). Shown as "€50 card credit", never "Debt: −€50". */
export function cardCredit(currentBalance: number | string | null | undefined): number {
  return round2(Math.max(0, num(currentBalance)))
}

/** The stored signed balance for a given amount owed (debt 950 → −950). Used when the user types "I owe X". */
export function signedBalanceFromDebt(debt: number | string | null | undefined): number {
  return round2(-Math.abs(num(debt)))
}

/**
 * Available credit = limit − debt. With a positive card credit the available
 * amount is limit + credit (V1 rule: linear, issuer-agnostic). Never below 0:
 * an over-limit card has 0 available and `overLimit`. A card with no usable
 * limit reports null (nothing to compare against).
 */
export function availableCredit(
  creditLimit: number | string | null | undefined,
  currentBalance: number | string | null | undefined,
): number | null {
  if (creditLimit === null || creditLimit === undefined || creditLimit === "") return null
  const limit = num(creditLimit)
  if (limit <= 0) return null
  return round2(Math.max(0, limit + num(currentBalance)))
}

export type CreditUsage = {
  debt: number
  credit: number
  limit: number | null
  available: number | null
  /** debt / limit, 0..1 for display (clamped); null without a limit. */
  utilization: number | null
  overLimit: boolean
}

/** One object with every headline figure the card screen shows. */
export function creditUsage(
  creditLimit: number | string | null | undefined,
  currentBalance: number | string | null | undefined,
): CreditUsage {
  const debt = cardDebt(currentBalance)
  const credit = cardCredit(currentBalance)
  const available = availableCredit(creditLimit, currentBalance)
  const limit = available === null ? null : num(creditLimit)
  const utilization = limit ? Math.min(1, round2(debt / limit)) : null
  return { debt, credit, limit, available, utilization, overLimit: limit !== null && debt > limit }
}

// ── Date math (UTC, ISO 'YYYY-MM-DD' strings — same conventions as recurring.ts) ──

function parseIso(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}

function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Is `day` a valid statement/due day-of-month setting (1..31)? */
export function isValidDayOfMonth(day: unknown): day is number {
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31
}

/**
 * The configured day-of-month landed in a concrete month, clamped to that
 * month's length: closing day 31 → Feb 28 (or 29 in a leap year), Apr 30, …
 */
export function dayInMonth(y: number, m: number, day: number): string {
  return toIso(y, m, Math.min(day, daysInMonth(y, m)))
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const total = y * 12 + (m - 1) + delta
  return { y: Math.floor(total / 12), m: (total % 12) + 1 }
}

export function addDays(iso: string, delta: number): string {
  const { y, m, d } = parseIso(iso)
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000)
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** The most recent statement closing date on or before `date`. */
export function lastClosingOnOrBefore(date: string, closingDay: number): string {
  const { y, m } = parseIso(date)
  const thisMonth = dayInMonth(y, m, closingDay)
  if (thisMonth <= date) return thisMonth
  const prev = addMonths(y, m, -1)
  return dayInMonth(prev.y, prev.m, closingDay)
}

/** The first statement closing date strictly after `date`. */
export function nextClosingAfter(date: string, closingDay: number): string {
  const { y, m } = parseIso(date)
  const thisMonth = dayInMonth(y, m, closingDay)
  if (thisMonth > date) return thisMonth
  const next = addMonths(y, m, 1)
  return dayInMonth(next.y, next.m, closingDay)
}

/** The first statement closing date on or after `date` (on the closing day itself the cycle closes today). */
export function nextClosingOnOrAfter(date: string, closingDay: number): string {
  const { y, m } = parseIso(date)
  const thisMonth = dayInMonth(y, m, closingDay)
  if (thisMonth >= date) return thisMonth
  const next = addMonths(y, m, 1)
  return dayInMonth(next.y, next.m, closingDay)
}

/**
 * Payment due date for a statement that closed on `closingDate`: the first
 * date STRICTLY after the close whose day-of-month is `dueDay` (clamped). So a
 * card closing on the 1st with due day 15 is due the 15th of the same month; a
 * card closing on the 25th with due day 10 is due the 10th of the next month.
 */
export function dueDateFor(closingDate: string, dueDay: number): string {
  return nextClosingAfter(closingDate, dueDay)
}

export type CycleBounds = {
  /** First day of the cycle (the day after the previous close). */
  start: string
  /** The closing date — the LAST day that belongs to this cycle. */
  closesOn: string
}

/**
 * The OPEN cycle as of `today`: every transaction dated after the last close
 * and up to (including) the next closing date belongs to it. On the closing
 * day itself the cycle is still open — it is filed as a statement the day after.
 */
export function openCycle(today: string, closingDay: number): CycleBounds {
  const closesOn = nextClosingOnOrAfter(today, closingDay)
  const prevClose = lastClosingOnOrBefore(addDays(closesOn, -1), closingDay)
  return { start: addDays(prevClose, 1), closesOn }
}

/** A transaction dated on or before the closing date belongs to that statement; the day after starts the new cycle. */
export function belongsToStatement(txDate: string, closingDate: string): boolean {
  return txDate <= closingDate
}

/**
 * Closing dates that are due to be filed as statements: strictly after `anchor`
 * (the latest known statement close, or the day the card was added) and
 * strictly before `today` (a cycle closes at the END of its closing day).
 * Ascending, capped so a long-unopened workspace never files hundreds at once
 * — the caller re-runs with the new anchor next time.
 */
export function closingsDue(anchor: string, closingDay: number, today: string, max = 24): string[] {
  const out: string[] = []
  let c = nextClosingAfter(anchor, closingDay)
  while (c < today && out.length < max) {
    out.push(c)
    c = nextClosingAfter(c, closingDay)
  }
  return out
}

// ── Statements & payment allocation ──────────────────────────────────────────
//
// A statement is a SNAPSHOT: the amount owed at the END of its closing date
// (`statement_balance`, computed from the ledger when the cycle is filed, or
// entered by the user when onboarding a card with history). It never changes
// afterwards — new purchases belong to the next cycle and cannot mutate it.
//
// Payments are DERIVED, never stored: every card payment (an incoming transfer
// leg on the card) dated AFTER the closing date reduces what is still owed on
// that statement, oldest debt first. This is FIFO without an allocation table:
// a later statement's balance already INCLUDES any older unpaid debt, so one
// payment reduces every open statement it is dated after, and the oldest one
// reaches zero first. Post-close refunds/credits are NOT payments — like a real
// issuer, they post to the current cycle and show up on the next statement.
//
// Overpaying (payments > statement) leaves the statement PAID and the excess
// reduces the overall debt (possibly into positive card credit); the new-cycle
// purchases metric is a separate, historical sum of purchases and is untouched.

export type StatementStatus = "open" | "unpaid" | "partial" | "paid" | "overdue"

/** Amount still owed on a statement after the payments dated after its close. Clamped to [0, statementBalance]. */
export function statementRemaining(
  statementBalance: number | string | null | undefined,
  paymentsSinceClose: number | string | null | undefined,
): number {
  const sb = num(statementBalance)
  if (sb <= 0) return 0
  return round2(Math.min(sb, Math.max(0, sb - num(paymentsSinceClose))))
}

/** The part of the statement that has been paid (statementBalance − remaining). */
export function statementPaid(
  statementBalance: number | string | null | undefined,
  paymentsSinceClose: number | string | null | undefined,
): number {
  const sb = num(statementBalance)
  if (sb <= 0) return 0
  return round2(sb - statementRemaining(sb, paymentsSinceClose))
}

export type StatementView = {
  statementBalance: number
  paid: number
  remaining: number
  status: Exclude<StatementStatus, "open">
  /** Days until the due date (negative = past due). */
  daysToDue: number
}

/**
 * Textual status for a CLOSED statement (the UI must never rely on colour):
 *   paid     — nothing left to pay (or nothing was owed at close)
 *   partial  — some paid, due date not yet passed
 *   unpaid   — nothing paid yet, due date not yet passed
 *   overdue  — anything still owed after the due date (whether partly paid or not)
 */
export function statementView(input: {
  statementBalance: number | string
  paymentsSinceClose: number | string
  dueDate: string
  today: string
}): StatementView {
  const statementBalance = round2(num(input.statementBalance))
  const remaining = statementRemaining(statementBalance, input.paymentsSinceClose)
  const paid = statementPaid(statementBalance, input.paymentsSinceClose)
  const daysToDue = Math.round(
    (Date.parse(`${input.dueDate}T00:00:00Z`) - Date.parse(`${input.today}T00:00:00Z`)) / 86_400_000,
  )
  let status: StatementView["status"]
  if (remaining <= 0) status = "paid"
  else if (input.today > input.dueDate) status = "overdue"
  else if (paid > 0) status = "partial"
  else status = "unpaid"
  return { statementBalance, paid, remaining, status, daysToDue }
}

/**
 * The amount owed at the end of a closing date, reconstructed from the
 * AUTHORITATIVE stored balance: debt at close = −(current balance − everything
 * that moved the balance AFTER the close). `movementAfterClose` is the signed
 * balance effect (Σ balanceDelta) of legs dated after the closing date whose
 * effect is currently applied. Anchoring on the stored balance (rather than
 * re-summing the whole ledger) keeps statements consistent with what the card
 * shows even where the ledger and the stored balance legitimately differ
 * (a trashed balance-defining system row, see wealth-ledger.reversesOnTrash).
 */
export function debtAtClose(currentBalance: number | string, movementAfterClose: number | string): number {
  return round2(-(num(currentBalance) - num(movementAfterClose)))
}

// ── Cycle activity ───────────────────────────────────────────────────────────

export type CardLeg = {
  type: string
  kind?: string | null
  amount: number | string
  isSystem?: boolean | null
}

export type CycleActivity = {
  /** Gross purchases, fees and interest posted in the cycle (outgoing, non-transfer, non-system). */
  spent: number
  /** Refunds/credits posted in the cycle (incoming, kind='refund'). */
  refunds: number
  /** Card payments received in the cycle (incoming transfer legs). */
  payments: number
  /**
   * Money that LEFT this card as a transfer in the cycle — i.e. this card was
   * used to pay another one (a balance transfer). Not spending: nothing was
   * bought, the debt was moved here from somewhere else. Without this line the
   * cycle breakdown would silently omit money the card really owes for.
   */
  transfers_out: number
}

/**
 * Sum a card's activity for the legs in an OPEN cycle. Purchases stay a gross,
 * historical metric — paying the card or a refund never "un-spends" them.
 */
export function cycleActivity(legs: CardLeg[]): CycleActivity {
  let spent = 0
  let refunds = 0
  let payments = 0
  let transfersOut = 0
  for (const leg of legs) {
    const amt = num(leg.amount)
    if (leg.isSystem) continue
    if (leg.kind === "transfer") {
      if (leg.type === "incoming") payments += amt
      else transfersOut += amt
      continue
    }
    if (leg.kind === "refund") {
      refunds += amt
      continue
    }
    if (leg.type === "outgoing") spent += amt
  }
  return { spent: round2(spent), refunds: round2(refunds), payments: round2(payments), transfers_out: round2(transfersOut) }
}

/** Card payments = incoming TRANSFER legs on the card. A refund or a cashback credit is not a payment. */
export function isCardPaymentLeg(leg: { type: string; kind?: string | null }): boolean {
  return leg.kind === "transfer" && leg.type === "incoming"
}

// ── Onboarding ───────────────────────────────────────────────────────────────

export type CardOnboardingInput = {
  creditLimit: number
  currentDebt: number
  statementClosingDay: number
  paymentDueDay: number
  /** Optional latest statement the user still knows about ("I don't know" = null). */
  statement?: { balance: number; closingDate: string } | null
}

export type CardOnboardingError =
  | "limit_invalid"
  | "debt_invalid"
  | "closing_day_invalid"
  | "due_day_invalid"
  | "same_day"
  | "statement_balance_invalid"
  | "statement_date_invalid"
  | "statement_in_future"

/**
 * Validate the card-creation input the same way on the client (inline errors)
 * and the server (400s). Returns the first problem found, or null.
 */
export function validateCardOnboarding(input: CardOnboardingInput, today: string): CardOnboardingError | null {
  if (!Number.isFinite(input.creditLimit) || input.creditLimit <= 0) return "limit_invalid"
  if (!Number.isFinite(input.currentDebt) || input.currentDebt < 0) return "debt_invalid"
  if (!isValidDayOfMonth(input.statementClosingDay)) return "closing_day_invalid"
  if (!isValidDayOfMonth(input.paymentDueDay)) return "due_day_invalid"
  if (input.statementClosingDay === input.paymentDueDay) return "same_day"
  if (input.statement) {
    if (!Number.isFinite(input.statement.balance) || input.statement.balance < 0) return "statement_balance_invalid"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.statement.closingDate)) return "statement_date_invalid"
    if (input.statement.closingDate > today) return "statement_in_future"
  }
  return null
}

/** Pick a sensible existing expense category for a card fee / interest charge, or "" if none fits. */
export function suggestFeeCategory(outgoingCategories: string[]): string {
  const patterns = [/fee/i, /interest/i, /bank/i, /card/i, /financ/i, /charge/i]
  for (const re of patterns) {
    const hit = outgoingCategories.find((c) => re.test(c))
    if (hit) return hit
  }
  return ""
}
