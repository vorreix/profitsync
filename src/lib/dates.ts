/**
 * Render a `YYYY-MM-DD` date in the user's language.
 *
 * The budget API speaks ISO dates (a period start, a bill's due date, a
 * transaction date). Handing those to `new Date("2026-09-04")` parses them as
 * UTC midnight, which shows the PREVIOUS day east of Greenwich once formatted
 * locally — so the string is parsed as local midnight instead. Anything that
 * is not a plain ISO date (a timestamp, an empty value) is formatted as-is or
 * returned unchanged.
 */
export function formatIsoDate(value: string | null | undefined, language: string, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(language, options ?? { year: "numeric", month: "short", day: "numeric" })
}
