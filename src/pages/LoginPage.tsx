import { useEffect } from "react"
import { Link, Navigate, useSearchParams } from "react-router-dom"
import { SignIn, useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"

import { InstallAppBanner } from "@/components/InstallAppBanner"
import { initPwa } from "@/lib/pwa/register-sw"
import { safeRedirect } from "@/lib/safe-redirect"
import { useNativeOAuthIntercept } from "@/lib/use-native-oauth-intercept"

// Clerk's own in-card social buttons render on BOTH web and native, so the card
// looks identical everywhere. On native their taps are hijacked by
// useNativeOAuthIntercept (Google blocks OAuth inside an embedded WebView, and
// production Clerk needs a native-flagged attempt for the external-browser
// round-trip — see src/lib/use-native-oauth-intercept.ts). On the web the hook is
// a no-op and Clerk's buttons behave normally.
export function LoginPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const { isLoaded, isSignedIn } = useAuth()

  // Preserve a post-login destination (e.g. an invitation accept page) through
  // the Clerk sign-in flow. Falls back to the dashboard.
  const redirect = safeRedirect(params.get("redirect"))
  const target = redirect ?? "/dashboard"
  const signUpUrl = redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : "/signup"

  useNativeOAuthIntercept("sign-in")

  // Registering here (in addition to boot) covers users who arrive via SPA navigation
  // from the landing page, where boot-time registration was skipped.
  useEffect(() => {
    initPwa()
  }, [])

  // Already signed in (e.g. arriving back on /login after a completed native
  // OAuth round-trip) — go straight to the app instead of showing the card.
  if (isLoaded && isSignedIn) return <Navigate to={target} replace />

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 gap-4">
      <SignIn
        path="/login"
        routing="path"
        signUpUrl={signUpUrl}
        forceRedirectUrl={target}
        fallbackRedirectUrl={target}
      />
      <Link
        to="/forgot-password"
        className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        {t("forgotPassword.linkLabel")}
      </Link>
      <InstallAppBanner className="w-full max-w-sm" />
    </div>
  )
}
