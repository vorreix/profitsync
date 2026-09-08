# ProfitSync — Local Setup (this machine)

_Last updated: 2026-08-09 by Claude Code. This documents what was installed on this Mac (Apple Silicon, macOS 26.6), how to run each platform, and the few secrets only you can provide._

## What is already installed & working

| Tool | Where | Notes |
|---|---|---|
| Node.js v24.19.0 LTS + npm 11 | `~/.local/node` (symlinked into `~/.local/bin`) | On PATH via `~/.zshrc` / `~/.zshenv` |
| Vercel CLI 58 | global npm | Needs `vercel login` (see below) |
| Temurin JDK 21 | `~/.local/jdk-21` | `JAVA_HOME` set in `~/.zshrc` / `~/.zshenv` |
| Android SDK (cmdline-tools, platform-tools, platform 36, build-tools) | `~/Library/Android/sdk` | `ANDROID_HOME` set; licenses accepted |
| Xcode 26.6 + iOS 26.5 simulators | already on machine | iOS project uses **SPM — no CocoaPods needed** |
| npm dependencies | `node_modules/` | 496/496 unit tests pass, typecheck clean |
| `.env.local` | project root | Created with placeholders + generated dev keys (VAPID, service token) |

> Open a **new terminal** (or `source ~/.zshrc`) so `node`, `java`, `adb`, `sdkmanager` are on PATH.

## ⚠️ The 2 secrets you must provide (everything else is optional)

The app boots without them, but **sign-in and all data APIs need them**:

1. **Clerk keys** — https://dashboard.clerk.com → your app → *API Keys*
   - `VITE_CLERK_PUBLISHABLE_KEY` (pk_test_…) and `CLERK_SECRET_KEY` (sk_test_…)
2. **Neon Postgres** — https://console.neon.tech → your project → *Connection string (Pooled)*
   - `DATABASE_URL` (must include `?sslmode=require`)

Put them in `.env.local` (placeholders are marked `REPLACE_ME`).

### Fastest path — pull everything from Vercel (recommended)

The project already deploys on Vercel, so its Development env has all of this. In this Claude Code session type these (the `!` prefix runs them here so I can see the output), or run them in any terminal:

```
! vercel login
! vercel link
! vercel env pull .env.local --environment=development
```

Then tell Claude to re-run the verification, or just run:

```
npm run db:migrate     # apply migrations to the DB in .env.local (only if it's a fresh DB)
vercel dev             # full-stack dev on http://localhost:3000
```

### Optional secrets (feature-gated, app degrades gracefully without them)

| Feature | Vars | Without it |
|---|---|---|
| Billing (Dodo) | `DODO_PAYMENTS_API_KEY` … | Stub mode — upgrade marks org premium locally (fine for QA) |
| Email (Resend) | `RESEND_API_KEY` | Invitations become copy-the-link; account deletion OTP 503s |
| AI quick add | `GEMINI_API_KEY` (or Anthropic/OpenAI) | ✨ trigger hidden |
| Quotation PDFs | `S3_*` | PDF modal shows "not available" |
| Native push (FCM) | `FCM_SERVICE_ACCOUNT_JSON` + `android/credentials/google-services.json` | Push silently off (Android builds fine without it) |
| Web push | `VAPID_*` | **Already generated** for this machine ✔ |

## Running each platform

### Web

```
npm run dev        # FULL app on http://localhost:5173 — vite.config.ts has a localApiPlugin
                   # that serves the /api router in-process (reads .env.local directly)
vercel dev         # prod-parity alternative on http://localhost:3000 — needs vercel login + link,
                   # and reads the CLOUD Development env (not .env.local)
```

> CLAUDE.md says `npm run dev` has no API — that's stale; `vite.config.ts` gained a
> `localApiPlugin` that dispatches `/api/*` to the same router the Vercel function uses.

### Android

```
npm run cap:build:android   # build web bundle + sync + assembleDebug APK (headless)
npm run cap:open:android    # sync + open in Android Studio (Studio NOT installed yet — optional)
```

Headless install/run on an emulator — **already set up**: the `android-36` system image is installed and an AVD named `profitsync` (Pixel 7) exists. To run:

```
emulator -avd profitsync &          # add -no-window for headless
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.vorreix.profitsync/.MainActivity
```

If more than one emulator/device is attached (other projects on this machine also run emulators), pin every adb command with `-s <serial>` (see `adb devices`).

To use a physical device: enable USB debugging, plug in, `adb install …`.

Android Studio is **not** installed (CLI toolchain only). If you want it: https://developer.android.com/studio — point it at the existing SDK in `~/Library/Android/sdk`.

### iOS

```
npm run cap:build:ios       # build web bundle + sync + xcodebuild for the simulator (headless)
npm run cap:open:ios        # sync + open in Xcode (for running on a device / archiving)
```

Headless run in a simulator:

```
xcrun simctl boot "iPhone 17 Pro"
open -a Simulator
xcrun simctl install booted ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted com.vorreix.profitsync
```

Running on a **physical iPhone** requires your Apple Developer signing identity — open `npm run cap:open:ios`, select your team under *Signing & Capabilities*, and run from Xcode. I can't do that part for you.

### Native shells always need a re-sync after web changes

Per the repo's strict parity rule: after any web change run `npm run cap:sync:android` **and** `npm run cap:sync:ios`.

## Gotchas found during setup

- Native builds REQUIRE `.env.android` / `.env.ios` (gitignored, per-developer) with `VITE_API_BASE_URL` — I created both pointing at `https://profitsync.net`. The Clerk publishable key inherits from `.env.local` (Vite loads it in every mode); for a store build put the `pk_live_…` key in `.env.android`/`.env.ios` explicitly. For pointing a device at a LAN dev server, create `.env.android.local`/`.env.ios.local` and use the `cap:sync:*:local` scripts.
- `vercel dev` reads the **cloud Development env**, not `.env.local` — keep both in sync (`vercel env pull`).
- `android/credentials/google-services.json` is gitignored; without it the Google-services plugin is skipped and native push/Google-Sign-In are off in local builds. Grab it from the Firebase console (project `.firebaserc` → app `com.vorreix.profitsync`) if you need them.
