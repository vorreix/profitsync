// DEPENDENCY-FREE scheduling math for reminders (#6) and broadcasts (#7).
//
// Like src/lib/notifications.ts and src/lib/budget-history.ts this module is
// imported by the API (the /api/cron/notifications endpoint), the frontend
// (schedule summaries) AND the vitest unit suite — so it must stay free of any
// runtime import (no DB, React, Node, fetch). It uses only `Intl` + `Date`, which
// exist in all three environments. The only import is a TYPE import (erased at
// compile, so it is not a runtime dependency).
import type { ReminderSchedule, BroadcastRecurrence, BroadcastSchedule } from "./types.js"

// ── Timezone-aware wall-clock helpers ──────────────────────────────────────────
// All derived purely from Intl, so a Date (an absolute instant) can be read as the
// wall-clock a user in `tz` would see — no external tz database needed.

const WEEKDAY_TO_NUM: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
}

/** Weekday (1=Mon … 7=Sun) of `date` as seen in IANA `tz`. */
export function weekdayInTz(date: Date, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date)
  return WEEKDAY_TO_NUM[name] ?? 0
}

function partsInTz(date: Date, tz: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const out: Record<string, string> = {}
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value
  return out
}

/** "HH:mm" wall-clock time of `date` in IANA `tz` (24h, zero-padded). */
export function timeInTz(date: Date, tz: string): string {
  const p = partsInTz(date, tz)
  // hourCycle h23 can emit "24" at midnight in some engines — normalize to "00".
  const hh = p.hour === "24" ? "00" : p.hour
  return `${hh}:${p.minute}`
}

/** "YYYY-MM-DD" calendar date of `date` in IANA `tz`. */
export function dateInTz(date: Date, tz: string): string {
  const p = partsInTz(date, tz)
  return `${p.year}-${p.month}-${p.day}`
}

/** Validate an IANA timezone string (falls back to "UTC" if unsupported). */
export function safeTimezone(tz: string | undefined | null): string {
  if (!tz) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return tz
  } catch {
    return "UTC"
  }
}

// ── Reminders ──────────────────────────────────────────────────────────────────

/**
 * Decide which reminder slot (if any) is due at `now`, given the user's schedule
 * and when the reminder last fired. Returns a stable slot key
 * `"YYYY-MM-DDTHH:mm"` (in the user's tz) to fire — or null when nothing is due.
 *
 * The cron ticks every few minutes, so we fire the LATEST scheduled time that has
 * already passed today and has not yet fired (firing 09:00 at 09:03 is fine;
 * firing it again at 09:08, or firing a stale slot already covered, is not). The
 * caller turns the slot key into a dedupeKey so a double-tick can never double-send.
 */
export function reminderDueSlot(
  schedule: ReminderSchedule,
  now: Date,
  lastFiredAt: Date | null,
): string | null {
  const tz = safeTimezone(schedule.timezone)
  const times = Array.isArray(schedule.times) ? [...schedule.times].filter(Boolean).sort() : []
  if (times.length === 0) return null

  const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : []
  const today = dateInTz(now, tz)
  const wd = weekdayInTz(now, tz)
  // Empty weekdays = every day.
  if (weekdays.length > 0 && !weekdays.includes(wd)) return null

  const cur = timeInTz(now, tz)
  const passed = times.filter((t) => t <= cur)
  if (passed.length === 0) return null
  const latest = passed[passed.length - 1]

  // Already fired this slot (or a later one) today?
  if (lastFiredAt) {
    const firedDate = dateInTz(lastFiredAt, tz)
    const firedTime = timeInTz(lastFiredAt, tz)
    if (firedDate === today && firedTime >= latest) return null
  }
  return `${today}T${latest}`
}

/**
 * Validate/normalize an untrusted reminder schedule (from a request body or a DB
 * jsonb column) into a clean ReminderSchedule: well-formed "HH:mm" times, weekdays
 * in 1..7, and a supported IANA timezone. Drops anything malformed so a tampered
 * payload can never widen the shape.
 */
export function sanitizeReminderSchedule(input: unknown): ReminderSchedule {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const times = Array.isArray(obj.times)
    ? Array.from(
        new Set(
          obj.times.filter(
            (t): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
          ),
        ),
      ).sort()
    : []
  const weekdays = Array.isArray(obj.weekdays)
    ? Array.from(
        new Set(obj.weekdays.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 1 && d <= 7)),
      ).sort((a, b) => a - b)
    : []
  const timezone = safeTimezone(typeof obj.timezone === "string" ? obj.timezone : "UTC")
  return { times, weekdays, timezone }
}

/** Human summary of a reminder schedule, e.g. "Mon–Fri at 09:00, 18:00". */
export function describeReminderSchedule(schedule: ReminderSchedule): string {
  const times = (schedule.times ?? []).join(", ") || "—"
  const wd = schedule.weekdays ?? []
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  let days: string
  if (wd.length === 0 || wd.length === 7) days = "Every day"
  else if (wd.length === 5 && [1, 2, 3, 4, 5].every((d) => wd.includes(d))) days = "Mon–Fri"
  else days = wd.slice().sort((a, b) => a - b).map((d) => names[d] ?? d).join(", ")
  return `${days} at ${times}`
}

// ── Broadcasts ──────────────────────────────────────────────────────────────────

/**
 * The first instant a broadcast should be delivered by the scheduler. 'now' is
 * delivered immediately by the send path (returns null = nothing to schedule).
 * 'at' and 'recurring' fire at their start instant.
 */
export function firstBroadcastFire(schedule: BroadcastSchedule): Date | null {
  if (schedule.type === "now") return null
  const at = new Date(schedule.at)
  return isNaN(at.getTime()) ? null : at
}

/**
 * Given a recurrence and the instant it last fired, the next instant it should
 * fire — or null when it has passed `until`. Pure date arithmetic in UTC; the
 * absolute instant is what the cron compares against.
 */
export function nextRecurringFire(recurring: BroadcastRecurrence, last: Date): Date | null {
  const interval = Math.max(1, Math.floor(recurring.interval || 1))
  const next = new Date(last.getTime())
  switch (recurring.freq) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + interval)
      break
    case "weekly":
      next.setUTCDate(next.getUTCDate() + interval * 7)
      break
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + interval)
      break
    default:
      return null
  }
  if (recurring.until) {
    const until = new Date(recurring.until)
    if (!isNaN(until.getTime()) && next.getTime() > until.getTime()) return null
  }
  return next
}
