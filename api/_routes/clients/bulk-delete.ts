import type { VercelRequest, VercelResponse } from "@vercel/node"
import { canDelete, requireAuth, requireBusinessFeature } from "../../_lib/auth.js"
import { logAudit } from "../../_lib/audit.js"
import { trashClients } from "../../_lib/client-trash.js"

const MAX_IDS = 200

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (!requireBusinessFeature(res, ctx, "clients")) return
  const { userId, orgId, role } = ctx

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })
  if (!canDelete(role)) return res.status(403).json({ error: "Forbidden" })

  const { ids } = req.body as { ids?: unknown }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids must be a non-empty array" })
  }
  const cleanIds = [...new Set(ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (cleanIds.length === 0) return res.status(400).json({ error: "ids must be a non-empty array" })

  // Mirror the single-client DELETE: soft-delete each client's live transactions
  // together with it, every balance reversed exactly once and a transfer only
  // ever whole (api/_lib/client-trash.ts). Org-scoped; the own/internal client is
  // never deletable. Client + transactions share one `deletedAt` so trash-restore
  // re-applies exactly this cascade (and leaves any individually-trashed-earlier
  // transactions alone).
  const result = await trashClients(orgId, userId, cleanIds)
  if (!result.ok) return res.status(result.status).json(result.body)

  await Promise.all(result.ids.map((id) => logAudit({ orgId, entityType: "client", entityId: id, action: "delete", actorId: userId })))
  return res.json({ deleted: result.ids.length })
}
