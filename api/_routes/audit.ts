import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { auditLogs, clients, quotations, transactions } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"

const VALID = ["client", "transaction", "quotation"] as const

// Verify the entity belongs to the active org before exposing its history.
async function entityInOrg(type: string, id: string, orgId: string): Promise<boolean> {
  if (type === "client") {
    const [r] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, id), eq(clients.organizationId, orgId)))
    return !!r
  }
  if (type === "quotation") {
    const [r] = await db.select({ id: quotations.id }).from(quotations).where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId)))
    return !!r
  }
  // transaction → scope via its client
  const [r] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId)))
  return !!r
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const { entity_type, entity_id } = req.query as { entity_type?: string; entity_id?: string }
  if (!entity_type || !VALID.includes(entity_type as (typeof VALID)[number]) || !entity_id) {
    return res.status(400).json({ error: "entity_type and entity_id are required" })
  }

  const owned = await entityInOrg(entity_type, entity_id, orgId)
  if (!owned) return res.status(404).json({ error: "Not found" })

  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.entityType, entity_type), eq(auditLogs.entityId, entity_id)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100)

  return res.json(rows.map(serialize))
}
