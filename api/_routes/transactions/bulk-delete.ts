import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canDelete, requireAuth } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { resolveTxLegs } from "../../_lib/tx-legs.js"
import { setTransferTrashed } from "../../_lib/wealth-accounts.js"
import { setRowsTrashed } from "../../_lib/tx-trash.js"

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

  // Every row a LOGICAL transfer owns is trashed through the transfer service,
  // one atomic database function per transfer (both legs + fee rows +
  // balances) — and only when one of its LEGS was selected: a fee row selected
  // on its own is skipped, never trashed alone (the header still records it,
  // so a later Reverse would refund it again) and never silently taking its
  // whole transfer along (same rule as DELETE /api/transactions/:id). A
  // transfer the service refuses (a reversal pair, already half-trashed) is
  // skipped too rather than aborting the batch halfway: every call here is
  // atomic on its own, so the rest still goes. Skipped row ids come back in
  // `skipped_transactions` (the tag-delete convention). Legacy transfer legs
  // with no header still go the standard way via their group.
  const transferRows = allLegs.filter((leg) => leg.transferId)
  const transferIds = [...new Set(transferRows.filter((leg) => leg.kind === "transfer").map((leg) => leg.transferId as string))]
  const refused = new Set<string>()
  for (const transferId of transferIds) {
    const result = await setTransferTrashed(orgId, userId, transferId, false)
    if (!result.ok) refused.add(transferId)
  }
  const skipped = transferRows
    .filter((leg) => !transferIds.includes(leg.transferId as string) || refused.has(leg.transferId as string))
    .map((leg) => leg.id)
  const legs = allLegs.filter((leg) => !leg.transferId)

  // Claim-first: only the rows this call actually flipped reverse a balance, so
  // a replayed or concurrent bulk delete can't reverse a leg twice.
  const trashed = await setRowsTrashed(legs.map((l) => l.id), userId, false)
  await Promise.all(
    trashed.map((tid) => logAudit({ orgId, entityType: "transaction", entityId: tid, action: "delete", actorId: userId })),
  )

  return res.json({ deleted: transferRows.length - skipped.length + trashed.length, skipped_transactions: skipped })
}
