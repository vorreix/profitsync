# Native OAuth — root cause & the native-mode fix

## Symptom (device-reproduced)
On a physical phone, tapping **Continue with Google**, picking a Gmail account, and
returning to the app lands back on `/login` with **no session** — the sign-in never
completes. Email/password works. Same on iOS.

## Verified root cause (CDP experiments on the device)
Clerk runs two independent **client universes** per instance:

- **standard-browser client** — what clerk-js (running in the Capacitor WebView) owns.
  Identified by cookies in the standard browser; in the WebView third-party cookies to
  `clerk.profitsync.net` are blocked, so clerk-js keeps this client alive via a
  dev-browser JWT.
- **native client** — the one an attempt created with `_is_native=1` is bound to.

Our previous fix created the OAuth attempt via a raw `fetch('/v1/client/sign_ins?_is_native=1')`
(`src/lib/native-oauth.ts`). That `_is_native=1` flag **forks the attempt onto the native
client**, which clerk-js's standard-browser client never sees. So when the deep link
returns and `OAuthCallbackPage` calls `clerk.client.reload({ rotatingTokenNonce })`, it
reloads the **wrong** client — the completed sign-in is on the native client — and the
session is never adopted. Proven by comparing client IDs across 6 CDP runs:
`_is_native=1` attempts always landed on a different `client_…` id than clerk-js's own.

We needed `_is_native` (Google blocks WebView OAuth → the verification finishes in the
system browser, which has no WebView cookie → a "web" attempt's cookie-less callback is
rejected `authorization_invalid` on the **production** instance). But `_is_native` on a
raw fetch forks the client. Dead end for the raw-fetch approach.

## The fix — put clerk-js itself into native mode
Set **`standardBrowser={false}`** on `<ClerkProvider>` for native platforms (Clerk's
documented native pattern, same as Tauri). Then clerk-js's **own** `client` IS the native
client, and `experimental.persistClient` (default `true`) persists the session without
cookies. Now:

1. Create the attempt through clerk-js's own API — `clerk.client.signIn.create({ strategy,
   redirectUrl, actionCompleteRedirectUrl })` / `signUp.create({…})`. Because clerk-js is
   in native mode the attempt is a native attempt on **clerk-js's own client**.
2. Open `verification.externalVerificationRedirectURL` in the system browser (unchanged
   deep-link + `OAuthCallbackPage`).
3. On return, `clerk.client.reload({ rotatingTokenNonce })` reloads the **same** client the
   attempt lives on → `signIn/signUp.status === "complete"` → `setActive` → `/dashboard`.

This also drops the raw-fetch module entirely (`native-oauth.ts` + test): clerk-js's client
API replaces it.

### One-time effect
Switching an installed native app to `standardBrowser:false` changes the client model, so
any currently-signed-in native user is logged out **once** on first launch of the new build
and signs in again. Acceptable; web is unaffected (`standardBrowser` stays `true` on web).

## Status: primary sign-in FIXED (device-verified). Cold-start persistence — KNOWN GAP.
On a physical phone the Google round-trip now completes end-to-end **in-session**: tap
Continue with Google → pick the account in the system browser → deep link back →
`setActive` → land in the app; `getToken` returns a real JWT and authed API calls work.

**But** after a force-close + reopen the session is lost and the user must sign in again.

### Persistence — verified root cause (CDP experiments on the device)
The native client is addressed by a **rotating client JWT** the transport shim
(`native-clerk-transport.ts`) persists to `localStorage`. It captures each rotation by
reading the `Authorization` **response** header off a real-browser fetch (a hidden iframe),
which Clerk CORS-exposes on ordinary FAPI responses. The gap is the single most important
request:

- `client.reload({ rotatingTokenNonce })` (GET `/v1/client?rotating_token_nonce=…`) adopts
  the browser-completed session onto the client **and rotates its token server-side**, but
  its response does **NOT** carry a CORS-readable `Authorization` header (unlike plain GETs;
  device-verified — the iframe reads `authHeader: ABSENT` on the nonce reload while it reads
  the rotated token fine on every other GET).
- So the shim is left holding the **spent** pre-nonce token. The next client-scoped call
  (`setActive`'s session touch) 401s, but `setActive` keeps the session in memory, so the
  app is fine for the life of this instance. A **cold start** boots clerk-js on the dead
  token → Clerk mints a fresh empty client → signed out.
- There is **no safe post-hoc recovery**: a follow-up plain `GET /v1/client` with the spent
  token rotates to a **new EMPTY client** and abandons the session-bearing one
  (device-verified — an earlier "refresh the token" `client.reload()` did exactly this and
  made it worse; it has been removed).

### The pending fix (needs one live-device sign-in to verify)
Read that one nonce-reload response through a **native, CORS-free transport**. Verified
transport facts from the device:

- `CapacitorHttp.request()` does **NOT** strip the `Authorization` response header — proven
  against an echo server (`GET …/response-headers?Authorization=Bearer%20PROBE123` came back
  with `authorization: "Bearer PROBE123"`). The prior "CapacitorHttp strips Authorization"
  belief was a case-sensitivity bug in the probe (`h["Authorization"]` vs `h["authorization"]`)
  plus an empty-client confound (a signed-out client has no token to rotate).
- CapacitorHttp is native HTTP with **no CORS**, so it can read `Authorization` on responses
  the browser (iframe) hides — exactly the nonce reload.

Plan: route the `rotating_token_nonce` reload (only) through `CapacitorHttp.request()` with
the current bearer token, capture the rotated `Authorization`, and persist it as the durable
client JWT. Guard against Clerk switching to cookie-mode (send no cookies / ignore
`Set-Cookie`; the `_cfuvid` cookie observed is Cloudflare's, not Clerk's `__client`).
**Not shipped yet** because verifying it requires a fresh Google sign-in on the device (the
empty-client confound makes it un-testable otherwise) and the change touches the auth token
path — shipping it unverified risks regressing the working in-session flow.

To verify when at the device: install this build, sign in with Google, **force-close**, reopen
→ should land already signed in. Logcat filter `[ProfitSync Native Auth]`.

## Changes
- `src/main.tsx` — `<ClerkProvider standardBrowser={!isNativeApp()}>`; install the native
  transport shim before clerk-js loads.
- `src/lib/native-clerk-transport.ts` — **new.** Native FAPI transport: forces `_is_native=1`,
  owns + follows the rotating client JWT (persisted to `localStorage`), routes FAPI through a
  hidden-iframe real-browser fetch so Clerk's CORS-exposed `Authorization` is readable. Header
  comment documents the cold-start persistence gap + the CapacitorHttp fix path.
- `src/lib/use-native-oauth-intercept.ts` — create the attempt via clerk-js
  `signIn/signUp.create`; read `externalVerificationRedirectURL`. Types moved here.
- `src/lib/native-auth.ts` (+ test) — shared native helpers (`isNativeApp`, `nativeAuthLog`,
  redirect URL). Replaces the deleted raw-fetch module's home for these.
- `src/lib/native-oauth.ts` + `src/lib/native-oauth.test.ts` — **deleted** (raw-fetch
  workaround obsolete).
- `src/pages/OAuthCallbackPage.tsx` — absorb the nonce, resolve the client state explicitly
  (complete / transfer sign-in↔sign-up / client-session), `setActive`, SOFT-navigate in.
  Does **not** do a second `client.reload()` (that abandons the session-bearing client).
- Comment touch-ups in `LoginPage.tsx` / `SignupPage.tsx` that referenced the deleted file.

## Verify
- [x] Device: Google round-trip with `shammamaqbool.t@gmail.com` → completes in-session,
  `getToken` returns a real JWT, authed API works (lands on `/onboarding` for a new user).
- [ ] Device: email/password sign-in still works in native mode. *(unchanged path; not
  re-run this pass — email/password never touched the native OAuth transport)*
- [ ] Device: session persists across an app restart — **KNOWN GAP**, root cause + fix
  documented above; not yet fixed (needs a live-device verification of the CapacitorHttp path).
- [ ] Web: Google/email sign-in unaffected (`standardBrowser` stays `true` — the shim and the
  intercept both early-return off-native, so web is structurally untouched).
- [x] `cap:sync:android` + `cap:sync:ios` — see task summary for run status.
- [x] Pre-commit gate green (lint + typecheck + tests).

## Branch
`fix/native-oauth-native-mode-maqbool` (off `dev`).
