// Shape validation for admin broadcasts (#7). Pure (no DB) so POST + PATCH share
// exactly one normalizer; group/user existence is checked in the routes.
//
// Relative imports keep the `.js` extension (unbundled ESM on @vercel/node).
import { firstBroadcastFire } from "../../src/lib/schedule-notifications.js"
import type { BroadcastAudience, BroadcastSchedule } from "../../src/lib/types.js"

export function sanitizeAudience(raw: unknown): BroadcastAudience {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  switch (o.type) {
    case "push_enabled":
      return { type: "push_enabled" }
    case "users":
      return {
        type: "users",
        userIds: Array.isArray(o.userIds)
          ? Array.from(new Set(o.userIds.filter((u): u is string => typeof u === "string" && u.length > 0)))
          : [],
      }
    case "group":
      return { type: "group", groupId: typeof o.groupId === "string" ? o.groupId : "" }
    case "all":
    default:
      return { type: "all" }
  }
}

function validIso(v: unknown): string | null {
  if (typeof v !== "string") return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export function sanitizeSchedule(raw: unknown): BroadcastSchedule {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  if (o.type === "at") {
    const at = validIso(o.at)
    return at ? { type: "at", at } : { type: "now" }
  }
  if (o.type === "recurring") {
    const at = validIso(o.at)
    const r = (o.recurring && typeof o.recurring === "object" ? o.recurring : {}) as Record<string, unknown>
    const freq = r.freq === "weekly" || r.freq === "monthly" ? r.freq : "daily"
    const interval = typeof r.interval === "number" && r.interval >= 1 ? Math.floor(r.interval) : 1
    const until = validIso(r.until)
    return at ? { type: "recurring", at, recurring: { freq, interval, until } } : { type: "now" }
  }
  return { type: "now" }
}

/** Validate a click-action link for its type. Returns null when acceptable. */
export function linkError(link: string | null | undefined, linkType: string): string | null {
  if (!link) return null
  if (linkType === "external") {
    try {
      const u = new URL(link)
      if (u.protocol !== "https:" && u.protocol !== "http:") return "External links must be http(s) URLs."
      return null
    } catch {
      return "Enter a valid URL (including https://)."
    }
  }
  // internal: an app route
  if (!link.startsWith("/")) return "Internal links must start with / (e.g. /dashboard)."
  return null
}

/**
 * Resolve the persisted status + next fire time for a create/update, given the
 * chosen mode ('draft' | 'schedule') and schedule. ('send' delivers immediately
 * in the route and sets status='sent' there.)
 */
export function statusForMode(
  mode: "draft" | "schedule",
  schedule: BroadcastSchedule,
): { status: "draft" | "scheduled"; nextFireAt: Date | null } {
  const fire = firstBroadcastFire(schedule)
  if (mode === "schedule" && fire) return { status: "scheduled", nextFireAt: fire }
  // draft (or a "schedule" with a now/invalid time) → keep it as a draft.
  return { status: "draft", nextFireAt: fire }
}
