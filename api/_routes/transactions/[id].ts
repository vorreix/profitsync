import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { cleanTransactionTags } from "../../_lib/transaction-tags.js"

function balanceDelta(type: string, amount: unknown): number {
  const n = Number(amount)
  return type === "incoming" ? n : -n
}

const txDetailFields = {
  id: transactions.id,
  clientId: transactions.clientId,
  clientName: clients.name,
  wealthAccountId: transactions.wealthAccountId,
  wealthAccountName: wealthAccounts.nickname,
  wealthAccountBankName: wealthAccounts.bankName,
  wealthAccountType: wealthAccounts.type,
  wealthAccountIcon: wealthAccounts.icon,
  type: transactions.type,
  amount: transactions.amount,
  description: transactions.description,
  category: transactions.category,
  tags: transactions.tags,
  date: transactions.date,
  isSystem: transactions.isSystem,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
  attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
}

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
    const [tx] = await db
      .select(txDetailFields)
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
      .where(eq(transactions.id, id))
    if (!tx) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(tx))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { type, amount, description, category, tags, date, wealth_account_id } = req.body as {
      type?: string; amount?: number; description?: string; category?: string; tags?: unknown; date?: string; wealth_account_id?: string | null
    }
    if (type !== undefined && !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }
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
        ...(tags !== undefined ? { tags: cleanTransactionTags(tags) } : {}),
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
      ["type", "amount", "description", "category", "tags", "date", "wealthAccountId"],
    )
    if (Object.keys(changes).length) await logAudit({ orgId, entityType: "transaction", entityId: id, action: "update", actorId: userId, changes })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Soft-delete: the transaction moves to Trash (restorable) rather than vanishing.
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id))
    await db.update(transactions).set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() }).where(eq(transactions.id, id))
    if (before?.wealthAccountId) {
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${balanceDelta(before.type, before.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, before.wealthAccountId))
    }
    await logAudit({ orgId, entityType: "transaction", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
