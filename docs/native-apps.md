# ProfitSync Native Apps

ProfitSync uses Capacitor to package the existing Vite web app as installable
Android and iOS apps. The frontend and backend stay shared with the web/PWA
deployment.

## Project Layout

- `capacitor.config.ts` contains the native app id, app name, and `dist` web dir.
- `android/` is the generated Android Studio project.
- `ios/` is the generated Xcode project.
- `dist/` remains the Vite production output copied into each native project.

## Environment

Web/dev builds can keep using relative API requests:

```env
VITE_API_BASE_URL=
```

Native store builds should point to the deployed backend origin:

```env
VITE_API_BASE_URL=https://profitsync.net
```

Use the same Clerk publishable key as the matching backend environment. Add the
native app origins/redirects in Clerk before release if the auth flow requires
allowed origins or callback URLs.

## Common Commands

Run these from the repository root in PowerShell:

```powershell
npm install
npm run build
npm run cap:sync
npx cap open android
npx cap open ios
```

The `npm run cap:sync` command runs a production web build and copies `dist/`
into the Android and iOS projects.

## Android on Windows

Android Studio was detected at:

```text
C:\Program Files\Android\Android Studio
```

This machine's Android SDK was detected at:

```text
C:\Users\Sistec 34\AppData\Local\Android\Sdk
```

Gradle reads the SDK path from `android/local.properties`:

```properties
sdk.dir=C\:\\Users\\Sistec 34\\AppData\\Local\\Android\\Sdk
```

`android/local.properties` is machine-specific and is ignored by git.

If a different Windows machine does not have Android Studio or the SDK yet:

1. Install Android Studio from https://developer.android.com/studio.
2. Open Android Studio and install the Android SDK, Android SDK Platform-Tools,
   Android SDK Build-Tools, and at least one current Android platform.
3. Set a user environment variable named `ANDROID_HOME` to the SDK path, usually
   `C:\Users\<you>\AppData\Local\Android\Sdk`.
4. Add `%ANDROID_HOME%\platform-tools` to `Path`.
5. Alternatively, create `android/local.properties` with the SDK path:

```properties
sdk.dir=C\:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

Windows debug APK build from the repository root:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
cd android
.\gradlew.bat :app:assembleDebug
```

After a successful debug build, the APK is generated under:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Android Google Login

The Android app uses a Capacitor-only Clerk Google OAuth path so the Google
flow opens outside the embedded WebView and returns to the app through a native
callback URL. Browser/PWA Google login continues to use Clerk's normal web UI.

For a debug APK with native Google login console diagnostics enabled, sync the
native bundle with:

```powershell
npm run android:sync:debug
```

This sets `VITE_NATIVE_AUTH_DEBUG=true` for the web bundle. The Android app UI
stays identical to the mobile web/PWA UI; diagnostics are emitted as sanitized
console logs for:

- app launched in Capacitor/native mode
- Google login button clicked
- browser OAuth opened
- deep link callback received
- redacted callback URL details
- Clerk callback processing started
- Clerk callback success/failure

Callback URLs are logged with query and hash values redacted.

Native Android package name:

```text
com.profitsync.app
```

Native Android callback URL:

```text
com.profitsync.app://oauth-callback
```

The native app must never use a `localhost/.../sso-callback` URL on a real
phone. In Capacitor Android, the hidden native OAuth interceptor forces Clerk's
Google sign-in and sign-up requests to use this deep link for:

```text
redirectUrl: com.profitsync.app://oauth-callback
actionCompleteRedirectUrl: com.profitsync.app://oauth-callback
```

In Clerk:

- Enable Google as a social connection for sign-up/sign-in.
- If using production/custom Google credentials, configure the Google Web client
  ID and secret requested by Clerk.
- In **Native applications**, enable Native API if prompted.
- In **Allowlist for mobile SSO redirect**, add:

```text
com.profitsync.app://oauth-callback
```

- If Clerk has a separate **Allowed redirect URLs**, **Allowed origins**, or
  **Redirect URLs** allowlist for the instance, add the same deep link there
  too. Keep normal web URLs such as `https://profitsync.net/sso-callback` for
  the browser/PWA flow, but do not rely on `localhost` for installed Android
  builds.
- For development instances, keep any required localhost web URLs for desktop
  browser testing only. A real Android phone must return through
  `com.profitsync.app://oauth-callback`.

In Google Cloud Console, create an OAuth 2.0 Android client for debug builds:

```text
Application type: Android
Name: ProfitSync Android Debug
Package name: com.profitsync.app
SHA-1: 89:2F:48:7F:62:D6:97:65:ED:02:88:28:81:44:98:BF:D5:59:01:55
SHA-256: 4B:BE:6F:4E:3F:C0:72:33:F7:98:6D:44:4D:EF:D5:3E:31:02:68:E0:4C:9E:F6:E7:52:A7:B1:FF:EF:F0:BA:C8
```

The debug fingerprints above were read from:

```text
C:\Users\Sistec 34\.android\debug.keystore
```

For release builds, create a second Android OAuth client with the same package
name and the release signing certificate fingerprints. If Google Play App
Signing is enabled, use the SHA-1/SHA-256 shown in Play Console under **Setup >
App signing**. If signing locally, list the release keystore fingerprints with:

```powershell
& 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe' -list -v -keystore '<path-to-release-keystore>' -alias '<release-key-alias>'
```

Google Android OAuth clients do not use a redirect URI field. The mobile return
URL for this Capacitor/Clerk flow is the Clerk allowlisted callback:

```text
com.profitsync.app://oauth-callback
```

If Clerk asks for a Google redirect URI while configuring custom Google
credentials, copy the exact web redirect URI shown by Clerk into the Google
Cloud **Web application** OAuth client. Do not put the Capacitor callback URL
into the Google Web client redirect URI list.

If Android Google login opens Chrome and then lands on
`localhost/signup/sso-callback` or `localhost/login/sso-callback`, the native
deep link is not being used for that OAuth attempt. Rebuild/sync the APK and
confirm the Clerk mobile SSO allowlist contains:

```text
com.profitsync.app://oauth-callback
```

## Android Logs

With a device connected over USB and USB debugging enabled, capture native auth
logs from the repository root:

```powershell
npm run android:logs
```

Equivalent direct command:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -v time |
  Select-String -Pattern "ProfitSync|Capacitor|Chromium|Clerk|native-google-oauth"
```

Useful focused filters:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -v time Chromium:I Capacitor:I SystemWebViewClient:D *:S
```

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -v time |
  Select-String -Pattern "native-google-oauth|oauth-callback|Clerk"
```

## Store Prep

Android:

- Install Android Studio and Android SDK.
- Set `ANDROID_HOME` or create `android/local.properties` with `sdk.dir=...`.
- Configure release signing in Android Studio before Play Store upload.
- Build an Android App Bundle from Android Studio or with Gradle for release.

iOS:

- Open `ios/App/App.xcworkspace` on macOS with Xcode.
- Select the Apple Developer team and signing profile.
- Archive the app from Xcode and upload with Organizer or Transporter.

Before each store build, run `npm run cap:sync` so native projects include the
latest web app bundle.
