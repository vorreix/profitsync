# Sign in with Apple — setup guide

ProfitSync supports **Apple** and **Google** social sign-in on every surface:

| Surface | How the button appears |
|---|---|
| **Web / installed PWA** | Clerk's prebuilt `<SignIn>` / `<SignUp>` renders the provider buttons automatically for every connection **enabled in the Clerk dashboard**. No app code. |
| **Android / iOS (Capacitor)** | Custom `NativeOAuthButton` (`provider="apple" \| "google"`) drives OAuth through the in-app browser + our custom deep-link scheme. It renders **only** in the native app; the web falls back to Clerk's own buttons. |

Because the native path calls `clerk.signIn.create({ strategy: "oauth_apple" })`, the
Apple connection must be configured in Clerk for **both** web and native — there is a
single Clerk configuration, not one per platform.

This is a **one-time portal setup** (Apple Developer + Clerk dashboard). No secrets
live in the app or the repo — Clerk stores the Apple key server-side, exactly the
model we use for every other credential.

---

## Part A — Apple Developer portal

You need a paid **Apple Developer Program** membership (you have one).

1. **App ID** (Identifiers → `+` → App IDs → App).
   - Description: `ProfitSync`.
   - **Bundle ID (explicit):** `com.vorreix.profitsync` (must match `capacitor.config.ts` `appId`).
   - Capabilities: tick **Sign In with Apple**. Save.

2. **Services ID** (Identifiers → `+` → Services IDs). This is the OAuth *client id* for the web/Clerk flow.
   - Description: `ProfitSync Web Auth`.
   - Identifier: e.g. `com.vorreix.profitsync.signin` (this string is Clerk's "Apple Services ID").
   - After creating, open it → tick **Sign In with Apple** → **Configure**:
     - **Primary App ID:** the App ID from step 1.
     - **Domains and Subdomains:** `clerk.<your-clerk-domain>` — copy the exact value from Clerk's Apple setup screen (Clerk shows the domain to authorize). For a Clerk production instance this is your Frontend API host.
     - **Return URLs:** the callback Clerk shows on its Apple setup screen (looks like `https://clerk.<domain>/v1/oauth_callback`). Paste it verbatim.
   - Save.

3. **Sign In with Apple key** (Keys → `+`).
   - Name: `ProfitSync Sign In with Apple`.
   - Tick **Sign In with Apple** → **Configure** → pick the Primary App ID → Save.
   - **Download the `.p8`** (once only — Apple never lets you re-download it) and note the **Key ID**.
   - Note your **Team ID** (top-right of the developer portal).

You now have the four things Clerk needs: **Services ID**, **Team ID**, **Key ID**, and the **`.p8` key**.

---

## Part B — Clerk dashboard

1. Clerk → **User & Authentication → Social Connections → Apple → Enable**.
2. Toggle **Use custom credentials** and fill in:
   - **Apple Services ID** = the Services ID identifier (`com.vorreix.profitsync.signin`).
   - **Apple Team ID** = your Team ID.
   - **Apple Key ID** = the Key ID from the `.p8`.
   - **Apple Private Key** = paste the full contents of the downloaded `.p8`.
3. Clerk displays the **Authorized domain** and **Return URL** to enter back in Apple
   (Part A step 2) — if you set them before Clerk showed them, reconcile now so they match exactly.
4. Save. Repeat for **both** your Clerk **development** and **production** instances
   (they have different domains; Apple's Services ID can list multiple return URLs/domains).

Do the same for **Google** if not already done (Social Connections → Google) — the native
Google button uses the identical Clerk mechanism.

---

## Part C — Native deep link (already wired in the app)

No portal work; this is here so you understand the flow and can debug it.

- The app registers the custom scheme **`com.vorreix.profitsync://oauth-callback`**
  (`NATIVE_OAUTH_REDIRECT_URL` in `src/lib/native-auth.ts`).
- `NativeOAuthButton` calls `signIn/signUp.create({ strategy, redirectUrl: <scheme>, actionCompleteRedirectUrl })`,
  then opens Clerk's returned `externalVerificationRedirectURL` in the Capacitor in-app browser.
- Apple/Google → Clerk → redirect to the custom scheme → the `App.appUrlOpen` listener in
  `src/App.tsx` converts it to `/sso-callback?...` → `OAuthCallbackPage` finishes the session.
- **Android:** the scheme is registered by Capacitor automatically from `appId`. Nothing to add.
- **iOS:** `npx cap add ios` generates the app; the custom scheme is registered in the app's
  `Info.plist` (`CFBundleURLTypes`) — verify it lists `com.vorreix.profitsync` when the iOS
  platform is added (native-05). Also enable the **Sign In with Apple** capability in Xcode
  (Signing & Capabilities → `+ Capability`) so App Store review accepts it.

---

## Verifying

- **Web:** open `/login` in a browser — "Continue with Apple" and "Continue with Google"
  appear inside Clerk's card once the connections are enabled. Click → Apple's sheet → back to the app.
- **Native:** in the emulator/device build (native-05), the two custom buttons appear above the
  Clerk card on `/login` and `/signup`; tapping opens the provider page in the in-app browser and
  returns to the app. If a button reports an error, check `NativeOAuthButton`'s `nativeAuthLog`
  output (`[ProfitSync Native Auth]`) in the device console — an `oauth_start_failed` almost always
  means the provider isn't enabled/configured in Clerk for that instance.

## App Store note

Apple **requires** that any app offering a third-party social login (we offer Google) **also**
offers Sign in with Apple. Shipping both satisfies App Store Review Guideline 4.8 — do not remove
the Apple button from the iOS build.
