import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, max } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { debtDetails, organizations, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth } from "../_lib/auth.js"
import { logAudit } from "../_lib/audit.js"
import { resolveLogoColumns } from "../_lib/bank-brand.js"
import { buildDebtsOverview, DEBT_KINDS, loadDebt, serializeDebt } from "../_lib/debts.js"
import { amountExceedsLimit } from "../../src/lib/money.js"
import { PAYMENT_FREQUENCIES, type PaymentFrequency } from "../../src/lib/debt-math.js"
import { isValidDayOfMonth } from "../../src/lib/credit-card.js"
import { todayIso } from "../../src/lib/recurring.js"
import { isValidCurrency } from "../../src/lib/currencies.js"

const ISO = /^\d{4}-\d{2}-\d{2}$/
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/**
 * GET  /api/debts — the Debt Hub: every open debt (I owe) and receivable (owed
 *      to me) with derived status/progress/estimate, this month's obligations,
 *      the next payment, insights, and the next 3 months of scheduled payments.
 * POST /api/debts — create a debt. The money side is recorded exactly once:
 *      either the amount already owed becomes a system Opening Balance on the new
 *      debt account (nothing else moves), or — when the borrowed money is being
 *      received now — a TRANSFER debt → bank account (bank +, debt −; never income).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId))
  const orgCurrency = org?.currency ?? "USD"

  if (req.method === "GET") {
    return res.json(await buildDebtsOverview(orgId, orgCurrency))
  }

  if (req.method === "POST") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const b = (req.body ?? {}) as Record<string, unknown>
    const direction = b.direction === "receivable" ? "receivable" : "owed"
    const name = String(b.name ?? "").trim()
    const counterparty = String(b.counterparty ?? "").trim()
    if (!name && !counterparty) return res.status(400).json({ error: "Give the debt a name or say who it is with" })
    const kind = typeof b.kind === "string" && (DEBT_KINDS as readonly string[]).includes(b.kind) ? b.kind : direction === "receivable" ? "informal" : "other"
    const currency = typeof b.currency === "string" && b.currency.trim() ? b.currency.trim().toUpperCase() : orgCurrency
    if (!isValidCurrency(currency)) return res.status(400).json({ error: "Unknown currency" })

    const balance = num(b.current_balance)
    if (balance === null || Number.isNaN(balance) || balance < 0) return res.status(400).json({ error: "current_balance must be 0 or more" })
    if (amountExceedsLimit(balance)) return res.status(400).json({ error: "Amount is too large" })
    const original = num(b.original_amount)
    if (original !== null && (Number.isNaN(original) || original < 0 || amountExceedsLimit(original))) return res.status(400).json({ error: "original_amount is invalid" })
    const rate = num(b.annual_rate_pct)
    if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 1000)) return res.status(400).json({ error: "annual_rate_pct is invalid" })
    const rateType = b.rate_type === "fixed" || b.rate_type === "variable" ? b.rate_type : null
    const payment = num(b.payment_amount)
    if (payment !== null && (Number.isNaN(payment) || payment < 0 || amountExceedsLimit(payment))) return res.status(400).json({ error: "payment_amount is invalid" })
    const frequency = typeof b.payment_frequency === "string" && (PAYMENT_FREQUENCIES as readonly string[]).includes(b.payment_frequency) ? (b.payment_frequency as PaymentFrequency) : payment ? "monthly" : null
    const nextDue = typeof b.next_due_date === "string" && ISO.test(b.next_due_date) ? b.next_due_date : null
    const startDate = typeof b.start_date === "string" && ISO.test(b.start_date) ? b.start_date : null
    const maturity = typeof b.maturity_date === "string" && ISO.test(b.maturity_date) ? b.maturity_date : null
    const installments = num(b.remaining_installments)
    if (installments !== null && (!Number.isInteger(installments) || installments < 0)) return res.status(400).json({ error: "remaining_installments is invalid" })
    void isValidDayOfMonth
    const notes = String(b.notes ?? "").slice(0, 2000)
    const isEstimate = b.balance_is_estimate === true

    // Optional: the borrowed money is being received now, into this account.
    const disbursementAccountId = typeof b.disbursement_account_id === "string" ? b.disbursement_account_id : null
    let disbursement: typeof wealthAccounts.$inferSelect | null = null
    if (disbursementAccountId) {
      const [acc] = await db
        .select()
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, disbursementAccountId), eq(wealthAccounts.organizationId, orgId)))
      if (!acc || acc.archivedAt || acc.type === "space" || acc.type === "loan" || acc.type === "receivable") {
        return res.status(400).json({ error: "Choose an active bank or cash account to receive the money" })
      }
      disbursement = acc
    }

    const type = direction === "receivable" ? "receivable" : "loan"
    const signed = direction === "receivable" ? balance : -balance
    const brandDomain = typeof b.brand_domain === "string" ? b.brand_domain : ""
    const logoUrl = typeof b.logo_url === "string" ? b.logo_url : ""
    const logo = brandDomain || logoUrl ? await resolveLogoColumns(brandDomain, logoUrl) : null
    const [{ maxPos }] = await db.select({ maxPos: max(wealthAccounts.position) }).from(wealthAccounts).where(eq(wealthAccounts.organizationId, orgId))

    const [account] = await db
      .insert(wealthAccounts)
      .values({
        organizationId: orgId,
        type,
        bankName: counterparty || name,
        nickname: name,
        openingBalance: signed.toFixed(2),
        currentBalance: signed.toFixed(2),
        icon: typeof b.icon === "string" && b.icon ? b.icon : direction === "receivable" ? "custom" : "bank",
        brandDomain,
        position: (maxPos ?? -1) + 1,
        ...(logo ? { logoUrl: logo.logoUrl, logoData: logo.logoData } : {}),
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()

    const [details] = await db
      .insert(debtDetails)
      .values({
        organizationId: orgId,
        wealthAccountId: account.id,
        kind,
        counterparty,
        currency,
        originalAmount: original == null ? (balance > 0 ? balance.toFixed(2) : null) : original.toFixed(2),
        annualRatePct: rate == null ? null : rate.toFixed(4),
        rateType,
        paymentAmount: payment == null || payment === 0 ? null : payment.toFixed(2),
        paymentFrequency: frequency,
        nextDueDate: nextDue,
        startDate,
        maturityDate: maturity,
        remainingInstallments: installments,
        balanceIsEstimate: isEstimate,
        notes,
        createdBy: userId,
      })
      .returning()

    if (balance > 0) {
      const clientId = await ensureDefaultClient(orgId, userId)
      const today = todayIso()
      if (disbursement) {
        // Borrowing: a TRANSFER debt → bank. The debt account's opening balance
        // above is reset to 0 first so the transfer is the single source of the
        // figure (bank +X, debt −X, income 0).
        await db.update(wealthAccounts).set({ openingBalance: "0", currentBalance: "0" }).where(eq(wealthAccounts.id, account.id))
        const groupId = crypto.randomUUID()
        const legs = direction === "owed"
          ? [
              { accountId: account.id, type: "outgoing" as const, description: `Borrowed — paid out to ${disbursement.nickname.trim() || disbursement.bankName}` },
              { accountId: disbursement.id, type: "incoming" as const, description: `Borrowed from ${counterparty || name}` },
            ]
          : [
              { accountId: disbursement.id, type: "outgoing" as const, description: `Lent to ${counterparty || name}` },
              { accountId: account.id, type: "incoming" as const, description: `Lent — from ${disbursement.nickname.trim() || disbursement.bankName}` },
            ]
        for (const leg of legs) {
          const [row] = await db
            .insert(transactions)
            .values({
              clientId, wealthAccountId: leg.accountId, groupId, kind: "transfer", type: leg.type,
              amount: balance.toFixed(2), description: leg.description, category: "Transfer", date: startDate ?? today,
              createdBy: userId, updatedBy: userId,
            })
            .returning({ id: transactions.id })
          const delta = leg.type === "incoming" ? balance : -balance
          await db
            .update(wealthAccounts)
            .set({ currentBalance: sqlPlus(delta), updatedBy: userId, updatedAt: new Date() })
            .where(eq(wealthAccounts.id, leg.accountId))
          await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
        }
      } else {
        // Amount already owed: a balance-defining system row (not income, not expense).
        const [row] = await db
          .insert(transactions)
          .values({
            clientId, wealthAccountId: account.id, type: direction === "owed" ? "outgoing" : "incoming",
            amount: balance.toFixed(2), description: "Opening Balance", category: "Opening Balance", date: today,
            isSystem: true, createdBy: userId, updatedBy: userId,
          })
          .returning({ id: transactions.id })
        await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
      }
    }

    await logAudit({ orgId, entityType: "wealth_account", entityId: account.id, action: "create", actorId: userId })
    const row = await loadDebt(orgId, account.id)
    void details
    return res.status(201).json(row ? serializeDebt(row, todayIso()) : { id: account.id })
  }

  return res.status(405).json({ error: "Method not allowed" })
}

import { sql } from "drizzle-orm"
const sqlPlus = (delta: number) => sql`${wealthAccounts.currentBalance}::numeric + ${delta.toFixed(2)}::numeric`
