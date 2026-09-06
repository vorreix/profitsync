// Server side of Cards: loading/serializing card rows (joined with their
// ledger account + funding bank), validating a card as the payer of a
// transaction leg, and the shared "sync" every card read runs (recurring
// catch-up → statement filing → autopay → notifications).
//
// A card never holds money (docs/cards/CARDS.md): everything below is identity,
// attribution and scheduling. The ledger stays in wealth_accounts/transactions.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db, serialize } from "../../src/lib/db/index.js"
import { cards, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { logoDataUrl } from "../../src/lib/logo-data.js"
import type { BrandColor, CardDesign } from "../../src/lib/types.js"
import { isLiabilityType } from "../../src/lib/credit-card.js"

export type CardRow = typeof cards.$inferSelect

const fundingAccounts = alias(wealthAccounts, "funding_accounts")
const issuerAccounts = alias(wealthAccounts, "issuer_accounts")
const fundingCards = alias(cards, "funding_cards")

// The list/detail shape: the card + the columns of its ledger account (balance,
// limit, cycle days, brand) and its funding bank that the visuals need — one
// query, no N+1. logo_data is swapped for a durable data URL like the accounts
// list does.
const cardColumns = {
  id: cards.id,
  organizationId: cards.organizationId,
  kind: cards.kind,
  accountId: cards.accountId,
  fundingAccountId: cards.fundingAccountId,
  issuerAccountId: cards.issuerAccountId,
  fundingCardId: cards.fundingCardId,
  name: cards.name,
  holderName: cards.holderName,
  network: cards.network,
  last4: cards.last4,
  expiryMonth: cards.expiryMonth,
  expiryYear: cards.expiryYear,
  tier: cards.tier,
  design: cards.design,
  brandColors: cards.brandColors,
  brandLogoUrl: cards.brandLogoUrl,
  autopay: cards.autopay,
  autopaySince: cards.autopaySince,
  status: cards.status,
  position: cards.position,
  createdAt: cards.createdAt,
  updatedAt: cards.updatedAt,
  accountType: wealthAccounts.type,
  accountBankName: wealthAccounts.bankName,
  accountNickname: wealthAccounts.nickname,
  accountCurrentBalance: wealthAccounts.currentBalance,
  accountCreditLimit: wealthAccounts.creditLimit,
  accountStatementClosingDay: wealthAccounts.statementClosingDay,
  accountPaymentDueDay: wealthAccounts.paymentDueDay,
  accountBrandDomain: wealthAccounts.brandDomain,
  accountLogoUrl: wealthAccounts.logoUrl,
  accountLogoData: wealthAccounts.logoData,
  accountArchivedAt: wealthAccounts.archivedAt,
  fundingAccountBankName: fundingAccounts.bankName,
  fundingAccountNickname: fundingAccounts.nickname,
  fundingAccountLogoData: fundingAccounts.logoData,
  fundingAccountArchivedAt: fundingAccounts.archivedAt,
  issuerAccountBankName: issuerAccounts.bankName,
  issuerAccountNickname: issuerAccounts.nickname,
  issuerAccountLogoData: issuerAccounts.logoData,
  issuerAccountArchivedAt: issuerAccounts.archivedAt,
  fundingCardName: fundingCards.name,
  fundingCardKind: fundingCards.kind,
  fundingCardLast4: fundingCards.last4,
  fundingCardNetwork: fundingCards.network,
  fundingCardStatus: fundingCards.status,
  transactionCount: sql<number>`(select count(*)::int from transactions t where t.card_id = ${cards.id} and t.deleted_at is null)`,
}

type JoinedCard = {
  [K in keyof typeof cardColumns]: (typeof cardColumns)[K] extends { _: { data: infer D } } ? D : unknown
}

/**
 * The status a card EFFECTIVELY has: its ledger account being archived closes
 * it (a credit card's liability account IS the card; a debit card on a closed
 * bank has nothing to spend from). One derivation, so the quota (which counts
 * accounts) and every picker agree.
 */
export function effectiveCardStatus(row: { status: string; accountArchivedAt?: Date | string | null }): "active" | "frozen" | "closed" {
  if (row.accountArchivedAt) return "closed"
  return row.status === "frozen" ? "frozen" : row.status === "closed" ? "closed" : "active"
}

/** Drop the base64 blobs, add durable logo data URLs, derive the status, snake_case the keys. */
export function serializeCard(row: JoinedCard): Record<string, unknown> {
  const { accountLogoData, fundingAccountLogoData, issuerAccountLogoData, ...rest } = row as JoinedCard & {
    accountLogoData?: unknown
    fundingAccountLogoData?: unknown
    issuerAccountLogoData?: unknown
  }
  return serialize({
    ...rest,
    status: effectiveCardStatus(rest as { status: string; accountArchivedAt?: Date | null }),
    accountLogoSrc: logoDataUrl(typeof accountLogoData === "string" ? accountLogoData : null),
    fundingAccountLogoSrc: logoDataUrl(typeof fundingAccountLogoData === "string" ? fundingAccountLogoData : null),
    issuerAccountLogoSrc: logoDataUrl(typeof issuerAccountLogoData === "string" ? issuerAccountLogoData : null),
  })
}

function baseQuery() {
  return db
    .select(cardColumns)
    .from(cards)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, cards.accountId))
    .leftJoin(fundingAccounts, eq(fundingAccounts.id, cards.fundingAccountId))
    .leftJoin(issuerAccounts, eq(issuerAccounts.id, cards.issuerAccountId))
    .leftJoin(fundingCards, eq(fundingCards.id, cards.fundingCardId))
}

/** The org's cards: open ones first (user order), then closed (when asked). */
export async function loadCards(orgId: string, opts: { includeClosed?: boolean } = {}): Promise<JoinedCard[]> {
  const rows = await baseQuery()
    .where(and(eq(cards.organizationId, orgId), opts.includeClosed ? undefined : and(ne(cards.status, "closed"), sql`${wealthAccounts.archivedAt} is null`)))
    .orderBy(sql`(${cards.status} = 'closed' or ${wealthAccounts.archivedAt} is not null)`, asc(cards.position), asc(cards.createdAt))
  return rows as JoinedCard[]
}

export async function loadCard(orgId: string, id: string): Promise<JoinedCard | null> {
  const [row] = await baseQuery().where(and(eq(cards.id, id), eq(cards.organizationId, orgId))).limit(1)
  return (row as JoinedCard | undefined) ?? null
}

// ── Leg validation / attribution ─────────────────────────────────────────────

export type ResolvedCard = { ok: true; card: CardRow; accountId: string } | { ok: false; error: string }

/**
 * May this card pay a transaction leg, and which ledger account does the money
 * land on? The card must be the org's, not closed, on an active account, and
 * ACTIVE unless `allowFrozen` (a frozen card takes no new purchases, but may
 * still receive a payment); and when the caller also names an account it must
 * be the card's own — a card can never post to another account.
 */
export async function resolveCardForLeg(orgId: string, cardId: string, wealthAccountId?: string | null, opts: { allowFrozen?: boolean } = {}): Promise<ResolvedCard> {
  const [row] = await db
    .select({ card: cards, accountArchivedAt: wealthAccounts.archivedAt })
    .from(cards)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, cards.accountId))
    .where(and(eq(cards.id, cardId), eq(cards.organizationId, orgId)))
    .limit(1)
  if (!row) return { ok: false, error: "Card not found" }
  if (row.card.status === "frozen" && !opts.allowFrozen) return { ok: false, error: "This card is frozen — unfreeze it to use it" }
  if (row.card.status === "closed") return { ok: false, error: "This card is closed" }
  if (row.accountArchivedAt) return { ok: false, error: "The card's account is archived" }
  if (wealthAccountId && wealthAccountId !== row.card.accountId) return { ok: false, error: "A card can only pay from its own account" }
  return { ok: true, card: row.card, accountId: row.card.accountId }
}

export type Attribution = { ok: true; accountId: string | null; cardId: string | null } | { ok: false; error: string }

/**
 * THE one rule every write path applies to the (card_id, wealth_account_id)
 * pair (docs/cards/CARDS.md):
 *   • a card named → the money lands on that card's own account (400 if the
 *     caller says otherwise) and the card must be usable (see resolveCardForLeg);
 *   • no card, but the account is a credit card's liability account → the row
 *     carries that credit card (the card IS the account, 1:1) — so legacy
 *     callers (AI quick-add, system rows, the old account routes) still attribute;
 *   • otherwise plain account, no card.
 * Used by POST /api/transactions, /group, PATCH /:id, recurring create/edit,
 * the materializer and transfers.
 */
export async function attributeCard(
  orgId: string,
  input: { cardId?: string | null; wealthAccountId?: string | null; allowFrozen?: boolean },
): Promise<Attribution> {
  if (input.cardId) {
    const resolved = await resolveCardForLeg(orgId, input.cardId, input.wealthAccountId ?? undefined, { allowFrozen: input.allowFrozen })
    if (!resolved.ok) return resolved
    return { ok: true, accountId: resolved.accountId, cardId: resolved.card.id }
  }
  if (!input.wealthAccountId) return { ok: true, accountId: null, cardId: null }
  const [row] = await db
    .select({ id: cards.id, status: cards.status })
    .from(cards)
    .innerJoin(wealthAccounts, eq(wealthAccounts.id, cards.accountId))
    .where(and(eq(cards.accountId, input.wealthAccountId), eq(cards.kind, "credit"), eq(cards.organizationId, orgId)))
    .limit(1)
  if (row && row.status === "frozen" && !input.allowFrozen) return { ok: false, error: "This card is frozen — unfreeze it to use it" }
  return { ok: true, accountId: input.wealthAccountId, cardId: row?.id ?? null }
}

/** Which transactions "belong to" a card for its detail list: a credit card owns its whole liability account; a debit card owns the rows that carry its id. */
export async function cardTransactionFilter(orgId: string, cardId: string) {
  const [row] = await db
    .select({ kind: cards.kind, accountId: cards.accountId })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.organizationId, orgId)))
    .limit(1)
  if (!row) return null
  return row.kind === "credit"
    ? { kind: "credit" as const, where: eq(transactions.wealthAccountId, row.accountId) }
    : { kind: "debit" as const, where: eq(transactions.cardId, cardId) }
}

// ── Brand palette helpers ────────────────────────────────────────────────────

export function coerceBrandColors(v: unknown): BrandColor[] | null {
  if (!Array.isArray(v)) return null
  const out = v
    .filter((c): c is { hex: string; type?: unknown; brightness?: unknown } => !!c && typeof c === "object" && typeof (c as { hex?: unknown }).hex === "string")
    .map((c) => ({ hex: c.hex, type: String(c.type ?? "other"), ...(typeof c.brightness === "number" ? { brightness: c.brightness } : {}) }))
  return out.length ? out : null
}

export function coerceDesign(v: unknown): CardDesign | null {
  if (!v || typeof v !== "object") return null
  return v as CardDesign
}

/** The credit card that IS this liability account (1:1), or null. */
export async function creditCardIdFor(accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.accountId, accountId), eq(cards.kind, "credit")))
    .limit(1)
  return row?.id ?? null
}

/** Sync a credit card's status with its liability account (archive ⇄ close). Called by the account PATCH/DELETE routes. */
export async function syncCardStatusWithAccount(accountId: string, archived: boolean, userId: string): Promise<void> {
  await db
    .update(cards)
    .set({ status: archived ? "closed" : "active", updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(cards.accountId, accountId), eq(cards.kind, "credit"), archived ? ne(cards.status, "closed") : eq(cards.status, "closed")))
}

/** The org's non-closed cards on (or funded by) an account — what archiving a bank would strand. */
export async function openCardsOnAccount(orgId: string, accountId: string): Promise<CardRow[]> {
  return db
    .select()
    .from(cards)
    .where(and(eq(cards.organizationId, orgId), eq(cards.accountId, accountId), ne(cards.status, "closed")))
}

/** Credit cards whose statements are paid from this account (autopay source). */
export async function cardsFundedBy(orgId: string, accountId: string): Promise<CardRow[]> {
  return db
    .select()
    .from(cards)
    .where(and(eq(cards.organizationId, orgId), eq(cards.fundingAccountId, accountId), ne(cards.status, "closed")))
}

// ── Funding: who pays a credit card ──────────────────────────────────────────

export type ResolvedFunding =
  | { ok: true; accountId: string | null; cardId: string | null; isLiability: boolean }
  | { ok: false; error: string; code?: string }

/**
 * THE one rule for the paying side of a credit card, applied by POST /api/cards
 * and PATCH /api/cards/:id so the stored pair can never disagree:
 *
 *   • `accountId` is always the account the money LEAVES;
 *   • `cardId` is the optional INSTRUMENT, and when given the account is forced
 *     to that card's own — the same rule attributeCard applies to every
 *     transaction leg, so a card can never post to another account;
 *   • a card may not pay itself (`payeeAccountId` / `payeeCardId` guard the
 *     same-row CHECKs with a message instead of a constraint violation);
 *   • a LIABILITY funder (paying one card with another) is allowed and reported
 *     back as `isLiability`, so the caller can force autopay off. That single
 *     rule is what makes a funding cycle impossible without walking the graph:
 *     a loop needs two unattended payers, and a card can never be one.
 *
 * `cardId: null` with an account clears any previous instrument, which is what
 * an older client posting only `funding_account_id` must mean.
 */
export async function resolveFunding(
  orgId: string,
  input: { accountId?: string | null; cardId?: string | null; payeeCardId: string; payeeAccountId: string },
): Promise<ResolvedFunding> {
  if (!input.accountId && !input.cardId) return { ok: true, accountId: null, cardId: null, isLiability: false }

  let accountId = input.accountId ?? null
  let cardId: string | null = null

  if (input.cardId) {
    if (input.cardId === input.payeeCardId) return { ok: false, error: "A card can't pay itself", code: "funding_self" }
    // allowFrozen: a frozen card cannot take new purchases, but the money still
    // leaves the bank behind it and the user may well still be paying with it.
    const resolved = await resolveCardForLeg(orgId, input.cardId, accountId ?? undefined, { allowFrozen: true })
    if (!resolved.ok) return { ok: false, error: resolved.error, code: "funding_card" }
    accountId = resolved.accountId
    cardId = resolved.card.id
  }

  if (!accountId) return { ok: true, accountId: null, cardId: null, isLiability: false }
  if (accountId === input.payeeAccountId) return { ok: false, error: "A card can't pay itself", code: "funding_self" }

  const [account] = await db
    .select({ id: wealthAccounts.id, type: wealthAccounts.type })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, accountId), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  if (!account) return { ok: false, error: "The paying account must be active", code: "funding_account" }
  const liability = isLiabilityType(account.type)
  if (account.type !== "bank" && account.type !== "cash" && !liability) {
    return { ok: false, error: "Pay from a bank, cash, or another card", code: "funding_account" }
  }
  return { ok: true, accountId: account.id, cardId, isLiability: liability }
}
