import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, transactions } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"

const MAX_IDS = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" })
  }
  const cleanIds = [...new Set(ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (cleanIds.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  // Transactions are scoped to the org through their client. Resolve which of the
  // requested ids actually belong to this org (and aren't already deleted), then
  // soft-delete exactly those.
  const valid = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(
      and(
        inArray(transactions.id, cleanIds),
        eq(clients.organizationId, orgId),
        isNull(transactions.deletedAt),
      ),
    )
  const validIds = valid.map((r) => r.id)
  if (validIds.length > 0) {
    await db
      .update(transactions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(inArray(transactions.id, validIds))
  }

  return res.json({ deleted: validIds.length })
}
