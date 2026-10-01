import { sql } from "drizzle-orm"

import { db } from "../../src/lib/db/index.js"

/**
 * Move plain ledger rows into (restore=false) or out of (restore=true) Trash,
 * CLAIM-FIRST and in ONE statement, and return the ids that actually moved.
 *
 * The balance shift is computed from the rows the UPDATE flipped — never from
 * a list read beforehand — so a replayed DELETE, a stale tab, two concurrent
 * restores or a transient-failure retry of this very statement all find the
 * rows already flipped and move no money: a balance moves exactly once per
 * ledger movement. Read-then-write (reverse, then flip) reversed an already
 * trashed row a second time.
 *
 * Rows owned by a logical transfer (`transfer_id` set: both legs AND the fee
 * rows) are never touched here — only set_transfer_trashed may move them, as
 * one unit with their header. System balance-defining rows (Opening Balance,
 * Balance Adjustment) are never trashed here (MC-054): their effect stays in
 * current_balance through Trash (wealth-ledger reversesOnTrash), so a trashed
 * one could only be purged into a balance no row explains. They are changed
 * from the account's page instead (tag delete, api/_lib/tag-ops.ts, keeps them
 * live too). One already in Trash (legacy) still RESTORES, without moving the
 * balance — the same rule as reversalsByAccount, written in SQL because it has
 * to run inside the claiming statement — and purge / Empty trash keep it while
 * its account exists.
 *
 * Callers pass ids they have already scoped to the org.
 */
export async function setRowsTrashed(ids: string[], userId: string, restore: boolean): Promise<string[]> {
  if (ids.length === 0) return []
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)
  const result = await db.execute(sql`
    with flipped as (
      update transactions
      set deleted_at = ${restore ? sql`null` : sql`now()`}, updated_by = ${userId}, updated_at = now()
      where id in (${idList})
        and ${restore ? sql`deleted_at is not null` : sql`deleted_at is null and not is_system`}
        and transfer_id is null
      returning id, wealth_account_id, type, amount, is_system
    ), shifts as (
      -- What the rows applied while live (incoming +, outgoing -), per account.
      select wealth_account_id, sum(case when type = 'incoming' then amount else -amount end) as applied
      from flipped
      where wealth_account_id is not null and not is_system
      group by wealth_account_id
    ), moved as (
      update wealth_accounts wa
      set current_balance = wa.current_balance ${restore ? sql`+` : sql`-`} shifts.applied, updated_by = ${userId}, updated_at = now()
      from shifts
      where wa.id = shifts.wealth_account_id
    )
    select id from flipped`)
  return (result.rows as Array<{ id: string }>).map((row) => row.id)
}

/**
 * Hard-delete logical transfers that are wholly in Trash — every row they own
 * (both legs AND the fee rows, which carry transfer_id but no group_id) plus
 * the header — in ONE statement, and return how many transactions rows went.
 * One transfer when `transferId` is given (Delete forever), else every such
 * transfer in the org (Empty trash). Balances are never touched: a trashed
 * row's effect was reversed when it was trashed.
 *
 * A transfer qualifies when none of its rows is live, and its header is either
 * trashed or a `completed` legacy header — the 0071 backfill made headers for
 * groups already sitting in Trash, and 0073 added `deleted_at` as NULL, so
 * their header reads live while every row is trashed. A leg trashed on its own
 * (its sibling still live) never qualifies: that would leave one side.
 *
 * The header delete re-checks the header's `deleted_at` against this
 * statement's snapshot. A restore (set_transfer_trashed) that lands first
 * flips it — and the rows, whose `deleted_at is not null` re-check then skips
 * them — so nothing goes; one caught mid-flight holds the header lock this
 * DELETE waits on while wanting the row locks it holds, and the deadlock rolls
 * one side back whole. Never a live header over deleted rows, or restored rows
 * whose header is gone.
 */
export async function purgeTrashedTransfers(orgId: string, transferId?: string): Promise<number> {
  const result = await db.execute(sql`
    with header as (
      select h.id, h.deleted_at from transfers h
      where h.organization_id = ${orgId}
        ${transferId ? sql`and h.id = ${transferId}` : sql``}
        and not exists (select 1 from transactions x where x.transfer_id = h.id and x.deleted_at is null)
        and (h.deleted_at is not null
          or (h.status = 'completed' and exists (select 1 from transactions x where x.transfer_id = h.id)))
    ), purged_rows as (
      delete from transactions where transfer_id in (select id from header) and deleted_at is not null
      returning id
    ), purged_headers as (
      delete from transfers h using header
      where h.id = header.id and h.deleted_at is not distinct from header.deleted_at
    )
    select count(*)::int as purged from purged_rows`)
  return (result.rows as Array<{ purged: number }>)[0]?.purged ?? 0
}
