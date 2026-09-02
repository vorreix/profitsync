import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db, dbBatch } from "../../../../../src/lib/db/index.js"
import { budgetEnvelopes, budgetEvents } from "../../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../../_lib/auth.js"
import { loadPlan } from "../../../../_lib/budget-engine.js"

/**
 * POST /api/budgets/v2/envelopes/reorder — persist a drag-to-reorder.
 *
 * Body: { ids: string[] }  — the envelope ids in their new display order.
 *
 * Positions are rewritten from the array index rather than patched one at a
 * time, so the stored order always matches exactly what the user sees and
 * cannot drift into duplicate or gappy positions after repeated drags.
 *
 * Every id must belong to this plan. A partial list is accepted (the UI reorders
 * one section at a time) but an id from another workspace fails the whole
 * request rather than being skipped, because silently ignoring it would report
 * success for an order that was not applied.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  const { userId, orgId, role } = ctx
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const plan = await loadPlan(orgId)
  if (!plan) return res.status(404).json({ error: "No budget plan" })

  const raw = (req.body as { ids?: unknown })?.ids
  if (!Array.isArray(raw) || raw.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })
  if (raw.length > 200) return res.status(400).json({ error: "Too many ids" })

  const ids = raw.map((v) => String(v))
  if (new Set(ids).size !== ids.length) return res.status(400).json({ error: "ids must be unique" })

  const owned = await db
    .select({ id: budgetEnvelopes.id, position: budgetEnvelopes.position })
    .from(budgetEnvelopes)
    .where(
      and(
        eq(budgetEnvelopes.planId, plan.id),
        eq(budgetEnvelopes.organizationId, orgId),
        ne(budgetEnvelopes.status, "removed"),
        inArray(budgetEnvelopes.id, ids),
      ),
    )
  if (owned.length !== ids.length) {
    return res.status(404).json({ error: "unknown_envelope", message: "One of those envelopes is not in this plan" })
  }

  // Nothing to do — avoids writing an audit row for a drag that ended where it
  // started.
  const before = new Map(owned.map((o) => [o.id, o.position]))
  if (ids.every((id, i) => before.get(id) === i)) return res.json({ reordered: 0 })

  const writes = ids.map((id, index) =>
    db
      .update(budgetEnvelopes)
      .set({ position: index, updatedBy: userId, updatedAt: new Date() })
      .where(eq(budgetEnvelopes.id, id)),
  )

  // One batch, so the list is never observed half-reordered.
  await dbBatch([
    ...writes,
    db.insert(budgetEvents).values({
      organizationId: orgId,
      planId: plan.id,
      action: "envelopes_reordered",
      detail: { order: ids, count: ids.length },
      actorUserId: userId,
    }),
  ] as unknown as Parameters<typeof dbBatch>[0])

  return res.json({ reordered: ids.length })
}
