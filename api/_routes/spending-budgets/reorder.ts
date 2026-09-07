import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { spendingBudgets } from "../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"

/**
 * POST /api/spending-budgets/reorder { ids } — the display order of a set of
 * SIBLINGS (lower = earlier). One statement, like /api/cards/reorder: Neon HTTP
 * has no interactive transactions, so a loop of UPDATEs could leave half an
 * order behind. Ids from another workspace match nothing.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((x) => typeof x !== "string")) {
    return res.status(400).json({ error: "ids must be a non-empty array of budget ids" })
  }
  const unique = [...new Set(ids as string[])]
  const rows = sql.join(unique.map((id, index) => sql`(${id}::uuid, ${index}::int)`), sql`, `)
  await db.execute(sql`
    update ${spendingBudgets} set position = v.pos, updated_by = ${userId}, updated_at = now()
    from (values ${rows}) as v(id, pos)
    where ${spendingBudgets.id} = v.id and ${spendingBudgets.organizationId} = ${orgId}
  `)
  return res.json({ ok: true })
}
