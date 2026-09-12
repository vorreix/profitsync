import type { VercelRequest, VercelResponse } from "@vercel/node"
import { serialize } from "../../../../src/lib/db/index.js"
import { canDelete, canWrite, requireAuth } from "../../../_lib/auth.js"
import { setTransferTrashed, transitionTransfer } from "../../../_lib/wealth-accounts.js"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  const { id } = req.query as { id: string }
  if (req.method === "DELETE" || req.method === "POST") {
    if (!canDelete(ctx.role)) return res.status(403).json({ error: "Forbidden" })
    const result = await setTransferTrashed(ctx.orgId, ctx.userId, id, req.method === "POST")
    if (!result.ok) return res.status(result.status).json(result.body)
    return res.json(serialize(result.row))
  }
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" })
  if (!canWrite(ctx.role)) return res.status(403).json({ error: "Forbidden" })
  const { status } = req.body as { status?: string }
  if (!status || !["pending", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, completed, or cancelled", code: "invalid_transfer_status" })
  }
  const result = await transitionTransfer(ctx.orgId, ctx.userId, id, status as "pending" | "completed" | "cancelled")
  if (!result.ok) return res.status(result.status).json(result.body)
  return res.json({ ...serialize(result.row), leg_ids: result.legIds })
}
