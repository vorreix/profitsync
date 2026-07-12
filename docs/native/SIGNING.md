# App signing — Android & iOS (first-timer guide)

Every app installed on a phone is cryptographically **signed**. The signature
proves each update comes from the same author, so the OS lets it replace the
installed version. **If you lose your signing key you can lose the ability to
update your app** — so the #1 rule is: *generate the keys once, back them up in
two safe places, and never commit them.*

This repo is built so **no signing material ever lives in git** (see the
credential table in `NATIVE_APPS_PLAN.md`). The build reads keys from gitignored
files that you create locally; without them the app still builds (unsigned), so
CI and other machines never need the secrets.

---

## Android

Android has **two** keys once you use Play App Signing (strongly recommended):

| Key | Who holds it | What it does |
|---|---|---|
| **App signing key** | **Google** (Play App Signing) | The real key Android verifies on-device. Google generates + guards it. |
| **Upload key** | **You** (`android/key.properties` → a `.jks`) | Signs the `.aab` you upload. Google verifies it, strips it, re-signs with the app key. **If you lose it, Google can reset it** — that's the safety net. |

Without Play App Signing there's only one key and losing it is terminal. So:
**enrol in Play App Signing** (Play Console offers it on your first upload —
accept it).

### 1. Create your upload keystore (once)

```bash
keytool -genkeypair -v \
  -keystore ~/profitsync-upload.jks \
  -alias upload -keyalg RSA -keysize 2048 -validity 9125
```

- `-validity 9125` ≈ 25 years (Play requires a key valid well past 2033).
- It asks for a **keystore password**, your name/org (a distinguished name), and
  a **key password**. Remember both.
- **Back up `profitsync-upload.jks` + the passwords** somewhere safe (a password
  manager + an offline copy). Keep it **out of the repo** — `*.jks`/`*.keystore`
  are gitignored, but storing it outside the tree entirely is safest.

### 2. Point the build at it

Copy the template and fill it in:

```bash
cp android/key.properties.example android/key.properties   # key.properties is gitignored
```

```properties
storeFile=/Users/you/profitsync-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

`android/app/build.gradle` loads this automatically. With it present, `release`
builds are signed; without it they're unsigned (see the conditional
`signingConfigs.release` block).

### 3. Build the release bundle

```bash
npm run cap:sync:android                 # build web (--mode android) + copy into android/
cd android && ./gradlew bundleRelease     # signed .aab (if key.properties is set)
```

Output: `android/app/build/outputs/bundle/release/app-release.aab` — this is what
you upload to Play. (`assembleRelease` makes an `.apk` for sideloading; the store
wants the `.aab`.)

Verify the signature: `./gradlew :app:signingReport` — the **release** variant
should show your keystore under `Store`/`Alias` (not `null`).

---

## iOS

iOS signing is managed through your **Apple Developer account** ($99/year). The
moving parts:

| Piece | What it is |
|---|---|
| **Distribution certificate** | Proves *you* (your Apple team) built the app. One per team, reused across apps. |
| **App ID** | The `com.vorreix.profitsync` identifier registered to your team (+ its capabilities: Sign in with Apple, Push). |
| **Provisioning profile** | Ties the App ID + certificate + (for the store) your team together, authorising a build for distribution. |

You rarely touch these by hand — **let Xcode manage them ("automatic signing")**.

### 1. One-time setup in Xcode

1. `npm run cap:open:ios` → Xcode.
2. Select the **App** target → **Signing & Capabilities**.
3. **Team**: pick your Apple Developer team (sign in via Xcode → Settings →
   Accounts if it's not listed). Leave **Automatically manage signing** ON —
   Xcode creates/downloads the certificate + provisioning profile for you.
4. Confirm the capabilities are present: **Sign in with Apple** and (once push is
   provisioned) **Push Notifications**. Add via **+ Capability** if missing.

### 2. Archive + export

```bash
npm run cap:sync:ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Release -sdk iphoneos \
  -archivePath ios/build/App.xcarchive archive

# Fill in your Team ID in ios/App/ExportOptions.plist first (developer.apple.com → Membership)
xcodebuild -exportArchive \
  -archivePath ios/build/App.xcarchive \
  -exportOptionsPlist ios/App/ExportOptions.plist \
  -exportPath ios/build/export
```

Or entirely in the GUI: **Product ▸ Archive** → **Distribute App** → **App Store
Connect** → **Upload**. The GUI is easier the first time; the CLI is for CI later.

Output (CLI path): `ios/build/export/App.ipa`. `ios/build/` is gitignored.

### 3. The distribution certificate is a secret too

Your iOS distribution certificate's **private key** lives in your Mac's Keychain.
Back it up (Keychain Access → export the "Apple Distribution" identity as a
`.p12`, password-protect it) so you can build from another machine or restore it.
`*.p12`/`*.mobileprovision` are gitignored — never commit them.

---

## What's a secret vs. what's public (quick reference)

**Secrets — never in the repo, back them up offline:**
Android upload keystore (`.jks`) + passwords · iOS distribution `.p12` · the
Apple **Sign in with Apple** `.p8` (lives in the Clerk dashboard) · the **APNs**
`.p8` (uploaded to Firebase) · `FCM_SERVICE_ACCOUNT_JSON` (Vercel env).

**Public / config — fine to ship in the app bundle:**
`VITE_CLERK_PUBLISHABLE_KEY` (`pk_live_…`), `VITE_API_BASE_URL`,
`VITE_VAPID_PUBLIC_KEY`, and the Firebase client config
(`google-services.json` / `GoogleService-Info.plist` — these hold only a public
Firebase API key; still gitignored here to keep each machine self-contained).

Next: **`PUBLISHING.md`** — get the signed builds into the stores.
