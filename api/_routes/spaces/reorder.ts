import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { wealthAccounts } from "../../../src/lib/db/schema.js"
import { canWrite, canUseSpaces, requireAuth } from "../../_lib/auth.js"

// POST /api/spaces/reorder — persist the drag-to-reorder Space order.
// Body: { ids: string[] } in display order; each id's `position` is set to its
// index. Scoped to the caller's org AND type='space' (so it can never touch a
// bank/cash account's order).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canUseSpaces(ctx)) return res.status(403).json({ error: "Spaces aren't available on this account type" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const body = req.body as { ids?: unknown }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : []
  if (ids.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  const owned = await db
    .select({ id: wealthAccounts.id })
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "space"), inArray(wealthAccounts.id, ids)))
  const ownedSet = new Set(owned.map((r) => r.id))

  await Promise.all(
    ids
      .filter((id) => ownedSet.has(id))
      .map((id, index) =>
        db
          .update(wealthAccounts)
          .set({ position: index, updatedBy: userId })
          .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId))),
      ),
  )

  return res.json({ ok: true })
}
