import i18n from "@/lib/i18n"

/**
 * Dates in the language the user chose.
 *
 * `toLocaleDateString("en-US", …)` prints "Oct 13, 2026" to everyone, and
 * `toLocaleDateString(appLocale(), …)` prints whatever the BROWSER is set to —
 * neither of which is the language the user picked in this app. Someone reading
 * the debts page in Malayalam got a fully Malayalam screen with English month
 * names scattered through it.
 *
 * Reading `i18n.language` here rather than taking a `locale` argument means a
 * pure helper (one that is not a React component and cannot call `useTranslation`)
 * still formats correctly, and there is one place to change if the mapping ever
 * needs to differ from the i18next code.
 */
export function appLocale(): string {
  // i18next carries the plain code ("ml"); Intl wants a BCP-47 tag and is happy
  // with the same string. Falls back to English for an unknown or unset value.
  return i18n.language || "en"
}

/** Parse an ISO date (YYYY-MM-DD) as LOCAL midnight, never UTC. */
function atLocalMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

/** "October 2051" */
export const formatMonthYear = (iso: string) =>
  atLocalMidnight(iso).toLocaleDateString(appLocale(), { month: "long", year: "numeric" })

/** "13 Oct" */
export const formatShortDate = (iso: string) =>
  atLocalMidnight(iso).toLocaleDateString(appLocale(), { month: "short", day: "numeric" })

/** "13 Oct 2026" */
export const formatLongDate = (iso: string) =>
  atLocalMidnight(iso).toLocaleDateString(appLocale(), { month: "short", day: "numeric", year: "numeric" })

/** Anything else, in the user's language. */
export const formatDate = (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
  (typeof value === "string" ? atLocalMidnight(value) : new Date(value)).toLocaleDateString(appLocale(), options)
