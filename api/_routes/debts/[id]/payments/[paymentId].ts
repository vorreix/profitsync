import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../../../../src/lib/db/index.js"
import { debtPayments, transactions } from "../../../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../../../_lib/auth.js"
import { logAudit } from "../../../../_lib/audit.js"
import { setRowsTrashed } from "../../../../_lib/tx-trash.js"

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
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(payment.groupId ? eq(transactions.groupId, payment.groupId) : eq(transactions.id, payment.transactionId), isNull(transactions.deletedAt)))
  // Claim-first, in one statement (api/_lib/tx-trash.ts setRowsTrashed): only
  // the legs this call actually flips reverse a balance. Reversing the legs
  // read above and then flipping them reversed every leg once per request, so
  // a double-clicked delete took the payment back twice (MC-058). A repayment's
  // legs carry no transfer_id and are never system rows, so all of them move.
  const trashed = await setRowsTrashed(legs.map((leg) => leg.id), userId, false)
  if (trashed.length === 0) return res.status(404).json({ error: "Already deleted" })
  for (const legId of trashed) await logAudit({ orgId, entityType: "transaction", entityId: legId, action: "delete", actorId: userId })
  return res.status(204).end()
}
