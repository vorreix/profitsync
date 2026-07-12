# ProfitSync native apps — docs index

ProfitSync ships as one codebase on four surfaces: the **web app**, the
**installable PWA**, a **native Android app**, and a **native iOS app**. The two
native apps are [Capacitor](https://capacitorjs.com) WebView shells around the
exact same Vite build — they boot straight into the product (login when signed
out), sign in with **Google and Apple**, and talk to the deployed backend at
`https://profitsync.net`.

## Start here

| If you want to… | Read |
|---|---|
| Understand the whole initiative + the branch chain + credential model | **`NATIVE_APPS_PLAN.md`** |
| Build & run the **Android** app (setup, commands, branding, FCM push) | **`ANDROID.md`** |
| Build & run the **iOS** app (setup, commands, branding, APNs push, SPM) | **`IOS.md`** |
| Set up **Sign in with Apple** (+ Google) in Apple Developer + Clerk | **`APPLE_OAUTH.md`** |
| Create signing keys / certificates the right way (and back them up) | **`SIGNING.md`** |
| **Test** with real testers and **publish** to both stores, step by step | **`PUBLISHING.md`** |

## The typical journey (never done this before?)

1. **`APPLE_OAUTH.md`** — one-time portal setup so Apple/Google sign-in works.
2. **`ANDROID.md`** / **`IOS.md`** — build the app and run it in an
   emulator/simulator, then on your own phone.
3. **`SIGNING.md`** — generate your Android upload keystore + set up iOS
   distribution signing (do this once; back the keys up).
4. **`PUBLISHING.md`** — upload to **Internal testing** (Android) / **TestFlight**
   (iOS), test on real devices, then submit to production.

## Key facts that never change

- **App ID:** `com.vorreix.profitsync` (both platforms). **OAuth deep-link
  scheme:** `com.vorreix.profitsync://oauth-callback`.
- **No secret ever lives in the repo.** The app bundle carries only public values
  (`pk_live_…`, the API base, the public VAPID key); every real secret sits in
  Vercel env, the Clerk dashboard, Firebase, or your offline key backups. Full
  table in `NATIVE_APPS_PLAN.md`.
- **Everything native no-ops gracefully when unconfigured** — the apps build, boot
  login-first, and sign in with **zero** Firebase/push config present. Push turns
  on later by adding `google-services.json` / `GoogleService-Info.plist` + the
  server key, with no code change.
- **Store updates are the only update path** (the in-app service worker is
  disabled) — bump the version and re-upload for every change.
