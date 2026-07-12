# Native apps (Android + iOS) — login-first, native-smooth, publishable

Status: **in progress** · Started 2026-07-12 · Chain root: `feat/native-00-plan-maqbool`
(stacked off `dev`)

This is the **single source of truth** and the living tracker for turning ProfitSync's
Capacitor wrapper into two **publishable, native-smooth** apps (Android + iOS) that boot
straight into the product (no marketing landing), sign in with Google **and Apple**, and
ship with proper **production** credentials — while keeping every real secret on the
server, never in the app bundle.

## The mission (locked with the user, 2026-07-12)

1. **The app starts at the login page.** No marketing/landing inside the app — PWA,
   Android, and iOS all boot into the core product (login when signed out, dashboard when
   signed in). The web browser keeps serving the marketing landing at `/`.
2. **The UI must feel exactly as smooth as a native mobile app.** Status-bar theming,
   safe areas, keyboard handling, haptics, hardware-back, and native page transitions.
3. **Apple OAuth** (an Apple Developer account now exists) — Sign in with Apple, on web
   and native, mirroring the existing native Google flow.
4. **Ship a proper Android app, then mirror the approach for iOS.** Build both to a
   publishable state, then **publish both** to the Play Store and App Store.
5. **The user has never tested or published a mobile app** → this initiative ships
   step-by-step publishing docs (`docs/native/PUBLISHING.md`, `SIGNING.md`, `iOS.md`).
6. **Production credentials for prod; no secrets baked into the app.** Only
   public-by-necessity values live in the bundle; the server (Vercel env) holds every
   real secret. See *Credential model* below.

## Working conventions (apply to every branch)

- **Stacked branches off `dev`.** Each branch is one task, chained from the previous.
  Naming: `feat/native-<NN>-<slug>-maqbool` (sequence number + `maqbool` last).
- **Nothing is merged by the agent.** Branches are pushed; PRs land in order. `dev`/`main`
  are never pushed directly (see memory `never-push-dev-directly`).
- **The full pre-commit gate must pass before every push** (secret-scan → check-esm-extensions
  → boot-functions → route-guards → i18n:check → lint → typecheck → test:ci). No `--no-verify`.
- **Bundle discipline (non-negotiable).** `@capacitor/*` and `@capacitor-firebase/*` load
  **only** in the lazy `native` chunk (vite `manualChunks`), via **dynamic import inside a
  function that first checks `isNativeApp()`**. Platform detection reads the
  `window.Capacitor` bridge global — it never statically imports `@capacitor/core` — so the
  web bundle stays Capacitor-free. The manualChunks graph must stay **acyclic** (CLAUDE.md).
- **In-app delivery/UX never depends on push.** Everything native no-ops gracefully on the
  web and in an unconfigured build.
- **Mobile-first + i18n.** New user-facing strings go through `useTranslation()` and are
  translated to all 8 locales (`en it de hi ta te ml ar`); `/admin` stays English-only.
- **One custom URL scheme across platforms:** `com.vorreix.profitsync://oauth-callback`
  (already registered in the Android manifest; iOS registers the same scheme in Info.plist).
  `toInternalOAuthCallbackPath` already parses it platform-agnostically.

## Architecture recap (how the native app already works)

- Capacitor 8 wraps the **same Vite build** the web uses (`webDir: dist`); the WebView loads
  the bundled `index.html` at `/`, so React Router boots at `/`.
- The web bundle is API-origin-agnostic: `src/lib/api-base.ts` rewrites every `/api/*` fetch
  to the absolute `VITE_API_BASE_URL` baked in at build time (native only), and **refuses to
  ship a cleartext base URL** (https-or-localhost guard). The web build never sets it.
- Native env is Vite **mode**-based: `--mode android` → `.env.android` (prod: `pk_live`,
  `https://profitsync.net`), `--mode android-local` → `.env.android.local` (dev: `pk_test`,
  `http://127.0.0.1:3001`). iOS mirrors this with `--mode ios` / `--mode ios-local`.
- Native Google OAuth: `signIn.create({ strategy:"oauth_google", redirectUrl: <scheme>,
  actionCompleteRedirectUrl })` → open `externalVerificationRedirectURL` in the Capacitor
  in-app `Browser` → provider auth → redirect to the custom scheme → `App.appUrlOpen`
  listener → `/sso-callback` → `OAuthCallbackPage` runs `clerk.handleRedirectCallback`.
- Push: `@capacitor-firebase/messaging` (one FCM token on Android **and** iOS — Firebase
  wraps APNs); server sender `api/_lib/push-fcm.ts` (HTTP v1, no SDK). Web push stays VAPID.
- Reminders: phone-local via `@capacitor/local-notifications` (see notification-system V6).
- Service worker is **disabled in the WebView** (`initPwa()` bails on `window.Capacitor`) —
  store updates replace the bundle; there is no in-app SW update path.

## Credential model (server holds secrets; app ships only public values)

| Value | Nature | Lives where |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` (`pk_live_…`) | **Public** (browser key) | `.env.android` / `.env.ios` → baked into bundle |
| `VITE_VAPID_PUBLIC_KEY` | **Public** | build env → bundle |
| `VITE_API_BASE_URL` (`https://profitsync.net`) | **Public** | build env → bundle |
| `google-services.json` / `GoogleService-Info.plist` | Config (public Firebase API key) | `android/credentials/` · `ios/App/App/` — **gitignored**, per-machine |
| `CLERK_SECRET_KEY` | **Secret** | Vercel env only |
| `VAPID_PRIVATE_KEY` | **Secret** | Vercel env only |
| `FCM_SERVICE_ACCOUNT_JSON` | **Secret** | Vercel env only |
| Apple **Sign in with Apple** signing key (`.p8`) | **Secret** | Clerk dashboard (Clerk mints the client-secret JWT) — never in app |
| APNs auth key (`.p8`) | **Secret** | uploaded to Firebase console — never in app |
| Android upload keystore + passwords | **Secret** | offline / CI secret store — never in repo (see SIGNING.md) |
| iOS distribution cert + provisioning profile | **Secret** | Apple/Xcode/CI — never in repo |

Invariant: **no server-only secret is ever `VITE_`-prefixed or committed.** The app bundle
is world-readable once shipped; treat it as public.

## Branch chain (live tracker)

| # | Branch | Delivers | Status |
|---|--------|----------|--------|
| 00 | `feat/native-00-plan-maqbool` | This plan | ✅ pushed |
| 01 | `feat/native-01-login-first-maqbool` | `isNativeApp()`; PWA + native boot to `/login` / `/dashboard`, never the landing | ✅ pushed |
| 02 | `feat/native-02-native-shell-maqbool` | StatusBar/Keyboard/Haptics/Splash + hardware-back + native CSS polish | ✅ pushed |
| 03 | `feat/native-03-transitions-maqbool` | Direction-aware native page transitions | ✅ pushed |
| 04 | `feat/native-04-apple-oauth-maqbool` | Sign in with Apple (web + native), i18n'd auth buttons | ✅ pushed |
| 05 | `feat/native-05-ios-platform-maqbool` | Add + configure the iOS platform; build + boot in the simulator | ✅ simulator-verified |
| 06 | `feat/native-06-release-signing-maqbool` | Android release signing + iOS export config + build pipeline | ⏳ |
| 07 | `feat/native-07-publishing-docs-maqbool` | Play Store + App Store publishing/testing guides | ⏳ |

## Per-branch detail

### 01 — login-first entry
- **Problem:** `LandingRoute` (`src/App.tsx:99`) only skips the marketing landing for an
  installed PWA (`isStandalonePwa()`), which returns **false** inside the Capacitor WebView.
  So native users land on marketing at `/`. `isNativeAndroid()` (`src/lib/native-auth.ts:20`)
  is Android-only, so the OAuth deep-link listener (`App.tsx:114`) would be dead on iOS.
- **Approach:** add `isNativeApp()` + `nativePlatform()` (reads `window.Capacitor.getPlatform()`,
  covers `android`+`ios`) alongside `isNativeAndroid()`. Broaden: `LandingRoute` →
  `isStandalonePwa() || isNativeApp()`; the OAuth listener guard → `isNativeApp()`;
  `isNativePushSupported()` and reminder gates → `isNativeApp()`. Push registration sends the
  live `nativePlatform()` instead of the hardcoded `"android"`.
- **Files:** `src/lib/native-auth.ts`, `src/App.tsx`, `src/lib/native-push.ts`,
  `src/lib/native-reminders.ts` (+ a pure unit test for the platform helpers).
- **Verify:** Playwright — web `/` still renders marketing; simulate standalone → `/login`.
  Gate. (Native path re-verified end-to-end on device in branch 05.)

### 02 — native shell smoothness
- Install `@capacitor/status-bar`, `@capacitor/keyboard`, `@capacitor/haptics`,
  `@capacitor/splash-screen`.
- `src/lib/native-shell.ts` (dynamic-imports, `isNativeApp()`-gated): status-bar style
  synced to the resolved theme (re-runs on light/dark change), keyboard resize + hide-on-submit,
  splash `hide()` once the first route is decided, Android **hardware back** → router back with
  a **root-route exit guard** (double-back-to-exit on `/dashboard`/`/login`), and a `haptics`
  helper (light impact) wired to the FAB, tab switches, and primary submits.
- `capacitor.config.ts`: SplashScreen (no auto-hide; we hide on boot), Keyboard `resize:native`,
  StatusBar overlay config.
- `src/index.css`: `-webkit-font-smoothing: antialiased`; disable long-press callout/selection
  on **chrome** (nav/header/tab-bar/FAB/buttons) while keeping content + inputs selectable;
  `overscroll-behavior-y: none` at the root only; momentum scroll on scroll containers.
- **Rejected (with reason):** global `user-select:none` (breaks copying amounts/referral codes)
  and `maximum-scale=1` (kills pinch-zoom → WCAG regression). iOS input-zoom is instead
  prevented by keeping input font-size ≥ 16px.
- **Verify:** web unaffected (all native calls no-op); gate. Device feel verified in 05.

### 03 — native page transitions
- Direction-aware transitions (forward push / back pop) on route change, built with the
  `transition-creator` skill; animate transform/opacity; honor `prefers-reduced-motion`.
- **Verify:** Playwright screenshots + no new console errors; gate.

### 04 — Apple OAuth
- `NativeAppleAuthButton` mirroring `NativeGoogleAuthButton` with `strategy:"oauth_apple"`;
  both native buttons generalized to `isNativeApp()` (android+ios). Web social buttons are
  rendered by Clerk's `<SignIn>`/`<SignUp>` automatically once the Apple connection is enabled
  in the Clerk dashboard — no web code change beyond enabling it there.
- i18n the auth button labels (Google **and** Apple) across all 8 locales (they are currently
  hardcoded English).
- **Human/portal steps (documented, not code):** Apple Developer → App ID + **Services ID** +
  a **Sign in with Apple** key (`.p8`); Clerk dashboard → enable Apple, paste Team ID / Services
  ID / Key ID / `.p8` (Clerk mints & rotates the client-secret JWT); register the return URL and
  the `com.vorreix.profitsync://oauth-callback` scheme in Clerk redirect URLs.
- **Verify:** web button renders when the connection is on; native button compiles + is gated;
  gate. Live native Apple sign-in verified on device once the portal steps are done.

### 05 — iOS platform ✅
- Added `@capacitor/ios@^8`; `npx cap add ios` (SPM, **not** CocoaPods — Xcode 26 scaffolds
  `ios/App/CapApp-SPM/Package.swift`, no `Podfile`); `.env.ios` / `.env.ios.local` (copies of the
  Android ones — same backend/Clerk/app-id); vite mode wiring (`--mode ios|ios-local`);
  `build:ios*` + `cap:*:ios` npm scripts (+ `scripts/ios-xcodebuild.mjs` headless simulator build);
  deployment target 15.0; Info.plist (`CFBundleURLTypes` = `com.vorreix.profitsync`,
  `ITSAppUsesNonExemptEncryption=false`, **`NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription`**
  for attachment uploads); app icon + launch splash; `docs/native/IOS.md` dev guide.
- **Firebase crash guard:** the FCM plugin force-configures Firebase at load and crashes with no
  `GoogleService-Info.plist`. `AppDelegate.configureFirebaseIfNeeded()` configures an **inert
  placeholder** app first, so the app boots + signs in with **zero** credentials; a real plist (added
  when push is provisioned) takes over with no code change. Best respects "no secrets in the app."
- **Deviations from the pre-build plan (auditable):**
  - Icons come from **`scripts/ios-brand-assets.mjs`** (`sharp`, reads the shared `assets/` sources),
    **not** `@capacitor/assets` — the latter isn't installed and `sharp` already is; reusing the same
    `assets/` that Android consumes keeps the two apps' branding on one source of truth. The modern
    single-1024 universal icon is used (opaque, alpha stripped — iOS rejects alpha icons).
  - `GoogleService-Info.plist` goes in the **app target** (`ios/App/App/`, gitignored) rather than a
    separate `ios/credentials/` dir, because iOS needs it inside the bundle for `Bundle.main` lookup.
    No `pod install` (SPM handles deps).
- **Verify (real):** built with `xcodebuild -sdk iphonesimulator` and booted on **iPhone 17
  simulator** — the `--mode ios` **production** bundle (live Clerk + `https://profitsync.net` API base)
  compiles, launches, and lands **login-first** with the native Apple + Google buttons above the Clerk
  card; live Clerk renders on the `capacitor://` origin (no origin error), no Firebase crash, native
  status bar / Dynamic Island respected. Push / live Apple sign-in / APNs need a real device + portal
  config (documented in IOS.md + APPLE_OAUTH.md).

### 06 — release signing + build pipeline
- Android: `signingConfigs { release }` in `android/app/build.gradle` reading a **gitignored**
  `android/key.properties` (+ committed `key.properties.example`); `bundleRelease` → signed `.aab`.
  Recommend **Play App Signing** (Google holds the app key; you hold an upload key).
- iOS: `ios/App/ExportOptions.plist` template for `xcodebuild -exportArchive`.
- vite.config: **non-fatal warn** if a prod native mode (`android`/`ios`) ships a `pk_test_` key.
- `android/credentials/.gitignore` belt-and-suspenders for `google-services.json`.
- **Verify:** gate; `gradlew :app:tasks` shows the release signing wiring is valid (a real signed
  build needs the operator's keystore).

### 07 — publishing + signing docs
- `docs/native/iOS.md` (mirror of ANDROID.md), `docs/native/SIGNING.md` (keystore + Play App
  Signing + iOS certs/profiles), `docs/native/PUBLISHING.md` (first-timer step-by-step for both
  stores: accounts + fees, app registration, internal testing / TestFlight, listings + screenshots,
  privacy/data-safety, review, staged release), `docs/native/README.md` index; refresh ANDROID.md.

## Verification matrix

| Branch | Proof |
|---|---|
| 01 | Playwright: web landing intact; standalone → `/login`. Unit test for platform helpers. Gate. |
| 02 | Web no-op confirmed; gate. Device feel in 05. |
| 03 | Playwright transition screenshots; reduced-motion respected; gate. |
| 04 | Web Apple button renders (connection on); native button gated + compiles; i18n parity; gate. |
| 05 | **iOS Simulator build boots to `/login`** (screenshot). Gate. |
| 06 | Gate; gradle release wiring valid; export plist present. |
| 07 | Docs reviewed; gate on chain tip. |

## Corrections applied to the research (auditable)

- ⚠️ **URL-scheme collision was a phantom.** The one scheme is
  `com.vorreix.profitsync://oauth-callback`; iOS reuses it verbatim. No `profitsync://` exists.
- ⚠️ **No `maximum-scale=1`** — pinch-zoom stays enabled (WCAG). Input-zoom is handled by 16px+
  inputs, not by disabling zoom.
- ⚠️ **No hard `pk_live` build guard** — it would break the intentional `pk_test` local-shell
  build. A non-fatal warning is used instead.
- ⚠️ **No global `user-select:none`** — content and inputs stay selectable; only chrome loses the
  long-press callout.

## Open items for the human (tracked, not blockers to the code)

- Apple Developer + Clerk dashboard: enable Sign in with Apple (branch 04 documents exact steps).
- Firebase: upload the APNs `.p8` for iOS push; place `GoogleService-Info.plist` in `ios/App/App/`.
- Create the Android upload keystore + Play App Signing enrollment (SIGNING.md).
- App Store Connect + Google Play Console app registrations, listings, screenshots (PUBLISHING.md).
- `gh` is not authenticated here → PRs are opened by the user from the pushed branches.

## Change log

- 2026-07-12: plan written. Deep 5-cluster research completed (entry/routing, auth/Apple,
  native shell, iOS readiness, build/secrets); findings cross-verified against first-hand reads;
  four research claims corrected (above). Environment confirmed: Xcode 26.4.1 + CocoaPods 1.16.2
  present (real iOS simulator build is possible), Capacitor CLI 8.4.1, Java 22, `gh` unauthenticated.
- 2026-07-12: branches 01–04 implemented, gated, and pushed (login-first entry, native shell,
  page transitions, Apple OAuth). Branch 05 (iOS platform) implemented + **simulator-verified**
  (login-first boot with Apple + Google buttons, no Firebase crash). iOS uses **SPM** not CocoaPods
  (Xcode 26); brand assets via a new `scripts/ios-brand-assets.mjs` reusing the shared `assets/`;
  `IOS.md` written. Next: 06 (release signing) → 07 (publishing docs).
