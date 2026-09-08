// Card notifications. Every entry point is best-effort (`void …catch(() => {})`
// at the call site) and DEDUPED — card reads run the sync on every page load, so
// an un-deduped emit would re-notify forever. Keys are stable per event:
// per statement (ready / due soon / overdue / autopay), per card per cycle
// (utilisation), per card per expiry (expiring).
//
// Recipients: the workspace's editing members (owner/admin/editor), like the
// budget alerts — a viewer can't act on a card. Links open the card screen.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { notifyOrgMembers } from "./notifications.js"
import { cardDisplayName, maskedTail } from "../../src/lib/cards.js"
import type { CardRow } from "./cards.js"

const EDITORS = { roles: ["owner", "admin", "editor"] }
const money = (n: number) => n.toFixed(2)

type CardIdentity = Pick<CardRow, "id" | "name" | "network" | "kind" | "last4"> & { account_bank_name?: string | null }

/** "Federal Visa •••• 1234" — the name every card notification leads with. */
export function cardLabel(card: CardIdentity): string {
  const tail = maskedTail(card.last4)
  return tail === "••••" ? cardDisplayName(card) : `${cardDisplayName(card)} ${tail}`
}

const link = (cardId: string) => `/wealth/cards/${cardId}`

/** A new statement was filed (computed close). Once per statement. */
export async function notifyStatementReady(input: { orgId: string; card: CardIdentity; statementId: string; balance: number; dueDate: string }): Promise<void> {
  const name = cardLabel(input.card)
  await notifyOrgMembers(input.orgId, {
    type: "card_statement_ready",
    title: "Card statement ready",
    body: `${name}: ${money(input.balance)} due ${input.dueDate}.`,
    data: { i18nKey: "types.card_statement_ready.title", i18nBodyKey: "types.card_statement_ready.body", i18nParams: { card: name, amount: money(input.balance), date: input.dueDate } },
    link: link(input.card.id),
    dedupeKey: `card_stmt:${input.statementId}`,
  }, EDITORS)
}

/** Payment due within 3 days and still unpaid. Once per statement. */
export async function notifyPaymentDueSoon(input: { orgId: string; card: CardIdentity; statementId: string; remaining: number; dueDate: string; daysToDue: number }): Promise<void> {
  const name = cardLabel(input.card)
  await notifyOrgMembers(input.orgId, {
    type: "card_payment_due_soon",
    title: "Card payment due soon",
    body: `${name}: ${money(input.remaining)} due ${input.dueDate} (${input.daysToDue} day${input.daysToDue === 1 ? "" : "s"}).`,
    data: { i18nKey: "types.card_payment_due_soon.title", i18nBodyKey: "types.card_payment_due_soon.body", i18nParams: { card: name, amount: money(input.remaining), date: input.dueDate, days: input.daysToDue } },
    link: link(input.card.id),
    dedupeKey: `card_due_soon:${input.statementId}`,
  }, EDITORS)
}

/** Something is still owed after the due date. Once per statement. */
export async function notifyPaymentOverdue(input: { orgId: string; card: CardIdentity; statementId: string; remaining: number; dueDate: string }): Promise<void> {
  const name = cardLabel(input.card)
  await notifyOrgMembers(input.orgId, {
    type: "card_payment_overdue",
    title: "Card payment overdue",
    body: `${name}: ${money(input.remaining)} was due ${input.dueDate}.`,
    data: { i18nKey: "types.card_payment_overdue.title", i18nBodyKey: "types.card_payment_overdue.body", i18nParams: { card: name, amount: money(input.remaining), date: input.dueDate } },
    link: link(input.card.id),
    dedupeKey: `card_overdue:${input.statementId}`,
  }, EDITORS)
}

/** Autopay recorded a statement payment. Once per statement. */
export async function notifyAutopayPaid(input: { orgId: string; card: CardIdentity; statementId: string; amount: number; fromName: string }): Promise<void> {
  const name = cardLabel(input.card)
  await notifyOrgMembers(input.orgId, {
    type: "card_autopay_paid",
    title: "Card paid automatically",
    body: `${money(input.amount)} paid to ${name} from ${input.fromName}.`,
    data: { i18nKey: "types.card_autopay_paid.title", i18nBodyKey: "types.card_autopay_paid.body", i18nParams: { card: name, amount: money(input.amount), from: input.fromName } },
    link: link(input.card.id),
    dedupeKey: `card_autopay:${input.statementId}`,
  }, EDITORS)
}

/**
 * Autopay could not pay (funding bank archived/missing, quota, error). Once per
 * statement — per cause when the engine will retry (`dedupeSuffix`), so a fixed
 * bank and a later quota problem each get their own single nudge.
 */
export async function notifyAutopayFailed(input: { orgId: string; card: CardIdentity; statementId: string; amount: number; reason: string; dedupeSuffix?: string }): Promise<void> {
  const name = cardLabel(input.card)
  await notifyOrgMembers(input.orgId, {
    type: "card_autopay_failed",
    title: "Autopay could not pay your card",
    body: `${name}: ${money(input.amount)} was not paid — ${input.reason}. Pay it manually.`,
    data: { i18nKey: "types.card_autopay_failed.title", i18nBodyKey: "types.card_autopay_failed.body", i18nParams: { card: name, amount: money(input.amount), reason: input.reason } },
    link: link(input.card.id),
    dedupeKey: `card_autopay_failed:${input.statementId}${input.dedupeSuffix ? `:${input.dedupeSuffix}` : ""}`,
  }, EDITORS)
}

/** Utilisation crossed 90% of the limit. Once per card per open cycle. */
export async function notifyUtilizationHigh(input: { orgId: string; card: CardIdentity; cycleStart: string; utilization: number; available: number }): Promise<void> {
  const name = cardLabel(input.card)
  const pct = Math.round(input.utilization * 100)
  await notifyOrgMembers(input.orgId, {
    type: "card_utilization_high",
    title: "Card close to its limit",
    body: `${name} is at ${pct}% of its limit — ${money(input.available)} left.`,
    data: { i18nKey: "types.card_utilization_high.title", i18nBodyKey: "types.card_utilization_high.body", i18nParams: { card: name, pct, available: money(input.available) } },
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
