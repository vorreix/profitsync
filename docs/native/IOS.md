# iOS (Capacitor) build — setup & how it works

The native iOS app is the same Capacitor WebView shell as Android, wrapped around
the same Vite build the web uses. It ships the bundle inside the `.ipa`
(`webDir: dist`) — no remote URL — and talks to the deployed backend via the same
API-base fetch rewrite. Everything here mirrors `ANDROID.md`; only the
platform-specific tooling differs.

> **macOS + Xcode only.** iOS apps can only be built on a Mac. This project was
> scaffolded with **Xcode 26.x** and uses **Swift Package Manager** (not
> CocoaPods) — there is no `Podfile`; Capacitor + Firebase are pulled in through
> `ios/App/CapApp-SPM/Package.swift`, which `npx cap sync ios` regenerates. Never
> hand-edit that file.

## One-time setup

1. **Xcode** (16+/26.x) with the iOS platform + a simulator runtime installed
   (Xcode → Settings → Components). Run `xcodebuild -runFirstLaunch` once. A paid
   **Apple Developer Program** membership is needed for device builds, TestFlight,
   and the App Store (not for the simulator).
2. **Env files** (gitignored by the repo's `.env*` rule — every developer creates
   their own; identical in shape to the Android ones):
   - `.env.ios` — used by `--mode ios` (release-ish builds):
     ```
     VITE_API_BASE_URL=https://profitsync.net
     VITE_CLERK_PUBLISHABLE_KEY=pk_live_…   # or pk_test_ against dev
     ```
   - `.env.ios.local` — used by `--mode ios-local` (pointing at a LAN dev server,
     e.g. `http://192.168.x.x:3001`).
   `VITE_API_BASE_URL` is REQUIRED: inside the WebView the app is served from
   `capacitor://localhost`, not the backend origin, so `src/lib/api-base.ts`
   rewrites every `/api/*` fetch to this base. Without it, all API calls dead-end.
   (`.env.ios` is usually a copy of `.env.android` — the two native builds share
   the same backend, Clerk key, and app id.)
3. **Clerk**: the native Apple/Google OAuth flow redirects to the custom scheme
   `com.vorreix.profitsync://oauth-callback` — it must be registered in the Clerk
   dashboard's redirect URLs for the instance you build against, and the Apple
   connection must be enabled (see `APPLE_OAUTH.md`). The scheme is already
   registered in `ios/App/App/Info.plist` (`CFBundleURLTypes`).

## Commands

```bash
npm run build:ios          # tsc + vite build --mode ios (bakes in .env.ios)
npm run cap:sync:ios       # build:ios + copy dist into ios/App/App/public
npm run cap:build:ios      # sync + headless simulator build (scripts/ios-xcodebuild.mjs)
npm run cap:open:ios       # sync + open the project in Xcode (Product ▸ Run to launch)
npm run cap:sync:ios:local # local variant (--mode ios-local against a LAN dev server)
```

**Run in the Simulator from the CLI** (what CI / a smoke test does):

```bash
npm run cap:sync:ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' \
  -derivedDataPath ios/DerivedData \
  -clonedSourcePackagesDirPath ios/DerivedData/SourcePackages build
xcrun simctl boot 'iPhone 17' 2>/dev/null; open -a Simulator
xcrun simctl install booted ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.vorreix.profitsync
```

**Run on a physical device**: open in Xcode (`npm run cap:open:ios`), pick your
device, set **Signing & Capabilities → Team** (your Apple Developer team; Xcode
auto-manages a development provisioning profile), then Product ▸ Run. The first
run requires trusting the developer profile on the device
(Settings → General → VPN & Device Management). Signed release/TestFlight builds
are configured in **native-06** (`SIGNING.md`).

## Branding — app icon & launch screen

The app icon and launch splash are generated from the **shared** brand sources in
`assets/` — the exact same images the Android pipeline consumes, so the two apps
never drift. Never hand-edit the generated PNGs. To regenerate (e.g. after a logo
change):

```bash
node scripts/android-brand-assets.mjs   # rebuilds assets/ from public/logo.png (shared)
node scripts/ios-brand-assets.mjs       # writes the iOS icon + splash from assets/
```

`scripts/ios-brand-assets.mjs` (uses `sharp`) writes:
- `AppIcon.appiconset/AppIcon-512@2x.png` — 1024×1024, **opaque** (flattened on
  white, alpha stripped: iOS rejects icons with an alpha channel). The asset
  catalog uses the modern single "universal" 1024 icon; Xcode downsamples the
  rest at build time.
- `Splash.imageset/splash-2732x2732*.png` — the full lockup centered on white.

The icon uses `assets/icon-only.png` (the P/S mark, no wordmark — a small icon
with the wordmark would be illegible); the splash uses `assets/splash.png` (the
full lockup).

## Push notifications (FCM via APNs)

iOS push uses the **same** `@capacitor-firebase/messaging` plugin and the same
server sender as Android — Firebase wraps APNs, so there are **zero server
changes** and one code path for both platforms. Web push stays on the VAPID
pipeline; the two never mix. As on Android, **everything no-ops safely when
unconfigured**: the app builds, launches, and signs in with **no** Firebase
config present (see *The defensive Firebase config* below), and the server skips
FCM without `FCM_SERVICE_ACCOUNT_JSON`.

One-time setup (needs the Apple Developer portal + Firebase console):

1. **APNs auth key**: Apple Developer → Keys → `+` → tick **Apple Push
   Notifications service (APNs)** → download the `.p8` (once only) and note the
   **Key ID** + your **Team ID**.
2. **Firebase iOS app**: in the same Firebase project used for Android
   (console.firebase.google.com), add an **iOS** app with bundle id
   `com.vorreix.profitsync`. Download **`GoogleService-Info.plist`**.
3. **Place the plist in the app target**: drop `GoogleService-Info.plist` into
   `ios/App/App/` and add it to the **App** target in Xcode (so it lands in the
   bundle — `AppDelegate` looks it up with `Bundle.main.path(forResource:)`). It
   is **gitignored** (the repo's global `GoogleService-Info.plist` rule) — each
   machine that builds a push-enabled app places its own copy, exactly like
   Android's `google-services.json`.
4. **Upload the APNs key to Firebase**: Firebase → Project settings → Cloud
   Messaging → *Apple app configuration* → upload the `.p8` + Key ID + Team ID.
5. **Enable the Push Notifications capability** in Xcode (Signing &
   Capabilities → `+ Capability` → Push Notifications). Background modes →
   *Remote notifications* if you want silent pushes.
6. **Server key**: the same `FCM_SERVICE_ACCOUNT_JSON` Vercel env var already used
   for Android covers iOS — nothing to add.
7. Rebuild + reinstall on a **real device** (the simulator cannot receive remote
   push). In-app: Profile → Notifications → *Enable push notifications* →
   *Send test*.

### The defensive Firebase config (why the app boots with no plist)

The Firebase Messaging plugin calls `FirebaseApp.configure()` the instant it
loads, during Capacitor's plugin registration. Without a bundled
`GoogleService-Info.plist` that call throws and crashes the app **before the
login screen ever appears**. So `AppDelegate.configureFirebaseIfNeeded()` runs
first (in `didFinishLaunchingWithOptions`) and:
- if a real `GoogleService-Info.plist` is in the bundle → `FirebaseApp.configure()`
  (normal path — push works);
- otherwise → configures an **inert placeholder** `FirebaseOptions` (a
  format-valid but access-less API key / app id) so the plugin finds an existing
  `FirebaseApp` and never force-configures.

The placeholder grants access to **nothing** — no real credential ships in the
app. Core features work regardless; push stays dormant until a real plist is
added, at which point Firebase initialises normally with **zero code changes**.

## Sign in with Apple (App Store requirement)

The native Apple button is already wired (`NativeOAuthButton provider="apple"`,
see `APPLE_OAUTH.md`). Two things for the store:
- Enable the **Sign in with Apple** capability in Xcode (Signing &
  Capabilities → `+ Capability`) so App Store review accepts it.
- Apple **requires** any app offering a third-party social login (we offer Google)
  to **also** offer Sign in with Apple (Guideline 4.8). Both ship — do not remove
  the Apple button from the iOS build.

## Shipping an app update (keep the app in sync with the web app)

The app ships a frozen copy of the web bundle — deploying the website does NOT
update installed apps. To cut an updated build:

1. Bump the version: `MARKETING_VERSION` (user-facing, e.g. `1.0.1`) and
   `CURRENT_PROJECT_VERSION` (build number, +1 every upload) in
   `ios/App/App.xcodeproj/project.pbxproj` (or the target's General tab in Xcode).
2. `npm run cap:sync:ios` — rebuilds the web bundle (`--mode ios`) and copies it
   into the shell.
3. Archive + upload in Xcode (Product ▸ Archive → Distribute App) or via
   `xcodebuild -exportArchive` (config in native-06).

The in-app service worker is disabled in the WebView (see below), so there is no
self-update path — rebuilding is the only way, same as Android.

## How the native pieces fit (and what NOT to break)

- **API base rewrite** (`src/lib/api-base.ts`, installed in `main.tsx`): no-ops
  unless `VITE_API_BASE_URL` was baked in at build time — the web build never sets
  it, so web behavior is untouched. It also **refuses a cleartext base URL**
  (https-or-localhost guard) so auth tokens can't leak over http.
- **OAuth deep link**: `NativeOAuthButton` (rendered only when `isNativeApp()`)
  opens the provider page in the Capacitor in-app `Browser` → Apple/Google →
  Clerk redirects to `com.vorreix.profitsync://oauth-callback` → the iOS
  `CFBundleURLTypes` scheme → Capacitor `appUrlOpen` (listener in `App.tsx`) →
  `/sso-callback` → `OAuthCallbackPage` completes the Clerk handshake. Same scheme
  and same code path as Android.
- **Service worker**: `initPwa()` deliberately skips native WebViews
  (`window.Capacitor` check in `src/lib/pwa/register-sw.ts`) — the PWA update
  pipeline would fight the store update model.
- **Bundle hygiene**: `@capacitor/*` lives in its own lazy `native` chunk (vite
  `manualChunks`) and `isNativeApp()` reads the bridge global instead of importing
  `@capacitor/core` — keep it that way so the web bundle stays Capacitor-free. The
  manualChunks graph must stay acyclic (see CLAUDE.md).
- **Generated files are gitignored**: `ios/App/App/public/` (the cap-synced
  bundle), `capacitor.config.json`, `App/build`, `DerivedData`, and
  `GoogleService-Info.plist` are all ignored (`ios/.gitignore` + the root
  `.gitignore`). Only the project shell, `AppDelegate.swift`, `Info.plist`, the
  asset catalog, storyboards, and the SPM manifest are tracked. Never commit the
  synced bundle or a build output.

## What still needs a real device / portal (not blockers to the simulator build)

| Item | Where |
|---|---|
| Sign in with Apple / Google — live sign-in | needs the Clerk + Apple portal setup (`APPLE_OAUTH.md`) |
| Push notifications | needs the APNs `.p8` + `GoogleService-Info.plist` + a real device (above) |
| Release signing, TestFlight, App Store upload | native-06 (`SIGNING.md`) + native-07 (`PUBLISHING.md`) |
