import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNotNull } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { purgeTrashedTransfers } from "../../_lib/tx-trash.js"
import { purgeTrashedClients } from "../../_lib/client-trash.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, userId, role } = ctx

  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { type, id } = req.body as { type: string; id: string }
  if (!id) return res.status(400).json({ error: "id is required" })
  if (!["client", "quotation", "transaction"].includes(type)) {
    return res.status(400).json({ error: "type must be client, quotation, or transaction" })
  }

  if (type === "transaction") {
    // The transaction is in Trash, i.e. already soft-deleted — its wealth-balance
    // effect was reversed at soft-delete time, so purging must NOT touch balances
    // again (that would double-reverse). Expand a split group so purging one
    // soft-deleted leg removes all its (soft-deleted) siblings — no orphans.
    const [tx] = await db
      .select({ id: transactions.id, groupId: transactions.groupId, transferId: transactions.transferId, isSystem: transactions.isSystem, wealthAccountId: transactions.wealthAccountId })
      .from(transactions)
      .innerJoin(clients, eq(transactions.clientId, clients.id))
      .where(and(eq(transactions.id, id), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
    if (!tx) return res.status(404).json({ error: "Not found" })
    // A trashed Opening Balance / Balance Adjustment still carries its effect in
    // current_balance (system rows never reverse through Trash), so it is the
    // only row explaining that part of the balance. Purging it left a balance
    // with no row behind it (MC-054: such a wallet was then relabelled into
    // another currency with nothing to show for it). It can be restored; the
    // balance itself is changed from the account's page. Once its account is
    // gone it explains nothing and goes like any row.
    if (tx.isSystem && tx.wealthAccountId) {
      return res.status(409).json({ error: "This entry sets the account's balance — change it from the account's page.", code: "system_row" })
    }
    if (tx.transferId) {
      // A row of a logical transfer is purged with the WHOLE transfer — both
      // legs, the fee rows and the header — in ONE statement
      // (purgeTrashedTransfers). Following group_id alone left the fee in
      // Trash, where restoring it charged the fee again for a transfer that no
      // longer existed. Refused while any of its rows is still live (a leg
      // trashed on its own): deleting it would leave a transfer with one side.
      if ((await purgeTrashedTransfers(orgId, tx.transferId)) === 0) {
        return res.status(409).json({ error: "This transfer is not in Trash — delete the whole transfer first, then purge it.", code: "transfer_not_trashed" })
      }
      return res.status(204).end()
    }
    if (tx.groupId) {
      const legs = await db
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(clients, eq(transactions.clientId, clients.id))
        .where(and(eq(transactions.groupId, tx.groupId), eq(clients.organizationId, orgId), isNotNull(transactions.deletedAt)))
      await db.delete(transactions).where(and(inArray(transactions.id, legs.map((l) => l.id)), isNotNull(transactions.deletedAt)))
    } else {
      await db.delete(transactions).where(and(eq(transactions.id, id), isNotNull(transactions.deletedAt)))
    }
    return res.status(204).end()
  }

  if (type === "client") {
    // One claim-first statement (purgeTrashedClients): the client goes only
    // while it is in Trash, and only its rows still LIVE are reversed (never
    // reversed when it was trashed — legacy); trashed ones were. A loser of a
    // race with another purge or a restore deletes nothing and answers 404.
    if (!(await purgeTrashedClients(orgId, userId, id))) return res.status(404).json({ error: "Not found" })
    return res.status(204).end()
  }

  const result = await db
    .delete(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning({ id: quotations.id })
  if (!result.length) return res.status(404).json({ error: "Not found" })
  return res.status(204).end()
}
