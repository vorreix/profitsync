import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomUUID } from "node:crypto"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, requireAuth } from "../../_lib/auth.js"
import { getOrgPlan } from "../../_lib/quota.js"
import { logAudit } from "../../_lib/audit.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"

const displayName = (a: { nickname: string; bankName: string }) => a.nickname.trim() || a.bankName

/**
 * Move money between two of the org's wealth accounts. Recorded as ONE logical
 * transfer = two legs sharing a `group_id` with `kind='transfer'`: an outgoing
 * leg on the source and an incoming leg on the destination, each syncing its own
 * balance. Transfers anchor to the org's default client and are excluded from the
 * global transactions list, the income/expense summary, and analytics — they
 * show only on each account's own list. The first returned leg id can carry
 * attachments via the normal /transactions/:id/attachments route.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { from_account_id, to_account_id, amount, date, note } = req.body as {
    from_account_id?: string
    to_account_id?: string
    amount?: number | string
    date?: string
    note?: string
  }

  const amt = Number(amount)
  if (!from_account_id || !to_account_id) return res.status(400).json({ error: "from_account_id and to_account_id are required" })
  if (from_account_id === to_account_id) return res.status(400).json({ error: "Choose two different accounts" })
  if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ error: "amount must be greater than 0" })
  if (amountExceedsLimit(amt)) return res.status(400).json({ error: "Amount is too large" })

  const accounts = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  const from = accounts.find((a) => a.id === from_account_id)
  const to = accounts.find((a) => a.id === to_account_id)
  if (!from || !to) return res.status(400).json({ error: "Select two active accounts" })

  const clientId = await ensureDefaultClient(orgId, userId)

  // A transfer is two transactions; on the free plan both legs must fit under the
  // per-client limit (otherwise transfers would be a quota bypass).
  const { planKey, limits } = await getOrgPlan(orgId)
  if (planKey === "free") {
    const [{ current }] = await db
      .select({ current: count() })
      .from(transactions)
      .where(and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt)))
    if (current + 2 > limits.transactionsPerClient) {
      return res.status(402).json({
        allowed: false,
        reason: `Free plan is limited to ${limits.transactionsPerClient} transactions per client. Upgrade to Premium.`,
        limit: limits.transactionsPerClient,
        current,
        upgradeHint: true,
      })
    }
  }

  const today = new Date().toISOString().split("T")[0]
  const when = date ?? today
  const groupId = randomUUID()
  const noteText = (note ?? "").trim()
  const suffix = noteText ? ` — ${noteText}` : ""

  // Outgoing leg (source) then incoming leg (destination).
  const [outLeg] = await db
    .insert(transactions)
    .values({
      clientId,
      wealthAccountId: from.id,
      groupId,
      kind: "transfer",
      type: "outgoing",
      amount: String(amt),
      description: `Transfer to ${displayName(to)}${suffix}`,
      category: "Transfer",
      date: when,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  const [inLeg] = await db
    .insert(transactions)
    .values({
      clientId,
      wealthAccountId: to.id,
      groupId,
      kind: "transfer",
      type: "incoming",
      amount: String(amt),
      description: `Transfer from ${displayName(from)}${suffix}`,
      category: "Transfer",
      date: when,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()

  await db
    .update(wealthAccounts)
    .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${amt}`, updatedBy: userId, updatedAt: new Date() })
    .where(eq(wealthAccounts.id, from.id))
  await db
    .update(wealthAccounts)
    .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${amt}`, updatedBy: userId, updatedAt: new Date() })
    .where(eq(wealthAccounts.id, to.id))

  await logAudit({ orgId, entityType: "transaction", entityId: outLeg.id, action: "create", actorId: userId })
  await logAudit({ orgId, entityType: "transaction", entityId: inLeg.id, action: "create", actorId: userId })

  return res.status(201).json({ group_id: groupId, from_leg: serialize(outLeg), to_leg: serialize(inLeg), attach_to: outLeg.id })
}
