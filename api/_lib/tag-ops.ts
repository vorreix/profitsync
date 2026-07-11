import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, quotations, transactions, wealthAccounts } from "../../src/lib/db/schema.js"
import { reversalsByAccount } from "../../src/lib/wealth-ledger.js"

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
 * path.
 */
export async function removeTagEverywhere(orgId: string, name: string): Promise<void> {
  await db.execute(sql`
    update transactions t
    set tags = (
      select coalesce(jsonb_agg(e), '[]'::jsonb)
      from jsonb_array_elements_text(t.tags) e
      where lower(e) <> lower(${name})
    )
    from clients c
    where c.id = t.client_id and c.organization_id = ${orgId}
      and exists (select 1 from jsonb_array_elements_text(t.tags) e where lower(e) = lower(${name}))`)

  for (const table of ["clients", "quotations"] as const) {
    await db.execute(sql`
      update ${sql.identifier(table)}
      set tags = (
        select coalesce(jsonb_agg(e), '[]'::jsonb)
        from jsonb_array_elements_text(tags) e
        where lower(e) <> lower(${name})
      )
      where organization_id = ${orgId}
        and exists (select 1 from jsonb_array_elements_text(tags) e where lower(e) = lower(${name}))`)
  }
}

export type TagDeleteCounts = { transactions: number; clients: number; quotations: number }

/**
 * "Delete the tag AND its related records": soft-delete (to Trash, reversible)
 * every entity carrying `name`. A tagged CLIENT takes its live transactions down
 * with it (mirroring the client DELETE endpoint), so its transactions are removed
 * even if they don't carry the tag themselves. The own/internal client is never
 * touched. Wealth balances are reversed from the ledger for every removed
 * transaction (a bare soft-delete would leave balances overstated). All rows in
 * one call share a single `deletedAt` so trash-restore re-applies exactly them.
 */
export async function softDeleteByTag(orgId: string, name: string, userId: string): Promise<TagDeleteCounts> {
  const now = new Date()
  const needle = name.toLowerCase()
  const txHasTag = sql`exists (select 1 from jsonb_array_elements_text(${transactions.tags}) e where lower(e) = ${needle})`
  const clientHasTag = sql`exists (select 1 from jsonb_array_elements_text(${clients.tags}) e where lower(e) = ${needle})`
  const quotationHasTag = sql`exists (select 1 from jsonb_array_elements_text(${quotations.tags}) e where lower(e) = ${needle})`

  // Tagged clients (never the own/internal client, never already-trashed).
  const taggedClients = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), eq(clients.isOwn, false), clientHasTag))
  const clientIds = taggedClients.map((c) => c.id)

  // Transactions to remove = those carrying the tag (org-scoped via client) ∪ all
  // live transactions of a tagged client. Dedupe by id so a tx that is both isn't
  // double-reversed.
  const taggedTx = await db
    .select({ id: transactions.id, wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt), isNull(transactions.deletedAt), txHasTag))
  const clientTx = clientIds.length
    ? await db
        .select({ id: transactions.id, wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount })
        .from(transactions)
        .where(and(inArray(transactions.clientId, clientIds), isNull(transactions.deletedAt)))
    : []

  const legMap = new Map<string, { id: string; wealthAccountId: string | null; type: string; amount: string }>()
  for (const t of [...taggedTx, ...clientTx]) legMap.set(t.id, t)
  const legs = [...legMap.values()]

  // Reverse each removed transaction's balance effect (collapsed per account).
  for (const [accountId, shift] of reversalsByAccount(legs)) {
    await db
      .update(wealthAccounts)
      .set({ currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`, updatedBy: userId, updatedAt: now })
      .where(eq(wealthAccounts.id, accountId))
  }
  if (legs.length) {
    await db
      .update(transactions)
      .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
      .where(inArray(transactions.id, legs.map((l) => l.id)))
  }
  if (clientIds.length) {
    await db.update(clients).set({ deletedAt: now, updatedBy: userId, updatedAt: now }).where(inArray(clients.id, clientIds))
  }
  const qtDeleted = await db
    .update(quotations)
    .set({ deletedAt: now, updatedBy: userId, updatedAt: now })
    .where(and(eq(quotations.organizationId, orgId), isNull(quotations.deletedAt), quotationHasTag))
    .returning({ id: quotations.id })

  return { transactions: legs.length, clients: clientIds.length, quotations: qtDeleted.length }
}
