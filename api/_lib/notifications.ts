// Server-side notification service.
//
// `createNotification` is the single entry point every event source calls (see
// branch notif-10). It resolves the recipient's preference cascade
// (client → org → user → system default) and persists an in-app row when the
// category is enabled in-app. Web-push delivery is layered on in branch notif-09
// — the in-app path here never depends on it.
//
// NOTE: relative imports MUST keep the `.js` extension — these modules run as
// unbundled ESM on @vercel/node (see scripts/check-esm-extensions.mjs).
import { and, eq, or, sql } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { notificationPreferences, notifications, organizationMembers } from "../../src/lib/db/schema.js"
import {
  categoryForType,
  resolveChannelEnabled,
  sanitizePreferences,
  type NotificationCategory,
  type NotificationPreferences,
} from "../../src/lib/notifications.js"
import type { NotificationData } from "../../src/lib/types.js"
import { sendWebPushToUser } from "./push.js"

export type CreateNotificationInput = {
  /** Recipient (Clerk userId). */
  userId: string
  /** Org context; NULL for account-level notifications (e.g. cross-org invites). */
  organizationId?: string | null
  /** Stable type key (see NOTIFICATION_TYPES). Drives the category if not given. */
  type: string
  /** English fallback title (the client prefers data.i18nKey when present). */
  title: string
  body?: string
  data?: NotificationData
  link?: string | null
  actorUserId?: string | null
  clientId?: string | null
  /** Idempotency key: a repeated call with the same (userId, dedupeKey) is a no-op. */
  dedupeKey?: string | null
  /** Optional category override; defaults to categoryForType(type). */
  category?: NotificationCategory
  /**
   * Important notification (admin broadcasts marked "important"): bypasses the
   * recipient's preference cascade so it is ALWAYS written to the bell and a push
   * is ALWAYS attempted (the OS-level push permission still applies — we can't
   * override a device that never subscribed or revoked permission).
   */
  important?: boolean
  /**
   * Default the web_push channel ON for this send when the cascade has no explicit
   * opinion (still honours mute + an explicit opt-out). Used for admin broadcasts
   * and a user's own reminders, which should push by default even though their
   * category's push default is off.
   */
  pushDefault?: boolean
  /** Optional image URL forwarded to the push payload (broadcasts). */
  imageUrl?: string | null
}

/**
 * Load the preference cascade for a recipient, ordered MOST-specific → LEAST
 * (client, org, user). Each entry is the sanitized preferences object or null.
 * One round-trip via an OR over the (scope, target) keys.
 */
export async function loadPreferenceCascade(
  userId: string,
  organizationId?: string | null,
  clientId?: string | null,
): Promise<(NotificationPreferences | null)[]> {
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      or(
        and(eq(notificationPreferences.scope, "user"), eq(notificationPreferences.userId, userId)),
        organizationId
          ? and(
              eq(notificationPreferences.scope, "organization"),
              eq(notificationPreferences.organizationId, organizationId),
            )
          : sql`false`,
        organizationId && clientId
          ? and(
              eq(notificationPreferences.scope, "client"),
              eq(notificationPreferences.organizationId, organizationId),
              eq(notificationPreferences.clientId, clientId),
            )
          : sql`false`,
      ),
    )

  const byScope = (scope: string) => {
    const row = rows.find((r) => r.scope === scope)
    return row ? sanitizePreferences(row.preferences) : null
  }
  // Most specific first: client → organization → user.
  return [byScope("client"), byScope("organization"), byScope("user")]
}

/**
 * Create a notification for one recipient, honouring their preference cascade.
 * Returns the created row id, or null when the recipient has the category
 * disabled in-app (suppressed) or the dedupe key already exists.
 */
export async function createNotification(input: CreateNotificationInput): Promise<string | null> {
  const category = input.category ?? categoryForType(input.type)
  const cascade = await loadPreferenceCascade(input.userId, input.organizationId, input.clientId)

  // in_app controls persistence (the bell/history); web_push controls whether we
  // also deliver a browser/PWA push — both resolved from the same cascade. An
  // `important` notification (admin broadcast) bypasses the cascade entirely so a
  // muted recipient still gets it (at minimum in the bell).
  const showInApp = input.important || resolveChannelEnabled(cascade, category, "in_app")
  const showPush = input.important || resolveChannelEnabled(cascade, category, "web_push", input.pushDefault)
  if (!showInApp && !showPush) return null

  // Dedupe for event-sourced notifications. A pre-check keeps the common path
  // simple AND prevents a repeated event from re-pushing; the partial unique
  // index (user_id, dedupe_key) is the DB-level backstop against a concurrent
  // double-insert, caught below. (ON CONFLICT on a partial index can't be
  // inferred reliably here, hence the explicit path.)
  if (input.dedupeKey) {
    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.userId, input.userId), eq(notifications.dedupeKey, input.dedupeKey)))
      .limit(1)
    if (existing) return null
  }

  // Best-effort push (fire-and-forget): the in-app write below is the source of
  // truth and never waits on or fails because of push.
  if (showPush) {
    void sendWebPushToUser(input.userId, {
      title: input.title,
      body: input.body || undefined,
      url: input.link || undefined,
      image: input.imageUrl || undefined,
    }).catch(() => {})
  }

  if (!showInApp) return null

  try {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        type: input.type,
        category,
        title: input.title,
        body: input.body ?? "",
        data: (input.data ?? {}) as Record<string, unknown>,
        link: input.link ?? null,
        actorUserId: input.actorUserId ?? null,
        clientId: input.clientId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      .returning({ id: notifications.id })
    return row?.id ?? null
  } catch (err) {
    // 23505 = unique_violation: a concurrent insert won the dedupe race.
    if (input.dedupeKey && (err as { code?: string })?.code === "23505") return null
    throw err
  }
}

export type NotifyOrgMembersOptions = {
  /** Restrict to these roles (e.g. ["owner", "admin"]); default = all members. */
  roles?: string[]
  /** Skip this user (typically the actor who triggered the event). */
  excludeUserId?: string
}

/**
 * Fan a notification out to an org's members, each filtered through their own
 * preference cascade. The dedupeKey (if any) is suffixed per-user so the
 * idempotency is per-recipient.
 */
export async function notifyOrgMembers(
  organizationId: string,
  input: Omit<CreateNotificationInput, "userId" | "organizationId">,
  opts: NotifyOrgMembersOptions = {},
): Promise<void> {
  const members = await db
    .select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId))

  const targets = members.filter(
    (m) => m.userId !== opts.excludeUserId && (!opts.roles || opts.roles.includes(m.role)),
  )

  await Promise.all(
    targets.map((m) =>
      createNotification({
        ...input,
        userId: m.userId,
        organizationId,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${m.userId}` : null,
      }),
    ),
  )
}
