import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { auditLogs, clients, quotations, transactions, transfers, wealthAccounts } from "../../src/lib/db/schema.js"
import { resolveTxLegs } from "./tx-legs.js"
import { setTransferTrashed } from "./wealth-accounts.js"

// Cross-entity tag mutations. A tag lives as a string inside each row's `tags`
// jsonb array on transactions / clients / quotations. These helpers rewrite
// those arrays org-scoped and case-insensitively (an inline-typed tag can differ
// in casing from the registry spelling), keeping the array a deduped set.
//
// Transactions are org-scoped through their client (no organization_id column);
// clients and quotations carry organization_id directly.

/**
 * Rename `oldName` → `newName` everywhere it appears (case-insensitive match).
 * Elements that collapse onto an existing element are deduped away.
 */
export async function renameTagEverywhere(orgId: string, oldName: string, newName: string): Promise<void> {
  await db.execute(sql`
    update transactions t
    set tags = (
      select coalesce(jsonb_agg(distinct elem), '[]'::jsonb)
      from (
        select case when lower(e) = lower(${oldName}) then ${newName} else e end as elem
        from jsonb_array_elements_text(t.tags) e
      ) x
    )
    from clients c
    where c.id = t.client_id and c.organization_id = ${orgId}
      and exists (select 1 from jsonb_array_elements_text(t.tags) e where lower(e) = lower(${oldName}))`)

  for (const table of ["clients", "quotations"] as const) {
    await db.execute(sql`
      update ${sql.identifier(table)}
      set tags = (
        select coalesce(jsonb_agg(distinct elem), '[]'::jsonb)
        from (
          select case when lower(e) = lower(${oldName}) then ${newName} else e end as elem
          from jsonb_array_elements_text(tags) e
        ) x
      )
      where organization_id = ${orgId}
        and exists (select 1 from jsonb_array_elements_text(tags) e where lower(e) = lower(${oldName}))`)
  }
}

/**
 * Strip `name` (case-insensitive) from the tags array of every entity that has
 * it. The entities themselves are untouched — this is the "delete the tag only"
 * path. `liveOnly` leaves rows in Trash alone: after a with_records delete the
 * trashed rows keep the tag, so restoring one brings it back as it was.
 */
export async function removeTagEverywhere(orgId: string, name: string, liveOnly = false): Promise<void> {
  const txLive = liveOnly ? sql`and t.deleted_at is null` : sql``
  const rowLive = liveOnly ? sql`and deleted_at is null` : sql``
  await db.execute(sql`
    update transactions t
    set tags = (
      select coalesce(jsonb_agg(e), '[]'::jsonb)
      from jsonb_array_elements_text(t.tags) e
      where lower(e) <> lower(${name})
    )
    from clients c
    where c.id = t.client_id and c.organization_id = ${orgId} ${txLive}
      and exists (select 1 from jsonb_array_elements_text(t.tags) e where lower(e) = lower(${name}))`)

  for (const table of ["clients", "quotations"] as const) {
    await db.execute(sql`
      update ${sql.identifier(table)}
      set tags = (
        select coalesce(jsonb_agg(e), '[]'::jsonb)
        from jsonb_array_elements_text(tags) e
        where lower(e) <> lower(${name})
      )
      where organization_id = ${orgId} ${rowLive}
        and exists (select 1 from jsonb_array_elements_text(tags) e where lower(e) = lower(${name}))`)
  }
}

export type TagDeleteCounts = { transactions: number; clients: number; quotations: number }

// Mirrors set_transfer_trashed's refusals (0073: not completed, already
// trashed, part of a reversal pair) so the preview counts only what will move.
// The database function stays the authority when the delete actually runs.
const transferTrashable = and(
  eq(transfers.status, "completed"),
  isNull(transfers.deletedAt),
  isNull(transfers.reversesTransferId),
  sql`not exists (select 1 from transfers r where r.reverses_transfer_id = ${transfers.id})`,
)

/**
 * What "delete the tag AND its related records" takes down, read without
 * writing. The delete and the dialog's dry-run preview both come through here,
 * so the count the user confirms is the count that moves.
 *
 * Tagged clients (never the own/internal client) take ALL their live
 * transactions with them, mirroring the client DELETE endpoint. The tagged
 * transactions plus that cascade are expanded by resolveTxLegs to whole ledger
 * groups — a split, a legacy transfer or a debt repayment is one logical entry
 * and is never trashed one leg at a time. A row carrying `transfer_id` (a leg
 * OR a fee row) belongs to its logical transfer, so `transferIds` lists those
 * for the transfer service; every other row goes the standard way.
 */
async function planTagDelete(orgId: string, name: string) {
  const needle = name.toLowerCase()
  const txHasTag = sql`exists (select 1 from jsonb_array_elements_text(${transactions.tags}) e where lower(e) = ${needle})`
  const clientHasTag = sql`exists (select 1 from jsonb_array_elements_text(${clients.tags}) e where lower(e) = ${needle})`
  const quotationHasTag = sql`exists (select 1 from jsonb_array_elements_text(${quotations.tags}) e where lower(e) = ${needle})`

  const [taggedClients, taggedQuotations] = await Promise.all([
    db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), eq(clients.isOwn, false), clientHasTag)),
    db
      .select({ id: quotations.id })
      .from(quotations)
      .where(and(eq(quotations.organizationId, orgId), isNull(quotations.deletedAt), quotationHasTag)),
  ])
  const clientIds = taggedClients.map((c) => c.id)

  const [taggedTx, clientTx] = await Promise.all([
    db
      .select({ id: transactions.id })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), isNull(transactions.deletedAt), txHasTag)),
    clientIds.length
      ? db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(inArray(transactions.clientId, clientIds), isNull(transactions.deletedAt)))
      : Promise.resolve([]),
  ])
  const legs = await resolveTxLegs(orgId, [...taggedTx, ...clientTx].map((t) => t.id))
  const transferIds = [...new Set(legs.flatMap((l) => (l.transferId ? [l.transferId] : [])))]
  return { clientIds, quotationIds: taggedQuotations.map((q) => q.id), legs, transferIds }
}

/** Every live row (legs + fee row) of these transfers — what the service moves. */
function liveTransferRows(orgId: string, transferIds: string[], onlyTrashable = false) {
  if (transferIds.length === 0) return Promise.resolve([])
  return db
    .select({ id: transactions.id, transferId: transfers.id })
    .from(transactions)
    .innerJoin(transfers, eq(transfers.id, transactions.transferId))
    .where(and(
      eq(transfers.organizationId, orgId),
      inArray(transfers.id, transferIds),
      isNull(transactions.deletedAt),
      onlyTrashable ? transferTrashable : undefined,
    ))
}

/** Dry run of softDeleteByTag: the true number of rows it would move to Trash. */
export async function previewTagDelete(orgId: string, name: string): Promise<TagDeleteCounts> {
  const plan = await planTagDelete(orgId, name)
  const transferRows = await liveTransferRows(orgId, plan.transferIds, true)
  return {
    transactions: plan.legs.filter((l) => !l.transferId).length + transferRows.length,
    clients: plan.clientIds.length,
    quotations: plan.quotationIds.length,
  }
}

/**
 * "Delete the tag AND its related records": soft-delete to Trash everything
 * planTagDelete returns, with every wealth balance reversed exactly once.
 *
 * Logical transfers go through the transfer service (setTransferTrashed): one
 * atomic database function trashes both legs, the fee row, the header and the
 * balances, so restoring any leg from Trash brings the whole transfer back. A
 * transfer the service would refuse (a reversal pair, an incomplete or
 * half-trashed transfer) is left untouched and its rows are reported in
 * `skipped_transactions`. Transfer rows are written on the own client
 * (ensureDefaultClient), which is never cascaded, so a kept transfer row can't
 * end up under a trashed client.
 *
 * Every other row is trashed here claim-first: only rows this call flips from
 * live are reversed, so a replayed or concurrent delete moves no money twice.
 * They share one `deletedAt` with the tagged clients so a client restore
 * re-applies exactly its cascade.
 */
export async function softDeleteByTag(
  orgId: string,
  name: string,
  userId: string,
): Promise<TagDeleteCounts & { skipped_transactions: string[] }> {
  const plan = await planTagDelete(orgId, name)
  const now = new Date()

  // Skip what the service would refuse, decided up front by the preview's own
  // predicate — not from a failed call: setTransferTrashed maps EVERY error to
  // the same 409, so its result can't tell a refusal from a dropped connection.
  const trashableRows = await liveTransferRows(orgId, plan.transferIds, true)
  const trashable = [...new Set(trashableRows.map((r) => r.transferId))]
  const refused = plan.transferIds.filter((id) => !trashable.includes(id))
  for (const transferId of trashable) {
    const result = await setTransferTrashed(orgId, userId, transferId, false)
    if (result.ok) continue
    // Changed under us (reversed or trashed meanwhile): skip it. Still trashable:
    // it failed for another reason — abort before the route strips the tag and
    // drops the registry row, so a retry still finds every tagged row. Every
    // step here is claim-first, so the retry moves nothing twice.
    if ((await liveTransferRows(orgId, [transferId], true)).length) throw new Error(`tag delete: transfer ${transferId} could not be trashed`)
    refused.push(transferId)
  }
  const skipped = (await liveTransferRows(orgId, refused)).map((r) => r.id)
  const movedTransferRows = trashableRows.filter((r) => !refused.includes(r.transferId)).length

  // Flip + balance shift in ONE statement, the shape of tx-trash.ts
  // setRowsTrashed: the shift is summed from the rows the UPDATE actually
  // flipped, so a crash can't leave rows in Trash with their balance still
  // applied, and a replay moves nothing. Written here rather than calling
  // setRowsTrashed because these rows must carry the JS `now` the tagged clients
  // get (a client restore re-applies exactly the rows with its deletedAt), and
  // setRowsTrashed stamps the database's now(). System balance-defining rows
  // flip without moving the balance (wealth-ledger reversesOnTrash).
  const standardIds = plan.legs.filter((l) => !l.transferId).map((l) => l.id)
  let trashedTx: { id: string }[] = []
  if (standardIds.length) {
    const flipped = db.$with("flipped").as(
      db
        .update(transactions)
        .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
        .where(and(inArray(transactions.id, standardIds), isNull(transactions.deletedAt), isNull(transactions.transferId)))
        .returning({ id: transactions.id, wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount, isSystem: transactions.isSystem }),
    )
    const shifts = db.$with("shifts").as(
      db
        .select({
          accountId: flipped.wealthAccountId,
          // What the rows applied while live (incoming +, outgoing -).
          applied: sql<string>`sum(case when ${flipped.type} = 'incoming' then ${flipped.amount} else -${flipped.amount} end)`.as("applied"),
        })
        .from(flipped)
        .where(and(isNotNull(flipped.wealthAccountId), eq(flipped.isSystem, false)))
        .groupBy(flipped.wealthAccountId),
    )
    const moved = db.$with("moved").as(
      db
        .update(wealthAccounts)
        .set({ currentBalance: sql`${wealthAccounts.currentBalance} - ${shifts.applied}`, updatedBy: userId, updatedAt: now })
        .from(shifts)
        .where(eq(wealthAccounts.id, shifts.accountId)),
    )
    trashedTx = await db.with(flipped, shifts, moved).select({ id: flipped.id }).from(flipped)
  }
  const trashedClients = plan.clientIds.length
    ? await db
        .update(clients)
        .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
        .where(and(inArray(clients.id, plan.clientIds), isNull(clients.deletedAt)))
        .returning({ id: clients.id })
    : []
  const trashedQuotations = plan.quotationIds.length
    ? await db
        .update(quotations)
        .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
        .where(and(inArray(quotations.id, plan.quotationIds), isNull(quotations.deletedAt)))
        .returning({ id: quotations.id })
    : []

  // Audit what the tag delete took down, as every other delete does (the
  // transfer service audits each transfer itself). A tagged client can cascade
  // thousands of rows, so this is a multi-row insert in chunks well under
  // Postgres' bind-parameter cap, not one request per row. Like logAudit, a
  // failure never undoes the delete it records.
  const entries = [
    ...trashedTx.map((r) => ({ entityType: "transaction", entityId: r.id })),
    ...trashedClients.map((c) => ({ entityType: "client", entityId: c.id })),
    ...trashedQuotations.map((q) => ({ entityType: "quotation", entityId: q.id })),
  ].map((e) => ({ ...e, organizationId: orgId, action: "delete", actorUserId: userId }))
  try {
    for (let i = 0; i < entries.length; i += 1000) await db.insert(auditLogs).values(entries.slice(i, i + 1000))
  } catch {
    /* non-fatal */
  }

  return {
    transactions: trashedTx.length + movedTransferRows,
    clients: trashedClients.length,
    quotations: trashedQuotations.length,
    skipped_transactions: skipped,
  }
}
