// Shared money paths for wealth accounts, extracted from the routes so that the
// Cards API (POST /api/cards creates a bank inline / a credit card's liability
// account) and autopay (api/_lib/card-autopay.ts records a statement payment)
// go through EXACTLY the same code as the user-facing routes — same quota,
// same system rows, same balance deltas, same audit entries.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { randomUUID } from "node:crypto"
import Decimal from "decimal.js"
import { and, count, eq, isNull, max, sql } from "drizzle-orm"
import { db, dbBatch } from "../../src/lib/db/index.js"
import { cards, creditCardStatements, organizations, transactions, transfers, wealthAccounts } from "../../src/lib/db/schema.js"
import { ensureDefaultClient } from "./auth.js"
import { logAudit } from "./audit.js"
import { type AppearanceInput, pickAppearance } from "./account-appearance.js"
import { type BankDetailInput, pickBankDetails, resolveLogoColumns } from "./bank-brand.js"
import { AmountError, amountExceedsLimit, normalizeCurrencyCode, reversalTransferAmounts, transferAmounts } from "../../src/lib/money.js"
import { TRANSFER_FEE_CATEGORY, TRANSFER_FEE_DESCRIPTION, TRANSFER_FEE_REFUND_DESCRIPTION, TRANSFER_REVERSAL_DESCRIPTION } from "../../src/lib/wealth-ledger.js"
import { checkBankAccountQuota, checkCreditCardQuota, getOrgPlan } from "./quota.js"
import { dueDateFor, isLiabilityType, signedBalanceFromDebt, validateCardOnboarding } from "../../src/lib/credit-card.js"
import { todayIso } from "../../src/lib/recurring.js"
import { isDebtAccountType } from "./debts.js"
import { notifyIfBudgetExceeded } from "./notify-budget.js"

// The default wallet's reserved name — shared with the UI (src/lib/cash-wallet.ts).
export { DEFAULT_CASH_NAME } from "../../src/lib/cash-wallet.js"

export type AccountRow = typeof wealthAccounts.$inferSelect
export type TransactionRow = typeof transactions.$inferSelect

/** A route-shaped failure: the HTTP status + JSON body to send back. */
export type Failure = { ok: false; status: number; body: Record<string, unknown> }
const fail = (status: number, body: Record<string, unknown>): Failure => ({ ok: false, status, body })

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const displayName = (a: { nickname: string; bankName: string }) => a.nickname.trim() || a.bankName

/**
 * A refused transfer amount as a route answer: its own code per reason
 * (amount_too_many_decimals, destination_amount_required, …) and the input it
 * is about, so the client can say it in the reader's language. Anything else
 * is a generic code — never the thrown message, which once carried Decimal.js
 * internals ("[DecimalError] Invalid argument: ") to the user (MC-152).
 */
export const amountFailure = (error: unknown, input?: TransferInput): Failure =>
  error instanceof AmountError
    ? fail(400, { error: outdatedClient(error, input) ? OUTDATED_CROSS_CURRENCY : error.message, code: error.code, field: error.field })
    : fail(400, { error: "Invalid transfer amounts", code: "invalid_transfer_amounts" })

// A build from before cross-currency transfers posts a bare `amount` (no
// currencies, no destination amount) and has no field for what arrives, so
// the fix is on the user's side. The code stays the same — newer builds
// translate it — and this sentence is what the old build shows (MC-105).
const OUTDATED_CROSS_CURRENCY = "These accounts use different currencies. Update the app to transfer between them."
const outdatedClient = (error: AmountError, input?: TransferInput) =>
  error.code === "destination_amount_required" && !!input &&
  input.sourceAmount == null && input.destinationAmount == null && !input.sourceCurrency && !input.destinationCurrency

/**
 * The token a ledger function RAISEd (`RAISE EXCEPTION 'token' USING ERRCODE =
 * 'P0001'`, mig 0073), however Drizzle wrapped the driver's error. Null for
 * everything else — a missing function, a timeout, an outage — which callers
 * re-throw so it is a logged 500, never a polite 409 that hides it (MC-154).
 */
export function raisedToken(err: unknown): string | null {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    const o = e as { code?: unknown; message?: unknown; cause?: unknown }
    if (o.code === "P0001" && typeof o.message === "string") return o.message.trim()
    e = o.cause
  }
  return null
}

/** What each known ledger-function refusal means to a client: status + message. The token IS the code. */
const RAISED: Record<string, { status: number; error: string }> = {
  invalid_transfer_transition: { status: 409, error: "This transfer can't move to that status any more" },
  transfer_not_found: { status: 404, error: "Transfer not found" },
  transfer_account_unavailable: { status: 409, error: "A transfer account is archived or missing" },
  transfer_account_currency_changed: { status: 409, error: "An account's currency changed after this transfer was planned. Cancel it and plan it again." },
  transfer_not_found_or_incomplete: { status: 409, error: "Only a completed transfer can be moved to or from the Trash" },
  reversal_linked_transfer_is_immutable: { status: 409, error: "A reversed transfer and its reversal are permanent — they can't be deleted or restored" },
  invalid_transfer_trash_state: { status: 409, error: "This transfer is already in that state" },
}

/** A known ledger-function refusal as a route failure; re-throws anything else. */
export function raisedFailure(err: unknown): Failure {
  const token = raisedToken(err)
  const known = token ? RAISED[token] : undefined
  if (!known) throw err
  return fail(known.status, { error: known.error, code: token })
}

// ── System rows ──────────────────────────────────────────────────────────────

/**
 * Insert an Opening Balance / Balance Adjustment row. System rows EXPLAIN a
 * balance in the ledger (never income/expense, never reversed through Trash).
 */
export async function createSystemTransaction(input: {
  orgId: string
  userId: string
  accountId: string
  amount: number
  type: "incoming" | "outgoing"
  description: string
  category: string
  currencyCode: string
}): Promise<void> {
  if (input.amount <= 0) return
  const clientId = await ensureDefaultClient(input.orgId, input.userId)
  const [row] = await db
    .insert(transactions)
    .values({
      clientId,
      wealthAccountId: input.accountId,
      type: input.type,
      amount: String(input.amount),
      currencyCode: input.currencyCode,
      description: input.description,
      category: input.category,
      date: todayIso(),
      isSystem: true,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning()
  await logAudit({ orgId: input.orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: input.userId })
}

// ── Create account ───────────────────────────────────────────────────────────

export type CreateAccountInput = BankDetailInput & AppearanceInput & {
  type?: string
  bank_name?: string
  bankName?: string
  nickname?: string
  opening_balance?: number | string
  openingBalance?: number | string
  icon?: string
  currency_code?: string
  // Credit card only (src/lib/credit-card.ts validateCardOnboarding):
  credit_limit?: number | string
  current_debt?: number | string
  statement_closing_day?: number
  payment_due_day?: number
  // Optional latest statement the user still knows ("I don't know" = omit).
  statement?: { balance?: number | string; closing_date?: string; due_date?: string } | null
}

/**
 * Create a bank / cash / credit-card account: validation, plan quota, brand
 * logo capture, the Opening Balance system row (a card's opening DEBT becomes a
 * negative opening balance + an outgoing system row) and, for a card onboarded
 * with a known statement, the seed `manual` statement. Returns the row, or the
 * exact HTTP failure the route should send.
 */
export async function createWealthAccount(orgId: string, userId: string, body: CreateAccountInput): Promise<{ ok: true; row: AccountRow } | Failure> {
  const { type, nickname, icon } = body
  const bankName = body.bankName ?? body.bank_name ?? ""
  const [org] = await db.select({ currency: organizations.currency, reportingCurrency: organizations.reportingCurrency }).from(organizations).where(eq(organizations.id, orgId)).limit(1)
  if (!org) return fail(404, { error: "Organization not found" })
  let currencyCode: string
  try {
    currencyCode = normalizeCurrencyCode(body.currency_code ?? org.reportingCurrency ?? org.currency)
  } catch {
    return fail(400, { error: "Invalid currency code", code: "invalid_currency" })
  }
  let openingBalance: number | string = body.openingBalance ?? body.opening_balance ?? 0
  if (type !== "bank" && type !== "cash" && type !== "credit_card") return fail(400, { error: "type must be bank, cash or credit_card" })

  // A credit card is a LIABILITY: the amount owed is stored as a NEGATIVE
  // balance (see src/lib/credit-card.ts) and its "opening balance" is that
  // signed value, so the Opening Balance system row explains the debt.
  let card: { creditLimit: number; currentDebt: number; statementClosingDay: number; paymentDueDay: number; statement: { balance: number; closingDate: string; dueDate?: string } | null } | null = null
  if (type === "credit_card") {
    const name = bankName.trim()
    if (!name) return fail(400, { error: "bank_name is required" })
    const st = body.statement && body.statement.closing_date
      ? { balance: Number(body.statement.balance ?? 0), closingDate: String(body.statement.closing_date), dueDate: body.statement.due_date ? String(body.statement.due_date) : undefined }
      : null
    card = {
      creditLimit: Number(body.credit_limit),
      currentDebt: Number(body.current_debt ?? 0),
      statementClosingDay: Number(body.statement_closing_day),
      paymentDueDay: Number(body.payment_due_day),
      statement: st,
    }
    const problem = validateCardOnboarding(card, todayIso())
    if (problem) return fail(400, { error: `Invalid credit card: ${problem}`, code: problem })
    if (amountExceedsLimit(card.creditLimit) || amountExceedsLimit(card.currentDebt)) return fail(400, { error: "Amount is too large", code: "amount_too_large" })
    if (st && amountExceedsLimit(st.balance)) return fail(400, { error: "Amount is too large", code: "amount_too_large" })
    if (st?.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(st.dueDate)) return fail(400, { error: "statement.due_date must be YYYY-MM-DD" })
    const quota = await checkCreditCardQuota(orgId)
    if (!quota.allowed) return fail(402, quota as unknown as Record<string, unknown>)
    openingBalance = signedBalanceFromDebt(card.currentDebt)
  }

  if (type === "bank") {
    const name = bankName.trim()
    if (!name) return fail(400, { error: "bank_name is required" })
    // Plan-based: free workspaces get 1 bank account, paid plans are unlimited.
    const quota = await checkBankAccountQuota(orgId)
    if (!quota.allowed) return fail(402, quota as unknown as Record<string, unknown>)
  }

  const opening = money(openingBalance)
  if (amountExceedsLimit(opening)) return fail(400, { error: "Amount is too large", code: "amount_too_large" })
  // Colour identity is presentation only, but an invalid value would fail the
  // DB CHECK instead of the request, so it is validated here like any input.
  const appearance = pickAppearance(body)
  if (!appearance.ok) return fail(400, { error: appearance.error })
  // Bank-detail fields apply to bank + card accounts (Cash in Hand has none);
  // a card reuses the issuer brand/logo lookup.
  const details = type === "bank" || type === "credit_card" ? pickBankDetails(body) : null
  const logo = details ? await resolveLogoColumns(details.brandDomain, details.logoUrl) : null
  // Append new accounts after the user's existing order.
  const [{ maxPos }] = await db
    .select({ maxPos: max(wealthAccounts.position) })
    .from(wealthAccounts)
    .where(eq(wealthAccounts.organizationId, orgId))
  const [row] = await db
    .insert(wealthAccounts)
    .values({
      organizationId: orgId,
      type,
      bankName: type === "cash" ? (bankName.trim() || nickname?.trim() || "Cash Wallet") : bankName.trim(),
      nickname: (nickname ?? "").trim(),
      currencyCode,
      openingBalance: String(opening),
      currentBalance: String(opening),
      icon: icon || (type === "cash" ? "wallet" : type === "credit_card" ? "card" : "bank"),
      ...(card
        ? {
            creditLimit: String(card.creditLimit),
            statementClosingDay: card.statementClosingDay,
            paymentDueDay: card.paymentDueDay,
          }
        : {}),
      position: (maxPos ?? -1) + 1,
      ...appearance.patch,
      ...(details ?? {}),
      ...(logo ? { logoUrl: logo.logoUrl, logoData: logo.logoData } : {}),
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()

  if (opening !== 0) {
    // The Opening Balance row EXPLAINS the starting balance in the ledger: an
    // incoming for money held, an outgoing for money owed (a card's opening
    // debt, an overdrawn bank). System rows are not income/expense.
    await createSystemTransaction({
      orgId,
      userId,
      accountId: row.id,
      amount: Math.abs(opening),
      type: opening > 0 ? "incoming" : "outgoing",
      description: "Opening Balance",
      category: "Opening Balance",
      currencyCode,
    })
  }

  // A known latest statement seeds statement tracking (source='manual'); its
  // remaining amount is derived from payments dated after its close, so the
  // opening-debt system row above never counts as a payment.
  if (card?.statement) {
    const closingDate = card.statement.closingDate
    await db
      .insert(creditCardStatements)
      .values({
        organizationId: orgId,
        wealthAccountId: row.id,
        cycleStart: null,
        closingDate,
        dueDate: card.statement.dueDate ?? dueDateFor(closingDate, card.paymentDueDay),
        statementBalance: card.statement.balance.toFixed(2),
        source: "manual",
        createdBy: userId,
      })
      .onConflictDoNothing({ target: [creditCardStatements.wealthAccountId, creditCardStatements.closingDate] })
  }

  await logAudit({ orgId, entityType: "wealth_account", entityId: row.id, action: "create", actorId: userId })
  return { ok: true, row }
}

// ── Transfer ─────────────────────────────────────────────────────────────────

export type TransferInput = {
  fromAccountId: string
  toAccountId: string
  /** Compatibility name for source principal. */
  amount?: number | string
  sourceAmount?: number | string
  destinationAmount?: number | string
  sourceFeeAmount?: number | string
  sourceCurrency?: string
  destinationCurrency?: string
  recurringRuleId?: string
  recurringDueDate?: string
  reversesTransferId?: string
  /** Internal correction fact: refund an original source fee into the reversal destination. */
  destinationFeeRefundAmount?: number | string
  date?: string
  note?: string
  /** The DEBIT card used on the source side (attribution on the outgoing leg). */
  fromCardId?: string | null
  /** Override the leg descriptions (autopay labels its payment). */
  descriptions?: { out: string; in: string }
  /**
   * Extra statements committed in the SAME atomic batch as the legs + balance
   * updates (autopay marks its statement paid this way — either everything
   * lands or nothing does).
   */
  extra?: Parameters<typeof dbBatch>[0][number][]
}

export type TransferResult = { ok: true; transferId: string; groupId: string; outLeg: TransactionRow; inLeg: TransactionRow; feeLeg: TransactionRow | null; feeRefundLeg: TransactionRow | null }
export type UnsettledTransferStatus = "planned" | "pending"
export type TransferIntentResult = { ok: true; row: typeof transfers.$inferSelect }

// A debt account is NOT a transfer endpoint. Money reaching a loan has to go
// through the debt engine, which splits it into principal (a transfer) and
// interest and fees (expenses) and records the allocation. A plain transfer
// would credit the whole instalment against the principal, so the interest
// would never be spending and the loan would read as paid off years early.
// The transactions routes already refuse this; every transfer entry point
// (immediate, planned/pending intent, and completing that intent later through
// complete_transfer) refuses it with this same answer.
const refuseDebtAccount = (): Failure =>
  fail(400, { error: "Record a payment from the debt's page instead — that keeps principal and interest apart.", code: "debt_account" })

/** The credit card that IS this liability account (1:1), or null. */
export async function creditCardIdForAccount(accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.accountId, accountId), eq(cards.kind, "credit")))
    .limit(1)
  return row?.id ?? null
}

/**
 * Move money between two of the org's wealth accounts. Recorded as ONE logical
 * transfer = two legs sharing a `group_id` with `kind='transfer'`: an outgoing
 * leg on the source and an incoming leg on the destination, each syncing its own
 * balance — all four writes in ONE atomic batch (src/lib/db dbBatch), so a
 * transfer can never be observed half-applied. Transfers anchor to the org's
 * default client and are excluded from the global transactions list, the
 * income/expense summary, and analytics — they show only on each account's own
 * list.
 *
 * PAYING A CREDIT CARD is exactly this: a transfer whose destination is a
 * credit_card account. The card's stored balance is negative (debt), so the
 * incoming leg reduces the debt; the bank leg is the cash movement. Neither leg
 * is an expense — the purchases already were (src/lib/credit-card.ts). The
 * incoming leg carries the credit card's id (every row on a liability account
 * does — docs/cards/CARDS.md), so the payment shows on the card's own page.
 */
export async function createTransfer(orgId: string, userId: string, input: TransferInput): Promise<TransferResult | Failure> {
  if (!input.fromAccountId || !input.toAccountId) return fail(400, { error: "from_account_id and to_account_id are required", code: "transfer_accounts_required" })
  if (input.fromAccountId === input.toAccountId) return fail(400, { error: "Choose two different accounts", code: "transfer_same_account" })
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail(400, { error: "date must be YYYY-MM-DD", code: "invalid_date" })

  const accounts = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  const from = accounts.find((a) => a.id === input.fromAccountId)
  const to = accounts.find((a) => a.id === input.toAccountId)
  // Archived (or gone) on either side — a Reverse offered on a transfer whose
  // other account was archived since lands here too (MC-133).
  if (!from || !to) return fail(400, { error: "Select two active accounts", code: "transfer_account_unavailable" })
  if (isDebtAccountType(from.type) || isDebtAccountType(to.type)) return refuseDebtAccount()
  if (!from.currencyCode || !to.currencyCode) return fail(409, { error: "Account currency migration is incomplete", code: "currency_missing" })
  try {
    if (input.sourceCurrency && normalizeCurrencyCode(input.sourceCurrency) !== from.currencyCode) {
      return fail(400, { error: "Source currency does not match the source account", code: "source_currency_mismatch" })
    }
    if (input.destinationCurrency && normalizeCurrencyCode(input.destinationCurrency) !== to.currencyCode) {
      return fail(400, { error: "Destination currency does not match the destination account", code: "destination_currency_mismatch" })
    }
  } catch {
    return fail(400, { error: "Invalid transfer currency", code: "invalid_currency" })
  }
  let amounts: ReturnType<typeof transferAmounts>
  try {
    amounts = transferAmounts({
      sourceAmount: input.sourceAmount ?? input.amount ?? "",
      destinationAmount: input.destinationAmount,
      sourceFeeAmount: input.sourceFeeAmount,
      sourceCurrency: from.currencyCode,
      destinationCurrency: to.currencyCode,
    })
  } catch (error) {
    return amountFailure(error, input)
  }
  let destinationFeeRefund = new Decimal(0)
  try {
    destinationFeeRefund = input.destinationFeeRefundAmount == null ? new Decimal(0) : new Decimal(input.destinationFeeRefundAmount)
    if (!destinationFeeRefund.isFinite() || destinationFeeRefund.lt(0) || destinationFeeRefund.decimalPlaces() > 2) throw new Error()
  } catch {
    return fail(400, { error: "Fee refund must be a non-negative amount with at most 2 decimal places", code: "invalid_fee_refund" })
  }

  const clientId = await ensureDefaultClient(orgId, userId)

  // A transfer is two transactions; on the free plan both legs must fit under the
  // per-client limit (otherwise transfers would be a quota bypass). EXCEPTION:
  // moving money in/out of a Space (savings bucket) is internal, off-P&L money
  // movement — a free user must always be able to fund/empty their Space, so it
  // is exempt from the per-client transaction quota.
  const involvesSpace = from.type === "space" || to.type === "space"
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey === "free" && !involvesSpace) {
    const [{ current }] = await db
      .select({ current: count() })
      .from(transactions)
      // Exclude internal system rows, consistent with checkTransactionQuota.
      .where(and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt), eq(transactions.isSystem, false)))
    const requiredRows = 2 + (new Decimal(amounts.sourceFeeAmount).gt(0) ? 1 : 0) + (destinationFeeRefund.gt(0) ? 1 : 0)
    if (current + requiredRows > limits.transactionsPerClient) {
      return fail(402, {
        allowed: false,
        reason: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`,
        limit: limits.transactionsPerClient,
        current,
        upgradeHint: true,
      })
    }
  }

  const when = input.date ?? todayIso()
  const transferId = randomUUID()
  const groupId = randomUUID()
  const noteText = (input.note ?? "").trim()
  const suffix = noteText ? ` — ${noteText}` : ""
  // Label a card payment as such so the ledger reads naturally on both accounts.
  const cardPayment = isLiabilityType(to.type)
  const outDescription = input.descriptions?.out ?? (cardPayment ? `Card payment to ${displayName(to)}${suffix}` : `Transfer to ${displayName(to)}${suffix}`)
  const inDescription = input.descriptions?.in ?? (cardPayment ? `Card payment from ${displayName(from)}${suffix}` : `Transfer from ${displayName(from)}${suffix}`)
  // Attribution: the incoming leg on a credit card IS on that card; a debit
  // card on the source side is whatever the caller resolved (transfer route).
  const inCardId = cardPayment ? await creditCardIdForAccount(to.id) : null
  const outCardId = input.fromCardId ?? (isLiabilityType(from.type) ? await creditCardIdForAccount(from.id) : null)

  const now = new Date()
  const batch = [
    db.insert(transfers).values({
      id: transferId,
      organizationId: orgId,
      groupId,
      sourceAccountId: from.id,
      destinationAccountId: to.id,
      sourceAmount: amounts.sourceAmount,
      sourceCurrency: from.currencyCode,
      destinationAmount: amounts.destinationAmount,
      destinationCurrency: to.currencyCode,
      effectiveRate: amounts.effectiveRate,
      rateSource: amounts.effectiveRate ? "effective_transfer" : null,
      sourceFeeAmount: amounts.sourceFeeAmount,
      reversesTransferId: input.reversesTransferId,
      status: "completed",
      transferDate: when,
      note: noteText,
      completedAt: now,
      createdBy: userId,
    }),
    db
      .insert(transactions)
      .values({
        clientId,
        wealthAccountId: from.id,
        cardId: outCardId,
        transferId,
        groupId,
        kind: "transfer",
        type: "outgoing",
        amount: amounts.sourceAmount,
        currencyCode: from.currencyCode,
        description: outDescription,
        category: "Transfer",
        date: when,
        recurringRuleId: input.recurringRuleId,
        recurringDueDate: input.recurringDueDate,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning(),
    db
      .insert(transactions)
      .values({
        clientId,
        wealthAccountId: to.id,
        cardId: inCardId,
        transferId,
        groupId,
        kind: "transfer",
        type: "incoming",
        amount: amounts.destinationAmount,
        currencyCode: to.currencyCode,
        description: inDescription,
        category: "Transfer",
        date: when,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning(),
    ...(new Decimal(amounts.sourceFeeAmount).gt(0)
      ? [db
          .insert(transactions)
          .values({
            clientId,
            wealthAccountId: from.id,
            transferId,
            kind: "standard",
            type: "outgoing",
            amount: amounts.sourceFeeAmount,
            currencyCode: from.currencyCode,
            description: `${TRANSFER_FEE_DESCRIPTION}${suffix}`,
            category: TRANSFER_FEE_CATEGORY,
            date: when,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning()]
      : []),
    ...(destinationFeeRefund.gt(0)
      ? [db.insert(transactions).values({
          clientId,
          wealthAccountId: to.id,
          transferId,
          kind: "refund",
          type: "incoming",
          amount: destinationFeeRefund.toFixed(2),
          currencyCode: to.currencyCode,
          description: `${TRANSFER_FEE_REFUND_DESCRIPTION}${suffix}`,
          category: TRANSFER_FEE_CATEGORY,
          date: when,
          createdBy: userId,
          updatedBy: userId,
        }).returning()]
      : []),
    db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${new Decimal(amounts.sourceAmount).plus(amounts.sourceFeeAmount).toFixed(2)}`, updatedBy: userId, updatedAt: now })
      .where(eq(wealthAccounts.id, from.id)),
    db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${new Decimal(amounts.destinationAmount).plus(destinationFeeRefund).toFixed(2)}`, updatedBy: userId, updatedAt: now })
      .where(eq(wealthAccounts.id, to.id)),
    ...(input.extra ?? []),
  ]
  const results = (await dbBatch(batch as unknown as Parameters<typeof dbBatch>[0])) as unknown as [unknown, TransactionRow[], TransactionRow[], ...unknown[]]
  const outLeg = results[1][0]
  const inLeg = results[2][0]
  let optionalIndex = 3
  const feeLeg = new Decimal(amounts.sourceFeeAmount).gt(0) ? (results[optionalIndex++] as TransactionRow[])[0] : null
  const feeRefundLeg = destinationFeeRefund.gt(0) ? (results[optionalIndex] as TransactionRow[])[0] : null

  await logAudit({ orgId, entityType: "transfer", entityId: transferId, action: "create", actorId: userId })
  await logAudit({ orgId, entityType: "transaction", entityId: outLeg.id, action: "create", actorId: userId })
  await logAudit({ orgId, entityType: "transaction", entityId: inLeg.id, action: "create", actorId: userId })
  if (feeLeg) await logAudit({ orgId, entityType: "transaction", entityId: feeLeg.id, action: "create", actorId: userId })
  if (feeRefundLeg) await logAudit({ orgId, entityType: "transaction", entityId: feeRefundLeg.id, action: "create", actorId: userId })
  // The fee is an ordinary expense, so it can push a budget over a tier like
  // any other — fire-and-forget, as every other spend writer does (MC-150).
  if (feeLeg) void notifyIfBudgetExceeded(orgId, clientId, userId, { category: feeLeg.category, date: feeLeg.date }).catch(() => {})

  return { ok: true, transferId, groupId, outLeg, inLeg, feeLeg, feeRefundLeg }
}

export async function transitionTransfer(
  orgId: string,
  userId: string,
  transferId: string,
  targetStatus: "pending" | "completed" | "cancelled",
): Promise<{ ok: true; row: typeof transfers.$inferSelect; legIds: string[] } | Failure> {
  const [before] = await db.select().from(transfers).where(and(eq(transfers.id, transferId), eq(transfers.organizationId, orgId))).limit(1)
  if (!before) return fail(404, { error: "Transfer not found", code: "transfer_not_found" })

  if (targetStatus !== "completed") {
    try {
      await db.execute(sql`select * from transition_unsettled_transfer(${transferId}::uuid, ${orgId}::uuid, ${targetStatus}, ${userId})`)
    } catch (err) {
      return raisedFailure(err)
    }
    const [row] = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
    return { ok: true, row, legIds: [] }
  }

  if (before.status !== "planned" && before.status !== "pending") {
    return fail(409, { error: `Transfer cannot move from ${before.status} to completed`, code: "invalid_transfer_transition" })
  }
  const accounts = await db.select().from(wealthAccounts).where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  const from = accounts.find((account) => account.id === before.sourceAccountId)
  const to = accounts.find((account) => account.id === before.destinationAccountId)
  if (!from || !to) return fail(409, { error: "A transfer account is archived or missing", code: "transfer_account_unavailable" })
  // Completing is where the money moves (complete_transfer posts plain legs), so
  // an intent recorded against a debt account before the intent path refused
  // it stops here. Cancelling it stays possible — that moves nothing.
  if (isDebtAccountType(from.type) || isDebtAccountType(to.type)) return refuseDebtAccount()
  const clientId = await ensureDefaultClient(orgId, userId)
  const involvesSpace = from.type === "space" || to.type === "space"
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey === "free" && !involvesSpace) {
    const [{ current }] = await db.select({ current: count() }).from(transactions)
      .where(and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt), eq(transactions.isSystem, false)))
    const requiredRows = new Decimal(before.sourceFeeAmount).gt(0) ? 3 : 2
    if (current + requiredRows > limits.transactionsPerClient) {
      return fail(402, { allowed: false, reason: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`, limit: limits.transactionsPerClient, current, upgradeHint: true })
    }
  }
  const inCardId = isLiabilityType(to.type) ? await creditCardIdForAccount(to.id) : null
  const outCardId = isLiabilityType(from.type) ? await creditCardIdForAccount(from.id) : null
  const suffix = before.note ? ` — ${before.note}` : ""
  const cardPayment = isLiabilityType(to.type)
  const outDescription = cardPayment ? `Card payment to ${displayName(to)}${suffix}` : `Transfer to ${displayName(to)}${suffix}`
  const inDescription = cardPayment ? `Card payment from ${displayName(from)}${suffix}` : `Transfer from ${displayName(from)}${suffix}`
  try {
    const result = await db.execute(sql`select * from complete_transfer(
      ${transferId}::uuid, ${orgId}::uuid, ${clientId}::uuid, ${userId},
      ${outDescription}, ${inDescription}, ${outCardId}::uuid, ${inCardId}::uuid
    )`)
    const ids = (result.rows as Array<{ out_leg_id: string; in_leg_id: string; fee_leg_id: string | null }>)[0]
    const [row] = await db.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
    // Completing posts the fee as an expense too (MC-150).
    if (ids.fee_leg_id) void notifyIfBudgetExceeded(orgId, clientId, userId, { category: TRANSFER_FEE_CATEGORY }).catch(() => {})
    return { ok: true, row, legIds: [ids.out_leg_id, ids.in_leg_id, ids.fee_leg_id].filter((id): id is string => !!id) }
  } catch (err) {
    // complete_transfer re-checks under its row lock: an account archived, or
    // its currency changed, since the read above each get their own code —
    // one generic 409 once hid both behind "could not be completed" (MC-067).
    return raisedFailure(err)
  }
}

/** Reverse a completed transfer using its original native facts, never current FX. */
export async function reverseTransfer(
  orgId: string,
  userId: string,
  transferId: string,
  date?: string,
  note?: string,
): Promise<TransferResult | Failure> {
  const [original] = await db.select().from(transfers).where(and(eq(transfers.id, transferId), eq(transfers.organizationId, orgId))).limit(1)
  if (!original) return fail(404, { error: "Transfer not found", code: "transfer_not_found" })
  if (original.status !== "completed") return fail(409, { error: "Only a completed transfer can be reversed", code: "invalid_transfer_transition" })
  // Policy: a reversal is final. Reversing it would re-apply the original
  // movement as a third transfer; to undo a reversal the user records a new
  // transfer, which says what actually happened.
  if (original.reversesTransferId) return fail(409, { error: "A reversal can't be reversed — record a new transfer instead", code: "transfer_is_reversal" })
  const [existing] = await db.select({ id: transfers.id }).from(transfers).where(eq(transfers.reversesTransferId, transferId)).limit(1)
  if (existing) return fail(409, { error: "This transfer has already been reversed", code: "transfer_already_reversed", reversal_transfer_id: existing.id })
  // A reversal moves both balances back, so every row it undoes must still be
  // moving them. A trashed transfer — or one whose leg or fee was trashed on
  // its own, or whose leg no longer exists at all — has already given (some
  // of) that money back; reversing it would give it back twice, and would then
  // pin the original forever (a reversal-linked transfer can't be restored).
  const rows = await db
    .select({ kind: transactions.kind, type: transactions.type, amount: transactions.amount, deletedAt: transactions.deletedAt })
    .from(transactions)
    .where(eq(transactions.transferId, original.id))
  if (original.deletedAt || rows.some((r) => r.deletedAt) || rows.filter((r) => r.kind === "transfer").length !== 2) {
    return fail(409, { error: "This transfer, or part of it, is in the Trash or was deleted, so it can't be reversed", code: "transfer_trashed" })
  }
  // Refund the fee that was actually taken — the live fee row(s) — rather than
  // the header's figure, which a fee row changed on its own would contradict.
  const liveFee = rows
    .filter((r) => r.kind !== "transfer" && r.type === "outgoing")
    .reduce((sum, r) => sum.plus(r.amount), new Decimal(0))
  try {
    const reversal = reversalTransferAmounts({ ...original, sourceFeeAmount: liveFee.toFixed(2) })
    return await createTransfer(orgId, userId, {
      fromAccountId: original.destinationAccountId,
      toAccountId: original.sourceAccountId,
      sourceAmount: reversal.sourceAmount,
      destinationAmount: reversal.destinationAmount,
      sourceCurrency: original.destinationCurrency,
      destinationCurrency: original.sourceCurrency,
      destinationFeeRefundAmount: reversal.destinationFeeRefundAmount,
      reversesTransferId: original.id,
      date,
      // No default note: `reverses_transfer_id` already records what this
      // undoes, and an English "Reversal of transfer <uuid>" was the suffix of
      // every reversal's fee-refund row in every language (MC-155).
      note: note?.trim() ?? "",
      descriptions: { out: TRANSFER_REVERSAL_DESCRIPTION, in: TRANSFER_REVERSAL_DESCRIPTION },
      // The same check again INSIDE the atomic batch, so a trash that lands
      // between the read above and this write aborts the reversal instead of
      // racing it. FOR UPDATE queues behind set_transfer_trashed's own row lock
      // and re-reads the header once it commits; an empty result divides by
      // zero, which rolls the whole batch back (neon-http has no interactive
      // transaction to ROLLBACK from). The catch below answers 409.
      extra: [db.execute(sql`
        with live as (
          select id from transfers
          where id = ${original.id} and deleted_at is null
            and not exists (select 1 from transactions where transfer_id = ${original.id} and deleted_at is not null)
          for update
        )
        select 1 / (select count(*) from live)::int`)],
    })
  } catch {
    return fail(409, { error: "This transfer could not be reversed", code: "transfer_reversal_conflict" })
  }
}

export async function setTransferTrashed(
  orgId: string,
  userId: string,
  transferId: string,
  restore: boolean,
): Promise<{ ok: true; row: typeof transfers.$inferSelect } | Failure> {
  try {
    await db.execute(sql`select * from set_transfer_trashed(${transferId}::uuid, ${orgId}::uuid, ${restore}, ${userId})`)
    const [row] = await db.select().from(transfers).where(and(eq(transfers.id, transferId), eq(transfers.organizationId, orgId))).limit(1)
    if (!row) return fail(404, { error: "Transfer not found", code: "transfer_not_found" })
    return { ok: true, row }
  } catch (err) {
    // The function's own refusals each keep their code — "a reversed transfer
    // is permanent" is not "cannot be restored". Anything else (a missing
    // function, a timeout) is re-thrown as a 500 (MC-154).
    return raisedFailure(err)
  }
}

/** Store transfer intent only. Planned/pending rows never create ledger effects. */
export async function createTransferIntent(
  orgId: string,
  userId: string,
  input: TransferInput,
  status: UnsettledTransferStatus,
): Promise<TransferIntentResult | Failure> {
  if (!input.fromAccountId || !input.toAccountId) return fail(400, { error: "from_account_id and to_account_id are required", code: "transfer_accounts_required" })
  if (input.fromAccountId === input.toAccountId) return fail(400, { error: "Choose two different accounts", code: "transfer_same_account" })
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail(400, { error: "date must be YYYY-MM-DD", code: "invalid_date" })
  const accounts = await db.select().from(wealthAccounts).where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  const from = accounts.find((account) => account.id === input.fromAccountId)
  const to = accounts.find((account) => account.id === input.toAccountId)
  // Archived (or gone) on either side — a Reverse offered on a transfer whose
  // other account was archived since lands here too (MC-133).
  if (!from || !to) return fail(400, { error: "Select two active accounts", code: "transfer_account_unavailable" })
  if (isDebtAccountType(from.type) || isDebtAccountType(to.type)) return refuseDebtAccount()
  if (!from.currencyCode || !to.currencyCode) return fail(409, { error: "Account currency migration is incomplete", code: "currency_missing" })
  try {
    if (input.sourceCurrency && normalizeCurrencyCode(input.sourceCurrency) !== from.currencyCode) return fail(400, { error: "Source currency does not match the source account", code: "source_currency_mismatch" })
    if (input.destinationCurrency && normalizeCurrencyCode(input.destinationCurrency) !== to.currencyCode) return fail(400, { error: "Destination currency does not match the destination account", code: "destination_currency_mismatch" })
  } catch {
    return fail(400, { error: "Invalid transfer currency", code: "invalid_currency" })
  }
  let amounts: ReturnType<typeof transferAmounts>
  try {
    amounts = transferAmounts({ sourceAmount: input.sourceAmount ?? input.amount ?? "", destinationAmount: input.destinationAmount, sourceFeeAmount: input.sourceFeeAmount, sourceCurrency: from.currencyCode, destinationCurrency: to.currencyCode })
  } catch (error) {
    return amountFailure(error, input)
  }
  const [row] = await db.insert(transfers).values({
    organizationId: orgId,
    groupId: randomUUID(),
    sourceAccountId: from.id,
    destinationAccountId: to.id,
    sourceAmount: amounts.sourceAmount,
    sourceCurrency: from.currencyCode,
    destinationAmount: amounts.destinationAmount,
    destinationCurrency: to.currencyCode,
    effectiveRate: amounts.effectiveRate,
    rateSource: amounts.effectiveRate ? "effective_transfer" : null,
    sourceFeeAmount: amounts.sourceFeeAmount,
    status,
    transferDate: input.date ?? todayIso(),
    note: (input.note ?? "").trim(),
    createdBy: userId,
  }).returning()
  await logAudit({ orgId, entityType: "transfer", entityId: row.id, action: "create", actorId: userId })
  return { ok: true, row }
}
