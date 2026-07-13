import { useEffect, useState } from "react"
import { useClerk } from "@clerk/clerk-react"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { isNativeApp, nativeAuthLog, nativeAuthUrlLog, NATIVE_OAUTH_REDIRECT_URL } from "@/lib/native-auth"
import { createNativeOAuthAttempt } from "@/lib/native-oauth"
import { cn } from "@/lib/utils"

// Native-only social sign-in. In the Capacitor WebView, Clerk's prebuilt social
// buttons can't complete OAuth (the provider redirect leaves the WebView), so we
// drive it manually: create a NATIVE-flagged sign-in/up attempt against FAPI
// (`_is_native=1` — see src/lib/native-oauth.ts for why clerk-js's own create is
// unusable here: production rejects a web-created attempt whose callback arrives
// from the cookie-less external browser with `authorization_invalid`), open the
// provider page in the system Browser, and the deep-link listener in App.tsx
// routes the callback back to /sso-callback. On the web this renders nothing —
// Clerk's <SignIn>/<SignUp> already render the enabled providers there.
type Provider = "google" | "apple"

type NativeOAuthButtonProps = {
  provider: Provider
  mode: "sign-in" | "sign-up"
  completeUrl: string
  unsafeMetadata?: Record<string, unknown>
}

const STRATEGY: Record<Provider, "oauth_google" | "oauth_apple"> = {
  google: "oauth_google",
  apple: "oauth_apple",
}

// Brand marks. Google keeps its fixed four colours on the outline button; the
// Apple logo uses currentColor so it inverts with the button's text (black-on-
// white in light mode, white-on-black in dark) per Apple's button guidance.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  )
}
function AppleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.79c.03 2.86 2.51 3.81 2.54 3.82-.02.07-.4 1.36-1.31 2.69-.79 1.15-1.61 2.29-2.9 2.31-1.27.03-1.68-.75-3.13-.75-1.45 0-1.9.73-3.1.78-1.25.05-2.2-1.24-2.99-2.39-1.63-2.35-2.88-6.64-1.2-9.54.83-1.44 2.32-2.35 3.94-2.37 1.22-.02 2.38.82 3.13.82.75 0 2.16-1.02 3.64-.87.62.03 2.36.25 3.48 1.89-.09.06-2.08 1.21-2.05 3.61ZM14.09 4.2c.66-.8 1.11-1.92.99-3.03-.95.04-2.11.64-2.8 1.44-.62.71-1.16 1.84-1.02 2.93 1.06.08 2.14-.54 2.83-1.34Z" />
    </svg>
  )
}

export function NativeOAuthButton({ provider, mode, completeUrl, unsafeMetadata }: NativeOAuthButtonProps) {
  const { t } = useTranslation()
  const clerk = useClerk()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If the user backs out of the external browser without finishing OAuth (or
  // the callback fails and returns here), the page regains visibility with the
  // button still in its submitting state — reset it so it's tappable again.
  useEffect(() => {
    if (!isNativeApp()) return
    const onVisible = () => {
      if (document.visibilityState === "visible") setSubmitting(false)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  if (!isNativeApp()) return null

  const strategy = STRATEGY[provider]
  const label = provider === "google" ? t("auth.continueWithGoogle") : t("auth.continueWithApple")
  const loaded = clerk.loaded

  async function handleAuth() {
    setSubmitting(true)
    setError(null)
    nativeAuthLog("oauth_button_clicked", {
      provider,
      mode,
      redirectUrl: NATIVE_OAUTH_REDIRECT_URL,
      redirectUrlComplete: completeUrl,
    })
    try {
      const { Browser } = await import("@capacitor/browser")
      const url = await createNativeOAuthAttempt({
        publishableKey: clerk.publishableKey,
        mode,
        strategy,
        unsafeMetadata,
      })

      nativeAuthUrlLog("generated_redirect_url", url, { provider, mode })
      await Browser.open({ url, presentationStyle: "fullscreen" })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      nativeAuthLog("oauth_start_failed", { provider, mode, message: detail })
      setError(t("auth.oauthError"))
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-2">
      <Button
        type="button"
        variant={provider === "apple" ? "default" : "outline"}
        className={cn(
          "w-full gap-2",
          provider === "apple" &&
            "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
        )}
        disabled={!loaded || submitting}
        onClick={handleAuth}
      >
        {submitting ? <Loader2 className="size-4 animate-spin" /> : provider === "google" ? <GoogleGlyph /> : <AppleGlyph />}
        {label}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
