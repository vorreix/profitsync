import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { balanceDelta } from "../../../src/lib/wealth-ledger.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  // Verify ownership via client.organization_id
  const [row] = await db
    .select({ clientOrgId: clients.organizationId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, id))

  if (!row || row.clientOrgId !== orgId) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    // Enrich exactly like the list row (join client + wealth account, count
    // attachments) so a deep link / back-nav fetch shows real names instead of
    // raw FK UUIDs in the detail modal.
    const [tx] = await db
      .select({
        id: transactions.id,
        clientId: transactions.clientId,
        clientName: clients.name,
        wealthAccountId: transactions.wealthAccountId,
        wealthAccountName: wealthAccounts.nickname,
        wealthAccountBankName: wealthAccounts.bankName,
        wealthAccountType: wealthAccounts.type,
        wealthAccountIcon: wealthAccounts.icon,
        groupId: transactions.groupId,
        kind: transactions.kind,
        type: transactions.type,
        amount: transactions.amount,
        description: transactions.description,
        category: transactions.category,
        date: transactions.date,
        isSystem: transactions.isSystem,
        recurringRuleId: transactions.recurringRuleId,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
        attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
      .where(eq(transactions.id, id))
    if (!tx) return res.status(404).json({ error: "Not found" })

    // For a split (group), surface the group totals the modal needs to show the
    // breakdown — leg/account counts and the summed amount, matching the list.
    if (tx.groupId) {
      const [agg] = await db
        .select({
          legCount: sql<number>`count(*)::int`,
          accountCount: sql<number>`count(distinct ${transactions.wealthAccountId})::int`,
          amount: sql<string>`sum(${transactions.amount}::numeric)`,
        })
        .from(transactions)
        .where(and(eq(transactions.groupId, tx.groupId), isNull(transactions.deletedAt)))
      return res.json(serialize({ ...tx, legCount: agg?.legCount ?? 1, accountCount: agg?.accountCount ?? 1, amount: agg?.amount ?? tx.amount }))
    }
    return res.json(serialize({ ...tx, legCount: 1, accountCount: 1 }))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { type, amount, description, category, date, wealth_account_id } = req.body as {
      type?: string; amount?: number; description?: string; category?: string; date?: string; wealth_account_id?: string | null
    }
    if (type !== undefined && !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }
    if (amount !== undefined && amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id))
    const nextAccountId = wealth_account_id !== undefined ? wealth_account_id : before.wealthAccountId
    if (nextAccountId) {
      const [account] = await db
        .select({ id: wealthAccounts.id })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, nextAccountId), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
      if (!account && nextAccountId !== before.wealthAccountId) {
        return res.status(400).json({ error: "Select an active bank or cash account" })
      }
    }
    const [updated] = await db
      .update(transactions)
      .set({
        ...(wealth_account_id !== undefined ? { wealthAccountId: wealth_account_id } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(date !== undefined ? { date } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    if (before.wealthAccountId) {
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${balanceDelta(before.type, before.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, before.wealthAccountId))
    }
    if (updated.wealthAccountId) {
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${balanceDelta(updated.type, updated.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, updated.wealthAccountId))
    }
    const changes = diffFields(
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["type", "amount", "description", "category", "date", "wealthAccountId"],
    )
    if (Object.keys(changes).length) await logAudit({ orgId, entityType: "transaction", entityId: id, action: "update", actorId: userId, changes })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Soft-delete: the transaction moves to Trash (restorable) rather than vanishing.
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id))
    if (!before) return res.status(404).json({ error: "Not found" })

    // A split transaction is one logical entry, so deleting any leg deletes the
    // whole group and reverses each leg's balance. The legs share one client, so
    // the ownership check above covers them all.
    const legs = before.groupId
      ? await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.groupId, before.groupId), isNull(transactions.deletedAt)))
      : [before]

    await db
      .update(transactions)
      .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(before.groupId ? eq(transactions.groupId, before.groupId) : eq(transactions.id, id))

    for (const leg of legs) {
      if (!leg.wealthAccountId) continue
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${balanceDelta(leg.type, leg.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, leg.wealthAccountId))
    }

    for (const leg of legs) {
      await logAudit({ orgId, entityType: "transaction", entityId: leg.id, action: "delete", actorId: userId })
    }
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
