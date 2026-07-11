// Shared, DEPENDENCY-FREE notification model.
//
// This module is imported by the API (api/_lib + api/_routes), the frontend
// (contexts, pages, settings forms) AND the vitest unit suite. Like
// src/lib/budget-history.ts it must therefore stay free of any import — no DB,
// no React, no Node, no fetch — so it is safe in every one of those contexts and
// the DB-free unit gate can exercise the pure cascade resolver.

// ── Categories ───────────────────────────────────────────────────────────────
// Notifications are grouped into a small set of categories. Preferences are set
// per-category (not per-type) to keep the settings UI tractable; each concrete
// notification `type` maps to exactly one category below.
export const NOTIFICATION_CATEGORIES = [
  "team", // invitations, members, role changes
  "billing", // payments, subscription, plan changes
  "budget", // budget thresholds reached / exceeded
  "transactions", // recurring posted, notable transactions
  "clients", // quotations, client lifecycle
  "system", // product / account-level announcements
] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

// ── Channels ─────────────────────────────────────────────────────────────────
// `in_app` is always delivered (the bell + history). `web_push` is the optional
// PWA/browser push enhancement. `mobile_push` is the native-app push toggle —
// ONE user-facing switch covering the device transports (FCM today, and FCM
// wraps APNs when the iOS shell lands), mapping to push_subscriptions rows with
// channel='fcm'. Preference channels are user intent; subscription channels are
// transports.
export const NOTIFICATION_CHANNELS = ["in_app", "web_push", "mobile_push"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

// ── Type registry ────────────────────────────────────────────────────────────
// Every server-emitted notification has a stable `type` that maps to a category
// (for preference grouping) and a default i18n key (under the `notifications`
// namespace) used to render the title when the row carries i18n params.
export type NotificationTypeDef = { category: NotificationCategory; i18nKey: string }

export const NOTIFICATION_TYPES = {
  member_invited: { category: "team", i18nKey: "types.member_invited" },
  invitation_accepted: { category: "team", i18nKey: "types.invitation_accepted" },
  role_changed: { category: "team", i18nKey: "types.role_changed" },
  member_removed: { category: "team", i18nKey: "types.member_removed" },
  payment_failed: { category: "billing", i18nKey: "types.payment_failed" },
  payment_succeeded: { category: "billing", i18nKey: "types.payment_succeeded" },
  subscription_changed: { category: "billing", i18nKey: "types.subscription_changed" },
  referral_credited: { category: "billing", i18nKey: "types.referral_credited" },
  referral_payout: { category: "billing", i18nKey: "types.referral_payout" },
  budget_warning: { category: "budget", i18nKey: "types.budget_warning" },
  budget_exceeded: { category: "budget", i18nKey: "types.budget_exceeded" },
  recurring_posted: { category: "transactions", i18nKey: "types.recurring_posted" },
  space_autosaved: { category: "transactions", i18nKey: "types.space_autosaved" },
  add_transaction_reminder: { category: "transactions", i18nKey: "types.add_transaction_reminder" },
  quotation_accepted: { category: "clients", i18nKey: "types.quotation_accepted" },
  system_announcement: { category: "system", i18nKey: "types.system_announcement" },
  admin_broadcast: { category: "system", i18nKey: "types.admin_broadcast" },
} as const satisfies Record<string, NotificationTypeDef>

export type NotificationType = keyof typeof NOTIFICATION_TYPES

/** Resolve a notification type's category, defaulting to `system` for unknown types. */
export function categoryForType(type: string): NotificationCategory {
  return (NOTIFICATION_TYPES as Record<string, NotificationTypeDef>)[type]?.category ?? "system"
}

// ── Preferences ──────────────────────────────────────────────────────────────
// A preference row stores per-category channel toggles plus a master `muted`.
// All fields optional so a sparse row only encodes what the user actually set.
export type CategoryPref = Partial<Record<NotificationChannel, boolean>>
export type NotificationPreferences = {
  muted?: boolean
  categories?: Partial<Record<NotificationCategory, CategoryPref>>
}

// The scopes a preference row can target.
export const PREFERENCE_SCOPES = ["user", "organization", "client"] as const
export type PreferenceScope = (typeof PREFERENCE_SCOPES)[number]

// System defaults, used when nothing in the cascade has an opinion. Everything
// shows in-app; web_push defaults on only for the high-signal categories so the
// out-of-the-box push experience isn't noisy.
const DEFAULT_PUSH_ON: ReadonlySet<NotificationCategory> = new Set(["team", "billing", "budget"])

export function defaultChannelEnabled(category: NotificationCategory, channel: NotificationChannel): boolean {
  if (channel === "in_app") return true
  if (channel === "web_push" || channel === "mobile_push") return DEFAULT_PUSH_ON.has(category)
  return false
}

/** A fully-populated preferences object (every category × channel) for UI initial state. */
export type FullNotificationPreferences = {
  muted: boolean
  categories: Record<NotificationCategory, Record<NotificationChannel, boolean>>
}
export function fullDefaultPreferences(): FullNotificationPreferences {
  const categories = {} as Record<NotificationCategory, Record<NotificationChannel, boolean>>
  for (const category of NOTIFICATION_CATEGORIES) {
    const pref = {} as Record<NotificationChannel, boolean>
    for (const channel of NOTIFICATION_CHANNELS) pref[channel] = defaultChannelEnabled(category, channel)
    categories[category] = pref
  }
  return { muted: false, categories }
}

// ── Cascade resolution ───────────────────────────────────────────────────────
// Decide whether a (category, channel) pair should be delivered, given the
// preference cascade ordered MOST-specific → LEAST-specific
// (e.g. [clientPref, orgPref, userPref]). Rules:
//   1. If any level is muted → not delivered.
//   2. Otherwise the most-specific level with an explicit boolean for this
//      (category, channel) wins.
//   3. Otherwise fall back to `defaultOverride` when given, else the system
//      default. `defaultOverride` lets a specific send (e.g. an admin broadcast,
//      or a user's own reminder) opt the channel ON by default while still
//      honouring mute and an explicit user opt-out.
export function resolveChannelEnabled(
  cascade: ReadonlyArray<NotificationPreferences | null | undefined>,
  category: NotificationCategory,
  channel: NotificationChannel,
  defaultOverride?: boolean,
): boolean {
  for (const level of cascade) {
    if (level?.muted) return false
  }
  for (const level of cascade) {
    const explicit = level?.categories?.[category]?.[channel]
    if (typeof explicit === "boolean") return explicit
  }
  return defaultOverride ?? defaultChannelEnabled(category, channel)
}

/** Convenience: is this (category) delivered on ANY channel given the cascade? */
export function resolveAnyChannel(
  cascade: ReadonlyArray<NotificationPreferences | null | undefined>,
  category: NotificationCategory,
): boolean {
  return NOTIFICATION_CHANNELS.some((ch) => resolveChannelEnabled(cascade, category, ch))
}

/** What an i18n key resolves to in the resource tree (checked against `en`). */
export type NotificationKeyKind = "string" | "object" | "missing"

/**
 * Effective i18n keys for rendering a stored notification's title/body.
 *
 * The stored payload is DATA, not code — rows created before a fix keep their
 * old shape forever, so rendering must tolerate every shape ever written:
 * - Correct rows: `i18nKey: "types.x.title"` (+ optional `i18nBodyKey`).
 * - Legacy reminder rows: `i18nKey: "types.add_transaction_reminder"` — a key
 *   that resolves to an OBJECT `{title, body}`; rendering it directly makes
 *   i18next return its "returned an object instead of string" error text.
 *
 * `kindOf` reports what a key resolves to (the caller checks the `en` bundle —
 * locale parity is CI-enforced, so `en` decides the shape for every language).
 * Keys are only rewritten when the rewritten key actually resolves to a string,
 * so behaviour for well-formed rows is unchanged.
 */
export function notificationRenderKeys(
  data: Record<string, unknown> | null | undefined,
  kindOf: (key: string) => NotificationKeyKind,
): { titleKey: string | null; bodyKey: string | null } {
  const raw = typeof data?.i18nKey === "string" && data.i18nKey ? data.i18nKey : null
  const rawBody = typeof data?.i18nBodyKey === "string" && data.i18nBodyKey ? data.i18nBodyKey : null

  if (!raw) return { titleKey: null, bodyKey: rawBody }

  if (kindOf(raw) === "object") {
    // Legacy bare type key → address its members (only when they exist).
    const titleKey = kindOf(`${raw}.title`) === "string" ? `${raw}.title` : null
    const bodyKey = rawBody ?? (kindOf(`${raw}.body`) === "string" ? `${raw}.body` : null)
    return { titleKey, bodyKey }
  }

  // A `.title` key with no explicit body key: use the sibling `.body` when it
  // exists so the body is localized too (falls back to the stored English).
  const derivedBody = raw.endsWith(".title") ? raw.replace(/\.title$/, ".body") : null
  const bodyKey = rawBody ?? (derivedBody && kindOf(derivedBody) === "string" ? derivedBody : null)
  return { titleKey: raw, bodyKey }
}

// Validate/normalize an untrusted preferences payload (from a PUT body or a DB
// jsonb column) into a clean NotificationPreferences — drops unknown categories
// and channels so a tampered row/body can never widen the shape.
export function sanitizePreferences(input: unknown): NotificationPreferences {
  const out: NotificationPreferences = {}
  if (!input || typeof input !== "object") return out
  const obj = input as Record<string, unknown>
  if (typeof obj.muted === "boolean") out.muted = obj.muted
  const cats = obj.categories
  if (cats && typeof cats === "object") {
    const categories: NotificationPreferences["categories"] = {}
    for (const category of NOTIFICATION_CATEGORIES) {
      const raw = (cats as Record<string, unknown>)[category]
      if (!raw || typeof raw !== "object") continue
      const pref: CategoryPref = {}
      for (const channel of NOTIFICATION_CHANNELS) {
        const v = (raw as Record<string, unknown>)[channel]
        if (typeof v === "boolean") pref[channel] = v
      }
      if (Object.keys(pref).length > 0) categories[category] = pref
    }
    if (categories && Object.keys(categories).length > 0) out.categories = categories
  }
  return out
}
