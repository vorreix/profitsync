import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { cards, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { fetchBrandPalette } from "../../_lib/bank-brand.js"
import { loadCard, resolveFunding, serializeCard } from "../../_lib/cards.js"
import { checkCreditCardQuota } from "../../_lib/quota.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { cardDebt, isLiabilityType, isValidDayOfMonth } from "../../../src/lib/credit-card.js"
import { todayIso } from "../../../src/lib/recurring.js"
import { recurringRules } from "../../../src/lib/db/schema.js"
import { pickCardIdentity } from "../cards.js"

const CARD_STATUSES = ["active", "frozen", "closed"] as const

/**
 * GET    /api/cards/:id   one card (joined with its accounts)
 * PATCH  /api/cards/:id   identity / design / funding bank / autopay / status /
 *                         credit configuration (limit + cycle days)
 * DELETE /api/cards/:id   remove — or close, when money history refers to it
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }
  // A malformed id is "not found", not a 500 from the uuid cast.
  if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return res.status(404).json({ error: "Not found" })

  const [card] = await db.select().from(cards).where(and(eq(cards.id, id), eq(cards.organizationId, orgId)))
  if (!card) return res.status(404).json({ error: "Not found" })
  const [account] = await db.select().from(wealthAccounts).where(eq(wealthAccounts.id, card.accountId))
  if (!account) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    const full = await loadCard(orgId, id)
    return full ? res.json(serializeCard(full)) : res.status(404).json({ error: "Not found" })
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      name?: unknown
      holder_name?: unknown
      network?: unknown
      last4?: unknown
      expiry_month?: unknown
      expiry_year?: unknown
      tier?: unknown
      design?: unknown
      account_id?: string | null
      funding_account_id?: string | null
      funding_card_id?: string | null
      autopay?: unknown
      status?: unknown
      refresh_brand?: boolean
      credit?: { credit_limit?: number | string; statement_closing_day?: number; payment_due_day?: number } | null
    }

    const patch: Partial<typeof cards.$inferInsert> = {}
    const identityKeys = ["name", "holder_name", "network", "last4", "expiry_month", "expiry_year", "tier", "design"] as const
    if (identityKeys.some((k) => k in body)) {
      // Merge over the saved values so a partial PATCH never blanks a field.
      const merged = {
        name: body.name ?? card.name,
        holder_name: body.holder_name ?? card.holderName,
        network: body.network ?? card.network,
        last4: body.last4 ?? card.last4,
        expiry_month: "expiry_month" in body ? body.expiry_month : card.expiryMonth,
        expiry_year: "expiry_year" in body ? body.expiry_year : card.expiryYear,
        tier: body.tier ?? card.tier,
        design: "design" in body ? body.design : card.design,
      }
      const identity = pickCardIdentity(merged, account.bankName)
      if (!identity.ok) return res.status(400).json({ error: identity.error })
      Object.assign(patch, {
        name: identity.value.name,
        holderName: identity.value.holderName,
        network: identity.value.network,
        last4: identity.value.last4,
        expiryMonth: identity.value.expiryMonth,
        expiryYear: identity.value.expiryYear,
        tier: identity.value.tier,
        design: identity.value.design,
      })
      // A credit card's nickname is also its liability account's name.
      if (card.kind === "credit" && identity.value.name !== account.nickname) {
        await db.update(wealthAccounts).set({ nickname: identity.value.name, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, account.id))
      }
    }

    // Re-link a DEBIT card to another bank — only while nothing refers to it
    // yet: moving a card with history would silently move money between banks
    // (its rows stay on the old bank, its rules would post to the new one).
    if (card.kind === "debit" && body.account_id !== undefined && body.account_id !== card.accountId) {
      if (!body.account_id) return res.status(400).json({ error: "A debit card needs a bank account" })
      const [bank] = await db
        .select({ id: wealthAccounts.id, type: wealthAccounts.type })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, body.account_id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
      if (!bank || bank.type !== "bank") return res.status(400).json({ error: "Select an active bank account" })
      const [{ used }] = await db.select({ used: count() }).from(transactions).where(eq(transactions.cardId, id))
      const [{ rules }] = await db.select({ rules: count() }).from(recurringRules).where(eq(recurringRules.cardId, id))
      if (used > 0 || rules > 0) return res.status(409).json({ error: "This card already has history on its bank — close it and add a new card on the other bank", code: "card_has_history" })
      patch.accountId = bank.id
    }

    // Who pays this card: a bank, cash, or another CARD. One helper validates
    // the (account, card) pair for both write paths so the stored two can never
    // disagree. An older client that sends only `funding_account_id` means
    // "no instrument", so the previous card is cleared rather than left stale.
    // null = not worked out yet; only looked up when the request needs it.
    let fundingIsLiability: boolean | null = null
    if (card.kind === "credit" && (body.funding_account_id !== undefined || body.funding_card_id !== undefined)) {
      const wantAccount = body.funding_account_id !== undefined ? body.funding_account_id : card.fundingAccountId
      const wantCard = body.funding_card_id !== undefined ? body.funding_card_id : body.funding_account_id !== undefined ? null : card.fundingCardId
      const funding = await resolveFunding(orgId, {
        accountId: wantAccount,
        cardId: wantCard,
        payeeCardId: card.id,
        payeeAccountId: card.accountId,
      })
      if (!funding.ok) return res.status(400).json({ error: funding.error, code: funding.code })
      patch.fundingAccountId = funding.accountId
      patch.fundingCardId = funding.cardId
      fundingIsLiability = funding.isLiability
      // Losing the payer, or handing it to another card, always stops autopay.
      if (!funding.accountId || funding.isLiability) {
        patch.autopay = false
        patch.autopaySince = null
      }
    }

    if (card.kind === "credit" && body.autopay !== undefined) {
      const on = body.autopay === true
      const funding = patch.fundingAccountId !== undefined ? patch.fundingAccountId : card.fundingAccountId
      if (on && !funding) return res.status(400).json({ error: "Choose the bank that pays this card before switching autopay on" })
      // A card paying a card would compound debt on a schedule — and refusing
      // it is also what makes a funding cycle impossible without walking the
      // graph, since a loop needs two unattended payers.
      if (on && fundingIsLiability === null && funding) {
        // Autopay flipped on without touching the payer: read what it is now.
        const [f] = await db.select({ type: wealthAccounts.type }).from(wealthAccounts).where(eq(wealthAccounts.id, funding))
        fundingIsLiability = isLiabilityType(f?.type ?? "")
      }
      if (on && fundingIsLiability) {
        return res.status(400).json({ error: "A credit card can't pay another card automatically — pay it yourself each month", code: "autopay_liability" })
      }
      patch.autopay = on
      // Switching on (re)starts the clock: only statements due from today on
      // are ever auto-paid. Switching off clears it.
      patch.autopaySince = on ? (card.autopay ? card.autopaySince ?? todayIso() : todayIso()) : null
    }

    // Credit configuration → the liability account (same rules as the account PATCH).
    if (card.kind === "credit" && body.credit && typeof body.credit === "object") {
      const c = body.credit
      const acctPatch: { creditLimit?: string; statementClosingDay?: number; paymentDueDay?: number } = {}
      if (c.credit_limit !== undefined) {
        const limit = Number(c.credit_limit)
        if (!Number.isFinite(limit) || limit <= 0 || amountExceedsLimit(limit)) return res.status(400).json({ error: "credit_limit must be greater than 0" })
        acctPatch.creditLimit = String(limit)
      }
      if (c.statement_closing_day !== undefined) {
        if (!isValidDayOfMonth(Number(c.statement_closing_day))) return res.status(400).json({ error: "statement_closing_day must be 1..31" })
        acctPatch.statementClosingDay = Number(c.statement_closing_day)
      }
      if (c.payment_due_day !== undefined) {
        if (!isValidDayOfMonth(Number(c.payment_due_day))) return res.status(400).json({ error: "payment_due_day must be 1..31" })
        acctPatch.paymentDueDay = Number(c.payment_due_day)
      }
      const nextClosing = acctPatch.statementClosingDay ?? account.statementClosingDay
      const nextDue = acctPatch.paymentDueDay ?? account.paymentDueDay
      if (nextClosing != null && nextDue != null && nextClosing === nextDue) return res.status(400).json({ error: "Closing day and due day must differ" })
      if (Object.keys(acctPatch).length) {
        await db.update(wealthAccounts).set({ ...acctPatch, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, account.id))
        await logAudit({ orgId, entityType: "wealth_account", entityId: account.id, action: "update", actorId: userId, changes: diffFields(account as Record<string, unknown>, { ...account, ...acctPatch } as Record<string, unknown>, ["creditLimit", "statementClosingDay", "paymentDueDay"]) })
      }
    }

    // Status: freeze/unfreeze is card-only (canWrite); closing is destructive
    // (canDelete, like account archive). Close/reopen of a CREDIT card also
    // archives/restores its liability account — they are one thing — and a card
    // that still owes money cannot be closed (nothing could ever pay it again).
    if (body.status !== undefined) {
      if (!(CARD_STATUSES as readonly unknown[]).includes(body.status)) return res.status(400).json({ error: "status must be active, frozen or closed" })
      const next = body.status as (typeof CARD_STATUSES)[number]
      if (next !== card.status) {
        if (next === "closed" && !canDelete(role)) return res.status(403).json({ error: "Forbidden" })
        if (card.kind === "credit") {
          if (next === "closed" && !account.archivedAt) {
            // A card that still owes money can't be closed — nothing could ever
            // pay it afterwards. Only when there IS money history: a stored
            // balance with no rows behind it (a purged workspace) is an
            // artifact, not a debt.
            const debt = cardDebt(account.currentBalance)
            const [{ rows }] = await db.select({ rows: count() }).from(transactions).where(eq(transactions.wealthAccountId, account.id))
            if (debt > 0 && rows > 0) return res.status(409).json({ error: "Pay off the card before closing it", code: "card_has_debt", debt })
            await db.update(wealthAccounts).set({ archivedAt: new Date(), isDefault: false, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, account.id))
            await logAudit({ orgId, entityType: "wealth_account", entityId: account.id, action: "close", actorId: userId })
          } else if (next !== "closed" && account.archivedAt) {
            const quota = await checkCreditCardQuota(orgId, { forRestore: true })
            if (!quota.allowed) return res.status(402).json(quota)
            await db.update(wealthAccounts).set({ archivedAt: null, isDefault: false, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, account.id))
            await logAudit({ orgId, entityType: "wealth_account", entityId: account.id, action: "reopen", actorId: userId })
          }
        }
        patch.status = next
      }
    }

    if (body.refresh_brand) {
      const palette = account.brandDomain ? await fetchBrandPalette(account.brandDomain).catch(() => null) : null
      if (palette) {
        patch.brandColors = palette.colors.length ? palette.colors : null
        patch.brandLogoUrl = palette.logo_dark_url
      }
    }

    if (Object.keys(patch).length === 0) {
      const full = await loadCard(orgId, id)
      return res.json(full ? serializeCard(full) : { id })
    }

    const [updated] = await db
      .update(cards)
      .set({ ...patch, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(cards.id, id), eq(cards.organizationId, orgId)))
      .returning()
    const changes = diffFields(
      card as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["name", "holderName", "network", "last4", "expiryMonth", "expiryYear", "tier", "accountId", "fundingAccountId", "autopay", "status"],
    )
    if (Object.keys(changes).length) {
      await logAudit({ orgId, entityType: "card", entityId: id, action: patch.status === "closed" ? "close" : card.status === "closed" && patch.status ? "reopen" : "update", actorId: userId, changes })
    }
    const full = await loadCard(orgId, id)
    return res.json(full ? serializeCard(full) : { id })
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    if (card.kind === "credit") {
      // The liability account IS the card: same semantics as deleting the
      // account — gone when it has no history, archived (card closed) otherwise.
      // Never while money is still owed (nothing could pay it afterwards) — but
      // only when there IS history: a stored balance with no rows behind it is
      // an artifact of a purge, not a debt.
      const [{ total }] = await db
        .select({ total: count() })
        .from(transactions)
        .where(eq(transactions.wealthAccountId, account.id))
      if (total > 0 && cardDebt(account.currentBalance) > 0) {
        return res.status(409).json({ error: "Pay off the card before closing it", code: "card_has_debt", debt: cardDebt(account.currentBalance) })
      }
      if (total > 0) {
        await db.update(wealthAccounts).set({ archivedAt: new Date(), isDefault: false, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, account.id))
        await db.update(cards).set({ status: "closed", updatedBy: userId, updatedAt: new Date() }).where(eq(cards.id, id))
        await logAudit({ orgId, entityType: "wealth_account", entityId: account.id, action: "close", actorId: userId })
        await logAudit({ orgId, entityType: "card", entityId: id, action: "close", actorId: userId })
        const full = await loadCard(orgId, id)
        return res.json(full ? serializeCard(full) : { id, status: "closed" })
      }
      await db.delete(wealthAccounts).where(eq(wealthAccounts.id, account.id)) // cascades to the card
      await logAudit({ orgId, entityType: "wealth_account", entityId: account.id, action: "delete", actorId: userId })
      await logAudit({ orgId, entityType: "card", entityId: id, action: "delete", actorId: userId })
      return res.status(204).end()
    }
    // Debit: keep the attribution when money history refers to the card —
    // trashed rows included (a later restore must still show which card paid).
    const [{ total }] = await db
      .select({ total: count() })
      .from(transactions)
      .where(eq(transactions.cardId, id))
    if (total > 0) {
      await db.update(cards).set({ status: "closed", updatedBy: userId, updatedAt: new Date() }).where(eq(cards.id, id))
      await logAudit({ orgId, entityType: "card", entityId: id, action: "close", actorId: userId })
      const full = await loadCard(orgId, id)
      return res.json(full ? serializeCard(full) : { id, status: "closed" })
    }
    await db.delete(cards).where(and(eq(cards.id, id), eq(cards.organizationId, orgId)))
    await logAudit({ orgId, entityType: "card", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
