import { useState } from "react"
import { useSignIn, useSignUp } from "@clerk/clerk-react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { isNativeAndroid, nativeAuthLog, nativeAuthUrlLog, NATIVE_OAUTH_REDIRECT_URL } from "@/lib/native-auth"

type NativeGoogleAuthButtonProps = {
  mode: "sign-in" | "sign-up"
  completeUrl: string
  unsafeMetadata?: Record<string, unknown>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Google sign-in could not be started."
}

export function NativeGoogleAuthButton({ mode, completeUrl, unsafeMetadata }: NativeGoogleAuthButtonProps) {
  const signInState = useSignIn()
  const signUpState = useSignUp()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isNativeAndroid()) return null

  const loaded = mode === "sign-in" ? signInState.isLoaded : signUpState.isLoaded

  async function handleGoogleAuth() {
    setSubmitting(true)
    setError(null)

    nativeAuthLog("google_button_clicked", {
      mode,
      redirectUrl: NATIVE_OAUTH_REDIRECT_URL,
      redirectUrlComplete: completeUrl,
    })
    try {
      const { Browser } = await import("@capacitor/browser")
      let externalVerificationRedirectURL: URL | null | undefined

      if (mode === "sign-in") {
        if (!signInState.isLoaded) return
        const result = await signInState.signIn.create({
          strategy: "oauth_google",
          redirectUrl: NATIVE_OAUTH_REDIRECT_URL,
          actionCompleteRedirectUrl: completeUrl,
        })
        externalVerificationRedirectURL = result.firstFactorVerification.externalVerificationRedirectURL
      } else {
        if (!signUpState.isLoaded) return
        const result = await signUpState.signUp.create({
          strategy: "oauth_google",
          redirectUrl: NATIVE_OAUTH_REDIRECT_URL,
          actionCompleteRedirectUrl: completeUrl,
          legalAccepted: true,
          unsafeMetadata,
        })
        externalVerificationRedirectURL = result.verifications.externalAccount.externalVerificationRedirectURL
      }

      if (!externalVerificationRedirectURL) {
        throw new Error("Clerk did not return a Google verification URL.")
      }

      nativeAuthUrlLog("generated_redirect_url", externalVerificationRedirectURL, { mode })
      await Browser.open({ url: externalVerificationRedirectURL.toString(), presentationStyle: "fullscreen" })
    } catch (cause) {
      const message = errorMessage(cause)
      nativeAuthLog("google_auth_start_failed", { mode, message })
      setError(message)
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={!loaded || submitting}
        onClick={handleGoogleAuth}
      >
        {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
        Continue with Google
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
