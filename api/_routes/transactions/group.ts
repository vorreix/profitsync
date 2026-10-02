import type { VercelRequest, VercelResponse } from "@vercel/node"
import { dbBatch, serialize } from "../../../src/lib/db/index.js"
import type { transactions } from "../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { notifyIfBudgetExceeded } from "../../_lib/notify-budget.js"
import { groupWriteWentStale, postGroupStatements, prepareGroup, type GroupBody } from "../../_lib/tx-group-write.js"

/**
 * Atomic create of a "split" transaction: one logical transaction (same client /
 * type / category / description / date) paid from one OR several wealth accounts.
 * Every account-leg is inserted as its own `transactions` row (so each account's
 * balance syncs through the same tested path) but all legs share a single
 * `group_id`, so the UI can collapse them into one row and break them back out in
 * the detail view. A single-allocation body is just a normal transaction
 * (group_id = NULL) — this endpoint is the one create path the client uses.
 * Editing a split is PUT /api/transactions/group/:groupId (same validation).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const prepared = await prepareGroup(ctx, req.body as GroupBody)
  if (!prepared.ok) return res.status(prepared.status).json(prepared.body)
  const { group } = prepared

  // The legs and every balance shift land together or not at all.
  const { groupId, insert, shifts } = postGroupStatements(group, userId)
  let created: (typeof transactions.$inferSelect)[]
  try {
    ;[created] = (await dbBatch([insert, ...shifts] as unknown as Parameters<typeof dbBatch>[0])) as unknown as [(typeof transactions.$inferSelect)[]]
  } catch (err) {
    // An account's currency changed after it was read: the deferred FK rolled
    // the whole batch back — a stale screen, not a server error.
    if (groupWriteWentStale(err)) {
      return res.status(409).json({ error: "An account changed while this was being saved. Reload and try again.", code: "transaction_changed" })
    }
    throw err
  }

  for (const row of created) {
    await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
  }

  // A split is one logical expense spread over several accounts, so it can breach
  // a budget exactly like a single transaction. Evaluated once for the group.
  if (group.type === "outgoing") void notifyIfBudgetExceeded(orgId, group.clientId, userId, { category: group.category, date: group.date }).catch(() => {})

  return res.status(201).json({
    group_id: groupId,
    ids: created.map((r) => r.id),
    legs: created.map(serialize),
  })
}
