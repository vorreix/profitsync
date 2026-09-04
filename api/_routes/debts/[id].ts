import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { debtDetails, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, ensureDefaultClient, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { DEBT_KINDS, directionOf, loadDebt, loadPayments, scheduleFor, serializeDebt } from "../../_lib/debts.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { PAYMENT_FREQUENCIES } from "../../../src/lib/debt-math.js"
import { DEBT_LIFECYCLES } from "../../../src/lib/debt-status.js"
import { todayIso } from "../../../src/lib/recurring.js"
import { isValidCurrency } from "../../../src/lib/currencies.js"

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET    /api/debts/:id — one debt + its live payments + the amortization schedule.
 * PATCH  /api/debts/:id — edit terms, set the lifecycle (paused / paid off /
 *        refinanced / written off / active), or RECONCILE the balance: a new
 *        `current_balance` records a system Balance Adjustment for the
 *        difference — history is never rewritten.
 * DELETE /api/debts/:id — close (archive) a debt that has history; hard-delete
 *        one that has none (details + payments cascade).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }
  const today = todayIso()

  const row = await loadDebt(orgId, id)
  if (!row) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    const payments = await loadPayments(orgId, [id], { limit: 100 })
    return res.json({
      debt: serializeDebt(row, today),
      payments: payments.map(serialize),
      schedule: scheduleFor(row, today),
    })
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const b = (req.body ?? {}) as Record<string, unknown>
    const num = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined
      if (v === null || v === "") return null
      const n = Number(v)
      return Number.isFinite(n) ? n : NaN
    }
    const detailPatch: Partial<typeof debtDetails.$inferInsert> = {}
    const accountPatch: Partial<typeof wealthAccounts.$inferInsert> = {}

    if (typeof b.name === "string") {
      if (!b.name.trim() && !(typeof b.counterparty === "string" ? b.counterparty.trim() : row.details.counterparty)) return res.status(400).json({ error: "name is required" })
      accountPatch.nickname = b.name.trim()
    }
    if (typeof b.counterparty === "string") { detailPatch.counterparty = b.counterparty.trim(); accountPatch.bankName = b.counterparty.trim() || row.account.bankName }
    if (typeof b.icon === "string" && b.icon.trim()) accountPatch.icon = b.icon
    if (typeof b.kind === "string") {
      if (!(DEBT_KINDS as readonly string[]).includes(b.kind)) return res.status(400).json({ error: "kind is invalid" })
      detailPatch.kind = b.kind
    }
    if (typeof b.currency === "string") {
      const c = b.currency.trim().toUpperCase()
      if (!isValidCurrency(c)) return res.status(400).json({ error: "Unknown currency" })
      detailPatch.currency = c
    }
    const original = num(b.original_amount)
    if (original !== undefined) {
      if (original !== null && (Number.isNaN(original) || original < 0 || amountExceedsLimit(original))) return res.status(400).json({ error: "original_amount is invalid" })
      detailPatch.originalAmount = original == null ? null : original.toFixed(2)
    }
    const rate = num(b.annual_rate_pct)
    if (rate !== undefined) {
      if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 1000)) return res.status(400).json({ error: "annual_rate_pct is invalid" })
      detailPatch.annualRatePct = rate == null ? null : rate.toFixed(4)
    }
    if (b.rate_type !== undefined) detailPatch.rateType = b.rate_type === "fixed" || b.rate_type === "variable" ? b.rate_type : null
    const payment = num(b.payment_amount)
    if (payment !== undefined) {
      if (payment !== null && (Number.isNaN(payment) || payment < 0 || amountExceedsLimit(payment))) return res.status(400).json({ error: "payment_amount is invalid" })
      detailPatch.paymentAmount = payment == null || payment === 0 ? null : payment.toFixed(2)
    }
    if (b.payment_frequency !== undefined) {
      if (b.payment_frequency !== null && !(PAYMENT_FREQUENCIES as readonly string[]).includes(String(b.payment_frequency))) return res.status(400).json({ error: "payment_frequency is invalid" })
      detailPatch.paymentFrequency = (b.payment_frequency as string | null) ?? null
    }
    for (const [key, col] of [["next_due_date", "nextDueDate"], ["start_date", "startDate"], ["maturity_date", "maturityDate"]] as const) {
      if (b[key] !== undefined) {
        if (b[key] !== null && !(typeof b[key] === "string" && ISO.test(b[key] as string))) return res.status(400).json({ error: `${key} must be YYYY-MM-DD` })
        detailPatch[col] = (b[key] as string | null) ?? null
      }
    }
    const installments = num(b.remaining_installments)
    if (installments !== undefined) {
      if (installments !== null && (!Number.isInteger(installments) || installments < 0)) return res.status(400).json({ error: "remaining_installments is invalid" })
      detailPatch.remainingInstallments = installments
    }
    if (typeof b.balance_is_estimate === "boolean") detailPatch.balanceIsEstimate = b.balance_is_estimate
    if (typeof b.notes === "string") detailPatch.notes = b.notes.slice(0, 2000)

    if (b.lifecycle !== undefined) {
      if (!(DEBT_LIFECYCLES as readonly string[]).includes(String(b.lifecycle))) return res.status(400).json({ error: "lifecycle is invalid" })
      detailPatch.lifecycle = b.lifecycle as string
      detailPatch.closedAt = b.lifecycle === "active" || b.lifecycle === "paused" ? null : new Date()
    }
    if (b.refinanced_into_account_id !== undefined) {
      if (b.refinanced_into_account_id === null) detailPatch.refinancedIntoAccountId = null
      else {
        const target = await loadDebt(orgId, String(b.refinanced_into_account_id))
        if (!target || target.account.id === id) return res.status(400).json({ error: "refinanced_into_account_id must be another debt in this workspace" })
        detailPatch.refinancedIntoAccountId = target.account.id
      }
    }

    // Reconciliation: the balance the lender shows. Recorded as a system
    // Balance Adjustment for the difference — never by editing past payments.
    const reconcile = num(b.current_balance)
    if (reconcile !== undefined && reconcile !== null) {
      if (Number.isNaN(reconcile) || reconcile < 0 || amountExceedsLimit(reconcile)) return res.status(400).json({ error: "current_balance must be 0 or more" })
      const signedNew = directionOf(row.account.type) === "receivable" ? reconcile : -reconcile
      const delta = Math.round((signedNew - Number(row.account.currentBalance)) * 100) / 100
      if (delta !== 0) {
        const clientId = await ensureDefaultClient(orgId, userId)
        const [tx] = await db
          .insert(transactions)
          .values({
            clientId, wealthAccountId: id, type: delta > 0 ? "incoming" : "outgoing", amount: Math.abs(delta).toFixed(2),
            description: "Balance Adjustment", category: "Adjustment", date: today, isSystem: true, createdBy: userId, updatedBy: userId,
          })
          .returning({ id: transactions.id })
        await db
          .update(wealthAccounts)
          .set({ currentBalance: signedNew.toFixed(2), updatedBy: userId, updatedAt: new Date() })
          .where(eq(wealthAccounts.id, id))
        await logAudit({ orgId, entityType: "transaction", entityId: tx.id, action: "create", actorId: userId })
      }
    }

    if (Object.keys(accountPatch).length) {
      await db.update(wealthAccounts).set({ ...accountPatch, updatedBy: userId, updatedAt: new Date() }).where(eq(wealthAccounts.id, id))
    }
    if (Object.keys(detailPatch).length) {
      await db.update(debtDetails).set({ ...detailPatch, updatedAt: new Date() }).where(eq(debtDetails.id, row.details.id))
    }
    const after = (await loadDebt(orgId, id))!
    const changes = diffFields(
      { ...row.details, nickname: row.account.nickname, currentBalance: row.account.currentBalance } as Record<string, unknown>,
      { ...after.details, nickname: after.account.nickname, currentBalance: after.account.currentBalance } as Record<string, unknown>,
      ["nickname", "counterparty", "kind", "currency", "originalAmount", "annualRatePct", "rateType", "paymentAmount", "paymentFrequency", "nextDueDate", "startDate", "maturityDate", "remainingInstallments", "lifecycle", "refinancedIntoAccountId", "notes", "currentBalance"],
    )
    if (Object.keys(changes).length) await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "update", actorId: userId, changes })
    return res.json(serializeDebt(after, today))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    const [{ total }] = await db
      .select({ total: count() })
      .from(transactions)
      .where(and(eq(transactions.wealthAccountId, id), isNull(transactions.deletedAt)))
    if (total > 0) {
      // Keep the history: close the account (it stays in Trash-like "closed" list).
      await db
        .update(wealthAccounts)
        .set({ archivedAt: new Date(), isDefault: false, updatedBy: userId, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, id))
      await db.update(debtDetails).set({ closedAt: sql`coalesce(${debtDetails.closedAt}, now())`, updatedAt: new Date() }).where(eq(debtDetails.id, row.details.id))
      await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "close", actorId: userId })
      return res.json(serializeDebt((await loadDebt(orgId, id))!, today))
    }
    await db.delete(wealthAccounts).where(eq(wealthAccounts.id, id)) // details + payments cascade
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
