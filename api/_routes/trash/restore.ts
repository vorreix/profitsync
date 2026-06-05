import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNotNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"

function balanceDelta(type: string, amount: unknown): number {
  const n = Number(amount)
  return type === "incoming" ? n : -n
}

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
      .select({ id: transactions.id, wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
    if (!tx) return res.status(404).json({ error: "Not found" })
    const [updated] = await db
      .update(transactions)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning()
    if (tx.wealthAccountId) {
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
    const [updated] = await db
      .update(clients)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.organizationId, orgId), isNotNull(clients.deletedAt)))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
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
