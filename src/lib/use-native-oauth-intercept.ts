import { useEffect, useRef } from "react"
import { useClerk } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { NATIVE_OAUTH_REDIRECT_URL, isNativeApp, nativeAuthLog, nativeAuthUrlLog } from "@/lib/native-auth"
import { nativeGoogleSignIn } from "@/lib/native-google-signin"

export type NativeOAuthMode = "sign-in" | "sign-up"
type NativeOAuthStrategy = "oauth_google" | "oauth_apple"

// Native (Capacitor) hook for the auth pages: keeps Clerk's OWN in-card social
// buttons (so the card looks and lays out exactly like the web) but hijacks
// their taps to run the native OAuth flow. Clerk's built-in button handler would
// navigate the WebView itself to the provider, which Google blocks
// (disallowed_useragent); we instead create the attempt through clerk-js and open
// the provider URL in the SYSTEM browser via @capacitor/browser.
//
// This relies on clerk-js running in NATIVE mode on native (standardBrowser:false
// in main.tsx). In that mode clerk-js's own `client` IS the native client, so an
// attempt created via clerk.client.signIn/signUp.create is a native attempt bound
// to the client the deep-link callback later reloads — which is what lets the
// round-trip complete (see OAuthCallbackPage.tsx). Prior to native mode we had to
// fork a separate native client with a raw _is_native fetch, which clerk-js could
// never see; that workaround (src/lib/native-oauth.ts) is gone.
//
// The listener runs in the CAPTURE phase on document, so it fires before Clerk's
// own React (bubble-phase) handler and cancels it. On the web this hook is a
// no-op. Provider is read from Clerk's element modifier classes
// (cl-socialButtonsBlockButton__google / __apple; icon variant covered too).
export function useNativeOAuthIntercept(mode: NativeOAuthMode, unsafeMetadata?: Record<string, unknown>) {
  const clerk = useClerk()
  const { t } = useTranslation()
  // Refs so the one-time listener always sees the latest values without
  // re-installing on every render (SignupPage passes a fresh metadata object).
  const metadataRef = useRef(unsafeMetadata)
  metadataRef.current = unsafeMetadata
  const errorTextRef = useRef(t("auth.oauthError"))
  errorTextRef.current = t("auth.oauthError")

  useEffect(() => {
    if (!isNativeApp()) return
    let busy = false

    const onClickCapture = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest?.<HTMLElement>(
        ".cl-socialButtonsBlockButton, .cl-socialButtonsIconButton",
      )
      if (!button) return
      const cls = button.className
      const provider: "google" | "apple" | null = /__google\b/.test(cls)
        ? "google"
        : /__apple\b/.test(cls)
          ? "apple"
          : null
      if (!provider) return

      event.preventDefault()
      event.stopPropagation()
      if (busy) return
      busy = true

      nativeAuthLog("oauth_button_clicked", { provider, mode, via: "clerk_card_intercept" })

      void (async () => {
        try {
          if (provider === "google") {
            // Native Google Sign-In (Credential Manager → Clerk google_one_tap).
            // Reliable session persistence; no external browser, no nonce reload.
            // On success it hard-navigates itself, so there is nothing to do here.
            const result = await nativeGoogleSignIn(clerk)
            if (!result.ok && result.reason !== "cancelled") {
              nativeAuthLog("native_google_signin_failed", { reason: result.reason, message: result.message })
              toast.error(errorTextRef.current)
            }
            return
          }
          // Apple: the external-browser attempt + system browser (unchanged).
          // Native Apple ID-token sign-in is a follow-up; Apple is iOS-only in
          // practice and the primary account is Google. See GOOGLE_SIGNIN_SETUP.md.
          const strategy: NativeOAuthStrategy = "oauth_apple"
          const { Browser } = await import("@capacitor/browser")
          const url = await startNativeOAuth(clerk, mode, strategy, metadataRef.current)
          nativeAuthUrlLog("generated_redirect_url", url, { provider, mode })
          await Browser.open({ url, presentationStyle: "fullscreen" })
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause)
          nativeAuthLog("oauth_start_failed", { provider, mode, message: detail })
          toast.error(errorTextRef.current)
        } finally {
          busy = false
        }
      })()
    }

    document.addEventListener("click", onClickCapture, true)
    return () => document.removeEventListener("click", onClickCapture, true)
  }, [clerk, mode])
}

// Creates the sign-in/up attempt through clerk-js's own client (native mode) and
// returns the provider verification URL to open in the system browser. Both
// redirect URLs use the allowlisted app scheme — a relative path is rejected
// ("Redirect url mismatch"); final in-app navigation is handled by
// OAuthCallbackPage. Throws on any failure.
async function startNativeOAuth(
  clerk: ReturnType<typeof useClerk>,
  mode: NativeOAuthMode,
  strategy: NativeOAuthStrategy,
  unsafeMetadata?: Record<string, unknown>,
): Promise<string> {
  const client = clerk.client
  if (!client) throw new Error("Clerk client is not ready.")

  if (mode === "sign-in") {
    const signIn = await client.signIn.create({
      strategy,
      redirectUrl: NATIVE_OAUTH_REDIRECT_URL,
      actionCompleteRedirectUrl: NATIVE_OAUTH_REDIRECT_URL,
    })
    const url = signIn.firstFactorVerification?.externalVerificationRedirectURL
    if (!url) throw new Error(`Clerk did not return a ${strategy} verification URL.`)
    return url.toString()
  }

  const signUp = await client.signUp.create({
    strategy,
    redirectUrl: NATIVE_OAUTH_REDIRECT_URL,
    actionCompleteRedirectUrl: NATIVE_OAUTH_REDIRECT_URL,
    legalAccepted: true,
    ...(unsafeMetadata ? { unsafeMetadata } : {}),
  })
  const url = signUp.verifications?.externalAccount?.externalVerificationRedirectURL
  if (!url) throw new Error(`Clerk did not return a ${strategy} verification URL.`)
  return url.toString()
}
