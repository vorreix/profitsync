# Currency selection during onboarding — design

**Date:** 2026-06-03
**Branch:** `currency_selection_on_onboarding_maqbool`

## Goal

Let the user choose their workspace currency during onboarding (step 1), for both
personal and business account types, with a sensible geo-detected default.

## Background (verified in code)

- `api/_routes/onboarding.ts` **already** accepts a `currency` field, validates it
  against `CURRENCY_LIST`, and applies it to the org (personal or business) and the
  user profile. No backend change required.
- `api/_routes/billing/pricing.ts` returns `detectedCountry` (ISO alpha-2 from
  `x-vercel-ip-country`, falling back to `US`).
- `CurrencyCombobox` (`src/components/CurrencyCombobox.tsx`) is a ready reusable
  selector (`value` / `onValueChange`).
- `CURRENCY_LIST` (`src/lib/currencies.ts`) has currency `code` + country *name*
  (not ISO code), so a dedicated country-code → currency lookup is needed.

## Changes

### 1. `src/lib/currencies.ts`
- Add `COUNTRY_TO_CURRENCY: Record<string, string>` — ISO alpha-2 country code →
  currency code, covering major markets. Fallback handled by helper.
- Add `currencyForCountry(code?: string): string` → returns the mapped currency, or
  `"USD"` when the code is missing/unmapped.

### 2. `src/pages/OnboardingPage.tsx`
- Fetch `/api/billing/pricing` **on mount** (currently only on step 2). Reuse its
  `detectedCountry`; this also pre-warms pricing for step 2.
- New state: `currency` (default `"USD"`) and `currencyTouched` (default `false`).
- When the pricing response arrives, set `currency = currencyForCountry(detectedCountry)`
  **only if `!currencyTouched`** (a late response must not clobber a manual choice).
- Render `<CurrencyCombobox>` in step 1 below the account-type cards, shown once an
  account type is selected (both personal and business). For business it sits under
  the company-name field. Label + "Detected from your location" helper line.
- Selecting a currency sets `currencyTouched = true`.
- `handleChoose` includes `currency` in the `/api/onboarding` POST body.

### 3. i18n — `src/lib/i18n/locales/en.json` (onboarding namespace)
- `currencyLabel`: "Currency"
- `currencyDetectedHint`: "Detected from your location — you can change it"
- English is the fallback for the other 7 locales; other files optional.

## Error handling
- Pricing fetch stays best-effort (existing `try/catch` swallow). On failure the
  currency simply remains `USD` and editable.
- Invalid currency codes are already rejected server-side (400).

## Testing
- Unit test for `currencyForCountry`: known code → mapped currency; unknown code →
  `USD`; `undefined` → `USD`.
- Manual: geo prefill reflects location; manual override persists across a late
  pricing response; both account types persist the chosen currency on the created org.
- `npm run typecheck`, `npm run lint`, `npm run test:ci`, `npm run build`.
