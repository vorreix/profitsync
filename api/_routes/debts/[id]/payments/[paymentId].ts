import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "../../../../../src/lib/db/index.js"
import { debtPayments, transactions, wealthAccounts } from "../../../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../../../_lib/auth.js"
import { logAudit } from "../../../../_lib/audit.js"
import { reversalsByAccount } from "../../../../../src/lib/wealth-ledger.js"

/**
 * DELETE /api/debts/:id/payments/:paymentId — move the WHOLE payment (every leg
 * of its ledger group: the principal transfer, the interest and fee expenses)
 * to Trash, reversing each account's balance exactly once — the same rule as
 * DELETE /api/transactions/:id. The allocation row disappears from history
 * because its anchor leg is trashed (derived), and comes back if the group is
 * restored from Trash. Purging the group cascades the row away.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id, paymentId } = req.query as { id: string; paymentId: string }
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const [payment] = await db
    .select()
    .from(debtPayments)
    .where(and(eq(debtPayments.id, paymentId), eq(debtPayments.organizationId, orgId), eq(debtPayments.wealthAccountId, id)))
  if (!payment) return res.status(404).json({ error: "Not found" })

  const legs = await db
    .select({ id: transactions.id, wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount, isSystem: transactions.isSystem })
    .from(transactions)
    .where(and(payment.groupId ? eq(transactions.groupId, payment.groupId) : eq(transactions.id, payment.transactionId), isNull(transactions.deletedAt)))
  if (legs.length === 0) return res.status(404).json({ error: "Already deleted" })

  for (const [accountId, shift] of reversalsByAccount(legs)) {
    await db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift.toFixed(2)}::numeric`, updatedBy: userId, updatedAt: new Date() })
      .where(eq(wealthAccounts.id, accountId))
  }
  await db
    .update(transactions)
    .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
    .where(payment.groupId ? eq(transactions.groupId, payment.groupId) : eq(transactions.id, payment.transactionId))
  for (const leg of legs) await logAudit({ orgId, entityType: "transaction", entityId: leg.id, action: "delete", actorId: userId })
  return res.status(204).end()
}
