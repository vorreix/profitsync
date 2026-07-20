import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ClerkProvider } from "@clerk/clerk-react"
import { I18nextProvider } from "react-i18next"
import { Analytics } from "@vercel/analytics/react"

import "./index.css"
import i18n from "@/lib/i18n"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { installApiBaseFetchRewrite } from "@/lib/api-base"
import { initPwa } from "@/lib/pwa/register-sw"
import { isNativeApp } from "@/lib/native-auth"
import { installNativeClerkTransport } from "@/lib/native-clerk-transport"

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in Vite env")
}

installApiBaseFetchRewrite()

// Native only: route clerk-js through the native FAPI transport (so its own
// client is a stable `_is_native` client that can complete external-browser
// OAuth). Must run before clerk-js loads so it captures the wrapped fetch.
installNativeClerkTransport(PUBLISHABLE_KEY)

// Capture a referral code (?r=CODE) on first load - anywhere, including the
// landing - so it survives the hop to signup (read there from localStorage).
try {
  const r = new URLSearchParams(window.location.search).get("r")
  if (r) localStorage.setItem("ps_ref", r.trim().toUpperCase())
} catch { /* storage unavailable */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* On native (Capacitor) run clerk-js in NON-standard-browser mode so it
        derives its state from FAPI responses rather than browser cookies. Paired
        with installNativeClerkTransport() above (which makes every FAPI call an
        `_is_native` request on a JWT-addressed client), this lets clerk-js's own
        client complete external-browser OAuth: the attempt from
        clerk.client.signIn/signUp.create is native, its callback deep-links back
        with rotating_token_nonce, and client.reload({nonce}) completes it on that
        same client (see use-native-oauth-intercept.ts + OAuthCallbackPage.tsx).
        Web keeps the default cookie-based standardBrowser:true.

        allowedRedirectProtocols: the iOS WebView origin is capacitor://localhost
        (Android's is https://localhost), and clerk-js validates every redirect —
        INCLUDING its own card step navigation (/login/factor-one,
        /signup/verify-email-address, built absolute against the page origin) —
        against an http/https protocol allowlist. Without capacitor: listed,
        every email submit on iOS "redirects to /" (a full WebView reload back to
        the start; simulator-verified 2026-07-20). The app scheme is included for
        deep-link redirects. */}
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      standardBrowser={!isNativeApp()}
      allowedRedirectProtocols={isNativeApp() ? ["http:", "https:", "capacitor:", "com.vorreix.profitsync:"] : undefined}
    >
      <ThemeProvider>
        {/* Bind the app subtree to its own i18next instance explicitly. The
            landing mounts a separate i18next instance (createInstance), and
            whichever instance initializes last would otherwise become
            react-i18next's global default - so once the lazy landing chunk
            loads, app routes reached via client-side navigation could resolve
            against the landing's resources and render raw keys. This provider
            pins the app to `i18n`; the landing's own <I18nextProvider> overrides
            it within the landing subtree. */}
        <I18nextProvider i18n={i18n}>
          <App />
        </I18nextProvider>
      </ThemeProvider>
    </ClerkProvider>
    <Analytics />
  </StrictMode>
)

// Register the PWA service worker (no-op on the landing page and other pre-auth routes).
initPwa()
