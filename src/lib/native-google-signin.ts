// Native (Capacitor) Google Sign-In → Clerk, the reliable replacement for the
// external-browser OAuth round-trip that could not persist the session.
//
// WHY THIS EXISTS (the auto-logout root cause):
// The external-browser flow finishes with `client.reload({ rotatingTokenNonce })`.
// On Clerk's current FAPI (API version 2025-11-10) that nonce reload attaches the
// session AND rotates the client's rotating token server-side, but returns the
// replacement token through NO channel the native transport reads (no Authorization
// response header when a bearer is presented, no Set-Cookie the WebView keeps). The
// app therefore held a SPENT client token; the next authed write (a session touch)
// 401'd → clerk-js signed out → cold starts booted signed-out. Device-proven.
//
// A native ID-token sign-in sidesteps that entirely: `authenticateWithGoogleOneTap`
// is an ORDINARY client write (POST /v1/client/sign_ins) — Clerk returns the rotated
// client token in the Authorization RESPONSE header exactly like every other authed
// write, and native-clerk-transport.ts captures it. No nonce, no browser, no gap.
//
// Requires (see docs/native-oauth/GOOGLE_SIGNIN_SETUP.md): the Google ID token's
// `aud` must equal the Web OAuth client ID configured on Clerk's Google connection.
import { isNativeApp, nativeAuthLog } from "@/lib/native-auth"

// Where a completed sign-in lands. The app's own guards then bounce brand-new
// users on to onboarding; landing on /dashboard first is correct for both.
const POST_SIGNIN_PATH = "/dashboard"

export type NativeGoogleResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "cancelled" | "no-token" | "error"; message?: string }

// The two clerk-js methods we need. Typed locally (rather than off @clerk/types)
// so this compiles regardless of the installed clerk-react typings version — the
// methods are present on the loaded clerk-js 5.127.1 runtime (verified on-device).
type GoogleOneTapClerk = {
  authenticateWithGoogleOneTap: (params: { token: string }) => Promise<unknown>
  handleGoogleOneTapCallback: (
    signInOrUp: unknown,
    params: { signInFallbackRedirectUrl?: string; signUpFallbackRedirectUrl?: string },
    customNavigate?: (to: string) => Promise<unknown>,
  ) => Promise<unknown>
}

// ⚠️ Capacitor plugin objects are Proxies that forward EVERY property access —
// including `then` — to a native call. NEVER resolve a promise WITH the proxy
// (an await on it would call proxy.then() → hang forever). Hand it back wrapped,
// exactly like src/lib/native-push.ts does for FirebaseMessaging.
async function firebaseAuth() {
  const mod = await import("@capacitor-firebase/authentication")
  return { fa: mod.FirebaseAuthentication }
}

function isCancellation(message: string): boolean {
  // Android Credential Manager / Google Sign-In cancel + iOS user-cancel strings.
  return /cancel|canceled|cancelled|12501|dismiss|no credential|GIDSignIn.*-5\b/i.test(message)
}

// Runs the whole native Google login: obtain a Google ID token via the native
// Credential Manager / Google Sign-In UI, hand it to Clerk's google_one_tap
// strategy (creates OR signs in), then let Clerk set the active session and
// hard-navigate to the app. Returns a result the caller maps to UX (silent on
// user-cancel, toast on real failure). Never throws.
export async function nativeGoogleSignIn(clerk: unknown): Promise<NativeGoogleResult> {
  if (!isNativeApp()) return { ok: false, reason: "unsupported" }

  let idToken: string
  try {
    const { fa } = await firebaseAuth()
    nativeAuthLog("native_google_signin_start")
    const result = await fa.signInWithGoogle()
    const token = result?.credential?.idToken
    if (!token) {
      nativeAuthLog("native_google_signin_no_token")
      return { ok: false, reason: "no-token" }
    }
    idToken = token
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (isCancellation(message)) {
      nativeAuthLog("native_google_signin_cancelled")
      return { ok: false, reason: "cancelled" }
    }
    nativeAuthLog("native_google_signin_provider_failed", { message })
    return { ok: false, reason: "error", message }
  }

  try {
    const oneTap = clerk as GoogleOneTapClerk
    const signInOrUp = await oneTap.authenticateWithGoogleOneTap({ token: idToken })
    nativeAuthLog("native_google_onetap_authenticated")
    // Hard-navigate on completion: clerk's default SPA history push does not
    // re-render the router in this app (the reason OAuthCallbackPage always used
    // window.location.replace). setActive has already persisted the rotated
    // client token by the time this fires, so the fresh boot is signed in.
    await oneTap.handleGoogleOneTapCallback(
      signInOrUp,
      { signInFallbackRedirectUrl: POST_SIGNIN_PATH, signUpFallbackRedirectUrl: POST_SIGNIN_PATH },
      (to: string) => {
        window.location.assign(to || POST_SIGNIN_PATH)
        return Promise.resolve()
      },
    )
    nativeAuthLog("native_google_signin_complete")
    return { ok: true }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    nativeAuthLog("native_google_clerk_failed", { message })
    return { ok: false, reason: "error", message }
  }
}
