# Android (Capacitor) build — setup & how it works

The native Android app is a Capacitor WebView shell around the same Vite build
the web uses. It ships the bundle inside the APK (`webDir: dist`) — no remote
URL — and talks to the deployed backend via an API-base fetch rewrite.

## One-time setup

1. **Android SDK** (min 24, target/compile 36) + JDK 17+. Set `ANDROID_HOME`
   (macOS default: `~/Library/Android/sdk`).
2. **Env files** (gitignored by the repo's `.env*` rule — every developer
   creates their own):
   - `.env.android` — used by `--mode android` (release-ish builds):
     ```
     VITE_API_BASE_URL=https://profitsync.net
     VITE_CLERK_PUBLISHABLE_KEY=pk_live_…   # or pk_test_ against dev
     ```
   - `.env.android.local` — used by `--mode android-local` (pointing at a LAN
     dev server, e.g. `http://192.168.x.x:3001`).
   `VITE_API_BASE_URL` is REQUIRED: inside the WebView the app is not served
   from the backend origin, so `src/lib/api-base.ts` rewrites every `/api/*`
   fetch to this base. Without it, all API calls dead-end.
3. **Clerk**: the native Google OAuth flow redirects to the custom scheme
   `com.vorreix.profitsync://oauth-callback` — it must be registered in the
   Clerk dashboard's redirect URLs for the instance you build against.

## Commands (cross-platform)

```bash
npm run build:android          # tsc + vite build --mode android
npm run cap:sync:android       # build + copy dist into android/
npm run cap:build:android      # sync + gradle assembleDebug (scripts/android-gradle.mjs
                               # picks gradlew/.bat per platform)
npm run cap:open:android       # open in Android Studio
```

Debug APK output: `android/app/build/outputs/apk/debug/app-debug.apk`
(unsigned — install for testing via `adb install`). Release signing is NOT
configured yet; set up a keystore + `signingConfigs` before any store upload.

## How the native pieces fit (and what NOT to break)

- **API base rewrite** (`src/lib/api-base.ts`, installed in `main.tsx`): no-ops
  unless `VITE_API_BASE_URL` was baked in at build time — the web build never
  sets it, so web behavior is untouched.
- **OAuth deep link**: `NativeGoogleAuthButton` (Android-only) opens the system
  browser → Google → Clerk redirects to the custom scheme → Android intent
  filter → Capacitor `appUrlOpen` (listener in `App.tsx`, installed only when
  `isNativeAndroid()`) → `/sso-callback` → `OAuthCallbackPage` completes the
  Clerk handshake.
- **Service worker**: `initPwa()` deliberately skips native WebViews
  (`window.Capacitor` check in `src/lib/pwa/register-sw.ts`) — the PWA update
  pipeline would fight the store update model.
- **Bundle hygiene**: `@capacitor/*` lives in its own lazy `native` chunk
  (vite `manualChunks`) and `isNativeAndroid()` reads the bridge global instead
  of importing `@capacitor/core` — keep it that way so the web bundle stays
  capacitor-free. The manualChunks graph must stay acyclic (see CLAUDE.md).
- **Server auth diagnostics**: `AUTH_DEBUG=1` (Vercel env) turns on per-request
  token diagnostics in `api/_lib/auth.ts` for debugging native token issues —
  leave it OFF normally (it logs every request).
