import { NATIVE_OAUTH_REDIRECT_URL } from "@/lib/native-auth"

// Native (Capacitor) OAuth start — bypasses clerk-js for the CREATE call only.
//
// Why: the OAuth verification completes in the EXTERNAL browser (Google blocks
// WebView OAuth), which never has the WebView's Clerk client cookie. Production
// Clerk instances reject a cookie-created ("web") sign-in attempt whose callback
// arrives cookie-less: /v1/oauth_callback answers `authorization_invalid`
// (dev instances are lax, so emulator testing against dev never caught it).
// Creating the attempt as a NATIVE attempt (`_is_native=1`, both redirect URLs
// on the allowlisted custom scheme) flips Clerk into its cross-browser flow:
// the callback 303s to the app scheme carrying `rotating_token_nonce`, which
// lets the app's client absorb the new session (see OAuthCallbackPage).
//
// The request still runs from the WebView with `credentials: "include"`, so the
// attempt is bound to the SAME Clerk client clerk-js uses — after the deep link
// returns, a client reload surfaces the completed sign-in/up.
//
// Instance prerequisites (both live in the Clerk dashboard / Backend API):
//   - redirect_urls allowlist contains com.vorreix.profitsync://oauth-callback
//   - allowed_origins includes the WebView origins + the app scheme origin

export type NativeOAuthStrategy = "oauth_google" | "oauth_apple"
export type NativeOAuthMode = "sign-in" | "sign-up"

// pk_live_<base64("clerk.example.com$")> → https://clerk.example.com
export function fapiBaseFromPublishableKey(publishableKey: string): string | null {
  const encoded = publishableKey.split("_")[2]
  if (!encoded) return null
  try {
    const domain = atob(encoded).replace(/\$$/, "")
    if (!domain || !/^[a-z0-9][a-z0-9.-]*$/i.test(domain)) return null
    return `https://${domain}`
  } catch {
    return null
  }
}

export function buildNativeOAuthBody(
  mode: NativeOAuthMode,
  strategy: NativeOAuthStrategy,
  unsafeMetadata?: Record<string, unknown>,
): URLSearchParams {
  const body = new URLSearchParams({
    strategy,
    // Native validation requires BOTH urls to be allowlisted — a relative path
    // like /dashboard is rejected with "Redirect url mismatch". Final in-app
    // navigation is handled by OAuthCallbackPage instead.
    redirect_url: NATIVE_OAUTH_REDIRECT_URL,
    action_complete_redirect_url: NATIVE_OAUTH_REDIRECT_URL,
  })
  if (mode === "sign-up") {
    body.set("legal_accepted", "true")
    if (unsafeMetadata) body.set("unsafe_metadata", JSON.stringify(unsafeMetadata))
  }
  return body
}

type FapiVerificationResponse = {
  response?: {
    first_factor_verification?: { external_verification_redirect_url?: string | null }
    verifications?: { external_account?: { external_verification_redirect_url?: string | null } }
  }
  errors?: Array<{ code?: string; message?: string; long_message?: string }>
}

export function extractVerificationUrl(mode: NativeOAuthMode, data: FapiVerificationResponse): string | null {
  const r = data?.response
  const url =
    mode === "sign-in"
      ? r?.first_factor_verification?.external_verification_redirect_url
      : r?.verifications?.external_account?.external_verification_redirect_url
  return url || null
}

export function extractFapiError(data: FapiVerificationResponse, fallback: string): string {
  const err = data?.errors?.[0]
  return err?.long_message || err?.message || fallback
}

// Creates the native-flagged sign-in/up attempt and returns the provider
// verification URL to open in the system browser. Throws on any failure.
export async function createNativeOAuthAttempt(opts: {
  publishableKey: string
  mode: NativeOAuthMode
  strategy: NativeOAuthStrategy
  unsafeMetadata?: Record<string, unknown>
}): Promise<string> {
  const base = fapiBaseFromPublishableKey(opts.publishableKey)
  if (!base) throw new Error("Could not derive the Clerk frontend API from the publishable key.")

  const endpoint = opts.mode === "sign-in" ? "sign_ins" : "sign_ups"
  const resp = await fetch(`${base}/v1/client/${endpoint}?_is_native=1`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildNativeOAuthBody(opts.mode, opts.strategy, opts.unsafeMetadata).toString(),
  })
  const data = (await resp.json()) as FapiVerificationResponse
  if (!resp.ok) throw new Error(extractFapiError(data, `Clerk rejected the ${opts.strategy} attempt (HTTP ${resp.status}).`))

  const url = extractVerificationUrl(opts.mode, data)
  if (!url) throw new Error(`Clerk did not return a ${opts.strategy} verification URL.`)
  return url
}
