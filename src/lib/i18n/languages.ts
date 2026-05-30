// Supported UI languages. `dir` drives the document text direction —
// Arabic is right-to-left, everything else left-to-right.
export type LanguageDir = "ltr" | "rtl"

export type SupportedLanguage = {
  code: string
  // Name shown in the language picker, in the language's own script.
  nativeName: string
  // English name, used as a secondary label.
  englishName: string
  dir: LanguageDir
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
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

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code)

export function getLanguage(code: string | null | undefined): SupportedLanguage {
  return (
    SUPPORTED_LANGUAGES.find((l) => l.code === code) ??
    SUPPORTED_LANGUAGES.find((l) => l.code === DEFAULT_LANGUAGE)!
  )
}

// Apply the text direction + lang attribute to the document for the active language.
export function applyDocumentDirection(code: string) {
  const lang = getLanguage(code)
  if (typeof document !== "undefined") {
    document.documentElement.lang = lang.code
    document.documentElement.dir = lang.dir
  }
}
