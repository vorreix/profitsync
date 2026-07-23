import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

// Empty the org's whole trash in one shot. Same invariants as single-item purge
// (api/_routes/trash/purge.ts): a soft-deleted transaction's balance was already
// reversed at soft-delete time (never touch it again); a trashed client's LIVE
// transactions were never reversed (reverse them before the cascade delete).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  // 1. Trashed clients — reverse balances for their LIVE transactions, then
  //    hard-delete (transactions + attachments cascade via FK).
  const trashedClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
  const clientIds = trashedClients.map((c) => c.id)
  if (clientIds.length) {
    const liveTx = await db
      .select({ wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount, isSystem: transactions.isSystem })
      .from(transactions)
      .where(and(inArray(transactions.clientId, clientIds), isNull(transactions.deletedAt)))
    for (const [accountId, shift] of reversalsByAccount(liveTx)) {
      await db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, accountId))
    }
    await db.delete(clients).where(inArray(clients.id, clientIds))
  }

  // 2. Remaining trashed transactions (their client is live — client-trashed ones
  //    died with the cascade above). Purging ALL soft-deleted rows inherently
  //    takes every soft-deleted split-group leg, so no orphaned legs.
  const trashedTx = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), isNotNull(transactions.deletedAt)))
  if (trashedTx.length) {
    await db.delete(transactions).where(inArray(transactions.id, trashedTx.map((t) => t.id)))
  }

  // 3. Trashed quotations (attachments + pdfs cascade via FK).
  const purgedQuotations = await db
    .delete(quotations)
    .where(and(eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning({ id: quotations.id })

  return res.json({
    purged: { clients: clientIds.length, transactions: trashedTx.length, quotations: purgedQuotations.length },
  })
}
