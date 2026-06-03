import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"

const MAX_IDS = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "clients")) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" })
  }
  const cleanIds = [...new Set(ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (cleanIds.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  // Org-scoped soft delete; the own/internal client is never deletable.
  const deleted = await db
    .update(clients)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(clients.id, cleanIds),
        eq(clients.organizationId, orgId),
        isNull(clients.deletedAt),
        eq(clients.isOwn, false),
      ),
    )
    .returning({ id: clients.id })

  await Promise.all(deleted.map((r) => logAudit({ orgId, entityType: "client", entityId: r.id, action: "delete", actorId: userId })))
  return res.json({ deleted: deleted.length })
}
