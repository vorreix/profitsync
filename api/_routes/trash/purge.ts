import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { type, id } = req.body as { type: string; id: string }
  if (!id) return res.status(400).json({ error: "id is required" })
  if (!["client", "quotation", "transaction"].includes(type)) {
    return res.status(400).json({ error: "type must be client, quotation, or transaction" })
  }

  if (type === "transaction") {
    // The transaction is in Trash, i.e. already soft-deleted — its wealth-balance
    // effect was reversed at soft-delete time, so purging must NOT touch balances
    // again (that would double-reverse). Expand a split group so purging one
    // soft-deleted leg removes all its (soft-deleted) siblings — no orphans.
    const [tx] = await db
      .select({ id: transactions.id, groupId: transactions.groupId })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
    if (!tx) return res.status(404).json({ error: "Not found" })
    if (tx.groupId) {
      const legs = await db
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(and(eq(transactions.groupId, tx.groupId), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
      await db.delete(transactions).where(inArray(transactions.id, legs.map((l) => l.id)))
    } else {
      await db.delete(transactions).where(eq(transactions.id, id))
    }
    return res.status(204).end()
  }

  if (type === "client") {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
    if (!client) return res.status(404).json({ error: "Not found" })
    // Any of the client's transactions still LIVE (deletedAt NULL) never had their
    // balance reversed (e.g. clients soft-deleted before cascade-reversal existed).
    // Reverse those before the cascade hard-delete. Already-soft-deleted ones were
    // reversed at soft-delete time — leave their balances alone (no double-reverse).
    const liveTx = await db
      .select({ wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .where(and(eq(transactions.clientId, id), isNull(transactions.deletedAt)))
    for (const [accountId, shift] of reversalsByAccount(liveTx)) {
      await db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, accountId))
    }
    // Hard-delete the client; transactions cascade (FK onDelete: cascade).
    await db.delete(clients).where(and(eq(clients.id, id), eq(clients.organizationId, orgId)))
    return res.status(204).end()
  }

  const result = await db
    .delete(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning({ id: quotations.id })
  if (!result.length) return res.status(404).json({ error: "Not found" })
  return res.status(204).end()
}
