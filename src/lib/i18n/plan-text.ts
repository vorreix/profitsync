import { useTranslation } from "react-i18next"

/**
 * Auto-translates backend-provided plan strings (plan names, custom feature
 * labels, promo notes) that are authored in English on the server, using the
 * `planGlossary` translation namespace. Falls back to the original English text
 * when the active language has no glossary entry, so custom admin text always
 * shows something sensible.
 */
export function usePlanText() {
  const { t } = useTranslation("planGlossary")
  return (text: string | null | undefined): string => {
    const s = (text ?? "").trim()
    if (!s) return ""
    // keySeparator/nsSeparator are disabled here so phrases with "." or ":" are
    // looked up literally rather than parsed as nested keys.
    return t(s, { defaultValue: s, keySeparator: false, nsSeparator: false })
  }
}
