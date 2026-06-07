import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq, inArray, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { transactions, wealthAccounts } from "../../../src/lib/db/schema.js"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { resolveTxLegs } from "../../_lib/tx-legs.js"
import { reversalsByAccount } from "../../../src/lib/wealth-ledger.js"

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
  const legs = await resolveTxLegs(orgId, cleanIds)
  if (legs.length === 0) return res.json({ deleted: 0 })

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

  return res.json({ deleted: legIds.length })
}
