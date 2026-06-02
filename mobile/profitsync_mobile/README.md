# ProfitSync — Native Mobile (Flutter)

A native iOS/Android client for ProfitSync, talking to the **same** backend API
(`/api/*`) and the **same** Clerk auth instance as the web app. No backend
changes are required — the app authenticates with Clerk and sends the default
session JWT as `Authorization: Bearer …` plus `x-org-id` for workspace scoping,
exactly like the web client.

## What's implemented

- **Auth** via Clerk (`clerk_flutter`) — email/password + social, sign-up with
  email verification. Uses the existing dev instance (`warm-oyster-76`).
- **Onboarding** (rebuilt for mobile): Personal vs Business account choice with a
  keyboard-aware sticky CTA, posting to `POST /api/onboarding`.
- **Dashboard**: net balance, income/expense, top clients, recent activity —
  computed from `/api/clients` + `/api/transactions`.
- **Clients**: searchable list, detail page with per-client P&L + transactions,
  create client. (Business workspaces only.)
- **Transactions**: list with income/expense filter, add transaction.
- **Quotations**: list + create. (Business workspaces only.)
- **Profile**: identity, workspace switcher, plan/currency, sign out.

Tabs adapt to the workspace type (personal hides Clients/Quotes).

## Architecture

| File | Responsibility |
|---|---|
| `lib/config.dart` | API base URL + Clerk key (via `--dart-define`) |
| `lib/api.dart` | HTTP client: bearer token + `x-org-id`, short GET cache |
| `lib/models.dart` | Models mirroring the API's snake_case JSON |
| `lib/app_state.dart` | `AppState` — profile, orgs, active workspace, onboarding |
| `lib/main.dart` | `AppContainer` wires Clerk → API → state; app root + gate |
| `lib/theme.dart` | Brand theme (emerald/indigo), light + dark |
| `lib/screens/*` | Auth, onboarding, dashboard, clients, transactions, quotations, profile |

## Running

The iOS simulator reaches the host Mac at `localhost`, so the local
`vercel dev` backend works directly:

```bash
cd mobile/profitsync_mobile
flutter run -d <ios-simulator-id>
# point at production instead:
flutter run --dart-define=API_BASE_URL=https://<your-prod-domain>
```

Defaults: `API_BASE_URL=http://localhost:3001`, Clerk dev publishable key baked
in (override with `--dart-define=CLERK_PUBLISHABLE_KEY=…`).

## Tests

```bash
flutter test                                              # deterministic widget tests
flutter test integration_test/flow_test.dart -d <sim>     # real e2e: auth → onboarding → dashboard
```

The integration tests use Clerk **test mode**: any email containing
`+clerk_test` accepts verification code `424242`, so they sign up/in without a
real inbox.

## Known setup gotcha — Clerk l10n generation

`clerk_flutter` 0.0.15-beta ships its `ClerkSdkLocalizations` as *generated*
code that isn't included in the published package, and its own pubspec is
missing `flutter: generate: true`. A clean `flutter run` therefore fails with
`'ClerkSdkLocalizations' isn't a type`.

Fix (already applied locally; re-run after any `flutter pub get` that lands a
fresh pub cache) — see `tool/fix_clerk_l10n.sh`:

```bash
bash tool/fix_clerk_l10n.sh
```

It adds `generate: true` to the cached package and runs `flutter gen-l10n` to
produce `lib/generated/clerk_sdk_localizations*.dart`.
