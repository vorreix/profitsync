// Card notifications. Every entry point is best-effort (`void …catch(() => {})`
// at the call site) and DEDUPED — card reads run the sync on every page load, so
// an un-deduped emit would re-notify forever. Keys are stable per event:
// per statement (ready / due soon / overdue / autopay), per card per cycle
// (utilisation), per card per expiry (expiring).
//
// Recipients: the workspace's editing members (owner/admin/editor), like the
// budget alerts — a viewer can't act on a card. Links open the card screen.
//
// Amounts are in the CARD's own currency (MC-086): pre-formatted for push and
// mail ("₹1,800.00", like the budget alerts), and carried raw beside it
// (`data.amount` + `data.currency`) so a renderer can re-format in the reader's
// locale. An autopay failure says WHY with a stable code (`data.reason_code`)
// and a translated body per code; the English `reason` param stays for store
// builds pinned before those keys.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { notifyOrgMembers } from "./notifications.js"
import { formatBudgetMoney as money } from "./notify-budget.js"
import { cardDisplayName, maskedTail } from "../../src/lib/cards.js"
import type { CardRow } from "./cards.js"

const EDITORS = { roles: ["owner", "admin", "editor"] }
type CardIdentity = Pick<CardRow, "id" | "name" | "network" | "kind" | "last4"> & { account_bank_name?: string | null }
/** A card whose notification carries an amount: its ledger account's currency travels with it. */
type MoneyCard = CardIdentity & { currency: string }

/**
 * Why autopay could not pay, as a stable code (the translated bell body is
 * `types.card_autopay_failed.reasons.<code>`) with the English clause push and
 * mail use. Never a raw engine/database error.
 */
export const AUTOPAY_FAILURE_REASONS = {
  autopay_funding_missing: "the paying bank is missing or closed — choose a bank to pay from",
  autopay_liability: "a credit card can't pay this automatically — pay it yourself",
  autopay_currency_mismatch: "the paying account is in a different currency from the card — pay it yourself, or choose an account in the card's currency",
  autopay_funding_card: "the card that pays this one can't be used",
  autopay_quota: "your plan's transaction limit was reached",
  autopay_not_recorded: "the payment could not be recorded",
  autopay_interrupted: "the payment was interrupted before it was recorded",
} as const
export type AutopayFailureCode = keyof typeof AUTOPAY_FAILURE_REASONS

/** "Federal Visa •••• 1234" — the name every card notification leads with. */
export function cardLabel(card: CardIdentity): string {
  const tail = maskedTail(card.last4)
  return tail === "••••" ? cardDisplayName(card) : `${cardDisplayName(card)} ${tail}`
}

const link = (cardId: string) => `/wealth/cards/${cardId}`

/** A new statement was filed (computed close). Once per statement. */
export async function notifyStatementReady(input: { orgId: string; card: MoneyCard; statementId: string; balance: number; dueDate: string }): Promise<void> {
  const name = cardLabel(input.card)
  const { currency } = input.card
  const amount = money(input.balance, currency)
  await notifyOrgMembers(input.orgId, {
    type: "card_statement_ready",
    title: "Card statement ready",
    body: `${name}: ${amount} due ${input.dueDate}.`,
    data: { i18nKey: "types.card_statement_ready.title", i18nBodyKey: "types.card_statement_ready.body", i18nParams: { card: name, amount, date: input.dueDate, currency }, amount: input.balance, currency },
    link: link(input.card.id),
    dedupeKey: `card_stmt:${input.statementId}`,
  }, EDITORS)
}

/** Payment due within 3 days and still unpaid. Once per statement. */
export async function notifyPaymentDueSoon(input: { orgId: string; card: MoneyCard; statementId: string; remaining: number; dueDate: string; daysToDue: number }): Promise<void> {
  const name = cardLabel(input.card)
  const { currency } = input.card
  const amount = money(input.remaining, currency)
  await notifyOrgMembers(input.orgId, {
    type: "card_payment_due_soon",
    title: "Card payment due soon",
    body: `${name}: ${amount} due ${input.dueDate} (${input.daysToDue} day${input.daysToDue === 1 ? "" : "s"}).`,
    data: { i18nKey: "types.card_payment_due_soon.title", i18nBodyKey: "types.card_payment_due_soon.body", i18nParams: { card: name, amount, date: input.dueDate, days: input.daysToDue, currency }, amount: input.remaining, currency },
    link: link(input.card.id),
    dedupeKey: `card_due_soon:${input.statementId}`,
  }, EDITORS)
}

/** Something is still owed after the due date. Once per statement. */
export async function notifyPaymentOverdue(input: { orgId: string; card: MoneyCard; statementId: string; remaining: number; dueDate: string }): Promise<void> {
  const name = cardLabel(input.card)
  const { currency } = input.card
  const amount = money(input.remaining, currency)
  await notifyOrgMembers(input.orgId, {
    type: "card_payment_overdue",
    title: "Card payment overdue",
    body: `${name}: ${amount} was due ${input.dueDate}.`,
    data: { i18nKey: "types.card_payment_overdue.title", i18nBodyKey: "types.card_payment_overdue.body", i18nParams: { card: name, amount, date: input.dueDate, currency }, amount: input.remaining, currency },
    link: link(input.card.id),
    dedupeKey: `card_overdue:${input.statementId}`,
  }, EDITORS)
}

/** Autopay recorded a statement payment. Once per statement. */
export async function notifyAutopayPaid(input: { orgId: string; card: MoneyCard; statementId: string; amount: number; fromName: string }): Promise<void> {
  const name = cardLabel(input.card)
  const { currency } = input.card
  const amount = money(input.amount, currency)
  await notifyOrgMembers(input.orgId, {
    type: "card_autopay_paid",
    title: "Card paid automatically",
    body: `${amount} paid to ${name} from ${input.fromName}.`,
    data: { i18nKey: "types.card_autopay_paid.title", i18nBodyKey: "types.card_autopay_paid.body", i18nParams: { card: name, amount, from: input.fromName, currency }, amount: input.amount, currency },
    link: link(input.card.id),
    dedupeKey: `card_autopay:${input.statementId}`,
  }, EDITORS)
}

/**
 * Autopay could not pay (funding bank archived/missing, quota, error). Once per
 * statement — per cause when the engine will retry (`dedupeSuffix`), so a fixed
 * bank and a later quota problem each get their own single nudge. `detail`
 * replaces the code's English clause in push/mail when the engine knows more
 * (the plan's own quota sentence); the bell translates the code.
 */
export async function notifyAutopayFailed(input: { orgId: string; card: MoneyCard; statementId: string; amount: number; code: AutopayFailureCode; detail?: string; dedupeSuffix?: string }): Promise<void> {
  const name = cardLabel(input.card)
  const { currency } = input.card
  const amount = money(input.amount, currency)
  const reason = input.detail || AUTOPAY_FAILURE_REASONS[input.code]
  await notifyOrgMembers(input.orgId, {
    type: "card_autopay_failed",
    title: "Autopay could not pay your card",
    body: `${name}: ${amount} was not paid — ${reason}. Pay it manually.`,
    data: {
      i18nKey: "types.card_autopay_failed.title",
      i18nBodyKey: "types.card_autopay_failed.body",
      // The per-code body wins only in a bundle that ships it (notificationRenderKeys).
      i18nBodyKeyAmounts: `types.card_autopay_failed.reasons.${input.code}`,
      i18nParams: { card: name, amount, reason, currency },
      reason_code: input.code,
      amount: input.amount,
      currency,
    },
    link: link(input.card.id),
    dedupeKey: `card_autopay_failed:${input.statementId}${input.dedupeSuffix ? `:${input.dedupeSuffix}` : ""}`,
  }, EDITORS)
}

/** Utilisation crossed 90% of the limit. Once per card per open cycle. */
export async function notifyUtilizationHigh(input: { orgId: string; card: MoneyCard; cycleStart: string; utilization: number; available: number }): Promise<void> {
  const name = cardLabel(input.card)
  const pct = Math.round(input.utilization * 100)
  const { currency } = input.card
  const available = money(input.available, currency)
  await notifyOrgMembers(input.orgId, {
    type: "card_utilization_high",
    title: "Card close to its limit",
    body: `${name} is at ${pct}% of its limit — ${available} left.`,
    data: { i18nKey: "types.card_utilization_high.title", i18nBodyKey: "types.card_utilization_high.body", i18nParams: { card: name, pct, available, currency }, available: input.available, currency },
    link: link(input.card.id),
    dedupeKey: `card_util:${input.card.id}:${input.cycleStart}`,
  }, EDITORS)
}

/** The card expires within 30 days. Once per card per expiry. */
export async function notifyCardExpiring(input: { orgId: string; card: CardIdentity; expiry: string }): Promise<void> {
  const name = cardLabel(input.card)
  await notifyOrgMembers(input.orgId, {
    type: "card_expiring",
    title: "Card expiring soon",
    body: `${name} expires ${input.expiry}.`,
    data: { i18nKey: "types.card_expiring.title", i18nBodyKey: "types.card_expiring.body", i18nParams: { card: name, expiry: input.expiry } },
    link: link(input.card.id),
    dedupeKey: `card_expiring:${input.card.id}:${input.expiry}`,
  }, EDITORS)
}
