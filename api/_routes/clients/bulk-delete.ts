import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

const MAX_IDS = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "clients")) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" })
  }
  const cleanIds = [...new Set(ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (cleanIds.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  // Org-scoped; the own/internal client is never deletable. Resolve the eligible
  // set first so the transaction cascade below only touches clients we will
  // actually soft-delete.
  const eligible = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        inArray(clients.id, cleanIds),
        eq(clients.organizationId, orgId),
        isNull(clients.deletedAt),
        eq(clients.isOwn, false),
      ),
    )
  const eligibleIds = eligible.map((r) => r.id)
  if (eligibleIds.length === 0) return res.json({ deleted: 0 })

  // Mirror the single-client DELETE: soft-delete each client's live transactions
  // together with it, reversing their wealth-balance effects so balances stay
  // correct while the clients sit in Trash. Client + transactions share one
  // `deletedAt` so trash-restore re-applies exactly this cascade (and leaves any
  // individually-trashed-earlier transactions alone).
  const now = new Date()
  const liveTx = await db
    .select({
      wealthAccountId: transactions.wealthAccountId,
      type: transactions.type,
      amount: transactions.amount,
      isSystem: transactions.isSystem,
    })
    .from(transactions)
    .where(and(inArray(transactions.clientId, eligibleIds), isNull(transactions.deletedAt)))
  for (const [accountId, shift] of reversalsByAccount(liveTx)) {
    await db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedBy: userId, updatedAt: now })
      .where(eq(wealthAccounts.id, accountId))
  }
  if (liveTx.length) {
    await db
      .update(transactions)
      .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
      .where(and(inArray(transactions.clientId, eligibleIds), isNull(transactions.deletedAt)))
  }

  const deleted = await db
    .update(clients)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(inArray(clients.id, eligibleIds), isNull(clients.deletedAt)))
    .returning({ id: clients.id })

  await Promise.all(deleted.map((r) => logAudit({ orgId, entityType: "client", entityId: r.id, action: "delete", actorId: userId })))
  return res.json({ deleted: deleted.length })
}
