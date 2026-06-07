import { useEffect, useRef } from "react"
import { useSignIn, useSignUp } from "@clerk/clerk-react"

import {
  describeNativeAuthError,
  describeUrlForNativeAuthLog,
  nativeAuthDebugLog,
} from "@/lib/native-auth-debug"
import { isNativeAndroidRuntime, NATIVE_OAUTH_CALLBACK_URL } from "@/lib/native-oauth"

function looksLikeGoogleAuthTrigger(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  const trigger = target.closest("button, a")
  if (!trigger) return false

  const label = [
    trigger.textContent,
    trigger.getAttribute("aria-label"),
    trigger.getAttribute("data-provider"),
    trigger.getAttribute("data-strategy"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return label.includes("google")
}

type NativeGoogleOAuthInterceptorProps = {
  flow?: "sign-in" | "sign-up"
  unsafeMetadata?: Record<string, unknown>
}

export function NativeGoogleOAuthInterceptor({
  flow = "sign-in",
  unsafeMetadata,
}: NativeGoogleOAuthInterceptorProps) {
  const { isLoaded, signIn } = useSignIn()
  const { isLoaded: isSignUpLoaded, signUp } = useSignUp()
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!isNativeAndroidRuntime()) return

    async function startGoogleOAuth(event: MouseEvent) {
      if (!looksLikeGoogleAuthTrigger(event.target)) return
      if (inFlightRef.current) return
      if (flow === "sign-in" && (!isLoaded || !signIn)) return
      if (flow === "sign-up" && (!isSignUpLoaded || !signUp)) return

      event.preventDefault()
      event.stopPropagation()
      inFlightRef.current = true

      nativeAuthDebugLog("Google login button clicked", {
        flow,
        nativeRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
        source: "clerk-ui",
      })

      try {
        const redirectUrl =
          flow === "sign-up"
            ? (
                await signUp!.create({
                  strategy: "oauth_google",
                  redirectUrl: NATIVE_OAUTH_CALLBACK_URL,
                  actionCompleteRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
                  externalAccountRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
                  externalAccountActionCompleteRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
                  unsafeMetadata,
                })
              ).verifications.externalAccount.externalVerificationRedirectURL?.toString()
            : (
                await signIn!.create({
                  strategy: "oauth_google",
                  redirectUrl: NATIVE_OAUTH_CALLBACK_URL,
                  actionCompleteRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
                })
              ).firstFactorVerification.externalVerificationRedirectURL?.toString()

        if (!redirectUrl) {
          nativeAuthDebugLog(
            "Google OAuth redirect URL missing",
            {
              flow,
              nativeRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
            },
            "error",
          )
          return
        }

        const { Browser } = await import("@capacitor/browser")
        nativeAuthDebugLog("generated OAuth URL", describeUrlForNativeAuthLog(redirectUrl))
        nativeAuthDebugLog("browser OAuth opened", {
          oauthUrl: describeUrlForNativeAuthLog(redirectUrl),
          nativeRedirectUrl: NATIVE_OAUTH_CALLBACK_URL,
        })
        await Browser.open({
          url: redirectUrl,
          presentationStyle: "fullscreen",
        })
      } catch (error) {
        nativeAuthDebugLog("Google sign-in failed", describeNativeAuthError(error), "error")
      } finally {
        inFlightRef.current = false
      }
    }

    document.addEventListener("click", startGoogleOAuth, true)
    return () => document.removeEventListener("click", startGoogleOAuth, true)
  }, [flow, isLoaded, isSignUpLoaded, signIn, signUp, unsafeMetadata])

  return null
}
