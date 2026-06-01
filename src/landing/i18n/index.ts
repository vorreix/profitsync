// Isolated i18next instance for the marketing landing page. This is a *separate*
// instance from the app's global i18n so the landing stays self-contained — it is
// provided to the landing subtree via <I18nextProvider> in LandingApp.
import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from "i18next-browser-languagedetector"

import {
  DEFAULT_LANGUAGE,
  LANDING_LANGUAGE_CODES,
  applyLandingDirection,
} from "./languages"
import en from "./locales/en.json"
import it from "./locales/it.json"
import de from "./locales/de.json"
import hi from "./locales/hi.json"
import ml from "./locales/ml.json"
import ta from "./locales/ta.json"
import te from "./locales/te.json"
import ar from "./locales/ar.json"

// Shared with the app so a language chosen on the landing carries into the app.
const LANGUAGE_STORAGE_KEY = "profitsync-language"

const landingI18n = i18next.createInstance()

landingI18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      it: { translation: it },
      de: { translation: de },
      hi: { translation: hi },
      ml: { translation: ml },
      ta: { translation: ta },
      te: { translation: te },
      ar: { translation: ar },
    },
    supportedLngs: LANDING_LANGUAGE_CODES,
    fallbackLng: DEFAULT_LANGUAGE,
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: { escapeValue: false },
    returnObjects: true,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  })

applyLandingDirection(landingI18n.language)
landingI18n.on("languageChanged", (lng) => {
  applyLandingDirection(lng)
  // The app's global i18n is i18next's DEFAULT instance; the landing uses a
  // separate one. Keep the default in sync so app routes reached from the
  // landing via client-side navigation (signup, login, legal) render in the
  // same language — without importing any app code.
  if (i18next.isInitialized && i18next.language !== lng) {
    void i18next.changeLanguage(lng)
  }
})

export default landingI18n
