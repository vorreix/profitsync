import type { VercelRequest, VercelResponse } from "@vercel/node"
import { sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { cards } from "../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"

/**
 * POST /api/cards/reorder { ids } — persist the user's drag order (lower = earlier).
 *
 * Ids from another org match nothing, so the org scope is the whole authorisation
 * check; there is no way to reorder a card you cannot see.
 */
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
  // ONE statement, not one per card. Neon HTTP has no interactive transactions,
  // so a loop of UPDATEs is not atomic: a timeout or a dropped connection after
  // k of n commits half an order, leaving duplicate positions that loadCards
  // then tie-breaks by created_at — an order that is neither the old nor the
  // new one, with nothing to tell the user. A single UPDATE ... FROM (VALUES …)
  // either applies the whole order or none of it.
  const rows = sql.join(
    unique.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
    sql`, `,
  )
  await db.execute(sql`
    update ${cards} set position = v.pos, updated_by = ${userId}, updated_at = now()
    from (values ${rows}) as v(id, pos)
    where ${cards.id} = v.id and ${cards.organizationId} = ${orgId}
  `)
  return res.json({ ok: true })
}
