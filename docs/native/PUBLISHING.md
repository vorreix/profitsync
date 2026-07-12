# Publishing ProfitSync to the Play Store & App Store (first-timer guide)

This is the end-to-end path for someone who has **never** shipped a mobile app:
set up the accounts, **test the app with real testers**, then submit to each
store. Read `SIGNING.md` first — you need a signed build for both stores.

The golden order is **always the same**: build a signed artifact → upload it to a
**test track** → invite yourself + a few testers → fix anything → **then**
promote/submit to production. Never submit an untested build straight to
production.

App identity (same on both stores):
- **App name:** ProfitSync · **Bundle/Application ID:** `com.vorreix.profitsync`
- Offers Google **and** Apple sign-in (Apple is mandatory on iOS because Google is
  offered — see `APPLE_OAUTH.md`).

---

## 0. Accounts & fees (do this first — approval can take a day or two)

| Store | Account | Fee | Sign up |
|---|---|---|---|
| Google Play | **Play Console** developer account | **$25 once** | play.google.com/console — identity verification can take 1–2 days |
| Apple App Store | **Apple Developer Program** | **$99 / year** | developer.apple.com — you already have this |

For a company listing (not your personal name) Apple may ask for a **D-U-N-S
number** (free, but can take days) — start that early if you want the seller to be
"Vorreix" rather than an individual.

---

## 1. Android — Google Play

### 1a. Create the app
Play Console → **Create app** → name `ProfitSync`, default language, **App**, Free
(or Paid), accept the declarations.

### 1b. Upload your first build to **Internal testing**
Left nav → **Testing ▸ Internal testing** → **Create new release**.
- The first time, accept **Play App Signing** (let Google hold the app key — see
  `SIGNING.md`).
- Upload `android/app/build/outputs/bundle/release/app-release.aab`
  (from `./gradlew bundleRelease`).
- Add a release name + notes → **Save** → **Review release** → **Roll out**.
- **Testers** tab → create an email list with your own address → copy the **opt-in
  URL**, open it on your phone, become a tester, install from Play. This is the
  real store pipeline minus public visibility — installs arrive in minutes.

Internal testing has **no review delay** and up to 100 testers — use it to shake
out sign-in, push, and the money flows on real devices before anything public.
(Later, **Closed** and **Open** testing tracks add more testers + a light review.)

### 1c. Fill in the store listing (required before production)
**Grow ▸ Store presence ▸ Main store listing:**
- Short description (≤80 chars) + full description.
- **App icon** 512×512, **Feature graphic** 1024×500, and **phone screenshots**
  (2–8, from a real device or the emulator — Play accepts the simulator shots).

**Policy ▸ App content** — Google *will* block production until these are done:
- **Privacy policy URL:** `https://profitsync.net/privacy-policy`.
- **Data safety:** declare what you collect. ProfitSync collects **email/name**
  (via Clerk, for auth) and the **financial records the user enters**; it's
  encrypted in transit (HTTPS) and users can delete their data. Be truthful —
  this form is user-facing.
- **Content rating** questionnaire (finance app → typically *Everyone*).
- **Target audience** (not directed at children), **Ads** (none), **Government
  app** (no).

### 1d. Go to production
**Production ▸ Create new release** → promote the tested build (or upload a new
`.aab`) → set the **staged rollout %** (start at 20% — you can halt if something
breaks) → submit. First production review is usually a few hours to a couple of
days.

---

## 2. iOS — App Store

### 2a. Register the App ID (once)
developer.apple.com → **Certificates, IDs & Profiles ▸ Identifiers** → **+** →
App IDs → App → Bundle ID `com.vorreix.profitsync` (explicit) → enable **Sign in
with Apple** (and **Push Notifications** when you provision push). (Xcode may have
already created this via automatic signing.)

### 2b. Create the app record
App Store Connect (appstoreconnect.apple.com) → **My Apps ▸ +** → **New App** →
platform iOS, name `ProfitSync`, primary language, bundle ID
`com.vorreix.profitsync`, SKU (any unique string, e.g. `profitsync-ios`).

### 2c. Upload a build & test with **TestFlight**
- Archive + upload (Xcode **Product ▸ Archive ▸ Distribute App**, or the
  `xcodebuild` flow in `SIGNING.md`).
- The build appears under **TestFlight** after Apple finishes processing
  (~5–30 min) + an **export-compliance** answer (our `Info.plist` already sets
  `ITSAppUsesNonExemptEncryption=false`, so it's automatic).
- **Internal testing:** add yourself/team (up to 100 App Store Connect users) —
  available immediately, no review. Install the **TestFlight** app on your iPhone
  and run the build.
- **External testing** (up to 10,000 testers via a public link) needs a quick
  **Beta App Review** first.

Test the same flows as Android: Apple **and** Google sign-in, the core money
screens, and (on a real device with the APNs config) push.

### 2d. Fill in the App Store listing
In App Store Connect, on the app version:
- **Screenshots** for the required device sizes (6.7" and 6.5" iPhone at minimum;
  simulator screenshots are fine).
- Description, keywords, support URL (`https://profitsync.net`), marketing URL.
- **App Privacy** ("nutrition label"): declare data collection to match Data
  Safety above — **Contact Info (email/name)** for App Functionality and the
  **financial info** the user enters; linked to the user's identity; not used for
  tracking. Truthful + consistent with the Google form.
- **Age rating** questionnaire, **Category** (Finance), pricing (Free).

### 2e. Submit for review
Attach the tested build to the version → **Add for Review** → **Submit**. Apple's
review is typically 24–48 h. Choose **phased release** (auto 7-day gradual rollout)
for updates. Common first-timer rejections to pre-empt:
- **Guideline 4.8** — offering Google sign-in without Apple. We ship both; keep
  the Apple button.
- **Sign-in demo account** — reviewers need to get in. Provide a **demo email +
  password** (or a working Apple/Google test account) in **App Review
  Information → Sign-In required**, or they can't test it.
- **Privacy label mismatch** — the label must match what the app actually
  collects.

---

## 3. Shipping updates (both stores)

The installed app ships a **frozen** copy of the web bundle — deploying
profitsync.net does **not** update it. To push app changes:

1. **Bump the version** (do this every upload):
   - Android: `versionCode` (+1) and `versionName` in `android/app/build.gradle`.
   - iOS: `CURRENT_PROJECT_VERSION` (+1) and `MARKETING_VERSION` in the Xcode
     target (or `project.pbxproj`).
2. Rebuild the signed artifact (`bundleRelease` / Archive).
3. Upload to the **test track first** (Internal testing / TestFlight), verify,
   then promote/submit to production.

There is no in-app auto-update (the service worker is disabled in the WebView) —
store updates are the only path, exactly as intended.

---

## 4. Handy checklists

**Before every submission:** version bumped · signed build installs from the test
track · Google + Apple sign-in work on a real device · privacy policy URL live ·
Data Safety / App Privacy match reality · screenshots current · demo account
provided (iOS).

**Keep forever (losing these hurts):** Android upload keystore + passwords · iOS
distribution `.p12` · your Play + Apple account credentials · the Apple/APNs `.p8`
keys.

See also: `SIGNING.md` (keys), `ANDROID.md` / `IOS.md` (builds), `APPLE_OAUTH.md`
(Apple/Google sign-in setup), `README.md` (index).
