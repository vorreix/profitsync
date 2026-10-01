import { translateApiError } from "@/lib/api-error-codes"

/**
 * Why a recurring rule stopped posting, in the reader's language (MC-077).
 *
 * The materializer stores `last_error` as a refusal body — `{ error, code,
 * ...params }`, the shape a route sends — so it reads through the same
 * translator as a toast: `apiErrors.<code>` filled from its params, the English
 * `error` only for someone reading English when the code has no line of its
 * own. A row written before that is a bare English sentence and is shown as it
 * is: there is no code in it to translate.
 *
 *   ruleErrorText(rule.last_error, t("apiErrors.recurring_failed"))
 */
export function ruleErrorText(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? "").trim()
  if (!text) return ""
  if (!text.startsWith("{")) return text
  return translateApiError(new Error(text), fallback)
}
