import { useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPatch } from "@/lib/api"
import { SUPPORTED_LANGUAGES, getLanguage } from "./languages"
import { LANGUAGE_STORAGE_KEY, setAppLanguage } from "./index"

// Single entry point for switching the UI language. Changing it via i18next
// updates the active translation, persists to localStorage (handled by the
// language detector) and flips the document direction for RTL languages.
// We also best-effort persist the choice to the user's profile so it follows
// them to other devices — a failed sync never blocks the local switch.
export function useLanguage() {
  const { i18n } = useTranslation()
  const { getToken } = useAuth()
  const current = getLanguage(i18n.language)

  const changeLanguage = useCallback(
    async (code: string) => {
      if (code === i18n.language) return
      // Loads the locale chunk BEFORE activating, so the switch never flashes
      // fallback English (locales are code-split — see i18n/index.ts).
      await setAppLanguage(code)
      try {
        const token = await getToken()
        if (token) await apiPatch("/api/profile", token, { language: code })
      } catch {
        // Non-fatal: the language is already applied locally.
      }
    },
    [i18n, getToken],
  )

  return { current, languages: SUPPORTED_LANGUAGES, changeLanguage }
}

// Adopt the language saved on the user's profile when they haven't picked one
// on this device yet (e.g. a fresh login on a new browser). A local choice in
// localStorage always wins, so this never fights an explicit selection.
export function useSyncProfileLanguage() {
  const { i18n } = useTranslation()
  const { getToken, isSignedIn } = useAuth()

  useEffect(() => {
    if (!isSignedIn) return
    if (localStorage.getItem(LANGUAGE_STORAGE_KEY)) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const profile = await apiGet<{ language?: string }>("/api/profile", token)
        if (!cancelled && profile.language && profile.language !== i18n.language) {
          await setAppLanguage(profile.language)
        }
      } catch {
        // Ignore — fall back to the locally detected language.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn])
}

