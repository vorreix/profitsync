import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { applicationsByAccount } from "../../../src/lib/wealth-ledger.js"
import { setTransferTrashed } from "../../_lib/wealth-accounts.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, userId, role } = ctx

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
      .select({ id: transactions.id, groupId: transactions.groupId, transferId: transactions.transferId, kind: transactions.kind })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
    if (!tx) return res.status(404).json({ error: "Not found" })
    if (tx.kind === "transfer" && tx.transferId) {
      // A leg of a logical transfer: restore the WHOLE transfer (legs, fee row,
      // balances) in one database function. Legacy legs without a header use
      // the group path below, exactly as before.
      const result = await setTransferTrashed(orgId, userId, tx.transferId, true)
      if (!result.ok) return res.status(result.status).json(result.body)
      const [row] = await db.select().from(transactions).where(eq(transactions.id, id))
      const [{ legs: restoredLegCount }] = await db.select({ legs: count() }).from(transactions).where(eq(transactions.transferId, tx.transferId))
      return res.json(serialize({ ...row, restoredLegCount }))
    }

    // A split or a TRANSFER is one logical entry: DELETE trashes every leg of the
    // group, so restore must bring every trashed leg back and re-apply each
    // leg's balance. Restoring a single leg of a card payment would reduce the
    // card's debt while leaving the bank leg in Trash — money out of nothing.
    const legs = await db
      .select({
        id: transactions.id,
        wealthAccountId: transactions.wealthAccountId,
        type: transactions.type,
        amount: transactions.amount,
        isSystem: transactions.isSystem,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(
        and(
          tx.groupId ? eq(transactions.groupId, tx.groupId) : eq(transactions.id, id),
          eq(clients.organizationId, orgId),
          isNotNull(transactions.deletedAt),
        ),
      )
    const legIds = legs.map((l) => l.id)
    // System balance-defining entries are not re-applied on restore — their
    // balance effect was never reversed on delete (see reversesOnTrash);
    // applicationsByAccount skips them and collapses legs per account.
    for (const [accountId, shift] of applicationsByAccount(legs)) {
      await db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedAt: new Date() })
        .where(eq(wealthAccounts.id, accountId))
    }
    const restored = await db
      .update(transactions)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(inArray(transactions.id, legIds))
      .returning()
    const updated = restored.find((r) => r.id === id) ?? restored[0]
    return res.json(serialize({ ...updated, restoredLegCount: restored.length }))
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
