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
// WHY A SERVER-SIDE TICKET EXCHANGE (and not `google_one_tap`):
// Google ID tokens minted on-device carry the platform (Android/iOS) OAuth client
// in `azp`, and Clerk's google_one_tap strategy only authorizes tokens whose azp
// is the configured Web client → 403 authorization_invalid (device-proven
// 2026-07-18; a garbage token fails with a DIFFERENT error, so the token itself
// verified fine — the rejection is the azp check). The fix: POST the Google token
// to our own /api/public/native-google-auth, which verifies it against Google
// (aud = our Web client) and mints a 60-second Clerk sign-in ticket. Redeeming
// the ticket is an ORDINARY client write (POST /v1/client/sign_ins) — Clerk
// returns the rotated client token in the Authorization RESPONSE header exactly
// like every other authed write, and native-clerk-transport.ts captures it.
// No nonce, no browser, no gap.
import { isNativeApp, nativeAuthLog } from "@/lib/native-auth"
import { API_BASE_URL } from "@/lib/api-base"

// Where a completed sign-in lands. The app's own guards then bounce brand-new
// users on to onboarding; landing on /dashboard first is correct for both.
const POST_SIGNIN_PATH = "/dashboard"

export type NativeGoogleResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "cancelled" | "no-token" | "error"; message?: string }

// The clerk-js surface we need for the ticket redemption. Typed locally (rather
// than off @clerk/types) so this compiles regardless of the installed
// clerk-react typings version — present on the loaded clerk-js 5.127.1 runtime.
type TicketClerk = {
  client: {
    signIn: {
      create: (params: { strategy: "ticket"; ticket: string }) => Promise<{
        status: string
        createdSessionId: string | null
      }>
    }
  }
  setActive: (params: { session: string }) => Promise<unknown>
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

// Exchange the Google ID token for a Clerk sign-in ticket via our API. Uses
// CapacitorHttp (native transport): this runs pre-auth inside the WebView, and
// the native request avoids the cross-origin preflight entirely.
async function fetchSignInTicket(idToken: string): Promise<string> {
  const { CapacitorHttp } = await import("@capacitor/core")
  const response = await CapacitorHttp.request({
    url: `${API_BASE_URL}/api/public/native-google-auth`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: { token: idToken },
  })
  const body =
    typeof response.data === "string" ? JSON.parse(response.data || "{}") : (response.data ?? {})
  if (response.status !== 200 || typeof body.ticket !== "string") {
    throw new Error(body.error || `Sign-in exchange failed (${response.status})`)
  }
  return body.ticket
}

// Runs the whole native Google login: obtain a Google ID token via the native
// Credential Manager / Google Sign-In UI, exchange it server-side for a Clerk
// sign-in ticket (creates the user on first login), redeem the ticket, then set
// the active session and hard-navigate into the app. Returns a result the
// caller maps to UX (silent on user-cancel, toast on real failure). Never throws.
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
    const ticket = await fetchSignInTicket(idToken)
    nativeAuthLog("native_google_ticket_minted")

    const c = clerk as TicketClerk
    const attempt = await c.client.signIn.create({ strategy: "ticket", ticket })
    if (attempt.status !== "complete" || !attempt.createdSessionId) {
      nativeAuthLog("native_google_ticket_incomplete", { message: attempt.status })
      return { ok: false, reason: "error", message: `Sign-in incomplete (${attempt.status})` }
    }
    await c.setActive({ session: attempt.createdSessionId })
    nativeAuthLog("native_google_signin_complete")
    // Hard-navigate on completion: clerk's default SPA history push does not
    // re-render the router in this app (the reason OAuthCallbackPage always used
    // window.location.replace). setActive has already persisted the rotated
    // client token by the time this fires, so the fresh boot is signed in.
    window.location.assign(POST_SIGNIN_PATH)
    return { ok: true }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    nativeAuthLog("native_google_clerk_failed", { message })
    return { ok: false, reason: "error", message }
  }
}
