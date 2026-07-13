import { isNativeApp } from "@/lib/native-auth"

// Native (Capacitor) Clerk transport shim — makes clerk-js talk to the Clerk
// Frontend API (FAPI) as a NATIVE client instead of a standard-browser one.
//
// Why this exists (proven on-device):
//   - Google blocks OAuth inside an embedded WebView (disallowed_useragent), so
//     the provider step must run in the system browser (a Chrome Custom Tab).
//     That browser has a DIFFERENT cookie jar from the app, so a standard-browser
//     ("web") sign-in attempt's callback arrives cookie-less and production Clerk
//     rejects it (`/v1/oauth_callback` → authorization_invalid).
//   - The only attempt type Clerk completes across browsers is a NATIVE attempt
//     (`_is_native=1`): its callback 303s back to the app's custom scheme carrying
//     `rotating_token_nonce`, which the app absorbs with client.reload({nonce}).
//   - But clerk-js's browser build NEVER sends `_is_native`, and native clients
//     live in a SEPARATE universe addressed by a rotating client-JWT bearer, not
//     cookies. So a hand-rolled `_is_native` fetch forks onto a client clerk-js
//     can't see, and clerk-js's own create can't go native.
//
// Two problems have to be solved together, or the session dies seconds after
// sign-in (the historical "returns to /login and freezes" bug):
//
//   1. Address the native client. Every FAPI request gets `_is_native=1` plus the
//      current client JWT as `Authorization: Bearer …`. This shim is the SOLE
//      authority on that token — it overrides whatever clerk-js would attach.
//
//   2. Follow the ROTATING token. Clerk rotates the client token on every
//      client-scoped response and returns the new one in the `Authorization`
//      RESPONSE header; the old one is immediately spent. We read it off
//      `CapacitorHttp.request()` — a NATIVE, CORS-free transport that surfaces
//      every response header (it does NOT strip `Authorization`;
//      echo-server-verified). Everything else keeps using CapacitorHttp's
//      window.fetch.
//
// ⚠️ Why FAPI must NOT go through any browser fetch (the historical iframe
// approach): browser contexts ALWAYS auto-attach an `Origin` header, and Clerk's
// FAPI now REJECTS requests that carry both `Origin` and `Authorization` with
// HTTP 400 "For security purposes, only one of the 'Origin' and 'Authorization'
// headers should be provided" (device-verified 2026-07-13, API version
// 2025-11-10). With the iframe transport every tokened FAPI call 400'd →
// `Clerk.status === "error"` → clerk-js never loaded → the native app showed
// dead/black auth screens, session-token refresh failed (every org API call
// 401'd), and cold starts always booted signed out. A native request sends no
// `Origin`, so the bearer is accepted — and as a bonus the one response the
// iframe could never read (the `rotating_token_nonce` reload after external-
// browser OAuth, whose rotated token is not CORS-exposed) is now readable too,
// which fixes cold-start persistence after Google/Apple sign-in.
//
// FAPI calls are serialized (a promise chain) so a rotation can't race: each
// request waits for the previous and uses the token it rotated. The persisted
// JWT also restores the session on a cold start (no cookies needed).
//
// Pairs with `standardBrowser: false` on <ClerkProvider> (main.tsx). Install
// BEFORE clerk-js loads (top of main.tsx) so clerk-js captures the wrapped fetch.
// Web is untouched — the shim early-returns off-native.

const STORAGE_KEY = "ps_clerk_native_client_jwt"

// pk_live_<base64("clerk.example.com$")> → "clerk.example.com"
function fapiHostFromPublishableKey(publishableKey: string): string | null {
  const encoded = publishableKey.split("_")[2]
  if (!encoded) return null
  try {
    const host = atob(encoded).replace(/\$$/, "")
    return /^[a-z0-9][a-z0-9.-]*$/i.test(host) ? host : null
  } catch {
    return null
  }
}

let installed = false

export function installNativeClerkTransport(publishableKey: string): void {
  if (installed || !isNativeApp() || typeof window === "undefined") return
  const host = fapiHostFromPublishableKey(publishableKey)
  if (!host) return
  installed = true

  // CapacitorHttp's patched fetch — kept for every NON-FAPI request.
  const capacitorFetch = window.fetch.bind(window)

  let clientJwt: string | null = null
  try {
    clientJwt = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }

  const isFapiRequest = (rawUrl: string): boolean => {
    try {
      const u = new URL(rawUrl, window.location.href)
      return u.host === host && u.pathname.startsWith("/v1/")
    } catch {
      return false
    }
  }

  async function forwardFapi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const inputUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url

    // clerk-js's FapiClient calls fetch(urlString, { method, headers, body }).
    // Normalise so the shim works whichever form is used.
    let method = init?.method
    let body = init?.body
    let headerSource: HeadersInit | undefined = init?.headers
    if (typeof input !== "string" && !(input instanceof URL)) {
      const req = input as Request
      method = method ?? req.method
      headerSource = headerSource ?? req.headers
      if (body == null && req.body) body = await req.clone().text()
    }

    const url = new URL(inputUrl, window.location.href)
    url.searchParams.set("_is_native", "1")

    // The shim owns the client token: attach the latest, or force a fresh client
    // when we have none (never let clerk-js's stale token through).
    const headers = new Headers(headerSource)
    if (clientJwt) headers.set("Authorization", `Bearer ${clientJwt}`)
    else headers.delete("Authorization")
    const headerObj: Record<string, string> = {}
    headers.forEach((value, key) => {
      headerObj[key] = value
    })

    // clerk-js sends form-encoded string bodies; normalise the odd cases so the
    // native layer transmits the exact bytes a browser would have.
    let bodyText: string | undefined
    if (body != null) {
      if (typeof body === "string") bodyText = body
      else if (body instanceof URLSearchParams) bodyText = body.toString()
      else bodyText = String(body)
    }

    // Native, CORS-free HTTP: sends NO `Origin` header (Clerk 400s on
    // Origin+Authorization together) and surfaces EVERY response header,
    // including the rotated `Authorization` the browser would hide on the
    // rotating_token_nonce reload. @capacitor/core is imported lazily to keep it
    // out of the eager web bundle (manualChunks routes @capacitor/* aside).
    const { CapacitorHttp } = await import("@capacitor/core")
    const response = await CapacitorHttp.request({
      url: url.toString(),
      method: method ?? "GET",
      headers: headerObj,
      data: bodyText,
      // Hand back the raw body text — clerk-js does its own JSON parsing.
      responseType: "text",
    })

    // CapacitorHttp header names keep whatever case the platform reports —
    // match case-insensitively.
    const outHeaders = new Headers()
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      if (typeof value === "string") outHeaders.set(key, value)
    }

    // Persist the rotated client token (empty value = client reset / sign-out).
    const returnedJwt = outHeaders.get("authorization")
    if (returnedJwt !== null) {
      clientJwt = returnedJwt || null
      try {
        if (clientJwt) localStorage.setItem(STORAGE_KEY, clientJwt)
        else localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* storage unavailable */
      }
    }

    // Re-materialise as a real Response so clerk-js consumes it exactly as a
    // normal fetch (204/205/304 = no body). CapacitorHttp may hand `data` back
    // as a parsed object on some platforms even with responseType text —
    // re-serialise so the body is always a string.
    const nullBody = response.status === 204 || response.status === 205 || response.status === 304
    const raw = response.data
    const responseText = nullBody || raw == null ? null : typeof raw === "string" ? raw : JSON.stringify(raw)
    return new Response(responseText, {
      status: response.status,
      headers: outHeaders,
    })
  }

  // Serialize FAPI calls: each waits for the previous so it uses the token the
  // previous one rotated (rotating tokens are single-use — concurrency spends
  // them out of order and Clerk reports the client signed out).
  let chain: Promise<unknown> = Promise.resolve()

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const inputUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (!isFapiRequest(inputUrl)) return capacitorFetch(input, init)

    const run = chain.then(() => forwardFapi(input, init))
    // Keep the chain alive regardless of this request's outcome.
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}
