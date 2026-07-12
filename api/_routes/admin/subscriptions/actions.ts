import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { subscriptions } from "../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../_lib/admin.js"
import {
  cancelledNowFields,
  dodoEnvForSub,
  FREE_RESET_FIELDS,
  stopDodoBilling,
} from "../../../_lib/admin-billing.js"
import { reconcileSubscriptionFromDodo } from "../../../_lib/billing-sync.js"
import { notifySubscriptionChanged } from "../../../_lib/notify-billing.js"

const MAX_IDS = 100
const ACTIONS = ["downgrade_free", "cancel_dodo", "sync"] as const
type Action = (typeof ACTIONS)[number]

/**
 * Bulk Dodo-aware actions on subscriptions (admin):
 *  - `downgrade_free` — cancel on Dodo + reset the row to the Free tier.
 *  - `cancel_dodo`    — cancel on Dodo (immediate) + mark the row cancelled.
 *  - `sync`           — pull the authoritative state from Dodo into our mirror.
 *
 * Each subscription is processed independently so one Dodo failure doesn't abort the
 * batch. The response returns the updated rows (so the UI can replace them in place)
 * plus per-row failures and a Dodo-cancellation count.
 *
 * POST { subscription_ids: string[], action }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "write")
  if (!ctx) return
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  const { subscription_ids, action } = req.body as { subscription_ids?: unknown; action?: unknown }
  if (!ACTIONS.includes(action as Action)) {
    return res.status(400).json({ error: `action must be one of: ${ACTIONS.join(", ")}` })
  }
  if (!Array.isArray(subscription_ids) || subscription_ids.length === 0) {
    return res.status(400).json({ error: "subscription_ids must be a non-empty array" })
  }
  const ids = [...new Set(subscription_ids.filter((v): v is string => typeof v === "string"))].slice(0, MAX_IDS)
  if (ids.length === 0) return res.status(400).json({ error: "subscription_ids must be a non-empty array" })

  const act = action as Action
  const updated: Record<string, unknown>[] = []
  const failed: Array<{ id: string; error: string }> = []
  const notFound: string[] = []
  let dodoCancelled = 0
  let synced = 0

  for (const id of ids) {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id))
    if (!sub) {
      notFound.push(id)
      continue
    }
    try {
      if (act === "sync") {
        const env = dodoEnvForSub(sub)
        const result = await reconcileSubscriptionFromDodo(sub, env)
        if (result.synced) synced += 1
        updated.push(serialize(result.subscription))
        continue
      }

      // downgrade_free / cancel_dodo both stop billing first.
      const stop = await stopDodoBilling(sub)
      if (stop.provider === "dodo" && !stop.ok) {
        failed.push({ id, error: stop.error }) // leave the row untouched so it can be retried
        continue
      }
      if (stop.provider === "dodo" && stop.ok) dodoCancelled += 1

      const patch =
        act === "downgrade_free"
          ? { ...FREE_RESET_FIELDS, updatedAt: new Date() }
          : { ...cancelledNowFields(new Date()), updatedAt: new Date() }

      const [row] = await db.update(subscriptions).set(patch).where(eq(subscriptions.id, id)).returning()
      if (row) {
        updated.push(serialize(row))
        // Org owners/admins learn their plan was changed by a platform admin.
        // (The `sync` action notifies from inside reconcileSubscriptionFromDodo.)
        void notifySubscriptionChanged(row.organizationId, {
          fromPlan: sub.planKey,
          toPlan: row.planKey,
          fromStatus: sub.status,
          toStatus: row.status,
        }).catch(() => {})
      }
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "Action failed" })
    }
  }

  return res.json({
    action: act,
    updated,
    updated_count: updated.length,
    failed,
    not_found: notFound,
    dodo_cancelled: dodoCancelled,
    synced,
  })
}
