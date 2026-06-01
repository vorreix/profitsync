// Self-contained language config for the marketing landing page.
// Intentionally NOT importing the app's i18n config — the landing is an
// isolated unit. Arabic is right-to-left; everything else left-to-right.
export type LanguageDir = "ltr" | "rtl"

export type LandingLanguage = {
  code: string
  nativeName: string
  englishName: string
  dir: LanguageDir
}

export const LANDING_LANGUAGES: LandingLanguage[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", dir: "ltr" },
  { code: "de", nativeName: "Deutsch", englishName: "German", dir: "ltr" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr" },
  { code: "ml", nativeName: "മലയാളം", englishName: "Malayalam", dir: "ltr" },
  { code: "ta", nativeName: "தமிழ்", englishName: "Tamil", dir: "ltr" },
  { code: "te", nativeName: "తెలుగు", englishName: "Telugu", dir: "ltr" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl" },
]

export const DEFAULT_LANGUAGE = "en"

export const LANDING_LANGUAGE_CODES = LANDING_LANGUAGES.map((l) => l.code)

export function getLandingLanguage(code: string | null | undefined): LandingLanguage {
  return (
    LANDING_LANGUAGES.find((l) => l.code === code) ??
    LANDING_LANGUAGES.find((l) => l.code === DEFAULT_LANGUAGE)!
  )
}

// Sync <html lang/dir> with the active language (RTL for Arabic).
export function applyLandingDirection(code: string) {
  const lang = getLandingLanguage(code)
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang.code
    document.documentElement.dir = lang.dir
  }
}
