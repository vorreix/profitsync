import i18n, { type ResourceLanguage } from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, applyDocumentDirection } from "./languages"
import en from "./locales/en.json"

export const LANGUAGE_STORAGE_KEY = "profitsync-language"

// Page-scoped namespaces. Each is also a top-level key inside the locale JSON,
// so a key works both as `t("clients.foo")` (default namespace) and via
// `useTranslation("clients")` + `t("foo")`. `fallbackNS` lets a page namespace
// still resolve shared keys like `common.*`.
const PAGE_NAMESPACES = [
  "clients", "transactions", "quotations", "organizations", "members",
  "trash", "subscription", "billing", "theme", "plan", "planGlossary", "pwa",
  "wealth", "spaces", "notifications",
] as const

type Locale = Record<string, ResourceLanguage[string]>

function buildLocaleResources(locale: Locale): ResourceLanguage {
  const res: ResourceLanguage = { translation: locale as ResourceLanguage[string] }
  for (const ns of PAGE_NAMESPACES) {
    if (locale[ns]) res[ns] = locale[ns]
  }
  return res
}

// Only English (the fallback + source of truth) ships in the boot bundle.
// The other 7 locale files (~650 KB raw combined) are code-split by Vite and
// fetched on demand — a user pays only for the language they actually use.
const LOCALE_LOADERS: Record<string, () => Promise<{ default: Locale }>> = {
  it: () => import("./locales/it.json"),
  de: () => import("./locales/de.json"),
  hi: () => import("./locales/hi.json"),
  ml: () => import("./locales/ml.json"),
  ta: () => import("./locales/ta.json"),
  te: () => import("./locales/te.json"),
  ar: () => import("./locales/ar.json"),
}

function baseLang(code: string | undefined | null): string {
  return (code ?? DEFAULT_LANGUAGE).split("-")[0]
}

/**
 * Make sure a language's bundles are registered before it is activated.
 * Resolves immediately for English, unknown codes, and already-loaded locales;
 * a failed chunk fetch resolves too (i18next then falls back to English rather
 * than blocking the switch).
 */
export async function ensureLocaleLoaded(code: string): Promise<void> {
  const lang = baseLang(code)
  const loader = LOCALE_LOADERS[lang]
  if (!loader || i18n.hasResourceBundle(lang, "translation")) return
  try {
    const mod = await loader()
    const resources = buildLocaleResources(mod.default)
    for (const [ns, bundle] of Object.entries(resources)) {
      i18n.addResourceBundle(lang, ns, bundle, true, true)
    }
  } catch {
    // Chunk fetch failed (offline / transient) — English fallback still renders;
    // the next switch attempt retries the import.
  }
}

/**
 * Single entry point for switching the UI language: loads the locale chunk
 * first, then activates it, so the switch never flashes fallback English.
 */
export async function setAppLanguage(code: string): Promise<void> {
  await ensureLocaleLoaded(code)
  await i18n.changeLanguage(code)
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: buildLocaleResources(en) },
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

// A non-English device/detected language boots on English fallback only for
// the few milliseconds its locale chunk takes to arrive, then re-renders in
// place (changeLanguage re-emits even for the same code).
const detected = i18n.resolvedLanguage ?? i18n.language
if (baseLang(detected) !== DEFAULT_LANGUAGE) {
  void ensureLocaleLoaded(detected).then(() => i18n.changeLanguage(detected))
}

// Keep <html dir/lang> in sync with the active language (RTL for Arabic).
applyDocumentDirection(i18n.language)
i18n.on("languageChanged", (lng) => applyDocumentDirection(lng))

export default i18n
