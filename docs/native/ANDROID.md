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

## Branding — launcher icon & splash screen

The launcher icons (all `mipmap-*` densities + adaptive icon) and splash
screens (all `drawable-*` variants, incl. night) are generated from the brand
sources in `assets/` — never hand-edit the generated PNGs. To regenerate
(e.g. after a logo change):

```bash
node scripts/android-brand-assets.mjs   # rebuilds assets/ from public/logo.png
npx @capacitor/assets generate --android \
  --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#ffffff' \
  --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#ffffff'
git checkout android/app/src/main/AndroidManifest.xml  # generator only reformats it
```

The script crops the P/S mark out of the full lockup at high res for the
icon (a launcher icon with the wordmark would be illegible) and centers the
full lockup for the splash. The adaptive icon uses PNG layers
(`@mipmap/ic_launcher_background` + `@mipmap/ic_launcher_foreground`); the
Capacitor template's vector drawables were deleted.

## Push notifications (FCM)

The app's native push channel is **FCM** via `@capacitor-firebase/messaging`
(one FCM token on Android AND iOS — Firebase wraps APNs). Web push stays on the
VAPID pipeline; the two never mix. Everything **no-ops safely when
unconfigured**: the APK builds and runs without `google-services.json`, and the
server skips FCM without its env var — so this setup is optional until you
flip it on.

One-time setup (~10 min, needs `firebase login` / console access):

1. **Firebase project**: console.firebase.google.com → add project (say
   `profitsync-app`). No Blaze upgrade needed — FCM is free on Spark.
2. **Android app**: add an Android app with package
   `com.vorreix.profitsync`, download **`google-services.json`** into
   **`android/credentials/`** (template: `google.services.example.json` in the
   same folder). It's gitignored — each machine that builds release APKs
   places its own copy. The build mirrors it into `android/app/` and
   auto-applies the google-services plugin when it exists; without it the
   app still builds, push is simply off.
3. **Server key**: Project settings → Service accounts → *Generate new private
   key* (a JSON file). Set it on Vercel as **`FCM_SERVICE_ACCOUNT_JSON`**
   (paste raw JSON or base64 of it) for Production (+ Preview if wanted):
   `vercel env add FCM_SERVICE_ACCOUNT_JSON production`.
4. Rebuild + reinstall the app. In-app: Profile → Notifications → *Enable
   push notifications* → *Send test*.
5. **iOS (later)**: in the Apple Developer portal create an APNs key (`.p8`)
   and upload it under Firebase → Project settings → Cloud Messaging. Same
   plugin, same server sender, zero server changes.

How it hangs together: the toggle registers the device token via
`POST /api/notifications/push { channel: "fcm" }` (`src/lib/native-push.ts`);
`api/_lib/push-fcm.ts` sends via FCM HTTP v1 (service-account JWT, no SDK);
notification taps deep-link via the `data.url` payload (listener attached in
`AppLayout`). Token rotation re-registers automatically; dead tokens are pruned
on send. Delivery outcomes appear in `/admin` → Worker (push_events, source
`fcm:*`).

**Bundle note:** `firebase/messaging` (the plugin's web-only optional peer) is
aliased to a stub in `vite.config.ts` — do not install the firebase JS SDK for
this; native push never runs in the browser.

## Shipping an app update (keep the APK in sync with the web app)

The APK ships a frozen copy of the web bundle — deploying the website does
NOT update installed apps. To cut an updated app:

1. Bump `versionCode` (+1, always) and `versionName` in
   `android/app/build.gradle`.
2. `npm run cap:build:android` — rebuilds the web bundle (`--mode android`),
   copies it into the shell (`cap sync`), and assembles the APK.
3. Install/distribute `android/app/build/outputs/apk/debug/app-debug.apk`
   (`adb install -r …` keeps app data).

The in-app service worker is intentionally disabled in the WebView (see
below), so there is no self-update path — rebuilding is the only way.

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
