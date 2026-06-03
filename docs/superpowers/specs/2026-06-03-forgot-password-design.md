# Forgot password (Clerk built-in flow) — design

**Date:** 2026-06-03
**Branch:** `currency_selection_on_onboarding_maqbool` (current working branch)

## Goal

Provide a working "forgot password" experience. Use Clerk's built-in reset flow
(already shipped inside the `<SignIn>` widget) rather than building custom pages.

## Background (verified in code)

- `src/pages/LoginPage.tsx` renders Clerk's prebuilt `<SignIn>` component
  (`@clerk/clerk-react`) with `routing="path"`, `path="/login"`,
  `fallbackRedirectUrl="/dashboard"`. This widget already includes the full
  forgot-password flow: email → reset code → new password → signed in.
- `src/pages/ForgotPasswordPage.tsx` and `src/pages/ResetPasswordPage.tsx` are
  empty stubs that `<Navigate to="/login" replace />`.
- `src/App.tsx` routes `/login/*`, `/signup/*`, `/forgot-password`,
  `/reset-password` (the latter two to the stubs).

## Decision

**Approach A — use Clerk's built-in flow.** No custom `useSignIn()` pages, no new
UI, no new i18n keys (those would be Approach B, not chosen).

## Changes

### 1. Clerk Dashboard (manual — operator action, outside the repo)
Confirm in Clerk Dashboard → User & authentication → Email, phone, username:
- **Password** authentication enabled.
- Password reset via **email verification code** enabled (default for
  password-based instances).
If disabled, the "Forgot password?" link will not function. This is the only
external dependency.

### 2. Stub routes — keep as redirects, add intent comment
Leave `/forgot-password` and `/reset-password` redirecting to `/login` as a safety
net for old bookmarks and any previously-sent links. Add a short comment to each
page explaining the redirect is intentional (Clerk's reset flow lives inside the
`<SignIn>` widget under `/login/*`, not these paths), so the empty files don't read
as unfinished work. No behavior change.

### 3. Verification (the real deliverable)
Run the app and walk the flow in a browser:
Login → enter email → **Forgot password?** → reset-code screen → new password →
redirect to `/dashboard`. Use a Clerk dev test email
(`+clerk_test@example.com`, auto-verifies). Report observed behavior step by step.

## Error handling
Handled entirely by Clerk's widget (invalid email, wrong/expired code, weak
password). No app-level error handling to add.

## Testing
No unit tests (no new app logic — the flow is Clerk's). Verification is the live
walkthrough above. Run `npm run typecheck` / `npm run lint` after the comment edits.

## Live verification result (2026-06-03)

Walked the flow against the running app on `:3000` and read Clerk's client-side
environment config directly. Findings:

- The `<SignIn>` widget renders correctly, but the sign-in screen shows **no
  "Forgot password?" link**.
- Could not create a test account to reach the valid-account password step: signup
  is gated by a Cloudflare Turnstile CAPTCHA that fails to load in an automation
  browser ("CAPTCHA failed to load… unsupported browser").
- Read `window.Clerk.__unstable__environment.userSettings`. Definitive config:
  - `email_address`: `first_factors: ["email_code"]`,
    `verifications: ["email_code", "email_link"]`
  - `password`: `enabled: true, required: true`, but
    `used_for_first_factor: false`, `first_factors: []`
  - **No `reset_password_email_code` / `reset_password_phone_code` strategy is
    present anywhere in the instance config.**

**Conclusion:** The absent link is a Clerk Dashboard configuration state, not a code
gap. The instance does not have the password-reset first-factor strategy enabled
(and notably appears configured for email-code sign-in, with password not used as a
first factor). Enabling password reset in the Dashboard is required for the built-in
"Forgot password?" link to appear. No app code can substitute for this.

### Required Clerk Dashboard action (operator)
Clerk Dashboard → **Configure → Email, phone, username** (User & authentication):
1. Under **Authentication strategies**, ensure **Password** is enabled as a sign-in
   option (so it is used as a first factor), or confirm the intended sign-in method.
2. Enable **Password reset** (email verification code). This adds the
   `reset_password_email_code` first factor, which is what renders the
   "Forgot password?" link in `<SignIn>`.
After saving, reload `/login` — the link appears on the password step.

## Explicitly out of scope (YAGNI)
- Custom-branded forgot/reset pages via `useSignIn()`.
- New i18n strings.
- Standalone deep-link forgot-password entry page (Approach C / Hybrid).
