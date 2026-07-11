import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomUUID } from "node:crypto"
import { and, count, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canWrite, ensureDefaultClient, isPersonalAccount, requireAuth } from "../../_lib/auth.js"
import { getOrgPlan } from "../../_lib/quota.js"
import { logAudit } from "../../_lib/audit.js"
import { balanceDelta } from "../../../src/lib/wealth-ledger.js"
import { cleanTransactionTags } from "../../../src/lib/transaction-tags.js"
import { PREMIUM_TAGS_PER_TX } from "../../../src/lib/tags.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"

type AllocationInput = { wealth_account_id?: string; account_id?: string; amount?: number | string }

/**
 * Atomic create of a "split" transaction: one logical transaction (same client /
 * type / category / description / date) paid from one OR several wealth accounts.
 * Every account-leg is inserted as its own `transactions` row (so each account's
 * balance syncs through the same tested path) but all legs share a single
 * `group_id`, so the UI can collapse them into one row and break them back out in
 * the detail view. A single-allocation body is just a normal transaction
 * (group_id = NULL) — this endpoint is the one create path the client uses.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })

  const { client_id, type, description, category, tags, date, allocations } = req.body as {
    client_id?: string
    type?: string
    description?: string
    category?: string
    tags?: unknown
    date?: string
    allocations?: AllocationInput[]
  }
  // Group-level metadata, like description/category: every leg carries it.
  const cleanTags = cleanTransactionTags(tags)

  if (!type || !["incoming", "outgoing"].includes(type)) {
    return res.status(400).json({ error: "type must be incoming or outgoing" })
  }
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({ error: "allocations is required" })
  }

  const legs = allocations
    .map((a) => ({ accountId: a.wealth_account_id ?? a.account_id ?? "", amount: Number(a.amount) }))
    .filter((a) => a.accountId && !isNaN(a.amount) && a.amount > 0)
  if (legs.length === 0) {
    return res.status(400).json({ error: "At least one allocation with an account and a positive amount is required" })
  }
  if (legs.some((leg) => amountExceedsLimit(leg.amount))) {
    return res.status(400).json({ error: "Amount is too large" })
  }

  // Validate every referenced account is an active, org-scoped account.
  const orgAccounts = await db
    .select()
    .from(wealthAccounts)
    .where(and(eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
  const byId = new Map(orgAccounts.map((a) => [a.id, a]))
  for (const leg of legs) {
    if (!byId.has(leg.accountId)) return res.status(400).json({ error: "Select an active bank or cash account" })
  }

  // Resolve the anchoring client (personal orgs use their hidden default client).
  let clientId: string
  if (isPersonalAccount(ctx)) {
    clientId = await ensureDefaultClient(orgId, userId)
  } else {
    if (!client_id) return res.status(400).json({ error: "client_id is required" })
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, client_id), eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    if (!client) return res.status(403).json({ error: "Forbidden" })
    clientId = client_id
  }

  // Quota: the whole group must fit under the per-client transaction limit.
  const { planKey, limits } = await getOrgPlan(orgId)
  // Per-plan tag ceiling (free = 1, paid = 3). Every leg shares the group's tags,
  // so one check on the deduped set covers the whole split.
  if (cleanTags.length > limits.tagsPerTransaction) {
    return res.status(402).json({
      allowed: false,
      reason:
        planKey === "free"
          ? `Free plan allows ${limits.tagsPerTransaction} tag${limits.tagsPerTransaction === 1 ? "" : "s"} per transaction. Upgrade to Premium for up to ${PREMIUM_TAGS_PER_TX}.`
          : `This plan allows ${limits.tagsPerTransaction} tags per transaction.`,
      limit: limits.tagsPerTransaction,
      current: cleanTags.length,
      upgradeHint: planKey === "free",
    })
  }
  if (planKey === "free") {
    const [{ current }] = await db
      .select({ current: count() })
      .from(transactions)
      .where(and(eq(transactions.clientId, clientId), isNull(transactions.deletedAt)))
    if (current + legs.length > limits.transactionsPerClient) {
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
  // Only a real multi-leg split gets a group_id; a single account stays NULL so
  // the rest of the app treats it as an ordinary transaction.
  const groupId = legs.length > 1 ? randomUUID() : null

  const created = []
  // Accumulate per-account balance shifts so two legs on one account collapse
  // into a single UPDATE.
  const shiftByAccount = new Map<string, number>()
  for (const leg of legs) {
    const [row] = await db
      .insert(transactions)
      .values({
        clientId,
        wealthAccountId: leg.accountId,
        groupId,
        type,
        amount: String(leg.amount),
        description: description ?? "",
        category: category ?? "",
        tags: cleanTags,
        date: date ?? today,
        // isSystem is server-only: user-created split legs are never system rows.
        createdBy: userId,
        updatedBy: userId,
      })
      .returning()
    created.push(row)
    shiftByAccount.set(leg.accountId, (shiftByAccount.get(leg.accountId) ?? 0) + balanceDelta(type, leg.amount))
  }

  for (const [accountId, shift] of shiftByAccount) {
    await db
      .update(wealthAccounts)
      .set({
        currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(wealthAccounts.id, accountId))
  }

  for (const row of created) {
    await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })
  }

  return res.status(201).json({
    group_id: groupId,
    ids: created.map((r) => r.id),
    legs: created.map(serialize),
  })
}
