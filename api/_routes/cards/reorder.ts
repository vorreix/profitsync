import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { cards } from "../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"

/** POST /api/cards/reorder { ids } — persist the user's drag order (lower = earlier). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== "string")) {
    return res.status(400).json({ error: "ids must be a non-empty array of card ids" })
  }
  const unique = [...new Set(ids as string[])]
  // Org-scoped UPDATE per id: an id from another org simply matches nothing.
  for (const [index, id] of unique.entries()) {
    await db
      .update(cards)
      .set({ position: index, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(cards.id, id), eq(cards.organizationId, orgId)))
  }
  return res.json({ ok: true })
}
