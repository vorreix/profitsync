# Native Google Sign-In setup (fixes the auto-logout)

This replaces the external-browser Google OAuth on Android/iOS with **native Google
Sign-In → Clerk `google_one_tap`**. It is the definitive fix for "the app logs me
out every time I reopen it" and the related "API call interruptions".

**You do NOT need to touch any code.** Everything in the app is done (branch
`fix/native-reliability-maqbool`). What remains is ~10 minutes of console config
that only you can do (it requires Google Cloud / Firebase / Clerk dashboard access).
Do the steps below, then run one build command and test.

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

## What you configure (the aud must match)

The native SDK mints a **Google ID token** whose `aud` = the **Web OAuth client ID**.
Clerk only accepts the token if its Google connection is configured with **that same
Web client ID**. So the whole job is: create the Google client, then point Clerk at it.

```
Android/iOS device ──(native picker)──► Google ID token (aud = WEB client id)
                                              │
                                              ▼
                       clerk.authenticateWithGoogleOneTap({ token })
                                              │  Clerk verifies aud == configured client id
                                              ▼
                                   session set + rotated token returned ✓
```

---

## Step 1 — Firebase: enable Google sign-in (project `profitsync-net`)

1. https://console.firebase.google.com → project **profitsync-net** → **Authentication**
   → **Sign-in method** → **Add new provider** → **Google** → **Enable** → pick a
   support email → **Save**.
   (This auto-creates a **Web** OAuth client + an **Android** OAuth client in the
   underlying Google Cloud project.)

## Step 2 — Firebase: register the app signing fingerprints (SHA-1)

Firebase → **Project settings** → **Your apps** → the Android app
**`com.vorreix.profitsync`** → **Add fingerprint**. Add **both**:

| Build | SHA-1 | Where from |
|---|---|---|
| **Debug** (the test APK below) | `88:86:2B:67:63:DF:18:D3:DA:19:78:C7:64:2F:0D:88:29:34:23:43` | your `~/.android/debug.keystore` (already computed) |
| **Production** (Play store) | *(your Play app-signing SHA-1)* | Play Console → your app → **App integrity** → **App signing** → **App signing key certificate → SHA-1** |

> Without the matching SHA-1, native Google Sign-In fails on-device with
> `DEVELOPER_ERROR (code 10)`.

## Step 3 — Firebase: download the updated `google-services.json`

Firebase → **Project settings** → the Android app → **Download google-services.json**.
Put it at:

```
android/credentials/google-services.json      ← replace the existing one
```

(The Gradle build mirrors it into `android/app/` automatically — both are gitignored.)
**Verify** it now contains a non-empty `oauth_client` array with a `client_type: 3`
(web) entry — that's what generates the `default_web_client_id` the plugin needs:

```bash
node -e "const g=require('./android/credentials/google-services.json'); console.log(g.client[0].oauth_client.map(o=>o.client_type))"
# expect something like: [ 3, 1 ]   (3 = web, 1 = android)   NOT []
```

## Step 4 — Get the Web client ID + secret

https://console.cloud.google.com → make sure the project is **profitsync-net** →
**APIs & Services** → **Credentials** → under **OAuth 2.0 Client IDs** open
**"Web client (auto created by Google Service)"**. Copy the **Client ID** (ends in
`.apps.googleusercontent.com`) and **Client secret**.

## Step 5 — Clerk: point the Google connection at that Web client

In the Clerk Dashboard for the **production** instance (`clerk.profitsync.net` — the
device build targets prod; repeat on the **dev** instance too if you also test a
`--mode android-local` build):

1. **User & Authentication → SSO Connections → Google** (enable it if not already).
2. Turn **"Use custom credentials"** ON.
3. **Client ID** = the **Web** client ID from Step 4.
   **Client Secret** = the secret from Step 4.
4. Ensure Google One Tap is allowed for the instance (Clerk enables it with the
   Google connection + custom credentials; there is no separate key to paste).
5. **Save.**

> The Client ID here **must equal** the token's `aud` (the Web client ID). A mismatch
> is the #1 failure — Clerk rejects the token with an "invalid token / one_tap" error.

## Step 6 (iOS only — do when you build for iOS)

1. Firebase → add/download **`GoogleService-Info.plist`** for the iOS app
   (`com.vorreix.profitsync`) → place at `ios/App/App/GoogleService-Info.plist`
   (likely already present for push).
2. In Xcode → target **App** → **Info** → **URL Types** → add a URL scheme equal to
   the plist's **`REVERSED_CLIENT_ID`** (needed by Google Sign-In on iOS).
3. `npm run cap:sync:ios` already added the FirebaseAuthentication SPM package; Xcode
   resolves FirebaseAuth on the next build.

---

## Build, install, test (Android)

```bash
# 1. Sync the current bundle into the native shell (already run on this branch,
#    but re-run after you drop in the new google-services.json):
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
| Gradle: `cannot find symbol R.string.default_web_client_id` | `google-services.json` has no **web** client | Do Steps 1–3; confirm `client_type: 3` exists |
| On-device `DEVELOPER_ERROR` / code `10` | app's SHA-1 not registered | Add the debug **and** Play SHA-1 (Step 2) |
| Clerk rejects the token (`one_tap` / invalid token) | `aud` ≠ Clerk's Google Client ID | Client ID in Clerk (Step 5) must be the **Web** client ID (Step 4) |
| Picker opens then nothing happens | you configured the **dev** Clerk but the build targets **prod** (or vice-versa) | configure the instance `.env.android` points to (prod = pk_live) |

Apple Sign-In still uses the old external-browser flow (iOS-only in practice; the
primary account is Google). Native Apple ID-token sign-in is a documented follow-up.
