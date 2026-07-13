import { useEffect, useState } from "react"
import { useClerk } from "@clerk/clerk-react"
import { Loader2 } from "lucide-react"

import { nativeAuthLog, nativeAuthUrlLog } from "@/lib/native-auth"

// Completes the native OAuth round-trip. The deep link from the external
// browser lands here (App.tsx routes com.vorreix.profitsync://oauth-callback to
// /sso-callback with the query intact). We do NOT rely solely on Clerk's
// generic handleRedirectCallback: on native its outcome navigation is easy to
// strand (SPA history hacks don't re-render the router), and the "transferable"
// case — signing IN with a Google/Apple account that has no user yet, or
// signing UP with one that already exists — dead-ends in a component-driven
// flow. Instead: absorb the rotating_token_nonce, then resolve the client state
// explicitly and finish with a HARD navigation (full reload boots the app with
// the fresh session; the in-app service worker is disabled on native, so this
// is always a clean load).
export function OAuthCallbackPage() {
  const clerk = useClerk()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // Hard navigation on purpose — see the header comment.
    function go(to: string) {
      nativeAuthLog("final_navigation", { to })
      window.location.replace(to)
    }

    async function completeOAuth() {
      nativeAuthUrlLog("callback_route_loaded", window.location.href)
      try {
        // The attempt was created `_is_native=1` in the WebView but completed
        // in the external browser, which rotates the client's token
        // server-side. The success deep link carries rotating_token_nonce —
        // reload the client with it so the completed sign-in/up becomes
        // visible. (Checked in both search and hash, defensively.)
        const search = new URLSearchParams(window.location.search)
        const hash = new URLSearchParams(window.location.hash.split("?")[1] ?? "")
        const nonce = search.get("rotating_token_nonce") || hash.get("rotating_token_nonce")
        if (nonce) {
          try {
            await clerk.client?.reload({ rotatingTokenNonce: nonce })
            nativeAuthLog("client_reloaded_with_nonce")
          } catch (cause) {
            nativeAuthLog("client_nonce_reload_failed", {
              message: cause instanceof Error ? cause.message : String(cause),
            })
          }
        }

        const signIn = clerk.client?.signIn
        const signUp = clerk.client?.signUp

        // 1) Attempt already complete — activate its session and enter the app.
        if (signIn?.status === "complete" && signIn.createdSessionId) {
          await clerk.setActive({ session: signIn.createdSessionId })
          nativeAuthLog("oauth_complete", { via: "sign_in" })
          go("/dashboard")
          return
        }
        if (signUp?.status === "complete" && signUp.createdSessionId) {
          await clerk.setActive({ session: signUp.createdSessionId })
          nativeAuthLog("oauth_complete", { via: "sign_up" })
          go("/dashboard")
          return
        }

        // 2) Sign-IN with an account that has no user yet → transfer to
        //    sign-up (creates the account from the verified OAuth identity).
        if (signIn?.firstFactorVerification?.status === "transferable" && signUp) {
          nativeAuthLog("oauth_transfer", { direction: "sign_in_to_sign_up" })
          const res = await signUp.create({ transfer: true, legalAccepted: true })
          if (res.status === "complete" && res.createdSessionId) {
            await clerk.setActive({ session: res.createdSessionId })
            nativeAuthLog("oauth_complete", { via: "transfer_sign_up" })
            go("/dashboard")
            return
          }
          nativeAuthLog("oauth_transfer_incomplete", { status: res.status ?? "unknown" })
        }

        // 3) Sign-UP with an account that already exists → transfer to sign-in.
        if (signUp?.verifications?.externalAccount?.status === "transferable" && signIn) {
          nativeAuthLog("oauth_transfer", { direction: "sign_up_to_sign_in" })
          const res = await signIn.create({ transfer: true })
          if (res.status === "complete" && res.createdSessionId) {
            await clerk.setActive({ session: res.createdSessionId })
            nativeAuthLog("oauth_complete", { via: "transfer_sign_in" })
            go("/dashboard")
            return
          }
          nativeAuthLog("oauth_transfer_incomplete", { status: res.status ?? "unknown" })
        }

        // 4) Anything else (failed verification, cancelled, unexpected state):
        //    let Clerk's generic handler decide, with the same hard navigation.
        await clerk.handleRedirectCallback(
          {
            signInUrl: "/login",
            signUpUrl: "/signup",
            redirectUrl: "/dashboard",
          },
          async (to) => go(to),
        )
        nativeAuthLog("clerk_callback_fallback_done")
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Sign-in callback failed."
        nativeAuthLog("clerk_callback_failure", { message })
        if (!cancelled) setError(message)
      }
    }

    void completeOAuth()

    return () => {
      cancelled = true
    }
  }, [clerk])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 p-4 text-center">
      {error ? (
        <>
          <h1 className="text-lg font-semibold">Sign-in failed</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <a href="/login" className="text-sm underline underline-offset-4">
            Back to sign in
          </a>
        </>
      ) : (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Finishing sign-in...</p>
        </>
      )}
    </div>
  )
}
