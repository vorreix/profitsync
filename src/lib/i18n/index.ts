import i18n, { type ResourceLanguage } from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, applyDocumentDirection } from "./languages"
import en from "./locales/en.json"
import it from "./locales/it.json"
import de from "./locales/de.json"
import hi from "./locales/hi.json"
import ml from "./locales/ml.json"
import ta from "./locales/ta.json"
import te from "./locales/te.json"
import ar from "./locales/ar.json"

export const LANGUAGE_STORAGE_KEY = "profitsync-language"

// Page-scoped namespaces. Each is also a top-level key inside the locale JSON,
// so a key works both as `t("clients.foo")` (default namespace) and via
// `useTranslation("clients")` + `t("foo")`. `fallbackNS` lets a page namespace
// still resolve shared keys like `common.*`.
const PAGE_NAMESPACES = [
  "clients", "transactions", "quotations", "organizations", "members",
  "trash", "subscription", "billing", "theme", "plan", "planGlossary", "pwa",
] as const

type Locale = Record<string, ResourceLanguage[string]>

function buildLocaleResources(locale: Locale): ResourceLanguage {
  const res: ResourceLanguage = { translation: locale as ResourceLanguage[string] }
  for (const ns of PAGE_NAMESPACES) {
    if (locale[ns]) res[ns] = locale[ns]
  }
  return res
}

const resources = {
  en: buildLocaleResources(en),
  it: buildLocaleResources(it),
  de: buildLocaleResources(de),
  hi: buildLocaleResources(hi),
  ml: buildLocaleResources(ml),
  ta: buildLocaleResources(ta),
  te: buildLocaleResources(te),
  ar: buildLocaleResources(ar),
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: ["translation", ...PAGE_NAMESPACES],
    defaultNS: "translation",
    fallbackNS: "translation",
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    fallbackLng: DEFAULT_LANGUAGE,
    // English is the source of truth; fall back to it for any missing key
    // so a partially-translated language never shows blank strings.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  })

// Keep <html dir/lang> in sync with the active language (RTL for Arabic).
applyDocumentDirection(i18n.language)
i18n.on("languageChanged", (lng) => applyDocumentDirection(lng))

export default i18n
