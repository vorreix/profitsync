import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ClerkProvider } from "@clerk/clerk-react"
import { I18nextProvider } from "react-i18next"

import "./index.css"
import i18n from "@/lib/i18n"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { initPwa } from "@/lib/pwa/register-sw"

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env.local")
}

// Capture a referral code (?r=CODE) on first load — anywhere, including the
// landing — so it survives the hop to signup (read there from localStorage).
try {
  const r = new URLSearchParams(window.location.search).get("r")
  if (r) localStorage.setItem("ps_ref", r.trim().toUpperCase())
} catch { /* storage unavailable */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <ThemeProvider>
        {/* Bind the app subtree to its own i18next instance explicitly. The
            landing mounts a separate i18next instance (createInstance), and
            whichever instance initializes last would otherwise become
            react-i18next's global default — so once the lazy landing chunk
            loads, app routes reached via client-side navigation could resolve
            against the landing's resources and render raw keys. This provider
            pins the app to `i18n`; the landing's own <I18nextProvider> overrides
            it within the landing subtree. */}
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>
      </ThemeProvider>
    </ClerkProvider>
  </StrictMode>
)

// Register the PWA service worker (no-op on the landing page and other pre-auth routes).
initPwa()
