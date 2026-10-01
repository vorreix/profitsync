import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { clients, quotations, transactions } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { purgeTrashedClients } from "../../_lib/client-trash.js"
import { purgeTrashedTransfers } from "../../_lib/tx-trash.js"

// Empty the org's whole trash in one shot. Same invariants as single-item purge
// (api/_routes/trash/purge.ts): a soft-deleted transaction's balance was already
// reversed at soft-delete time (never touch it again); a trashed client's LIVE
// transactions were never reversed (reverse them before the cascade delete).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { orgId, userId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  // 1. Trashed clients, with their rows — the single-purge statement for the
  //    whole workspace (purgeTrashedClients): claim-first, so a client a
  //    restore brings back meanwhile stays (with its rows), and a live row
  //    under a trashed client is reversed once even against a parallel purge.
  const purgedClients = await purgeTrashedClients(orgId, userId)

  // 2. Remaining trashed transactions (their client is live — client-trashed ones
  //    died with the cascade above). Purging ALL soft-deleted rows inherently
  //    takes every soft-deleted split-group leg, so no orphaned legs. Rows a
  //    logical transfer owns (legs AND fee rows) go only with their whole
  //    transfer, in the statement single purge uses — never row by row, which
  //    raced a restore into balances moved for rows that no longer exist.
  //    A trashed system row on an existing account STAYS (restorable): it is
  //    what explains that part of the balance, as in single purge (MC-054).
  const trashedTx = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(
      eq(clients.organizationId, orgId),
      isNull(clients.deletedAt),
      isNotNull(transactions.deletedAt),
      isNull(transactions.transferId),
      or(eq(transactions.isSystem, false), isNull(transactions.wealthAccountId)),
    ))
  if (trashedTx.length) {
    // deleted_at re-checked: a row restored since the read above stays.
    await db.delete(transactions).where(and(inArray(transactions.id, trashedTx.map((t) => t.id)), isNotNull(transactions.deletedAt)))
  }
  const transferRows = await purgeTrashedTransfers(orgId)

  // 3. Trashed quotations (attachments + pdfs cascade via FK).
  const purgedQuotations = await db
    .delete(quotations)
    .where(and(eq(quotations.organizationId, orgId), isNotNull(quotations.deletedAt)))
    .returning({ id: quotations.id })

  // The system rows step 2 kept, so the page can say why they are still in
  // Trash rather than claim it is empty (they reappear on reload). A one-sided
  // transfer leg also stays, but that is a repair for scripts/audit-balances.mjs,
  // not something the user can act on, so it is not counted here.
  const [{ kept }] = await db
    .select({ kept: sql<number>`count(*)::int` })
    .from(transactions)
    .innerJoin(clients, eq(transactions.clientId, clients.id))
    .where(and(
      eq(clients.organizationId, orgId),
      isNotNull(transactions.deletedAt),
      eq(transactions.isSystem, true),
      isNotNull(transactions.wealthAccountId),
    ))

  return res.json({
    purged: { clients: purgedClients, transactions: trashedTx.length + transferRows, quotations: purgedQuotations.length },
    kept: { transactions: kept },
  })
}
