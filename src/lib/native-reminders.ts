// Phone-local reminder delivery (V6). Personal "add your transactions"
// reminders fire ON the device via OS-scheduled local notifications — exact
// phone time, works offline, zero server involvement. The DB row remains the
// SETTINGS store (cross-device sync + the web management UI); this module is a
// pure projector: DB settings → OS alarm schedule.
//
// Sync model: deterministic cancel-all + re-schedule. Every boot and every
// reminder CRUD calls syncLocalReminders(all reminders); we never diff. That
// makes edits/deletes/disable trivially correct at the cost of a cheap
// re-registration.
//
// Bundle discipline: @capacitor/local-notifications loads lazily (vite routes
// @capacitor/* to the lazy "native" chunk); web builds never pull it in.
import { apiGet } from "@/lib/api"
import { isNativeApp } from "@/lib/native-auth"

export type LocalReminder = {
  id: string
  enabled: boolean
  label: string
  schedule: { times: string[]; weekdays: number[] }
}

// ⚠️ Same Capacitor footgun as native-push.ts: plugin objects are Proxies that
// forward EVERY property access (even `then`) to native — never resolve a
// promise WITH the proxy itself, always wrap it.
async function plugin() {
  const mod = await import("@capacitor/local-notifications")
  return { ln: mod.LocalNotifications }
}

export function isLocalRemindersSupported(): boolean {
  return isNativeApp()
}

/** ISO weekday (1=Mon…7=Sun, our schedule model) → Capacitor (1=Sun…7=Sat). */
export function capacitorWeekday(isoWeekday: number): number {
  return (isoWeekday % 7) + 1
}

/**
 * Stable int32 id per (reminder, weekday, time) so re-scheduling replaces
 * rather than duplicates. FNV-1a over the composite key, clamped positive.
 */
export function localNotificationId(reminderId: string, isoWeekday: number, time: string): number {
  const key = `${reminderId}:${isoWeekday}:${time}`
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 1) || 1 // >>>1 keeps it inside signed-int32 range, never 0
}

/** Expand a reminder into per-(weekday × time) OS schedules. Empty weekdays = daily. */
export function expandSchedules(r: LocalReminder): Array<{ id: number; weekday: number | null; hour: number; minute: number }> {
  if (!r.enabled) return []
  const out: Array<{ id: number; weekday: number | null; hour: number; minute: number }> = []
  const weekdays = r.schedule.weekdays.length > 0 ? r.schedule.weekdays : [0] // 0 = every day
  for (const time of r.schedule.times) {
    const [h, m] = time.split(":").map(Number)
    if (!Number.isInteger(h) || !Number.isInteger(m)) continue
    for (const wd of weekdays) {
      out.push({
        id: localNotificationId(r.id, wd, time),
        weekday: wd === 0 ? null : capacitorWeekday(wd),
        hour: h,
        minute: m,
      })
    }
  }
  return out
}

/** Ask for the OS notification permission (Android 13+). True when granted. */
export async function ensureLocalNotificationPermission(): Promise<boolean> {
  if (!isLocalRemindersSupported()) return false
  try {
    const { ln } = await plugin()
    const status = await ln.checkPermissions()
    if (status.display === "granted") return true
    const req = await ln.requestPermissions()
    return req.display === "granted"
  } catch {
    return false
  }
}

/**
 * Project the full reminder list onto the OS schedule (cancel-all + re-add).
 * Localized copy is rendered AT SCHEDULE TIME with the app's current language
 * (i18n params passed in by the caller, which has the hook).
 */
export async function syncLocalReminders(
  reminders: LocalReminder[],
  copy: { title: string; body: string },
): Promise<void> {
  if (!isLocalRemindersSupported()) return
  try {
    const { ln } = await plugin()
    const pending = await ln.getPending()
    if (pending.notifications.length > 0) {
      await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
    }
    const notifications = reminders.flatMap((r) =>
      expandSchedules(r).map((s) => ({
        id: s.id,
        title: r.label || copy.title,
        body: copy.body,
        schedule: {
          on: { ...(s.weekday !== null ? { weekday: s.weekday } : {}), hour: s.hour, minute: s.minute },
          allowWhileIdle: true,
        },
        extra: { url: "/transactions?new=1" },
        smallIcon: "ic_launcher_foreground",
      })),
    )
    if (notifications.length > 0) await ln.schedule({ notifications })
  } catch {
    /* best-effort — reminders are a nudge, never break the app */
  }
}

/**
 * Boot-time projection: pull the reminder settings from the server (they may
 * have been edited on the web or another device) and mirror them onto this
 * phone's OS schedule. Best-effort; no-op on web.
 */
export async function resyncLocalRemindersFromServer(
  getToken: () => Promise<string | null>,
  copy: { title: string; body: string },
): Promise<void> {
  if (!isLocalRemindersSupported()) return
  try {
    const token = await getToken()
    if (!token) return
    const res = await apiGet<{ reminders: Array<LocalReminder & { schedule: { times?: string[]; weekdays?: number[] } }> }>(
      "/api/notifications/reminders",
      token,
    )
    const reminders: LocalReminder[] = (res.reminders ?? []).map((r) => ({
      id: r.id,
      enabled: r.enabled,
      label: r.label,
      schedule: { times: r.schedule?.times ?? [], weekdays: r.schedule?.weekdays ?? [] },
    }))
    await syncLocalReminders(reminders, copy)
  } catch {
    /* best-effort */
  }
}

/**
 * Tap → deep link (mirrors the FCM tap handler). Returns an unlisten cleanup.
 * Call once from the signed-in shell when native.
 */
export async function initLocalReminderTaps(navigate: (url: string) => void): Promise<() => void> {
  if (!isLocalRemindersSupported()) return () => {}
  try {
    const { ln } = await plugin()
    const sub = await ln.addListener("localNotificationActionPerformed", (event) => {
      const url = (event.notification.extra as Record<string, string> | undefined)?.url
      if (url && url.startsWith("/")) navigate(url)
    })
    return () => {
      void sub.remove()
    }
  } catch {
    return () => {}
  }
}
