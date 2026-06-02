# ProfitSync PWA (login-onward) — Design Spec

- **Date:** 2026-06-02
- **Status:** Approved decisions; pending spec review → implementation plan
- **Author:** Maqbool (with Claude Code)
- **Scope owner:** ProfitSync web app (`/Users/maqbool/Desktop/mtt_projects/vorreix/profitsync`)

## 1. Goal

Turn the ProfitSync web app into an installable, self-updating Progressive Web App **from the `/login` and `/signup` screens onward, including the entire authenticated app**, while the public marketing landing page at `/` remains a plain website — never cached, never offered for install, and with no service worker for visitors who only ever see it.

All PWA build configuration lives in a new top-level `pwa/` folder. The app auto-updates whenever web code is redeployed, with no stale cached app, and **without interrupting a user mid-form**.

## 2. Non-goals (explicitly out of scope for v1)

- **No offline data.** Only the app shell + build assets are cached (install + fast load). Live data (`/api/*`) always requires the network. Read-only offline data and offline-write/background-sync are deferred to a possible Phase 2.
- **No changes to `/api/*` behavior**, auth, or the billing webhook.
- **No changes to the `mobile/` folder** — that is a separate, untracked Flutter native app and is unrelated to this work.
- **No PWA strings on the landing page** — the marketing page (`src/landing/`, own i18n) never shows install UI, so its locales are untouched.

## 3. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Offline depth | **App-shell install only** (no offline data) |
| 2 | `start_url` (installed-app launch target) | **`/dashboard`** (AppLayout redirects to `/login` if signed out) |
| 3 | Install prompt UX | **Custom "Install app" button + dismissible banner** on login/app screens; iOS Safari gets an "Add to Home Screen" instruction sheet |
| 4 | Update UX | **Silent** — fresh on next full load, **no forced reload, no prompt** (implemented form-safely; see §6) |
| 5 | Landing exclusion strictness | **Strict 4-layer** (see §5) |
| 6 | i18n | Add a `pwa` namespace to all **8 app locales** (en first, then it/de/hi/ml/ta/te/ar), per project policy that raw English in JSX is a bug |
| 7 | Icons | Standard **+ maskable + apple-touch**, generated from `public/logo.png` |

## 4. Discovered constraints (from codebase recon)

- **Stack:** React 19.2, Vite **7.3.1**, TypeScript (3 tsconfigs: app/node/api), Tailwind v4, Clerk auth, React Router 7, deployed on Vercel (consolidated `api/index.ts` + separate `api/billing/webhook.ts`). Build: `tsc -b && vite build` → `dist/`; Vercel runs `vercel-build` (db-migrate then build).
- **Route topology (the crux):** the landing page is at `/` (`<LandingApp/>`, isolated in `src/landing/` with its own i18n + scoped `ps-landing` CSS). Auth/app routes are **siblings** of `/`: `/login/*`, `/signup/*`, `/onboarding`, and the `<AppLayout>`-guarded `/dashboard`, `/clients`, `/transactions`, `/quotations`, `/organizations`, `/profile`, `/subscription`, `/trash`, `/admin/**`. There is **no common path prefix** other than `/`, so a service-worker *scope* cannot exclude only `/`.
- **`vercel.json` is already PWA-safe.** Its rewrites are `/api/(.*) → /api/index?__apipath=$1` and the SPA fallback `/((?!api|@)[^.]*) → /`. The SPA regex only matches **dotless** paths, so `/sw.js`, `/manifest.webmanifest`, `/workbox-*.js`, `/registerSW.js` (all contain dots) are served as real static files, not rewritten to `index.html`. No rewrite changes needed.
- **Assets:** `public/logo.png` (1254×1254) is the icon source; `public/favicon.png` (256×256), `public/logo-mark.png` (256×256) exist. `index.html` already has `viewport-fit=cover` and light/dark `theme-color` metas; it lacks a manifest link and Apple PWA metas.
- **Versions verified:** `vite-plugin-pwa@1.3.0` supports Vite 7 (`vite: …|| ^7.0.0`) and **bundles `workbox-build` + `workbox-window`** as its own dependencies (no separate workbox install needed). `@vite-pwa/assets-generator@1.0.2` is an optional peer used only for icon generation.
- **Dev nuance:** the plugin serves the dev SW at `/dev-sw.js?dev-sw` and the prod SW at `/sw.js`. We keep the SW **disabled in `vite dev`/`vercel dev`** and verify via `build` + `preview` to avoid dev caching confusion.

## 5. Architecture — strict 4-layer landing exclusion

Because scope cannot exclude only `/`, "PWA from login onward, not the landing page" is enforced with four independent layers:

1. **Conditional registration (client).** The service worker is registered only from app/auth code paths, gated by `shouldRegisterHere(pathname)`, which returns `false` for `/`, `/privacy-policy`, `/terms-of-service`, and `/invitations/*`. A visitor who only ever sees the marketing page gets **zero** PWA footprint (no SW, no precache, no install prompt — Chrome's install criteria require a controlling SW, so none is offered on `/`).
2. **NetworkOnly + navigation-fallback denylist (SW).** Even after a user logs in (the SW is now active with scope `/`), the landing/legal/invitation/api paths are denied the navigation fallback and never served from cache — so the marketing page and legal pages always come fresh from the network. Denylist regexes (single source of truth in `pwa/sw-policy.ts`):
   - `/^\/$/` (landing), `/^\/privacy-policy/`, `/^\/terms-of-service/`, `/^\/invitations\//`, `/^\/api\//`, `/^\/@/`.
3. **Exclude the landing bundle from precache (build).** `src/landing/*` is given its own named Rollup chunk (`landing`) via `manualChunks`, and that chunk is `globIgnore`d from the Workbox precache manifest — so the marketing JS is never cached.
4. **`start_url` + gated install UI.** `start_url: '/dashboard'` and `scope: '/'`; the install button/banner only mount on login/signup/app screens, never on the landing page.

Net effect: the marketing page behaves like a normal website at all times; the installed app opens into the product; the SW only ever caches the app shell + app/auth assets.

## 6. Auto-update mechanism (silent, form-safe)

**Requirement:** auto-update on every deploy, no stale app, no prompt, **no interruption**.

**Important correction:** raw `registerType: 'autoUpdate'` makes the browser **auto-reload open tabs** on a new version (vite-pwa docs warn this loses in-progress form data; they recommend `prompt` for form apps). ProfitSync is form-heavy, so a forced reload is unacceptable. We therefore deliver the chosen *silent / fresh-on-next-load / no-interruption* UX via **prompt-mode mechanics applied silently**:

- **Workbox:** `skipWaiting: true`-equivalent applied **on our command** (not automatically claiming current clients), `clientsClaim: false`, `cleanupOutdatedCaches: true`. The new SW activates in the background but does **not** take over the currently open tab.
- **Client (`src/lib/pwa/register-sw.ts`):** `injectRegister: null`; we register manually via `virtual:pwa-register`'s `registerSW({ immediate: true, onNeedRefresh, onRegisteredSW })`. On `onNeedRefresh` (new version detected) we **silently activate** the waiting SW **without reloading** (`updateSW(false)`), so no current tab is disturbed. Fresh assets are served on the **next full page load / app reopen**.
- **Convergence:** `onRegisteredSW` installs a periodic `registration.update()` (hourly) so long-lived sessions still pick up new versions in the background.
- **Stale-chunk safety net:** a global handler catches a failed dynamic `import()` (an old tab requesting a now-deleted hashed chunk after a deploy) and performs a single clean `location.reload()` — the only automatic reload, and only when the alternative is a broken lazy route.
- **Header:** `vercel.json` sets `Cache-Control: no-cache` on `/sw.js` and `/manifest.webmanifest` so update detection always works.

The exact `virtual:pwa-register` call to background-activate without reload (`updateSW(false)` vs. deferring to next load) will be confirmed against the installed plugin during implementation; the behavioral contract above is fixed.

## 7. File plan

### New `pwa/` folder (build config home — your request)
```
pwa/
├── manifest.ts          # web app manifest object (name, short_name, description, id, start_url:/dashboard,
│                        #   scope:/, display:standalone, theme/background color, icons[], categories)
├── sw-policy.ts         # SINGLE SOURCE OF TRUTH: navigateFallbackDenylist regexes + globIgnores (landing chunk)
├── vite-pwa.ts          # buildPwaPlugin(): returns configured VitePWA() using manifest.ts + sw-policy.ts
├── pwa-assets.config.ts # @vite-pwa/assets-generator config (source: public/logo.png → icon set)
└── README.md            # how the 4 layers work, how to test (build+preview+Lighthouse), how to regen icons
```

### New `src/` runtime pieces (import a Vite virtual module + wire into React/i18n)
```
src/lib/pwa/
├── register-sw.ts       # initPwa(): guarded conditional registration + silent background update + chunk-error reload
├── should-register.ts   # shouldRegisterHere(pathname) (mirrors sw-policy excludes; unit-tested)
└── use-install-prompt.ts# beforeinstallprompt capture; { canInstall, promptInstall, isIosSafari, isInstalled, dismiss }
src/components/
└── InstallAppBanner.tsx # dismissible banner (login + app only); RTL-aware; 'pwa' i18n namespace; dismiss persisted
```

### Modified files
| File | Change |
|---|---|
| `package.json` | add devDeps `vite-plugin-pwa@^1.3.0`, `@vite-pwa/assets-generator@^1.0.2`; add script `"pwa:icons": "pwa-assets-generator --preset … pwa/pwa-assets.config.ts"` (exact CLI confirmed in impl) |
| `vite.config.ts` | add `buildPwaPlugin()` to `plugins`; add `manualChunks` branch returning `landing` for `src/landing/` modules |
| `index.html` | add Apple metas (`apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`) and a proper `apple-touch-icon` (180×180). Manifest `<link>` is auto-injected by the plugin |
| `src/main.tsx` | call `initPwa()` once at startup (it self-guards; never registers on landing) |
| `src/pages/LoginPage.tsx`, `src/pages/SignupPage.tsx` | mount `<InstallAppBanner/>` |
| `src/components/AppLayout.tsx`, `src/components/MobileAppLayout.tsx` | mount `<InstallAppBanner/>` + add an "Install app" menu item (desktop sidebar footer + mobile "More" sheet) wired to `promptInstall()` / iOS sheet |
| `vercel.json` | add `headers` block: `no-cache` for `/sw.js` and `/manifest.webmanifest` |
| `src/lib/i18n/index.ts` | add `"pwa"` to `PAGE_NAMESPACES` |
| `src/lib/i18n/locales/{en,it,de,hi,ml,ta,te,ar}.json` | add a `pwa` block (en authored first, then translated to the other 7) |
| `src/vite-env.d.ts` | add `/// <reference types="vite-plugin-pwa/client" />` for `virtual:pwa-register` types |
| `eslint.config.js` (if needed) | ensure `pwa/**` is linted under the Node/config rule block |
| `public/` | committed generated icons: `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png` |

## 8. Manifest (target values)

- `name`: "ProfitSync" · `short_name`: "ProfitSync" (10 chars)
- `description`: existing tagline — "ProfitSync brings your clients, cash flow, and quotations into one clean workspace…"
- `id`: `/dashboard` · `start_url`: `/dashboard` · `scope`: `/`
- `display`: `standalone` · `background_color`: `#ffffff` · `theme_color`: `#ffffff` (matches existing light theme-color; dark handled by existing `prefers-color-scheme` metas)
- `categories`: `["business", "finance", "productivity"]`
- `icons`: 192 (any), 512 (any), 512 (maskable). `apple-touch-icon` provided via `<link>` in `index.html`.

## 9. Install prompt UX

- `use-install-prompt.ts` listens for `beforeinstallprompt`, calls `preventDefault()`, stashes the event, exposes `canInstall` + `promptInstall()`. Detects standalone/installed (`display-mode: standalone` / `navigator.standalone`) to hide UI when already installed. Detects iOS Safari (no `beforeinstallprompt`) to show an "Add to Home Screen → Share → Add" instruction sheet instead.
- `<InstallAppBanner/>` is dismissible; dismissal persisted in `localStorage` (`profitsync-pwa-install-dismissed`, re-show after ~14 days). Mounted on `/login`, `/signup`, and inside `AppLayout`/`MobileAppLayout` only — **never** on `/`.
- All strings via `useTranslation("pwa")`; RTL works automatically for `ar`.

## 10. Build / dev / test plan

- **Dev:** SW disabled in `vite dev`/`vercel dev` (`devOptions.enabled: false`) to avoid caching surprises while developing.
- **Verify:** `npm run build && npm run preview`, then in the browser:
  1. `/login` registers the SW; `/` does **not** (DevTools → Application → Service Workers).
  2. `manifest.webmanifest` loads; install affordance appears on `/login`/app, not on `/`.
  3. Lighthouse "Installable" passes; icons + maskable render.
  4. Landing `/`, legal, and `/api/*` are served from network (not cache).
  5. Update flow: rebuild, reload — new SW activates silently, fresh assets on next load, no forced reload mid-form.
- **Real-device:** install on Android Chrome (native prompt) and iOS Safari (instruction sheet).
- **Static checks:** `npm run typecheck` and `npm run lint` clean; one unit test for `shouldRegisterHere()`.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Forced reload loses form data | Use silent background activation (§6), never auto-reload on update |
| Old tab requests deleted hashed chunk after deploy | Chunk-load-error → single `reload()` recovery |
| SW accidentally controls/caches landing | 4-layer exclusion (§5); verified in test step 1 & 4 |
| SW caching `/api/*` or Clerk endpoints | `/api/` denylisted; Clerk endpoints are cross-origin and uncached by default |
| Drift between `sw-policy.ts` (build) and `should-register.ts` (client) | Both reference the same documented prefix list; cross-referenced in comments; `should-register` unit-tested |
| Stale SW served by CDN | `Cache-Control: no-cache` on `/sw.js` + `/manifest.webmanifest` |

## 12. Implementation sequence (detail comes from the implementation plan)

1. Install deps; scaffold `pwa/` (manifest, sw-policy, vite-pwa, assets config, README).
2. Generate + commit icons from `logo.png`.
3. Wire `buildPwaPlugin()` + `landing` manualChunk into `vite.config.ts`; add `vite-env.d.ts` reference.
4. Add `src/lib/pwa/*` (register, guard, install hook) + `initPwa()` in `main.tsx`.
5. Build `InstallAppBanner` + menu items; mount on login/signup/app only.
6. `index.html` Apple metas + apple-touch-icon; `vercel.json` headers.
7. i18n `pwa` namespace across all 8 locales.
8. `npm run build && preview` verification + Lighthouse + device install; typecheck/lint/test.
