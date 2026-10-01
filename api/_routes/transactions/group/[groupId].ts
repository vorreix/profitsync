import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm"
import { db, dbBatch, serialize } from "../../../../src/lib/db/index.js"
import { clients, debtPayments, transactionAttachments, transactions, wealthAccounts } from "../../../../src/lib/db/schema.js"
import { canWrite, requireAuth } from "../../../_lib/auth.js"
import { logAudit } from "../../../_lib/audit.js"
import { notifyIfBudgetExceeded } from "../../../_lib/notify-budget.js"
import { DEBT_ACCOUNT_TYPES } from "../../../_lib/debts.js"
import {
  claimReplacedLegsSql,
  groupWriteWentStale,
  lockReplacingSql,
  postGroupStatements,
  prepareGroup,
  type GroupBody,
} from "../../../_lib/tx-group-write.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PUT /api/transactions/group/:groupId — replace a split's legs in ONE atomic
 * batch (MC-046). `:groupId` is the split's group_id, or the id of a single
 * ungrouped transaction being edited into a split. Takes the same body and
 * validation as POST /api/transactions/group and answers in its shape.
 *
 * The edit used to be DELETE (old legs to Trash) + POST: restoring the old
 * version from Trash then applied the money a second time, and a refused POST
 * (frozen card, quota) left the split simply gone. Now the new legs, the
 * attachments moved onto them, the claim-first hard delete of the old legs
 * with its balance reversal, and the new balance shifts commit together or not
 * at all — nothing reaches Trash, and a failed save changes nothing.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx
  const { groupId } = req.query as { groupId: string }

  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" })
  // An edit, like PATCH: the replaced legs are the SAME logical entry rewritten
  // (an editor can already PATCH a single row's amount to anything), not a
  // deletion — so canWrite, not canDelete. Their ids are audited as replaced.
  if (!canWrite(role)) return res.status(403).json({ error: "Forbidden" })
  if (!UUID_RE.test(groupId ?? "")) return res.status(404).json({ error: "Not found" })

  // The live legs, org-scoped through their client, earliest first (the leg
  // the list opens the split by — and the one its attachments live on).
  const old = await db
    .select({
      id: transactions.id,
      clientId: transactions.clientId,
      type: transactions.type,
      kind: transactions.kind,
      description: transactions.description,
      category: transactions.category,
      tags: transactions.tags,
      date: transactions.date,
      isSystem: transactions.isSystem,
      transferId: transactions.transferId,
      recurringRuleId: transactions.recurringRuleId,
      recurringDueDate: transactions.recurringDueDate,
      accountType: wealthAccounts.type,
    })
    .from(transactions)
    .innerJoin(clients, eq(clients.id, transactions.clientId))
    .leftJoin(wealthAccounts, eq(wealthAccounts.id, transactions.wealthAccountId))
    .where(and(
      eq(clients.organizationId, orgId),
      isNull(transactions.deletedAt),
      or(eq(transactions.groupId, groupId), and(eq(transactions.id, groupId), isNull(transactions.groupId))),
    ))
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
  if (old.length === 0) return res.status(404).json({ error: "Not found" })
  const oldIds = old.map((leg) => leg.id)

  // Rows whose money is owned elsewhere are never replaced here — the same
  // locks PATCH applies, with the same codes, in PATCH's order:
  // - a debt repayment (principal transfer + interest/fee expenses, or an
  //   interest-only payment anchored by its allocation row) only on the debt's
  //   page — checked FIRST: its principal legs are transfers in the same group;
  // - Opening Balance / Balance Adjustment define the account's balance;
  // - a transfer (both legs AND its fee rows) moves only through the transfer service.
  const [debtPayment] = await db
    .select({ id: debtPayments.id })
    .from(debtPayments)
    .where(or(inArray(debtPayments.transactionId, oldIds), eq(debtPayments.groupId, groupId)))
    .limit(1)
  if (debtPayment || old.some((leg) => (DEBT_ACCOUNT_TYPES as readonly (string | null)[]).includes(leg.accountType))) {
    return res.status(409).json({ error: "Edit this payment from the debt's page — it keeps principal and interest apart.", code: "debt_group" })
  }
  if (old.some((leg) => leg.isSystem)) {
    return res.status(409).json({ error: "This entry sets the account's balance — change it from the account's page.", code: "system_row" })
  }
  if (old.some((leg) => leg.transferId || leg.kind === "transfer")) {
    return res.status(409).json({ error: "A transfer's amount, date, direction or account can't be edited row by row. Reverse the transfer and record it again.", code: "transfer_mutation_requires_transfer_service" })
  }

  const first = old[0]
  const prepared = await prepareGroup(ctx, req.body as GroupBody, {
    ids: oldIds,
    clientId: first.clientId,
    kind: first.kind,
    tags: Array.isArray(first.tags) ? (first.tags as string[]) : [],
    description: first.description ?? "",
    category: first.category ?? "",
    date: first.date,
  })
  if (!prepared.ok) return res.status(prepared.status).json(prepared.body)
  const { group } = prepared
  const leadId = group.legs[0].id

  // A recurring occurrence keeps its idempotency key, or the rule would post
  // it again on the next read. The (rule, due date) pair is unique, so the
  // date moves onto the new lead leg only after the old row is gone.
  const recurring = old.find((leg) => leg.recurringRuleId && leg.recurringDueDate)
  const { groupId: newGroupId, insert, shifts } = postGroupStatements(group, userId, { recurringRuleId: recurring?.recurringRuleId })
  const batch = [
    ...lockReplacingSql(oldIds, group.legs.map((leg) => leg.accountId)).map((lock) => db.execute(lock)),
    insert,
    // Attachments survive the edit on the lead leg (the delete below would cascade them).
    db.update(transactionAttachments).set({ transactionId: leadId, updatedAt: new Date() }).where(inArray(transactionAttachments.transactionId, oldIds)),
    db.execute(claimReplacedLegsSql(oldIds, userId)),
    ...(recurring ? [db.update(transactions).set({ recurringDueDate: recurring.recurringDueDate }).where(eq(transactions.id, leadId))] : []),
    ...shifts,
  ]

  let created: (typeof transactions.$inferSelect)[]
  try {
    ;[, , created] = (await dbBatch(batch as unknown as Parameters<typeof dbBatch>[0])) as unknown as [unknown, unknown, (typeof transactions.$inferSelect)[]]
  } catch (err) {
    if (groupWriteWentStale(err)) {
      return res.status(409).json({ error: "This transaction was changed or deleted while you were editing it. Reload and try again.", code: "transaction_changed" })
    }
    throw err
  }

  for (const legId of oldIds) await logAudit({ orgId, entityType: "transaction", entityId: legId, action: "delete", actorId: userId })
  for (const row of created) await logAudit({ orgId, entityType: "transaction", entityId: row.id, action: "create", actorId: userId })

  // An edit can push a budget over just as a create can.
  if (group.type === "outgoing" || first.type === "outgoing") {
    void notifyIfBudgetExceeded(orgId, group.clientId, userId, { category: group.category, date: group.date }).catch(() => {})
  }

  return res.json({
    group_id: newGroupId,
    ids: created.map((r) => r.id),
    legs: created.map(serialize),
  })
}
