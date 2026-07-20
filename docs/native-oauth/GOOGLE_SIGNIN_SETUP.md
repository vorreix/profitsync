# Native Google Sign-In setup (fixes the auto-logout)

This replaces the external-browser Google OAuth on Android/iOS with **native Google
Sign-In → Clerk `google_one_tap`**. It is the definitive fix for "the app logs me
out every time I reopen it" and the related "API call interruptions".

> **Project move (2026-07-18):** the original Firebase project `profitsync-net` was
> **deleted**. Everything now lives on **`profitsync-app`** (project number
> `622629171265`, org `547785823382`). Steps 1–3 below were re-done against it
> programmatically (CLI/MCP) — they are marked **DONE**. What remains is the
> **Clerk dashboard** part (Steps 4–5) and the **Play App Signing SHA-1**.

**You do NOT need to touch any code.** Everything in the app is done (branch
`fix/native-reliability-maqbool`). Auth stays on Clerk — Firebase is only the
source of the Google ID token (and of FCM push).

---

## Why this fixes the logout (one paragraph)

The old flow finished with `client.reload({ rotating_token_nonce })`. On Clerk's
current API that reload attaches the session **and** rotates the client's token
server-side, but returns the replacement through **no channel the app can read**.
The app kept a **spent** token → the next authed request 401'd → clerk-js signed
out → every cold start booted signed-out. Native Google Sign-In avoids the reload
entirely: `authenticateWithGoogleOneTap({ token })` is an ordinary client write, so
Clerk returns the rotated token in the `Authorization` response header exactly like
every other write, and the app persists it. No nonce, no browser, no gap.

---

## How the native flow works (ticket exchange — 2026-07-18)

The native SDK mints a **Google ID token** whose `aud` = the **Web OAuth client ID**
but whose `azp` = the platform (Android/iOS) client. Clerk's `google_one_tap`
strategy rejects any token whose azp isn't the configured Web client
(`403 authorization_invalid`, device-proven — that check cannot be satisfied by
an Android-minted token). So the app does a **server-side ticket exchange**
instead — Clerk's Google connection is not involved in the native path at all:

```
Android/iOS device ──(native picker)──► Google ID token (aud = WEB client id)
                │
                ▼  POST /api/public/native-google-auth  { token }
   our API verifies via Google tokeninfo (aud == WEB client id, email_verified)
                │  find-or-create Clerk user by verified email (Backend API)
                ▼
        60-second Clerk sign-in ticket ──► signIn.create({ strategy: "ticket" })
                                              │  ordinary client write
                                              ▼
                                   session set + rotated token returned ✓
```

The Clerk **custom credentials** (Steps 4–5) are still required — for **web**
Google login on profitsync.net (normal OAuth redirect flow), and they keep the
web/native accounts unified by verified email.

For project `profitsync-app` the generated clients are:

| Client | ID |
|---|---|
| **Web** (→ the token `aud`, goes into Clerk) | `622629171265-u02534555bnc0fpkp5hjk6dp3ei9a9jg.apps.googleusercontent.com` |
| Android (`com.vorreix.profitsync`, debug SHA-1) | `622629171265-gn1uakrvmsoq1l4lddiosjhqceve4guq.apps.googleusercontent.com` |
| iOS (`com.vorreix.profitsync`) | `622629171265-8ip18d5nl51005n90qn4kofsv7ppmfh6.apps.googleusercontent.com` |

## Step 1 — Firebase: enable Google sign-in — ✅ DONE

Google (and email/password) providers are enabled on **`profitsync-app`** via
`firebase deploy --only auth` (config in the repo-root `firebase.json`). This
auto-created the Web + Android OAuth clients above in the underlying Google
Cloud project.

## Step 2 — Firebase: register the app signing fingerprints (SHA-1) — ✅ ALL DONE

| Build | SHA-1 | Status |
|---|---|---|
| **Debug** (local APKs) | `88:86:2B:67:63:DF:18:D3:DA:19:78:C7:64:2F:0D:88:29:34:23:43` | ✅ registered (SHA-256 too) |
| **Upload key** (locally built release APKs) | `FE:9C:D3:4A:5D:41:7F:26:4F:B5:68:5F:2F:54:62:43:55:63:B0:6F` | ✅ registered (SHA-256 too) |
| **Play App signing** (store-delivered builds) | `D4:69:B8:CF:CB:AB:4D:75:21:43:69:FA:51:8C:06:0A:B8:80:6C:DC` | ✅ registered (SHA-256 too) |

> Historical gotcha (2026-07-18): the Play SHA-1 initially failed with
> `409 ALREADY_EXISTS: OAuth client already exists in a different project` — a
> package+SHA-1 pair belongs to ONE Google Cloud project globally, and the
> deleted `profitsync-net` still claimed it (deleted projects hold claims until
> purged, ~30 days). Fixed by restoring `profitsync-net` from
> cloud-resource-manager → Resources pending deletion, deleting its Android
> OAuth client, re-adding here. If it recurs for a new fingerprint, that's the
> playbook. Without a matching SHA-1, native Google Sign-In fails on-device
> with `DEVELOPER_ERROR (code 10)`.

## Step 3 — `google-services.json` — ✅ DONE

The fresh config for `profitsync-app` is at `android/credentials/google-services.json`
(mirrored into `android/app/` by the build; both gitignored) and contains the
required `client_type: 3` (web) + `client_type: 1` (android) entries. The iOS
`GoogleService-Info.plist` is likewise placed at `ios/App/App/GoogleService-Info.plist`.
To re-fetch on another machine:

```bash
npx -y firebase-tools@latest apps:sdkconfig ANDROID 1:622629171265:android:edd7cd2f7b1b0bcfebd6c0
npx -y firebase-tools@latest apps:sdkconfig IOS 1:622629171265:ios:7aaa9d5a25608798ebd6c0
```

## Step 4 — Get the Web client secret — ❌ YOU (console-only)

https://console.cloud.google.com → project **`profitsync-app`** →
**APIs & Services** → **Credentials** → under **OAuth 2.0 Client IDs** open the
**Web client**. The **Client ID** is the one in the table above; copy the
**Client secret** (the secret is not retrievable via CLI).

## Step 5 — Clerk: point the Google connection at that Web client — ❌ YOU

In the Clerk Dashboard for the **production** instance (`clerk.profitsync.net` — the
device build targets prod; repeat on the **dev** instance too if you also test a
`--mode android-local` build):

1. **User & Authentication → SSO Connections → Google** (enable it if not already).
2. Turn **"Use custom credentials"** ON.
3. **Client ID** = `622629171265-u02534555bnc0fpkp5hjk6dp3ei9a9jg.apps.googleusercontent.com`
   **Client Secret** = the secret from Step 4.
4. Ensure Google One Tap is allowed for the instance (Clerk enables it with the
   Google connection + custom credentials; there is no separate key to paste).
5. **Save.**

> ⚠️ If Clerk still holds the old `profitsync-net` client (`568589293730-…`), native
> Google Sign-In is **broken right now** — the new tokens' `aud` won't match until
> you paste the new Web client ID. The Client ID here **must equal** the token's
> `aud`. A mismatch is the #1 failure — Clerk rejects the token with an
> "invalid token / one_tap" error.

## Step 6 (iOS only — do when you build for iOS)

1. `GoogleService-Info.plist` for `com.vorreix.profitsync` must exist at
   `ios/App/App/GoogleService-Info.plist` (gitignored, machine-local — like
   Android's `google-services.json`). An **"Embed GoogleService-Info.plist"**
   run-script build phase copies it into the app bundle at build time when
   present (and only warns when absent, so plist-less machines still build).
   ⚠️ It is deliberately NOT in Copy Bundle Resources — a gitignored file there
   fails the build on any machine without it. **Never assume "the file is in the
   folder" means "the file is in the app"**: the v1 TestFlight build shipped
   with the plist on disk but not embedded, so the app booted on the inert
   Firebase placeholder and `signInWithGoogle()` **hung forever with no error**
   (simulator-proven 2026-07-20) — and the stuck `busy` latch then swallowed
   Apple taps too (now watchdogged in `use-native-oauth-intercept.ts`).
2. The plist's **`REVERSED_CLIENT_ID`** URL scheme
   (`com.googleusercontent.apps.622629171265-8ip18d5nl51005n90qn4kofsv7ppmfh6`)
   is committed in `Info.plist` under `CFBundleURLTypes` — the GIDSignIn round
   trip cannot return to the app without it. If the iOS OAuth client is ever
   regenerated, update it.
3. `npm run cap:sync:ios` already added the FirebaseAuthentication SPM package; Xcode
   resolves FirebaseAuth on the next build.
4. **iOS tokens have `aud` = the IOS client id** (not the Web client like
   Android's Credential Manager): `api/_routes/public/native-google-auth.ts`
   accepts both ids in `GOOGLE_CLIENT_IDS`. If the iOS OAuth client changes,
   update that set.
5. clerk-js validates every redirect — including its own card step navigation —
   against an http/https protocol allowlist, and the iOS WebView origin is
   `capacitor://localhost` (Android's is `https://localhost`). Without
   `allowedRedirectProtocols` on `<ClerkProvider>` (main.tsx) every email
   sign-in/sign-up submit on iOS logs `Clerk: "capacitor:" is not a valid
   protocol` and hard-redirects to `/` — perceived as "the page just reloads".
   Don't remove that prop.

---

## Build, install, test (Android)

```bash
# 1. Sync the current bundle into the native shell (re-run after any
#    google-services.json change):
npm run cap:sync:android

# 2. Build + install the debug APK on the connected phone:
cd android && ./gradlew assembleDebug && cd ..
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop com.vorreix.profitsync
adb shell monkey -p com.vorreix.profitsync -c android.intent.category.LAUNCHER 1
```

> The debug APK is **debug-signed** — if a Play-signed build is already installed,
> `adb uninstall com.vorreix.profitsync` first (Android refuses cross-signature
> replace).

### Verification checklist (this is the actual bug being fixed)

1. Tap **Continue with Google** → the **native account picker** appears (no Chrome
   tab) → pick `shammamaqbool.t@gmail.com` → lands on **/dashboard**. ✅
2. **Force-close the app** (swipe from recents) and **reopen** → you are **still
   signed in**, straight to the dashboard. ✅ ← the fix
3. Create a transaction / open clients repeatedly → **no random "failed" toasts / no
   sign-out** (the spent-token 401s are gone). ✅

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Gradle: `cannot find symbol R.string.default_web_client_id` | `google-services.json` has no **web** client | Re-fetch (Step 3); confirm `client_type: 3` exists |
| On-device `DEVELOPER_ERROR` / code `10` | app's SHA-1 not registered | Add the debug **and** Play SHA-1 (Step 2) |
| Clerk rejects the token (`one_tap` / invalid token) | `aud` ≠ Clerk's Google Client ID | Client ID in Clerk (Step 5) must be the **Web** client ID — check it's not the deleted project's `568589293730-…` one |
| Picker opens then nothing happens | you configured the **dev** Clerk but the build targets **prod** (or vice-versa) | configure the instance `.env.android` points to (prod = pk_live) |
| iOS: Google tap does NOTHING (no picker, no error) — and Apple goes dead after | `GoogleService-Info.plist` not **embedded** in the app bundle → inert Firebase → `signInWithGoogle()` never resolves; the hung flow latched `busy` (pre-watchdog) | Verify the "Embed GoogleService-Info.plist" build phase ran (`ls` the plist inside the built `App.app`); Step 6 above |
| iOS: email sign-in/sign-up "just reloads the page" | clerk-js rejects the `capacitor:` origin protocol on its step navigation and redirects to `/` | keep `allowedRedirectProtocols` on `<ClerkProvider>` (Step 6.5) |
| iOS: server exchange 401 "Invalid Google token" | iOS tokens carry `aud` = IOS client id | that id must be in `GOOGLE_CLIENT_IDS` (native-google-auth.ts) |

Apple Sign-In still uses the old external-browser flow (iOS-only in practice; the
primary account is Google). Native Apple ID-token sign-in is a documented follow-up.
