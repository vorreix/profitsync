// Snoozing a banner slide.
//
// A dismissal here is a SNOOZE, never a delete. Two reasons:
//
//  • The items are derived fresh, so a permanent dismissal would be the one way
//    to make the banner lie — hiding a real overdue payment forever because it
//    was waved away once, months ago.
//  • Only the calm tiers are dismissible at all (src/lib/alerts.ts sets
//    `dismissible`). A danger item clears by being FIXED; that is the whole
//    point of deriving it rather than logging it.
//
// The key is the alert's id, which encodes the situation (`card_autopay:<stmt>`,
// `posted:<rule>:<date>`), so a NEW statement or a new payment is a new id and
// comes back on its own.

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
export const DISMISS_KEY = "ps_alerts_snoozed"
/** A cap so a long-lived browser cannot grow this without bound. */
const MAX_ENTRIES = 50

/** id → the epoch ms at which it was snoozed. */
export type Snoozed = Record<string, number>

/**
 * Parse the stored map, dropping anything expired or malformed. Pruning on read
 * is what keeps the entry count bounded without a separate cleanup path.
 */
export function loadSnoozed(raw: string | null, now: number): Snoozed {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  const out: Snoozed = {}
  for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof at !== "number" || !Number.isFinite(at)) continue
    if (now - at >= SNOOZE_MS) continue
    out[id] = at
  }
  return trim(out)
}

export function isSnoozed(map: Snoozed, id: string, now: number): boolean {
  const at = map[id]
  return at !== undefined && now - at < SNOOZE_MS
}

export function snooze(map: Snoozed, id: string, now: number): Snoozed {
  return trim({ ...map, [id]: now })
}

/** Keep the newest entries only. */
function trim(map: Snoozed): Snoozed {
  const entries = Object.entries(map)
  if (entries.length <= MAX_ENTRIES) return map
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES))
}

export function readSnoozed(now: number): Snoozed {
  try {
    return loadSnoozed(localStorage.getItem(DISMISS_KEY), now)
  } catch {
    return {} // private mode — nothing sticks, and that is survivable
  }
}

export function writeSnoozed(map: Snoozed): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map))
  } catch {
    /* out of quota or blocked — the slide simply comes back */
  }
}
