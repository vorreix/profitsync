import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, getTableColumns, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { canDelete, canWrite, ensureDefaultClient, requireAuth } from "../../../_lib/auth.js"
import { DEFAULT_CASH_NAME } from "../../../_lib/wealth-accounts.js"
import { diffFields, logAudit } from "../../../_lib/audit.js"
import { type AppearanceInput, pickAppearance } from "../../../_lib/account-appearance.js"
import { type BankDetailInput, pickBankDetails, resolveLogoColumns } from "../../../_lib/bank-brand.js"
import { amountExceedsLimit, moneyRefusal, normalizeCurrencyCode, selectableCurrencyCode } from "../../../../src/lib/money.js"
import { logoDataUrl } from "../../../../src/lib/logo-data.js"
import { checkBankAccountQuota, checkCreditCardQuota } from "../../../_lib/quota.js"
import { cardDebt, isLiabilityType, isValidDayOfMonth, signedBalanceFromDebt } from "../../../../src/lib/credit-card.js"
import { cards } from "../../../../src/lib/db/schema.js"
import { cardsFundedBy, creditCardIdFor, openCardsOnAccount, syncCardStatusWithAccount } from "../../../_lib/cards.js"
import { currencyLockRefs, withCurrencyLock } from "../../../_lib/account-currency-lock.js"
import { accountCurrencyLockReason } from "../../../../src/lib/account-currency-lock.js"
import { reportingCurrencyFor } from "../../../_lib/fx-rates.js"

function money(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// Swap the heavy base64 column for a durable `logo_src` data URL the client can
// render directly (the hotlinked logo_url expires; the stored copy doesn't).
function withLogoSrc<T extends { logoData?: unknown }>(row: T) {
  const { logoData, ...rest } = row
  return { ...rest, logoSrc: logoDataUrl(typeof logoData === "string" ? logoData : null) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  // The currency-lock facts ride along on the one read: the GET hands the
  // picker its flag and the PATCH refuses from the very same columns.
  const [account] = await db
    .select({ ...getTableColumns(wealthAccounts), ...currencyLockRefs })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
  if (!account) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    // A liability account IS a credit card: hand the client the card id so
    // /wealth/:id can forward to the card screen.
    const cardId = isLiabilityType(account.type) ? await creditCardIdFor(account.id) : null
    return res.json(serialize({ ...withCurrencyLock(withLogoSrc(account)), cardId }))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as BankDetailInput & AppearanceInput & {
      bank_name?: string
      bankName?: string
      nickname?: string
      icon?: string
      current_balance?: number
      currentBalance?: number
      currency_code?: string
      // Credit card: the amount OWED (converted to the signed balance here, so
      // no client ever handles the liability sign) + configuration.
      current_debt?: number | string
      credit_limit?: number | string
      statement_closing_day?: number
      payment_due_day?: number
      archive?: boolean
      restore?: boolean
      set_default?: boolean
    }
    const { nickname, icon, archive, restore } = body
    // Colour identity — only the keys actually present are touched, so a
    // rename or a balance adjustment never resets a colour.
    const appearance = pickAppearance(body)
    if (!appearance.ok) return res.status(400).json({ error: appearance.error })
    const setDefault = typeof body.set_default === "boolean" ? body.set_default : undefined
    const bankName = body.bankName ?? body.bank_name
    const isCard = isLiabilityType(account.type)
    // `reason` + `currency` let the client say WHY in the user's language
    // instead of echoing this English line.
    const currencyLocked = (reason: string | null, currency: string | null) => res.status(409).json({
      error: "This account's currency cannot be changed after financial history exists. Create another account and transfer the money instead.",
      code: "account_currency_locked",
      reason: reason ?? "history",
      currency,
    })
    let currencyCode = account.currencyCode
    if (body.currency_code !== undefined) {
      try {
        currencyCode = normalizeCurrencyCode(body.currency_code)
      } catch {
        return res.status(400).json({ error: "Invalid currency code", code: "invalid_currency" })
      }
      // One predicate, shared with the GETs' `currency_locked` flag
      // (src/lib/account-currency-lock.ts); re-asserted in the write below.
      const reason = currencyCode !== account.currencyCode ? accountCurrencyLockReason(account) : null
      if (reason) return currencyLocked(reason, account.currencyCode)
      // A currency it moves TO is one new money may be created in (not KWD,
      // whose third decimal the columns can't keep); its own always passes, and
      // so does the workspace's, which POST accepts for a new account.
      if (!(selectableCurrencyCode(currencyCode, account.currencyCode) ?? selectableCurrencyCode(currencyCode, await reportingCurrencyFor(orgId)))) {
        return res.status(400).json({ error: "Invalid currency code", code: "invalid_currency" })
      }
    }
    let currentBalance = body.currentBalance ?? body.current_balance
    if (isCard && body.current_debt !== undefined) {
      const debt = Number(body.current_debt)
      if (!Number.isFinite(debt) || debt < 0) return res.status(400).json({ error: "current_debt must be 0 or more" })
      currentBalance = signedBalanceFromDebt(debt)
    }
    if (currentBalance !== undefined && amountExceedsLimit(currentBalance)) return res.status(400).json({ error: "Amount is too large" })
    // To the (new) currency's decimals, so the Balance Adjustment row and the
    // balance store the same figure (MC-047) — but only what this request
    // changes: the edit dialog resends both, and a legacy ¥1,500.50 balance
    // must still take a rename (MC-031).
    const restated = (value: unknown, stored: unknown) =>
      value !== undefined && (currencyCode !== account.currencyCode || Number(value) !== Number(stored)) ? value : undefined
    // A card's debt is checked AS TYPED: signedBalanceFromDebt rounds to cents,
    // so checking its result let a $10.555 debt be stored as $10.56 with a 200.
    const balanceAsTyped = isCard && body.current_debt !== undefined
      ? restated(body.current_debt, cardDebt(account.currentBalance))
      : restated(currentBalance, account.currentBalance)
    const badAmount = moneyRefusal(currencyCode, balanceAsTyped, isCard ? restated(body.credit_limit, account.creditLimit) : undefined)
    if (badAmount) return res.status(400).json(badAmount)
    // Card configuration (cards only). Changing the closing day only affects
    // FUTURE filings; statements already on record are immutable history.
    const cardPatch: { creditLimit?: string; statementClosingDay?: number; paymentDueDay?: number } = {}
    if (isCard) {
      if (body.credit_limit !== undefined) {
        const limit = Number(body.credit_limit)
        if (!Number.isFinite(limit) || limit <= 0 || amountExceedsLimit(limit)) return res.status(400).json({ error: "credit_limit must be greater than 0" })
        cardPatch.creditLimit = String(limit)
      }
      if (body.statement_closing_day !== undefined) {
        if (!isValidDayOfMonth(Number(body.statement_closing_day))) return res.status(400).json({ error: "statement_closing_day must be 1..31" })
        cardPatch.statementClosingDay = Number(body.statement_closing_day)
      }
      if (body.payment_due_day !== undefined) {
        if (!isValidDayOfMonth(Number(body.payment_due_day))) return res.status(400).json({ error: "payment_due_day must be 1..31" })
        cardPatch.paymentDueDay = Number(body.payment_due_day)
      }
      const nextClosing = cardPatch.statementClosingDay ?? account.statementClosingDay
      const nextDue = cardPatch.paymentDueDay ?? account.paymentDueDay
      if (nextClosing != null && nextDue != null && nextClosing === nextDue) return res.status(400).json({ error: "Closing day and due day must differ" })
    }

    // Bank-detail fields are only updated when at least one is present in the
    // body (so a plain rename/adjust PATCH doesn't wipe them). Logo is re-fetched
    // only when the brand domain / logo url is part of this update.
    const hasDetailUpdate = ["brand_domain", "logo_url", "country", "account_number", "routing_number", "swift", "address", "location", "note"]
      .some((k) => k in (body as Record<string, unknown>))
    const details = (account.type === "bank" || isCard) && hasDetailUpdate ? pickBankDetails(body) : null
    const logo = details && ("brand_domain" in body || "logo_url" in body)
      ? await resolveLogoColumns(details.brandDomain, details.logoUrl)
      : null

    // The DEFAULT cash wallet must always exist — it can be re-iconed and have
    // its balance adjusted, but never archived. Every OTHER cash wallet is one
    // the user made (one per currency since mig 0069) and archives like any
    // account. Keyed on `bank_name`, exactly as the DELETE path below and the
    // default-cash unique index are.
    const isDefaultCash = account.type === "cash" && account.bankName === DEFAULT_CASH_NAME
    if (archive && isDefaultCash) {
      return res.status(400).json({ error: "Cash in Hand can't be archived", code: "default_cash_permanent" })
    }
    // A credit card that still owes money can't be closed (nothing could pay it).
    // A credit card that still owes money can't be closed (nothing could pay it
    // afterwards) — but only when there IS money history behind the balance: a
    // stored balance with no rows left is an artifact of a purge, not a debt.
    if (archive && isCard && !account.archivedAt && cardDebt(account.currentBalance) > 0) {
      const [{ rows }] = await db.select({ rows: count() }).from(transactions).where(eq(transactions.wealthAccountId, id))
      if (rows > 0) return res.status(409).json({ error: "Pay off the card before closing it", code: "card_has_debt", debt: cardDebt(account.currentBalance) })
    }

    if ((account.type === "bank" || isCard) && bankName !== undefined && !bankName.trim()) {
      return res.status(400).json({ error: "bankName is required" })
    }
    // Active wallets OTHER than this one holding the default name — exactly the
    // rows wealth_accounts_one_default_cash_idx would collide with, so each
    // check below refuses with a 400 only when the write would otherwise 500.
    const otherActiveDefaults = async () => {
      const [{ total }] = await db
        .select({ total: count() })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "cash"), eq(wealthAccounts.bankName, DEFAULT_CASH_NAME), isNull(wealthAccounts.archivedAt), sql`${wealthAccounts.id} != ${id}`))
      return total
    }
    // The default wallet's name is reserved while an active default holds it.
    // With none active (the default was renamed away — the edit dialog allows
    // it), taking the name back is how a wallet becomes the default again, so
    // it passes; refusing it would make that rename one-way. Keeping its own
    // name is not a rename, so the default wallet's edit dialog still saves.
    if (account.type === "cash" && bankName !== undefined && bankName.trim() === DEFAULT_CASH_NAME && !isDefaultCash && (await otherActiveDefaults()) >= 1) {
      return res.status(400).json({ error: `"${DEFAULT_CASH_NAME}" is reserved for the default cash wallet`, code: "reserved_cash_name" })
    }
    if (icon !== undefined && !icon.trim()) {
      return res.status(400).json({ error: "icon is required" })
    }

    if (restore && account.archivedAt) {
      // Only the default wallet is unique (the index predicate); an extra cash
      // wallet reopens freely alongside it.
      if (isDefaultCash && (await otherActiveDefaults()) >= 1) {
        return res.status(400).json({ error: "Cash in Hand already exists", code: "default_cash_exists" })
      }
      if (account.type === "bank") {
        // Reopening: free plans block if already at the 1-active limit (forcing an
        // upgrade); paid plans always allow (the bank already counts toward 20).
        const quota = await checkBankAccountQuota(orgId, { forRestore: true })
        if (!quota.allowed) return res.status(402).json(quota)
      }
      if (isCard) {
        const quota = await checkCreditCardQuota(orgId, { forRestore: true })
        if (!quota.allowed) return res.status(402).json(quota)
      }
    }

    // The currency change, with the lock re-asserted IN the write (as
    // cards/[id].ts and debts/[id].ts do): a row, rule, card or transfer — or
    // another currency change — that landed since the read above makes this
    // match nothing → 409, before the default flip, the Balance Adjustment and
    // the rest of the patch are written (that adjustment's own row would
    // otherwise lock it).
    // ponytail: a writer that read the OLD currency before this commits (the
    // transaction POST stamps the code it read) can still insert after it;
    // closing that needs each writer to re-read the code in its own insert.
    if (currencyCode !== account.currencyCode) {
      const { hasRows, hasRecurring, hasCards, hasOpenTransfers } = currencyLockRefs
      const moved = await db
        .update(wealthAccounts)
        .set({ currencyCode, updatedBy: userId, updatedAt: new Date() })
        .where(and(
          eq(wealthAccounts.id, id),
          account.currencyCode ? eq(wealthAccounts.currencyCode, account.currencyCode) : isNull(wealthAccounts.currencyCode),
          sql`${wealthAccounts.currentBalance} = 0 and ${wealthAccounts.openingBalance} = 0`,
          sql`not (${hasRows} or ${hasRecurring} or ${hasCards} or ${hasOpenTransfers})`,
        ))
        .returning({ id: wealthAccounts.id })
      if (moved.length === 0) {
        const [now] = await db
          .select({ ...getTableColumns(wealthAccounts), ...currencyLockRefs })
          .from(wealthAccounts)
          .where(eq(wealthAccounts.id, id))
        return currencyLocked(now ? accountCurrencyLockReason(now) : null, now?.currencyCode ?? account.currencyCode)
      }
    }

    // Default flip. Two steps — clear, then set — because a single UPDATE that
    // flips both rows can transiently hold two `true` entries (row order is
    // unspecified) and trip the one-active-default unique index. The in-between
    // state (no default) is benign; selectors fall back to Cash.
    if (setDefault === true) {
      if (account.archivedAt) return res.status(400).json({ error: "Restore the account before making it default" })
      await db
        .update(wealthAccounts)
        .set({ isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.isDefault, true), sql`${wealthAccounts.id} != ${id}`))
      await db
        .update(wealthAccounts)
        .set({ isDefault: true, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
    } else if (setDefault === false) {
      await db
        .update(wealthAccounts)
        .set({ isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
    }

    const [before] = await db.select().from(wealthAccounts).where(eq(wealthAccounts.id, id))
    const oldBalance = money(before.currentBalance)
    const newBalance = currentBalance !== undefined ? money(currentBalance) : oldBalance
    const delta = newBalance - oldBalance

    if (delta !== 0) {
      const clientId = await ensureDefaultClient(orgId, userId)
      const txType = delta > 0 ? "incoming" : "outgoing"
      const [tx] = await db
        .insert(transactions)
        .values({
          clientId,
          wealthAccountId: id,
          type: txType,
          amount: String(Math.abs(delta)),
          // The POST-patch currency: a PATCH may change the currency and the
          // balance together (the lock passed, so nothing is denominated in the
          // old one yet), and this row is denominated in what the account
          // becomes — stamping the old code left a 100 EUR account whose only
          // row said 100 USD (MC-055).
          currencyCode,
          description: "Balance Adjustment",
          category: "Adjustment",
          date: new Date().toISOString().split("T")[0],
          isSystem: true,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning()
      await logAudit({ orgId, entityType: "transaction", entityId: tx.id, action: "create", actorId: userId })
    }

    const [updated] = await db
      .update(wealthAccounts)
      .set({
        // A blank name keeps the current one (bank/card blanks are refused above);
        // falling back to the reserved default name would hand it to any wallet.
        ...(bankName !== undefined ? { bankName: bankName.trim() || account.bankName } : {}),
        ...(nickname !== undefined ? { nickname: nickname.trim() } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...appearance.patch,
        ...(currentBalance !== undefined ? { currentBalance: String(newBalance) } : {}),
        ...cardPatch,
        ...(details ?? {}),
        ...(logo ? { logoUrl: logo.logoUrl, logoData: logo.logoData } : {}),
        // Archiving or restoring clears the default flag (an archived default is
        // meaningless, and restoring while another default exists would violate
        // the one-active-default index).
        ...(archive ? { archivedAt: new Date(), isDefault: false } : {}),
        ...(restore ? { archivedAt: null, isDefault: false } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(wealthAccounts.id, id))
      .returning()

    // Keep the cards on this account coherent with it (docs/cards/CARDS.md):
    // closing a bank closes the debit cards that spend from it and switches
    // autopay off for the credit cards it pays; a liability account's card
    // follows it (closed ⇄ active). Reopening a bank does NOT reopen its cards
    // — the user reopens the ones they still use.
    if (archive && !before.archivedAt) {
      if (isCard) {
        await syncCardStatusWithAccount(id, true, userId)
      } else {
        await db
          .update(cards)
          .set({ status: "closed", updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(cards.accountId, id), eq(cards.organizationId, orgId), sql`${cards.status} <> 'closed'`))
        await db
          .update(cards)
          .set({ autopay: false, autopaySince: null, updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(cards.fundingAccountId, id), eq(cards.organizationId, orgId), eq(cards.autopay, true)))
      }
    }
    if (restore && before.archivedAt && isCard) await syncCardStatusWithAccount(id, false, userId)

    const changes = diffFields(
      // The guarded write above already moved the currency: diff it from the first read.
      { ...before, currencyCode: account.currencyCode } as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["bankName", "nickname", "icon", "color", "colorStyle", "currencyCode", "currentBalance", "archivedAt", "isDefault", "country", "accountNumber", "routingNumber", "swift", "address", "location", "note", "creditLimit", "statementClosingDay", "paymentDueDay"],
    )
    if (Object.keys(changes).length) {
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: archive ? "close" : restore ? "reopen" : "update", actorId: userId, changes })
    }
    return res.json(serialize(withLogoSrc(updated)))
  }

  if (req.method === "DELETE") {
    // Matches the other entity DELETEs (owner/admin only). Editors can still
    // CLOSE an account via PATCH { archive: true }.
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // The DEFAULT cash wallet is permanent — it is auto-provisioned on first
    // read (api/_routes/wealth/accounts.ts ensureCashAccount) and would simply
    // come back. Any OTHER cash wallet is one the user made, and since a
    // workspace may now hold several (one per currency — mig 0069 lifted the
    // one-wallet rule), it follows the ordinary rules below: archived when it
    // has history, deleted when it is clean. `bank_name` is the discriminator
    // the provisioner and that migration's unique index both use.
    if (account.type === "cash" && account.bankName === DEFAULT_CASH_NAME) {
      return res.status(400).json({ error: "Cash in Hand can't be removed", code: "default_cash_permanent" })
    }
    const isCard = isLiabilityType(account.type)
    // Trashed rows count too: a hard delete would strip their attribution.
    const [{ total }] = await db
      .select({ total: count() })
      .from(transactions)
      .where(eq(transactions.wealthAccountId, id))
    if (isCard && !account.archivedAt && total > 0 && cardDebt(account.currentBalance) > 0) {
      return res.status(409).json({ error: "Pay off the card before closing it", code: "card_has_debt", debt: cardDebt(account.currentBalance) })
    }
    // Cards are identity the user typed in — never let a bank delete cascade
    // them away silently; a bank with cards is archived instead.
    const linkedCards = isCard ? [] : [...(await openCardsOnAccount(orgId, id)), ...(await cardsFundedBy(orgId, id))]

    if (total > 0 || linkedCards.length > 0) {
      const [updated] = await db
        .update(wealthAccounts)
        .set({ archivedAt: new Date(), isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, id))
        .returning()
      if (isCard) {
        await syncCardStatusWithAccount(id, true, userId)
      } else {
        await db
          .update(cards)
          .set({ status: "closed", updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(cards.accountId, id), eq(cards.organizationId, orgId), sql`${cards.status} <> 'closed'`))
        await db
          .update(cards)
          .set({ autopay: false, autopaySince: null, updatedBy: userId, updatedAt: new Date() })
          .where(and(eq(cards.fundingAccountId, id), eq(cards.organizationId, orgId), eq(cards.autopay, true)))
      }
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "close", actorId: userId })
      return res.json(serialize(withLogoSrc(updated)))
    }

    await db.delete(wealthAccounts).where(eq(wealthAccounts.id, id))
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
