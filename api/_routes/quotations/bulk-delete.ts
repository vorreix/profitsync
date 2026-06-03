import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { quotations } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"

const MAX_IDS = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "quotations")) return
  const { orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" })
  }
  const cleanIds = [...new Set(ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (cleanIds.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  const deleted = await db
    .update(quotations)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(quotations.id, cleanIds),
        eq(quotations.organizationId, orgId),
        isNull(quotations.deletedAt),
      ),
    )
    .returning({ id: quotations.id })

  return res.json({ deleted: deleted.length })
}
