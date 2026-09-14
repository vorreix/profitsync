import type { VercelRequest, VercelResponse } from "@vercel/node"
import { serialize } from "../../../../../src/lib/db/index.js"
import { canWrite, requireAuth } from "../../../../_lib/auth.js"
import { reverseTransfer } from "../../../../_lib/wealth-accounts.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(ctx.role)) return res.status(403).json({ error: "Forbidden" })
  const { id } = req.query as { id: string }
  const { date, note } = req.body as { date?: string; note?: string }
  const result = await reverseTransfer(ctx.orgId, ctx.userId, id, date, note)
  if (!result.ok) return res.status(result.status).json(result.body)
  return res.status(201).json({
    transfer_id: result.transferId,
    group_id: result.groupId,
    from_leg: serialize(result.outLeg),
    to_leg: serialize(result.inLeg),
    fee_refund_leg: result.feeRefundLeg ? serialize(result.feeRefundLeg) : null,
  })
}
