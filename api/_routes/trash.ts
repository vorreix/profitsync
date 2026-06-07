import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, quotations, transactions } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"

const txFields = {
  id: transactions.id,
  clientId: transactions.clientId,
  clientName: clients.name,
  type: transactions.type,
  amount: transactions.amount,
  description: transactions.description,
  category: transactions.category,
  date: transactions.date,
  deletedAt: transactions.deletedAt,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [deletedClients, deletedQuotations, deletedTransactions] = await Promise.all([
    db.select().from(clients).where(and(eq(clients.organizationId, orgId), isNotNull(clients.deletedAt))),
    db.select().from(quotations).where(and(eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt))),
    // Only transactions trashed on their OWN (their client is still live). A
    // transaction soft-deleted as part of its client's deletion travels with the
    // client — it's restored/purged via the client, so it must not also appear
    // (and be independently restorable) here.
    db
      .select(txFields)
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), isNotNull(transactions.deletedAt)))
      .orderBy(desc(transactions.deletedAt)),
  ])

  return res.json({
    clients: deletedClients.map(serialize),
    quotations: deletedQuotations.map(serialize),
    transactions: deletedTransactions.map(serialize),
  })
}
