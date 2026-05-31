import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNotNull } from "drizzle-orm"
import { db, serialize } from "../../src/lib/db/index.js"
import { clients, quotations } from "../../src/lib/db/schema.js"
import { requireAuth } from "../_lib/auth.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId } = ctx

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const [deletedClients, deletedQuotations] = await Promise.all([
    db.select().from(clients).where(and(eq(clients.organizationId, orgId), isNotNull(clients.deletedAt))),
    db.select().from(quotations).where(and(eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt))),
  ])

  return res.json({
    clients: deletedClients.map(serialize),
    quotations: deletedQuotations.map(serialize),
  })
}
