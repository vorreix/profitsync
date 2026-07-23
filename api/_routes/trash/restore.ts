import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { applicationsByAccount, balanceDelta, reversesOnTrash } from "../../../src/lib/wealth-ledger.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { type, id } = req.body as { type: string; id: string }
  if (!id) return res.status(400).json({ error: "id is required" })
  if (!["client", "quotation", "transaction"].includes(type)) {
    return res.status(400).json({ error: "type must be client, quotation, or transaction" })
  }

  if (type === "transaction") {
    // Transactions are org-scoped via their client.
    const [tx] = await db
      .select({ id: transactions.id, wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount, isSystem: transactions.isSystem })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
    if (!tx) return res.status(404).json({ error: "Not found" })
    const [updated] = await db
      .update(transactions)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning()
    // System balance-defining entries are not re-applied on restore — their
    // balance effect was never reversed on delete (see reversesOnTrash).
    if (tx.wealthAccountId && reversesOnTrash(tx)) {
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${balanceDelta(tx.type, tx.amount)}`,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, tx.wealthAccountId))
    }
    return res.json(serialize(updated))
  }

  if (type === "client") {
    const [client] = await db
      .select({ deletedAt: clients.deletedAt })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
    if (!client?.deletedAt) return res.status(404).json({ error: "Not found" })
    const deletedAt = client.deletedAt

    const [updated] = await db
      .update(clients)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning()

    // Re-apply + restore exactly the transactions that were trashed TOGETHER with
    // this client (same deletedAt). Transactions the user trashed individually
    // earlier carry a different deletedAt and stay in Trash.
    const cascadeTx = await db
      .select({ wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount, isSystem: transactions.isSystem })
      .from(transactions)
      .where(and(eq(transactions.clientId, id), eq(transactions.deletedAt, deletedAt)))
    for (const [accountId, shift] of applicationsByAccount(cascadeTx)) {
      await db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, accountId))
    }
    if (cascadeTx.length) {
      await db
        .update(transactions)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(and(eq(transactions.clientId, id), eq(transactions.deletedAt, deletedAt)))
    }
    return res.json(serialize(updated))
  }

  const [updated] = await db
    .update(quotations)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning()
  if (!updated) return res.status(404).json({ error: "Not found" })
  return res.json(serialize(updated))
}
