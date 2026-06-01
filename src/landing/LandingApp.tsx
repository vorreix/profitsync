import { I18nextProvider } from "react-i18next"
import landingI18n from "./i18n"
import "./styles/landing.css"
import { LandingPage } from "./LandingPage"

// Entry point for the marketing landing. Provides the landing's own isolated
// i18next instance to the subtree (separate from the app's global i18n) and
// pulls in the scoped stylesheet. Mounted at "/" in App.tsx.
export default function LandingApp() {
  return (
    <I18nextProvider i18n={landingI18n}>
      <LandingPage />
    </I18nextProvider>
  )
}
