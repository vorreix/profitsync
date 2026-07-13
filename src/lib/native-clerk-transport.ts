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
//      RESPONSE header; the old one is immediately spent. We read it off a REAL
//      browser fetch — a hidden same-origin iframe's `contentWindow.fetch`, which
//      CapacitorHttp (enabled in capacitor.config.ts) never patched — where
//      Clerk's CORS `access-control-expose-headers: Authorization` makes the
//      rotated token readable on ordinary FAPI responses. Everything else keeps
//      using CapacitorHttp's window.fetch.
//
// FAPI calls are serialized (a promise chain) so a rotation can't race: each
// request waits for the previous and uses the token it rotated. The persisted
// JWT also restores the session on a cold start (no cookies needed).
//
// ⚠️ KNOWN GAP — cold-start persistence after external-browser OAuth. The one
// request that adopts the browser-completed session — `client.reload({
// rotatingTokenNonce })` (GET /v1/client?rotating_token_nonce=…) — rotates the
// client token server-side but comes back WITHOUT a CORS-readable `Authorization`
// header (unlike plain GETs, Clerk does not expose it via CORS on that response,
// device-verified). So the iframe can't capture the token that reload rotates to;
// the shim keeps the spent pre-nonce token. The in-memory session is fine for the
// life of this app instance (setActive holds it), but a COLD START boots on the
// dead token → a fresh empty client → signed out. There is no safe post-hoc
// recovery: a second GET with the spent token just rotates to a NEW empty client
// (device-verified). The fix is to read THAT one response through a native,
// CORS-free transport — `CapacitorHttp.request()` does NOT strip `Authorization`
// (echo-server-verified), so it can surface the rotated token the CORS-bound
// iframe cannot. Pending a live-device sign-in to verify. See
// docs/native-oauth/PLAN.md.
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

  // Real browser fetch via a hidden same-origin iframe. CapacitorHttp only
  // patches the TOP window at bridge init, so a freshly created iframe's `fetch`
  // is the untouched native implementation whose Response surfaces the
  // CORS-exposed `Authorization` header (the rotated client token).
  //
  // ⚠️ A FRESH iframe per call — never a persistent one. The app backgrounds for
  // ~35s during the external-browser OAuth hop, and the WebView freezes/discards
  // a long-lived hidden iframe's realm. Reusing it, its `contentWindow` stays
  // truthy but its `fetch` silently stops surfacing response headers — so the
  // FIRST call after returning (the rotating_token_nonce reload, the single most
  // important one) drops the rotated token, leaving the shim on a stale client
  // for the rest of the session and after every cold start. A per-call iframe is
  // created after we're back in the foreground, so it's always a live realm.
  // FAPI traffic is a handful of calls plus infrequent polls — the cost is nil.
  function createNativeFrame(): HTMLIFrameElement {
    const el = document.createElement("iframe")
    el.setAttribute("aria-hidden", "true")
    el.style.display = "none"
    ;(document.body ?? document.documentElement).appendChild(el)
    return el
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
    // Plain object so it crosses cleanly into the iframe realm.
    const headerObj: Record<string, string> = {}
    headers.forEach((value, key) => {
      headerObj[key] = value
    })

    // Fresh iframe per call; keep it in the DOM until BOTH the headers and the
    // body have been read (its realm owns the response stream), then remove it.
    const frame = createNativeFrame()
    try {
      const response = await frame.contentWindow!.fetch(url.toString(), {
        method,
        headers: headerObj,
        body: body as BodyInit | null | undefined,
        // Native client is cookie-less — the bearer is the identity.
        credentials: "omit",
      })

      // Persist the rotated client token (empty value = client reset / sign-out).
      const returnedJwt = response.headers.get("Authorization")
      if (returnedJwt !== null) {
        clientJwt = returnedJwt || null
        try {
          if (clientJwt) localStorage.setItem(STORAGE_KEY, clientJwt)
          else localStorage.removeItem(STORAGE_KEY)
        } catch {
          /* storage unavailable */
        }
      }

      // Re-materialise the cross-realm response as a same-realm Response so
      // clerk-js consumes it exactly as a normal fetch (204/205/304 = no body).
      const nullBody = response.status === 204 || response.status === 205 || response.status === 304
      const bodyText = nullBody ? null : await response.text()

      const outHeaders = new Headers()
      response.headers.forEach((value, key) => {
        outHeaders.set(key, value)
      })
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      })
    } finally {
      frame.remove()
    }
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
