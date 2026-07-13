import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useClerk } from "@clerk/clerk-react"
import { Loader2 } from "lucide-react"

import { nativeAuthLog, nativeAuthUrlLog } from "@/lib/native-auth"

// Completes the native OAuth round-trip. The deep link from the external
// browser lands here (App.tsx routes com.vorreix.profitsync://oauth-callback to
// /sso-callback with the query intact). We do NOT rely solely on Clerk's
// generic handleRedirectCallback: on native its outcome navigation is easy to
// strand, and the "transferable" case — signing IN with a Google/Apple account
// that has no user yet, or signing UP with one that already exists — dead-ends
// in a component-driven flow. Instead: absorb the rotating_token_nonce, resolve
// the client state explicitly, then setActive and enter the app.
//
// ⚠️ Finish with a SOFT (react-router) navigation, never window.location — a
// full reload is fatal on native. clerk-js has no cookies here; its session
// lives in memory + the native client (addressed by the rotating client JWT the
// transport shim persists). setActive rotates that JWT one last time; a hard
// reload races that rotation and boots a COLD clerk-js that rejects the spent
// token and mints a fresh, session-less client — the exact "returns to /login
// and freezes" bug. A soft navigate keeps the just-activated in-memory session
// and lets the shim persist the final JWT so a later cold start can restore it.
export function OAuthCallbackPage() {
  const clerk = useClerk()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // Soft navigation on purpose — a hard reload drops the native session.
    // See the header comment.
    function go(to: string) {
      nativeAuthLog("final_navigation", { to })
      navigate(to, { replace: true })
    }

    // Activate the browser-completed session and enter the app with a SOFT
    // navigation (a hard reload is fatal here — see the header comment).
    //
    // ⚠️ We deliberately do NOT do a second `client.reload()` to "refresh" the
    // token. The rotating_token_nonce reload already rotated the client token
    // server-side, so any follow-up GET with the now-spent token resolves to a
    // fresh EMPTY client and ABANDONS the session-bearing one (device-verified).
    // setActive holds the session in memory, so the app works for the life of
    // this instance. The one downside — the shim can't capture the nonce-rotated
    // token, so a COLD START boots signed-out — is a known limitation tracked in
    // docs/native-oauth/PLAN.md (the fix is a CORS-free native read of the
    // nonce-reload response; see native-clerk-transport.ts).
    async function completeAndEnter(sessionId: string, via: string) {
      await clerk.setActive({ session: sessionId })
      nativeAuthLog("oauth_complete", { via })
      go("/dashboard")
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

        // Diagnostic snapshot of the resolved client state after the nonce
        // reload — the single most useful signal when a round-trip lands here
        // but doesn't complete (missing_requirements, transferable, etc.).
        nativeAuthLog("oauth_state_after_reload", {
          signInStatus: signIn?.status ?? null,
          signInSession: signIn?.createdSessionId ?? null,
          signInFirstFactor: signIn?.firstFactorVerification?.status ?? null,
          signUpStatus: signUp?.status ?? null,
          signUpSession: signUp?.createdSessionId ?? null,
          signUpMissingFields: signUp?.missingFields?.join(",") ?? null,
          signUpUnverifiedFields: signUp?.unverifiedFields?.join(",") ?? null,
          signUpExternalAccount: signUp?.verifications?.externalAccount?.status ?? null,
          clientSessions: (clerk.client?.sessions ?? []).length,
          activeSession: clerk.session?.status ?? null,
        })

        // 1) Attempt already complete — activate its session and enter the app.
        if (signIn?.status === "complete" && signIn.createdSessionId) {
          await completeAndEnter(signIn.createdSessionId, "sign_in")
          return
        }
        if (signUp?.status === "complete" && signUp.createdSessionId) {
          await completeAndEnter(signUp.createdSessionId, "sign_up")
          return
        }

        // 2) Sign-IN with an account that has no user yet → transfer to
        //    sign-up (creates the account from the verified OAuth identity).
        if (signIn?.firstFactorVerification?.status === "transferable" && signUp) {
          nativeAuthLog("oauth_transfer", { direction: "sign_in_to_sign_up" })
          const res = await signUp.create({ transfer: true, legalAccepted: true })
          if (res.status === "complete" && res.createdSessionId) {
            await completeAndEnter(res.createdSessionId, "transfer_sign_up")
            return
          }
          nativeAuthLog("oauth_transfer_incomplete", { status: res.status ?? "unknown" })
        }

        // 3) Sign-UP with an account that already exists → transfer to sign-in.
        if (signUp?.verifications?.externalAccount?.status === "transferable" && signIn) {
          nativeAuthLog("oauth_transfer", { direction: "sign_up_to_sign_in" })
          const res = await signIn.create({ transfer: true })
          if (res.status === "complete" && res.createdSessionId) {
            await completeAndEnter(res.createdSessionId, "transfer_sign_in")
            return
          }
          nativeAuthLog("oauth_transfer_incomplete", { status: res.status ?? "unknown" })
        }

        // 3b) The nonce reload can create/attach a session on the client without
        //     the sign-in/up resource itself flipping to "complete" (or its
        //     createdSessionId being surfaced). If the client now carries a
        //     session, activate the newest one and enter the app.
        const clientSessions = clerk.client?.sessions ?? []
        const activeCandidate =
          clientSessions.find((s) => s.status === "active") ?? clientSessions.at(-1)
        if (activeCandidate) {
          await completeAndEnter(activeCandidate.id, "client_session")
          return
        }

        // 4) Anything else (failed verification, cancelled, unexpected state):
        //    let Clerk's generic handler decide, with the same soft navigation.
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
  }, [clerk, navigate])

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
