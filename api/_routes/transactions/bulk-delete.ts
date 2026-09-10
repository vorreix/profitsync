import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { resolveTxLegs } from "../../_lib/tx-legs.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"
import { setTransferTrashed } from "../../_lib/wealth-accounts.js"

const MAX_IDS = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" })
  }
  const cleanIds = [...new Set(ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (cleanIds.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  // Expand each requested id to its full split group (a collapsed split row only
  // carries one representative leg id). Deduped, org-scoped, not-yet-deleted —
  // so every leg's balance is reversed exactly once and no leg is orphaned.
  const allLegs = await resolveTxLegs(orgId, cleanIds)
  if (allLegs.length === 0) return res.json({ deleted: 0 })

  // Legs of a LOGICAL transfer are trashed through the transfer service, one
  // atomic database function per transfer (both legs + fee row + balances).
  // Every row linked to one of those transfers — including a selected fee
  // row — is then excluded from the standard path, so nothing is reversed
  // twice. A fee row selected on its own (its transfer not selected) is an
  // ordinary expense and goes the standard way. Legacy transfer legs with no
  // header still go the standard way via their group, exactly as before.
  const transferIds = [...new Set(allLegs.filter((leg) => leg.kind === "transfer" && leg.transferId).map((leg) => leg.transferId as string))]
  for (const transferId of transferIds) {
    const result = await setTransferTrashed(orgId, userId, transferId, false)
    if (!result.ok) return res.status(result.status).json(result.body)
  }
  const viaService = new Set(transferIds)
  const legs = allLegs.filter((leg) => !(leg.transferId && viaService.has(leg.transferId)))
  if (legs.length === 0) return res.json({ deleted: allLegs.length })

  // Reverse each touched account's balance (one UPDATE per account).
  for (const [accountId, shift] of reversalsByAccount(legs)) {
    await db
      .update(wealthAccounts)
      .set({
        currentBalance: sql`${wealthAccounts.currentBalance}::numeric + ${shift}`,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(wealthAccounts.id, accountId))
  }

  const legIds = legs.map((l) => l.id)
  await db
    .update(transactions)
    .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
    .where(inArray(transactions.id, legIds))
  await Promise.all(
    legIds.map((tid) => logAudit({ orgId, entityType: "transaction", entityId: tid, action: "delete", actorId: userId })),
  )

  return res.json({ deleted: allLegs.length })
}
