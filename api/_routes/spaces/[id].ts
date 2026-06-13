import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNull } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { transactions, wealthAccountAttachments, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, isPersonalAccount, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { checkSpaceQuota } from "../../_lib/quota.js"
import { parseGoal, parseTargetDate, spaceFields } from "../../_lib/spaces.js"

// A Space must be EMPTY (balance 0) before it can be archived or deleted —
// otherwise the earmarked money would silently leave net worth (archived
// balances aren't summed). The UI offers "withdraw all & close".
const isEmpty = (balance: unknown) => Number(balance) === 0

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  if (!isPersonalAccount(ctx)) return res.status(403).json({ error: "Spaces are available on personal accounts only" })

  const [space] = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId), eq(wealthAccounts.type, "space")))
  if (!space) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    const [{ txCount }] = await db
      .select({ txCount: count() })
      .from(transactions)
      .where(and(eq(transactions.wealthAccountId, id), isNull(transactions.deletedAt)))
    const [{ attCount }] = await db
      .select({ attCount: count() })
      .from(wealthAccountAttachments)
      .where(eq(wealthAccountAttachments.wealthAccountId, id))
    // Drop the bank-detail/logo columns the Space UI doesn't use.
    const { logoData: _logoData, ...rest } = space
    return res.json(serialize({ ...rest, transactionCount: txCount, attachmentCount: attCount }))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const body = req.body as {
      name?: string
      goal_amount?: number | string | null
      target_date?: string | null
      icon?: string
      note?: string
      archived?: boolean
    }

    const set: Record<string, unknown> = { updatedBy: userId, updatedAt: new Date() }

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return res.status(400).json({ error: "name cannot be empty" })
      set.nickname = name
    }
    if (body.goal_amount !== undefined) {
      const goal = parseGoal(body.goal_amount)
      if (goal === "invalid") return res.status(400).json({ error: "goal_amount is invalid" })
      set.goalAmount = goal
    }
    if (body.target_date !== undefined) {
      const target = parseTargetDate(body.target_date)
      if (target === "invalid") return res.status(400).json({ error: "target_date must be YYYY-MM-DD" })
      set.targetDate = target
    }
    if (body.icon !== undefined) set.icon = body.icon || "piggy"
    if (body.note !== undefined) set.note = String(body.note)

    // Archive / restore.
    if (body.archived === true && !space.archivedAt) {
      if (!isEmpty(space.currentBalance)) {
        return res.status(400).json({ error: "Withdraw the remaining balance before closing this Space." })
      }
      set.archivedAt = new Date()
    } else if (body.archived === false && space.archivedAt) {
      // Restoring re-occupies a Space slot — re-check the plan quota.
      const quota = await checkSpaceQuota(orgId)
      if (!quota.allowed) return res.status(402).json(quota)
      set.archivedAt = null
    }

    const [updated] = await db
      .update(wealthAccounts)
      .set(set)
      .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
      .returning(spaceFields)
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "update", actorId: userId })
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    if (!isEmpty(space.currentBalance)) {
      return res.status(400).json({ error: "Withdraw the remaining balance before deleting this Space." })
    }
    const [{ txCount }] = await db
      .select({ txCount: count() })
      .from(transactions)
      .where(and(eq(transactions.wealthAccountId, id), isNull(transactions.deletedAt)))

    if (txCount > 0) {
      // Has history → archive (soft) so the transfer ledger stays intact.
      await db
        .update(wealthAccounts)
        .set({ archivedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
    } else {
      await db.delete(wealthAccounts).where(and(eq(wealthAccounts.id, id), eq(wealthAccounts.organizationId, orgId)))
    }
    await logAudit({ orgId, entityType: "wealth_account", entityId: id, action: "delete", actorId: userId })
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
