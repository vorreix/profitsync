import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm"

import { db } from "../../src/lib/db/index.js"
import { clients, transactions } from "../../src/lib/db/schema.js"

// ── Rows + their balance shifts, in ONE statement ────────────────────────────
//
// `current_balance` is stored, so every ledger write is two writes: the rows
// and the accounts they move. Run as separate statements they drift — a crash
// between them leaves a row without its balance (or the other way round), and
// a balance computed from a list read BEFORE the write moves again on a double
// submit, a second tab or a replayed retry. So every writer claims its rows
// first (INSERT … ON CONFLICT DO NOTHING / UPDATE … WHERE <still in the old
// state> / DELETE … RETURNING) and moves the balances in the SAME statement
// from the rows that statement returned — a loser, a replay or a stale tab
// claims nothing and moves nothing. The sign rules are src/lib/wealth-ledger.ts,
// written in SQL because they have to run inside the claiming statement.

/** SQL twin of balanceDelta: what a row applies to its account while live (incoming +, outgoing −). */
export function appliedSql(type: SQL | string, amount: SQL | string): SQL {
  return sql`(case when ${type} = 'incoming' then ${amount}::numeric else -(${amount}::numeric) end)`
}

/**
 * The per-row balance moves of the rows CTE `cte` returned — it must return
 * wealth_account_id, type, amount and is_system. `create` applies every row (a
 * system Opening Balance / Balance Adjustment IS the balance it writes);
 * `restore` re-applies and `trash` takes back (a trash, or a purge of a row
 * still live) everything except system rows, whose effect stays in the balance
 * through Trash (wealth-ledger reversesOnTrash).
 */
export function ledgerMovesSql(cte: string, mode: "create" | "restore" | "trash"): SQL {
  const applied = appliedSql(sql.raw("type"), sql.raw("amount"))
  return sql`select wealth_account_id, ${mode === "trash" ? sql`-` : sql``}${applied} as delta
    from ${sql.identifier(cte)}${mode === "create" ? sql`` : sql` where not coalesce(is_system, false)`}`
}

/**
 * The balance half of a claim-first ledger write, as the body of a
 * data-modifying CTE (`moved as (${balanceShiftSql(…)})`): adds each account's
 * summed `delta` from `moves` (rows of wealth_account_id, delta) — one UPDATE
 * per account however many rows moved it. `userId` null leaves updated_by alone
 * (the recurring materializer has no acting user).
 */
export function balanceShiftSql(moves: SQL, userId: string | null): SQL {
  return sql`update wealth_accounts wa
    set current_balance = wa.current_balance + s.delta, ${userId ? sql`updated_by = ${userId}, ` : sql``}updated_at = now()
    from (select wealth_account_id, sum(delta) as delta from (${moves}) m
          where wealth_account_id is not null group by wealth_account_id) s
    where wa.id = s.wealth_account_id and s.delta <> 0`
}

/** balanceShiftSql as a drizzle CTE, for statements built with `db.with(claim, …)`. */
export function balanceShiftCte(moves: SQL, userId: string | null) {
  return db.$with("moved", {}).as(balanceShiftSql(moves, userId))
}

export type TxLeg = {
  id: string
  groupId: string | null
  transferId: string | null
  kind: string
  wealthAccountId: string | null
  type: string
  amount: string
  isSystem: boolean | null
}

const legCols = {
  id: transactions.id,
  groupId: transactions.groupId,
  transferId: transactions.transferId,
  kind: transactions.kind,
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
