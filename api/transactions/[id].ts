import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db"
import { clients, transactions } from "../../src/lib/db/schema"
import { canDelete, canWrite, requireAuth } from "../_lib/auth"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx
  const { id } = req.query as { id: string }

  // Verify ownership via client.organization_id
  const [row] = await db
    .select({ clientOrgId: clients.organizationId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, id))

  if (!row || row.clientOrgId !== orgId) return res.status(404).json({ error: "Not found" })

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { type, amount, description, category, date } = req.body as {
      type?: string; amount?: number; description?: string; category?: string; date?: string
    }
    if (type !== undefined && !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }
    const [updated] = await db
      .update(transactions)
      .set({
        ...(type !== undefined ? { type } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(date !== undefined ? { date } : {}),
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    await db.delete(transactions).where(eq(transactions.id, id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
