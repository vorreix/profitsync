import { and, eq, inArray, isNull } from "drizzle-orm"

import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"

export type TxLeg = {
  id: string
  groupId: string | null
  wealthAccountId: string | null
  type: string
  amount: string
  isSystem: boolean | null
}

const legCols = {
  id: transactions.id,
  groupId: transactions.groupId,
  wealthAccountId: transactions.wealthAccountId,
  type: transactions.type,
  amount: transactions.amount,
  // Needed so balance reversal can skip system balance-defining entries
  // (Opening Balance / Balance Adjustment); see wealth-ledger.reversesOnTrash.
  isSystem: transactions.isSystem,
}

/**
 * Expand a set of transaction ids to the FULL set of org-scoped, not-yet-deleted
 * legs that must be actioned together. A "split" transaction is several leg rows
 * sharing one `group_id`; the collapsed list row carries a single representative
 * leg id, so deleting/purging a split must pull in every sibling leg — otherwise
 * legs are orphaned and the stored wealth balance is only partially reversed.
 *
 * Results are deduped by id, so selecting several legs of the same group (or the
 * same id twice) reverses each leg's balance exactly once.
 */
export async function resolveTxLegs(orgId: string, ids: string[]): Promise<TxLeg[]> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return []

  // Validate ownership (via client.organization_id) and read group ids.
  const requested = await db
    .select(legCols)
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(inArray(transactions.id, unique), eq(clients.organizationId, orgId), isNull(transactions.deletedAt)))

  const byId = new Map<string, TxLeg>()
  const groupIds: string[] = []
  for (const row of requested) {
    if (row.groupId) groupIds.push(row.groupId)
    else byId.set(row.id, row) // standalone transaction
  }

  if (groupIds.length > 0) {
    const legs = await db
      .select(legCols)
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(
        and(
          inArray(transactions.groupId, [...new Set(groupIds)]),
          eq(clients.organizationId, orgId),
          isNull(transactions.deletedAt),
        ),
      )
    for (const leg of legs) byId.set(leg.id, leg)
  }

  return [...byId.values()]
}
