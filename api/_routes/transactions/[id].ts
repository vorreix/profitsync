import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, transactions, transactionSettlements, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, canWrite, requireAuth } from "../../_lib/auth.js"
import { diffFields, logAudit } from "../../_lib/audit.js"
import { checkTransactionTagQuota } from "../../_lib/quota.js"
import { balanceDelta, reversesOnTrash } from "../../../src/lib/wealth-ledger.js"
import { amountExceedsLimit } from "../../../src/lib/money.js"
import { cleanTransactionTags } from "../../../src/lib/transaction-tags.js"
import { notifyIfBudgetExceeded } from "../../_lib/notify-budget.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { id } = req.query as { id: string }

  // Verify ownership via client.organization_id
  const [row] = await db
    .select({ clientOrgId: clients.organizationId })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(eq(transactions.id, id))

  if (!row || row.clientOrgId !== orgId) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    // Enrich exactly like the list row (join client + wealth account, count
    // attachments) so a deep link / back-nav fetch shows real names instead of
    // raw FK UUIDs in the detail modal.
    const [tx] = await db
      .select({
        id: transactions.id,
        clientId: transactions.clientId,
        clientName: clients.name,
        wealthAccountId: transactions.wealthAccountId,
        wealthAccountName: wealthAccounts.nickname,
        wealthAccountBankName: wealthAccounts.bankName,
        wealthAccountType: wealthAccounts.type,
        wealthAccountIcon: wealthAccounts.icon,
        groupId: transactions.groupId,
        kind: transactions.kind,
        type: transactions.type,
        amount: transactions.amount,
        description: transactions.description,
        category: transactions.category,
        tags: transactions.tags,
        date: transactions.date,
        isSystem: transactions.isSystem,
        recurringRuleId: transactions.recurringRuleId,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
        attachmentCount: sql<number>`(select count(*)::int from transaction_attachments where transaction_id = ${transactions.id})`,
        // Transfer counterpart (the other leg's account) → drives the Space badge.
        counterpartAccountId: sql<string | null>`(select t2.wealth_account_id::text from transactions t2 where t2.group_id = ${transactions.groupId} and t2.id <> ${transactions.id} and ${transactions.kind} = 'transfer' limit 1)`,
        counterpartType: sql<string | null>`(select wa.type from transactions t2 join wealth_accounts wa on wa.id = t2.wealth_account_id where t2.group_id = ${transactions.groupId} and t2.id <> ${transactions.id} and ${transactions.kind} = 'transfer' limit 1)`,
      })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .leftJoin(wealthAccounts, eq(transactions.wealthAccountId, wealthAccounts.id))
      // Org scope is redundant with the ownership check above (client_id is
      // immutable), but re-asserting it keeps this enrichment query self-defending.
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId)))
    if (!tx) return res.status(404).json({ error: "Not found" })

    // For a split (group), surface the group totals the modal needs to show the
    // breakdown — leg/account counts and the summed amount, matching the list.
    if (tx.groupId) {
      const [agg] = await db
        .select({
          legCount: sql<number>`count(*)::int`,
          accountCount: sql<number>`count(distinct ${transactions.wealthAccountId})::int`,
          amount: sql<string>`sum(${transactions.amount}::numeric)`,
        })
        .from(transactions)
        .where(and(eq(transactions.groupId, tx.groupId), isNull(transactions.deletedAt)))
      return res.json(serialize({ ...tx, legCount: agg?.legCount ?? 1, accountCount: agg?.accountCount ?? 1, amount: agg?.amount ?? tx.amount }))
    }
    return res.json(serialize({ ...tx, legCount: 1, accountCount: 1 }))
  }

  if (req.method === "PATCH") {
    if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
    const { type, amount, description, category, tags, date, wealth_account_id } = req.body as {
      type?: string; amount?: number; description?: string; category?: string; tags?: unknown; date?: string; wealth_account_id?: string | null
    }
    if (type !== undefined && !["incoming", "outgoing"].includes(type)) {
      return res.status(400).json({ error: "type must be incoming or outgoing" })
    }
    if (amount !== undefined && amountExceedsLimit(amount)) return res.status(400).json({ error: "Amount is too large" })
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id))
    // Per-plan tag ceiling. Only gate when tags are actually being changed, and
    // grandfather an existing over-limit set (previousCount) so editing anything
    // else on a legacy transaction never trips it — only *adding* tags is blocked.
    let cleanedTags: string[] | undefined
    if (tags !== undefined) {
      cleanedTags = cleanTransactionTags(tags)
      const previousCount = Array.isArray(before?.tags) ? before.tags.length : 0
      const tagQuota = await checkTransactionTagQuota(orgId, cleanedTags.length, { previousCount })
      if (!tagQuota.allowed) return res.status(402).json(tagQuota)
    }
    const nextAccountId = wealth_account_id !== undefined ? wealth_account_id : before.wealthAccountId
    if (nextAccountId) {
      const [account] = await db
        .select({ id: wealthAccounts.id })
        .from(wealthAccounts)
        .where(and(eq(wealthAccounts.id, nextAccountId), eq(wealthAccounts.organizationId, orgId), isNull(wealthAccounts.archivedAt)))
      if (!account && nextAccountId !== before.wealthAccountId) {
        return res.status(400).json({ error: "Select an active bank or cash account" })
      }
    }
    // Budget v2 invariant 7: Σ settlements ≤ expense.amount. The cap is enforced
    // when a refund is LINKED (api/_routes/budgets/v2/refunds.ts); an edit of
    // the expense (or of the linked inflow) must not sneak underneath it —
    // shrinking a fully-settled €100 expense to €40 would net −€60 into
    // safe-to-spend, money that never existed. Flipping the direction of a
    // linked row makes the link meaningless. Unlink first, then edit.
    const nextType = type ?? before.type
    const nextAmount = amount !== undefined ? Number(amount) : Number(before.amount)
    if (nextType !== before.type || nextAmount !== Number(before.amount)) {
      const [links] = await db
        .select({
          asExpense: sql<string>`coalesce(sum(case when ${transactionSettlements.expenseTransactionId} = ${id} then ${transactionSettlements.amount}::numeric end), 0)`,
          asSettlement: sql<string>`coalesce(sum(case when ${transactionSettlements.settlementTransactionId} = ${id} then ${transactionSettlements.amount}::numeric end), 0)`,
        })
        .from(transactionSettlements)
        .where(sql`${transactionSettlements.expenseTransactionId} = ${id} or ${transactionSettlements.settlementTransactionId} = ${id}`)
      const linked = Math.max(Number(links?.asExpense ?? 0), Number(links?.asSettlement ?? 0))
      if (linked > 0 && (nextType !== before.type || nextAmount < linked)) {
        return res.status(409).json({
          error: "settled_amount_exceeds",
          message: "This transaction has refunds linked to it — unlink them before changing its amount or direction",
          settled: linked,
          requested: nextAmount,
        })
      }
    }
    const [updated] = await db
      .update(transactions)
      .set({
        ...(wealth_account_id !== undefined ? { wealthAccountId: wealth_account_id } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(amount !== undefined ? { amount: String(amount) } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(cleanedTags !== undefined ? { tags: cleanedTags } : {}),
        ...(date !== undefined ? { date } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, id))
      .returning()
    if (!updated) return res.status(404).json({ error: "Not found" })
    if (before.wealthAccountId) {
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${balanceDelta(before.type, before.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, before.wealthAccountId))
    }
    if (updated.wealthAccountId) {
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${balanceDelta(updated.type, updated.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, updated.wealthAccountId))
    }
    const changes = diffFields(
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ["type", "amount", "description", "category", "tags", "date", "wealthAccountId"],
    )
    if (Object.keys(changes).length) await logAudit({ orgId, entityType: "transaction", entityId: id, action: "update", actorId: userId, changes })
    // An edit can push a budget over just as a create can (raising the amount,
    // moving the date into the current window, or flipping income -> expense).
    // Fire-and-forget so alerting can never fail the write.
    if (updated.type === "outgoing" || before.type === "outgoing") {
      void notifyIfBudgetExceeded(orgId, updated.clientId, userId).catch(() => {})
    }
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })
    // Soft-delete: the transaction moves to Trash (restorable) rather than vanishing.
    const [before] = await db.select().from(transactions).where(eq(transactions.id, id))
    if (!before) return res.status(404).json({ error: "Not found" })

    // A split transaction is one logical entry, so deleting any leg deletes the
    // whole group and reverses each leg's balance. The legs share one client, so
    // the ownership check above covers them all.
    const legs = before.groupId
      ? await db
          .select()
          .from(transactions)
          .where(and(eq(transactions.groupId, before.groupId), isNull(transactions.deletedAt)))
      : [before]

    await db
      .update(transactions)
      .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(before.groupId ? eq(transactions.groupId, before.groupId) : eq(transactions.id, id))

    for (const leg of legs) {
      // System balance-defining legs (Opening Balance / Balance Adjustment reset)
      // are not reversed on delete — see reversesOnTrash. Reversing one would
      // re-credit the account and undo the user's reset.
      if (!leg.wealthAccountId || !reversesOnTrash(leg)) continue
      await db
        .update(wealthAccounts)
        .set({
          currentBalance: sql`${wealthAccounts.currentBalance}::numeric - ${balanceDelta(leg.type, leg.amount)}`,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(wealthAccounts.id, leg.wealthAccountId))
    }

    for (const leg of legs) {
      await logAudit({ orgId, entityType: "transaction", entityId: leg.id, action: "delete", actorId: userId })
    }
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
