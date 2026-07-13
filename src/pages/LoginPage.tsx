import { useEffect } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { SignIn } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"

import { InstallAppBanner } from "@/components/InstallAppBanner"
import { NativeOAuthButton } from "@/components/NativeOAuthButton"
import { initPwa } from "@/lib/pwa/register-sw"
import { safeRedirect } from "@/lib/safe-redirect"

// In the native WebView, Clerk's own social buttons can't complete OAuth (Google
// blocks OAuth inside an embedded WebView), so the custom NativeOAuthButtons
// above replace them. Clerk's duplicate in-card social section + "or" divider
// are hidden by the `html.native-app .cl-socialButtonsRoot` rule in index.css —
// an appearance-prop Tailwind class can't do it (Clerk's unlayered CSS-in-JS
// beats layered Tailwind utilities). The web keeps Clerk's built-in buttons.
export function LoginPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()

  // Preserve a post-login destination (e.g. an invitation accept page) through
  // the Clerk sign-in flow. Falls back to the dashboard.
  const redirect = safeRedirect(params.get("redirect"))
  const target = redirect ?? "/dashboard"
  const signUpUrl = redirect ? `/signup?redirect=${encodeURIComponent(redirect)}` : "/signup"

  // Registering here (in addition to boot) covers users who arrive via SPA navigation
  // from the landing page, where boot-time registration was skipped.
  useEffect(() => {
    initPwa()
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 gap-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-2">
        <NativeOAuthButton provider="apple" mode="sign-in" completeUrl={target} />
        <NativeOAuthButton provider="google" mode="sign-in" completeUrl={target} />
      </div>
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
