import { sql, type SQL } from "drizzle-orm"

import { db } from "../../src/lib/db/index.js"
import { setTransferTrashed, type Failure } from "./wealth-accounts.js"

/**
 * The ledger rows a client delete takes down: the clients' rows plus every
 * sibling leg of a group one of them belongs to (a split, a debt repayment) —
 * resolveTxLegs' expansion (api/_lib/tx-legs.ts), written in SQL and keyed by
 * client, so a client with ten thousand rows binds a handful of parameters
 * instead of one per row (a bulk delete would pass Postgres' bind cap).
 * `owners` is a subquery of client ids; the outer row is aliased `t`.
 *
 * `= any(array(…))` rather than `in (…)`: each side becomes an indexable
 * array condition (client_date / group indexes), so the OR is a BitmapOr, not
 * a scan of every transaction. The group lookup ignores `deleted_at`: the
 * transfer legs trashed just before the flip still anchor their group's other
 * rows (a debt repayment's interest), as resolveTxLegs' up-front read did.
 */
function cascadeOf(owners: SQL) {
  return sql`(t.client_id = any(array(${owners})) or t.group_id = any(array(
    select g.group_id from transactions g where g.client_id = any(array(${owners})) and g.group_id is not null)))`
}

/**
 * Move clients to Trash together with their ledger rows, every wealth balance
 * reversed exactly once. The workspace DELETE, the bulk delete and the admin
 * console all come through here. Org, live and not-own are enforced here, so
 * callers may pass any ids; returns the ids actually trashed.
 *
 * Rows owned by a logical transfer (`transfer_id`: legs AND fee rows) go
 * through the transfer service first, one whole transfer at a time. Every
 * transfer row is written on the own client, which never qualifies, so this
 * finds none in practice; should one turn up and the service refuse it, the
 * delete stops with the service's 409 before any client moves — a client in
 * Trash over a live transfer row would split the balances from the reports.
 * Transfers already trashed by then stay whole and restorable.
 *
 * Everything else moves in ONE statement that claims the clients, flips their
 * rows and shifts the balances from the rows it flipped (the shape of
 * tx-trash.ts setRowsTrashed): two concurrent deletes, a replay or a crash
 * can't reverse a row twice or leave a client in Trash over live rows. The
 * claim conditions sit on the UPDATE's own row, not in a subquery, so the
 * losing statement re-checks them after the winner commits and claims nothing.
 * System balance-defining rows flip without moving the balance
 * (wealth-ledger reversesOnTrash).
 *
 * Clients and rows share one JS-made `deleted_at` so the client restore
 * (api/_routes/trash/restore.ts) re-applies exactly this cascade: it compares
 * the rows to the client's value after a JS round trip, which keeps only
 * milliseconds — the database's now() would never compare equal.
 */
export async function trashClients(
  orgId: string,
  userId: string,
  clientIds: string[],
): Promise<{ ok: true; ids: string[] } | Failure> {
  if (clientIds.length === 0) return { ok: true, ids: [] }
  const idList = sql.join(clientIds.map((id) => sql`${id}::uuid`), sql`, `)
  const claimable = sql`id in (${idList}) and organization_id = ${orgId}::uuid and deleted_at is null and not is_own`

  const owned = await db.execute(sql`
    select distinct t.transfer_id from transactions t
    where t.deleted_at is null and t.transfer_id is not null
      and ${cascadeOf(sql`select id from clients where ${claimable}`)}`)
  for (const { transfer_id } of owned.rows as Array<{ transfer_id: string }>) {
    const result = await setTransferTrashed(orgId, userId, transfer_id, false)
    if (!result.ok) return result
  }

  const at = sql`${new Date().toISOString()}::timestamp`
  const result = await db.execute(sql`
    with claimed as (
      update clients set deleted_at = ${at}, updated_by = ${userId}, updated_at = now()
      where ${claimable}
      returning id
    ), flipped as (
      update transactions t
      set deleted_at = ${at}, updated_by = ${userId}, updated_at = now()
      from clients c
      where c.id = t.client_id and c.organization_id = ${orgId}::uuid
        and t.deleted_at is null and t.transfer_id is null
        and ${cascadeOf(sql`select id from claimed`)}
      returning t.wealth_account_id, t.type, t.amount, t.is_system
    ), shifts as (
      -- What the rows applied while live (incoming +, outgoing -), per account.
      select wealth_account_id, sum(case when type = 'incoming' then amount else -amount end) as applied
      from flipped
      where wealth_account_id is not null and not is_system
      group by wealth_account_id
    ), moved as (
      update wealth_accounts wa
      set current_balance = wa.current_balance - shifts.applied, updated_by = ${userId}, updated_at = now()
      from shifts
      where wa.id = shifts.wealth_account_id
    )
    select id from claimed`)
  return { ok: true, ids: (result.rows as Array<{ id: string }>).map((row) => row.id) }
}
