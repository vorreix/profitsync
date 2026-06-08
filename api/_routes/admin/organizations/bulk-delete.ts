import type { VercelRequest, VercelResponse } from "@vercel/node"
import { requireAdminCap } from "../../../_lib/admin.js"
import { teardownOrganization } from "../../../_lib/admin-org-delete.js"

const MAX_IDS = 100

/**
 * Bulk-delete organizations (admin). For each org: cancel its Dodo subscription,
 * clean up its clients/quotations (+ cascades), and delete the org. Each org is
 * processed independently so one Dodo failure doesn't abort the batch; the response
 * reports per-org outcomes.
 *
 * POST { organization_ids: string[] }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "write")
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { organization_ids } = req.body as { organization_ids?: unknown }
  if (!Array.isArray(organization_ids) || organization_ids.length === 0) {
    return res.status(400).json({ error: "organization_ids must be a non-empty array" })
  }
  const ids = [...new Set(organization_ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (ids.length === 0) return res.status(400).json({ error: "organization_ids must be a non-empty array" })

  const deleted: string[] = []
  const notDeleted: string[] = []
  const dodoFailed: Array<{ id: string; error: string }> = []
  let dodoCancelled = 0

  for (const id of ids) {
    try {
      const r = await teardownOrganization(id)
      if (r.deleted) deleted.push(id)
      else notDeleted.push(id)
      if (r.dodo.provider === "dodo") {
        if (r.dodo.ok) dodoCancelled += 1
        else dodoFailed.push({ id, error: r.dodo.error })
      }
    } catch {
      notDeleted.push(id)
    }
  }

  return res.json({
    deleted,
    deleted_count: deleted.length,
    not_deleted: notDeleted,
    dodo_cancelled: dodoCancelled,
    dodo_failed: dodoFailed,
  })
}
