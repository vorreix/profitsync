import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, count, eq, isNotNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { setTransferTrashed } from "../../_lib/wealth-accounts.js"
import { setRowsTrashed } from "../../_lib/tx-trash.js"
import { balanceShiftCte, ledgerMovesSql } from "../../_lib/tx-legs.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, userId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { type, id } = req.body as { type: string; id: string }
  if (!id) return res.status(400).json({ error: "id is required" })
  if (!["client", "quotation", "transaction"].includes(type)) {
    return res.status(400).json({ error: "type must be client, quotation, or transaction" })
  }

  if (type === "transaction") {
    // Transactions are org-scoped via their client.
    const [tx] = await db
      .select({ id: transactions.id, groupId: transactions.groupId, transferId: transactions.transferId })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
    if (!tx) return res.status(404).json({ error: "Not found" })
    if (tx.transferId) {
      // A row of a logical transfer — either leg OR its fee row: restore the
      // WHOLE transfer (legs, fee rows, balances) in one database function.
      // Restoring a fee on its own would charge it again for a transfer that
      // is still in Trash. Legacy legs without a header use the group path
      // below, exactly as before.
      const result = await setTransferTrashed(orgId, userId, tx.transferId, true)
      if (!result.ok) return res.status(result.status).json(result.body)
      const [row] = await db.select().from(transactions).where(eq(transactions.id, id))
      const [{ legs: restoredLegCount }] = await db.select({ legs: count() }).from(transactions).where(eq(transactions.transferId, tx.transferId))
      return res.json(serialize({ ...row, restoredLegCount }))
    }

    // A split or a TRANSFER is one logical entry: DELETE trashes every leg of the
    // group, so restore must bring every trashed leg back and re-apply each
    // leg's balance. Restoring a single leg of a card payment would reduce the
    // card's debt while leaving the bank leg in Trash — money out of nothing.
    const legs = await db
      .select({ id: transactions.id })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(
        and(
          tx.groupId ? eq(transactions.groupId, tx.groupId) : eq(transactions.id, id),
          eq(clients.organizationId, orgId),
          isNotNull(transactions.deletedAt),
        ),
      )
    // Claim-first: only the rows this call actually brings back re-apply a
    // balance, so a double-clicked or replayed restore can't apply a leg twice.
    // System balance-defining entries flip without moving the balance — their
    // effect was never reversed on delete (see reversesOnTrash).
    const restoredIds = await setRowsTrashed(legs.map((l) => l.id), userId, true)
    if (restoredIds.length === 0) return res.status(404).json({ error: "Not found" })
    const [updated] = await db.select().from(transactions).where(eq(transactions.id, restoredIds.includes(id) ? id : restoredIds[0]))
    return res.json(serialize({ ...updated, restoredLegCount: restoredIds.length }))
  }

  if (type === "client") {
    // Re-apply + restore exactly the transactions that were trashed TOGETHER with
    // this client (same deleted_at). Transactions the user trashed individually
    // earlier carry a different deleted_at and stay in Trash.
    //
    // ONE statement, claim-first (api/_lib/tx-legs.ts): `old` locks the client
    // while it is still in Trash and hands over the deleted_at its cascade was
    // stamped with; the client is restored through that lock, its rows only
    // while they still carry that value, and the balances move by exactly the
    // rows it brought back. Three writes (client, then balances, then rows)
    // could stop halfway — a live client over trashed rows whose retry answered
    // 404 — and two concurrent restores both re-applied the rows they had read
    // (MC-058 / MC-059). The value is read inside the statement, not by an
    // earlier one: a restore and a re-delete in between would otherwise let a
    // stale request claim the client and restore none of its rows. The loser
    // of a race claims nothing and answers 404.
    const old = db.$with("old", {}).as(sql`
      select id, deleted_at from clients
      where id = ${id}::uuid and organization_id = ${orgId}::uuid and deleted_at is not null
      for update`)
    const restoredClient = db.$with("restored_client").as(
      db
        .update(clients)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(sql`${clients.id} in (select id from old)`)
        .returning(),
    )
    const restoredRows = db.$with("restored_rows").as(
      db
        .update(transactions)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(sql`(${transactions.clientId}, ${transactions.deletedAt}) in (select o.id, o.deleted_at from old o join restored_client r on r.id = o.id)`)
        .returning({ wealthAccountId: transactions.wealthAccountId, type: transactions.type, amount: transactions.amount, isSystem: transactions.isSystem }),
    )
    const [updated] = await db
      .with(old, restoredClient, restoredRows, balanceShiftCte(ledgerMovesSql("restored_rows", "restore"), userId))
      .select()
      .from(restoredClient)
    if (!updated) return res.status(404).json({ error: "Not found" })
    return res.json(serialize(updated))
  }

  const [updated] = await db
    .update(quotations)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning()
  if (!updated) return res.status(404).json({ error: "Not found" })
  return res.json(serialize(updated))
}
