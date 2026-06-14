import type { ComponentType } from "react"
import { Users, CreditCard, PiggyBank, ArrowLeftRight, FileText, Bell } from "lucide-react"
import type { TFunction } from "i18next"
import type { AppNotification } from "@/lib/types"
import type { NotificationCategory } from "@/lib/notifications"

// Category → icon + tone, used by the bell dropdown and the history page so a
// notification looks the same everywhere.
const CATEGORY_ICON: Record<NotificationCategory, ComponentType<{ className?: string }>> = {
  team: Users,
  billing: CreditCard,
  budget: PiggyBank,
  transactions: ArrowLeftRight,
  clients: FileText,
  system: Bell,
}

const CATEGORY_TONE: Record<NotificationCategory, string> = {
  team: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  billing: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  budget: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  transactions: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  clients: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  system: "bg-muted text-muted-foreground",
}

export function categoryIcon(category: string): ComponentType<{ className?: string }> {
  return CATEGORY_ICON[category as NotificationCategory] ?? Bell
}

export function categoryTone(category: string): string {
  return CATEGORY_TONE[category as NotificationCategory] ?? CATEGORY_TONE.system
}

// Title/body rendering: prefer the row's i18nKey (rendered in the user's
// language) and fall back to the server-stored English title/body. The i18nKey
// is namespaced under `notifications` (e.g. "types.member_invited").
export function notificationTitle(n: AppNotification, t: TFunction): string {
  const key = n.data?.i18nKey
  if (key) {
    const params = (n.data?.i18nParams ?? {}) as Record<string, unknown>
    const translated = t(key, { ns: "notifications", defaultValue: n.title, ...params })
    if (translated) return translated
  }
  return n.title
}

export function notificationBody(n: AppNotification, t: TFunction): string {
  const key = n.data?.i18nBodyKey as string | undefined
  if (key) {
    const params = (n.data?.i18nParams ?? {}) as Record<string, unknown>
    return t(key, { ns: "notifications", defaultValue: n.body, ...params })
  }
  return n.body
}

// Compact, localized relative time ("Just now", "5m ago", "3h ago", "2d ago",
// then an absolute date). Keys live under the `notifications.time` namespace.
export function relativeTime(iso: string, t: TFunction, locale?: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const diffMs = Date.now() - then
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 45) return t("time.just_now", { ns: "notifications" })
  const min = Math.floor(sec / 60)
  if (min < 60) return t("time.minutes", { ns: "notifications", count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t("time.hours", { ns: "notifications", count: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return t("time.days", { ns: "notifications", count: day })
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
}
