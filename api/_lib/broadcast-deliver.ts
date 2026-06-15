// Broadcast fan-out (#7). Shared by the scheduler (POST /api/cron/notifications)
// and the admin send-now route, so audience resolution + delivery + idempotency
// live in exactly one place.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { pushSubscriptions, userGroupMembers, userProfiles } from "../../src/lib/db/schema.js"
import type { BroadcastAudience } from "../../src/lib/types.js"
import { createNotification } from "./notifications.js"

/** The minimal broadcast shape the deliverer needs (decoupled from the DB row). */
export type DeliverableBroadcast = {
  id: string
  title: string
  body: string
  imageUrl?: string | null
  link?: string | null
  linkType?: string | null
  category?: string | null
  importance: boolean
  audience: BroadcastAudience
}

/** Resolve a broadcast audience to a de-duplicated list of recipient Clerk userIds. */
export async function resolveAudience(audience: BroadcastAudience): Promise<string[]> {
  switch (audience?.type) {
    case "all": {
      const rows = await db.selectDistinct({ id: userProfiles.id }).from(userProfiles)
      return rows.map((r) => r.id)
    }
    case "push_enabled": {
      const rows = await db
        .selectDistinct({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.channel, "web_push"))
      return rows.map((r) => r.userId)
    }
    case "users":
      return Array.from(new Set((audience.userIds ?? []).filter(Boolean)))
    case "group": {
      if (!audience.groupId) return []
      const rows = await db
        .select({ userId: userGroupMembers.userId })
        .from(userGroupMembers)
        .where(eq(userGroupMembers.groupId, audience.groupId))
      return Array.from(new Set(rows.map((r) => r.userId)))
    }
    default:
      return []
  }
}

const CHUNK = 100

/**
 * Fan a broadcast out to its audience, one notification per recipient (filtered
 * through each user's preference cascade unless `importance` bypasses it). The
 * per-user dedupeKey `broadcast:<id>:<userId>` makes a re-fire (cron retry,
 * double-tick) a no-op. Inserts are chunked so a huge audience doesn't open
 * thousands of concurrent writes. Returns how many bell rows were written.
 */
export async function deliverBroadcast(
  b: DeliverableBroadcast,
  opts: { occurrence?: string } = {},
): Promise<{ delivered: number; recipients: number }> {
  const userIds = await resolveAudience(b.audience)
  // The dedupe key MUST include the occurrence: a recurring broadcast reuses the
  // same broadcast id every fire, so without an occurrence discriminator the
  // per-user key would be identical across occurrences and the cascade dedupe
  // would suppress every fire after the first. The cron passes the scheduled fire
  // instant (stable across retries of that occurrence); a manual send passes a
  // fixed token (the status guard already prevents re-sending a sent broadcast).
  const occurrence = opts.occurrence ?? "once"
  let delivered = 0
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const slice = userIds.slice(i, i + CHUNK)
    const results = await Promise.all(
      slice.map((userId) =>
        createNotification({
          userId,
          organizationId: null, // account-level: shows in the bell regardless of active org
          type: "admin_broadcast",
          title: b.title,
          body: b.body || "",
          // Broadcasts are admin-authored free text (no i18nKey). Carry the link
          // type + image so the client + service worker can render/route them.
          data: { linkType: b.linkType ?? "internal", imageUrl: b.imageUrl ?? null },
          link: b.link ?? null,
          imageUrl: b.imageUrl ?? null,
          category: "system",
          important: b.importance,
          // A broadcast is a push-style announcement: attempt push by default for
          // everyone with a subscription (still honours mute + explicit opt-out).
          // `importance` escalates further (bypasses mute entirely).
          pushDefault: true,
          dedupeKey: `broadcast:${b.id}:${occurrence}:${userId}`,
        }).catch(() => null),
      ),
    )
    delivered += results.filter((r) => r !== null).length
  }
  return { delivered, recipients: userIds.length }
}
