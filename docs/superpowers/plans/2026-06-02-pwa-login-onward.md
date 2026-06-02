# ProfitSync PWA (login-onward) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ProfitSync an installable, silently self-updating PWA from `/login`/`/signup` and the authenticated app onward, while the marketing landing page (`/`) stays a plain, uncached website.

**Architecture:** `vite-plugin-pwa` (generateSW/Workbox) with all build config under a new `pwa/` folder. The landing page is excluded via 4 layers: conditional SW registration (never on `/` or legal/invitation routes), a Workbox navigate-fallback denylist, exclusion of the isolated `landing` chunk from precache, and `start_url:/dashboard` + install UI gated to app/auth screens. Updates are applied form-safely: a new SW activates silently in the background (no forced reload); fresh assets load on the next full navigation. A `vite:preloadError` handler does a single recovery reload for stale lazy chunks.

**Tech Stack:** React 19, Vite 7.3.1, TypeScript, `vite-plugin-pwa@^1.3.0`, `@vite-pwa/assets-generator@^1.0.2`, Workbox (bundled), react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-pwa-login-onward-design.md`

**Commit convention:** every commit message ends with the trailer:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File map

| Path | Responsibility |
|---|---|
| `pwa/manifest.ts` | Web app manifest object |
| `pwa/sw-policy.ts` | Single source of truth: navigate-fallback denylist + precache glob ignores |
| `pwa/vite-pwa.ts` | `buildPwaPlugin()` — configured `VitePWA()` |
| `pwa/pwa-assets.config.ts` | Icon-generation config (source `public/logo.png`) |
| `pwa/README.md` | How the 4 layers work + how to test/regenerate icons |
| `src/vite-env.d.ts` | Vite + `virtual:pwa-register` ambient types |
| `src/lib/pwa/should-register.ts` | `shouldRegisterHere(pathname)` route guard |
| `src/lib/pwa/should-register.test.ts` | Unit test for the guard |
| `src/lib/pwa/use-install-prompt.ts` | `beforeinstallprompt` store + `useInstallPrompt()` + `promptInstall()` + `ensureInstallListener()` |
| `src/lib/pwa/register-sw.ts` | `initPwa()` — conditional registration + silent update + chunk-error reload |
| `src/components/InstallAppBanner.tsx` | `InstallAppBanner` + `InstallMenuItem` |
| `vite.config.ts` | Add plugin + `landing` manualChunk |
| `index.html` | Apple PWA metas + apple-touch-icon |
| `vercel.json` | `no-cache` headers for `/sw.js` + `/manifest.webmanifest` |
| `src/main.tsx` | `initPwa()` at boot |
| `src/pages/LoginPage.tsx`, `src/pages/SignupPage.tsx` | banner + `initPwa()` on mount |
| `src/components/AppLayout.tsx`, `src/components/MobileAppLayout.tsx` | banner + install menu item + `initPwa()` |
| `src/lib/i18n/index.ts` + 8 locale JSONs | `pwa` namespace |
| `public/pwa-*.png`, `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png` | generated icons (committed) |

---

## Task 1: Install dependencies

**Files:** Modify `package.json` (+ lockfile)

- [ ] **Step 1: Install the two dev dependencies**

Run:
```bash
npm install -D vite-plugin-pwa@^1.3.0 @vite-pwa/assets-generator@^1.0.2
```
Expected: both added to `devDependencies`; `vite-plugin-pwa` pulls in `workbox-build`/`workbox-window` transitively.

- [ ] **Step 2: Add the icon-generation script to `package.json`**

In the `"scripts"` block, add this line (after `"preview": "vite preview"`):
```json
    "pwa:icons": "pwa-assets-generator -c pwa/pwa-assets.config.ts",
```

- [ ] **Step 3: Verify install**

Run: `npm ls vite-plugin-pwa @vite-pwa/assets-generator`
Expected: both resolve at the installed versions, no `UNMET` errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add vite-plugin-pwa and pwa assets generator"
```

---

## Task 2: Vite + virtual module ambient types

**Files:** Create `src/vite-env.d.ts`

- [ ] **Step 1: Create the type reference file**

Create `src/vite-env.d.ts`:
```typescript
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: PASS (no new errors; `import.meta.env` and `virtual:pwa-register` now have types).

- [ ] **Step 3: Commit**

```bash
git add src/vite-env.d.ts
git commit -m "build: add vite + vite-plugin-pwa client type references"
```

---

## Task 3: `pwa/` config files

**Files:** Create `pwa/manifest.ts`, `pwa/sw-policy.ts`, `pwa/vite-pwa.ts`, `pwa/pwa-assets.config.ts`, `pwa/README.md`

- [ ] **Step 1: Create `pwa/manifest.ts`**

```typescript
import type { ManifestOptions } from "vite-plugin-pwa"

// The installed-app manifest. start_url is /dashboard so launching the home-screen
// icon goes straight into the product (AppLayout redirects to /login when signed out).
// scope is "/" because the app's routes (/login, /dashboard, /clients, …) are all
// siblings of the landing page "/", with no narrower shared prefix; the landing page
// is kept out of the PWA by sw-policy.ts + conditional registration instead.
export const manifest: Partial<ManifestOptions> = {
  name: "ProfitSync",
  short_name: "ProfitSync",
  description:
    "ProfitSync brings your clients, cash flow, and quotations into one clean workspace — so you always know exactly where your money stands.",
  id: "/dashboard",
  start_url: "/dashboard",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  lang: "en",
  dir: "ltr",
  categories: ["business", "finance", "productivity"],
  icons: [
    { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}
```

- [ ] **Step 2: Create `pwa/sw-policy.ts`**

```typescript
// SINGLE SOURCE OF TRUTH for what the service worker must NOT treat as part of the
// installable app. Mirrored (in intent) by src/lib/pwa/should-register.ts on the client.

// Navigation requests matching these are never served the cached app-shell fallback,
// so the landing page, legal pages, invitation links and the API always hit the network.
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [
  /^\/$/, // marketing landing page
  /^\/privacy-policy/, // legal
  /^\/terms-of-service/, // legal
  /^\/invitations\//, // pre-auth invitation links
  /^\/api\//, // serverless API — never SW-handled
  /^\/@/, // Vite internal "@" paths
]

// The isolated marketing chunk (see the `landing` manualChunk in vite.config.ts) is
// kept out of the precache entirely, so landing assets are never cached.
export const PRECACHE_GLOB_IGNORES: string[] = ["**/landing-*.js", "**/landing-*.css"]
```

- [ ] **Step 3: Create `pwa/vite-pwa.ts`**

```typescript
import { VitePWA } from "vite-plugin-pwa"

import { manifest } from "./manifest"
import { NAVIGATE_FALLBACK_DENYLIST, PRECACHE_GLOB_IGNORES } from "./sw-policy"

// registerType:'prompt' + injectRegister:null means the plugin generates a SW that
// WAITS on update and never auto-injects a registration script. We register manually
// and conditionally (login-onward) in src/lib/pwa/register-sw.ts, and apply updates
// silently there without reloading the page — see the spec §6 for the form-safety reason.
export function buildPwaPlugin() {
  return VitePWA({
    registerType: "prompt",
    injectRegister: null,
    strategies: "generateSW",
    manifest,
    includeAssets: ["favicon.png", "apple-touch-icon-180x180.png", "maskable-icon-512x512.png"],
    workbox: {
      globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
      globIgnores: PRECACHE_GLOB_IGNORES,
      navigateFallback: "/index.html",
      navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST,
      cleanupOutdatedCaches: true,
      clientsClaim: false,
      skipWaiting: false,
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    devOptions: {
      // SW disabled in dev (vite dev / vercel dev) to avoid caching surprises while
      // developing. Test the PWA via `npm run build && npm run preview`.
      enabled: false,
    },
  })
}
```

- [ ] **Step 4: Create `pwa/pwa-assets.config.ts`**

```typescript
import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config"

// Generates the PWA icon set from the brand logo into public/:
//   pwa-64x64.png, pwa-192x192.png, pwa-512x512.png,
//   maskable-icon-512x512.png, apple-touch-icon-180x180.png, favicon.ico
// Run with: npm run pwa:icons
export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/logo.png"],
})
```

- [ ] **Step 5: Create `pwa/README.md`**

```markdown
# PWA configuration

ProfitSync is an installable PWA **from `/login`/`/signup` and the authenticated app
onward**. The marketing landing page (`/`) is intentionally NOT part of the PWA.

## Files
- `manifest.ts` — web app manifest (start_url `/dashboard`, scope `/`, icons).
- `sw-policy.ts` — the navigate-fallback denylist + precache glob ignores (single
  source of truth for "what the SW must not treat as the app").
- `vite-pwa.ts` — `buildPwaPlugin()`, imported by `../vite.config.ts`.
- `pwa-assets.config.ts` — icon generation config (source `../public/logo.png`).

Client runtime lives in `../src/lib/pwa/` (`register-sw.ts`, `should-register.ts`,
`use-install-prompt.ts`) and `../src/components/InstallAppBanner.tsx`.

## How the landing page is excluded (4 layers)
1. **Conditional registration** — `register-sw.ts` only registers the SW when
   `shouldRegisterHere(pathname)` is true (never `/`, `/privacy-policy`,
   `/terms-of-service`, `/invitations/*`).
2. **Navigate-fallback denylist** — even once the SW is active, those paths + `/api/*`
   always hit the network (`NAVIGATE_FALLBACK_DENYLIST`).
3. **Precache ignore** — the isolated `landing` Rollup chunk is excluded from precache
   (`PRECACHE_GLOB_IGNORES` + the `landing` manualChunk in `vite.config.ts`).
4. **start_url + gated UI** — `start_url:/dashboard`; the install banner/menu item only
   render on login/app screens.

## Updates (silent, form-safe)
`registerType:'prompt'` + we apply the waiting SW with `updateSW(false)` (skipWaiting,
no reload). Fresh assets load on the next full navigation/app reopen. A `vite:preloadError`
handler does one recovery reload if an old tab requests a deleted hashed chunk.

## Regenerate icons
```bash
npm run pwa:icons
```
Then commit the regenerated files in `public/`.

## Test
```bash
npm run build && npm run preview
```
- DevTools → Application → Service Workers: registered on `/login`, NOT on `/`.
- Lighthouse → Installable passes.
- `/`, legal, `/api/*` are served from the network (not cache).
```

- [ ] **Step 6: Commit**

```bash
git add pwa/
git commit -m "feat(pwa): add pwa/ config (manifest, sw-policy, plugin, icon config, README)"
```

---

## Task 4: Wire the plugin + landing chunk into Vite

**Files:** Modify `vite.config.ts`

- [ ] **Step 1: Add the import**

At the top of `vite.config.ts`, after the existing `import { defineConfig } from "vite"` line, add:
```typescript
import { buildPwaPlugin } from "./pwa/vite-pwa"
```

- [ ] **Step 2: Add the plugin to the plugins array**

Replace:
```typescript
  plugins: [react(), tailwindcss()],
```
with:
```typescript
  plugins: [react(), tailwindcss(), buildPwaPlugin()],
```

- [ ] **Step 3: Isolate the landing chunk in `manualChunks`**

Replace the `manualChunks` function body:
```typescript
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts"
          return "vendor"
        },
```
with:
```typescript
        manualChunks(id) {
          // Isolate the marketing landing page into its own chunk so it can be kept
          // out of the PWA precache (see pwa/sw-policy.ts PRECACHE_GLOB_IGNORES).
          if (id.includes("/src/landing/")) return "landing"
          if (!id.includes("node_modules")) return
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts"
          return "vendor"
        },
```

- [ ] **Step 4: Verify the build emits PWA artifacts**

Run: `npm run build`
Expected: PASS; `dist/` contains `sw.js`, a `workbox-*.js`, `manifest.webmanifest`, and a `landing-*.js` chunk. Confirm:
```bash
ls dist/sw.js dist/manifest.webmanifest && ls dist/assets/landing-*.js
```
Expected: all three listed.

- [ ] **Step 5: Confirm the landing chunk is NOT precached**

Run:
```bash
grep -c "landing-" dist/sw.js || true
```
Expected: `0` (the landing chunk filename does not appear in the precache manifest).

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts
git commit -m "feat(pwa): register vite-plugin-pwa and isolate the landing chunk"
```

---

## Task 5: Generate and commit icons

**Files:** Create `public/pwa-64x64.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png` (and possibly `public/favicon.ico`)

- [ ] **Step 1: Generate the icon set from the logo**

Run: `npm run pwa:icons`
Expected: writes `pwa-64x64.png`, `pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png` (and `favicon.ico`) into `public/`.

(If the CLI rejects `-c`, fall back to: `npx pwa-assets-generator --preset minimal-2023 public/logo.png`.)

- [ ] **Step 2: Verify the three manifest-referenced icons exist**

Run:
```bash
ls public/pwa-192x192.png public/pwa-512x512.png public/maskable-icon-512x512.png public/apple-touch-icon-180x180.png
```
Expected: all four listed.

- [ ] **Step 3: Commit**

```bash
git add public/pwa-*.png public/maskable-icon-512x512.png public/apple-touch-icon-180x180.png
git add public/favicon.ico 2>/dev/null || true
git commit -m "feat(pwa): generate app icons from logo (192/512/maskable/apple-touch)"
```

---

## Task 6: Route guard `shouldRegisterHere` (TDD)

**Files:** Create `src/lib/pwa/should-register.ts`, `src/lib/pwa/should-register.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pwa/should-register.test.ts`:
```typescript
import { describe, it, expect } from "vitest"

import { shouldRegisterHere } from "./should-register"

describe("shouldRegisterHere", () => {
  it("excludes the landing page", () => {
    expect(shouldRegisterHere("/")).toBe(false)
  })

  it("excludes legal and invitation routes", () => {
    expect(shouldRegisterHere("/privacy-policy")).toBe(false)
    expect(shouldRegisterHere("/terms-of-service")).toBe(false)
    expect(shouldRegisterHere("/invitations/abc123")).toBe(false)
  })

  it("includes auth and app routes", () => {
    expect(shouldRegisterHere("/login")).toBe(true)
    expect(shouldRegisterHere("/signup")).toBe(true)
    expect(shouldRegisterHere("/onboarding")).toBe(true)
    expect(shouldRegisterHere("/dashboard")).toBe(true)
    expect(shouldRegisterHere("/clients/42")).toBe(true)
    expect(shouldRegisterHere("/admin/users")).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pwa/should-register.test.ts`
Expected: FAIL — cannot resolve `./should-register`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pwa/should-register.ts`:
```typescript
// Mirrors pwa/sw-policy.ts: the service worker (and therefore the PWA) must never be
// registered on the marketing landing page or other pre-auth public routes. Everything
// else (auth + app) is fair game.
const EXCLUDED_PREFIXES = ["/privacy-policy", "/terms-of-service", "/invitations"]

export function shouldRegisterHere(pathname: string): boolean {
  if (pathname === "/") return false
  for (const prefix of EXCLUDED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return false
  }
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/pwa/should-register.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pwa/should-register.ts src/lib/pwa/should-register.test.ts
git commit -m "feat(pwa): add login-onward registration route guard (TDD)"
```

---

## Task 7: Install-prompt store

**Files:** Create `src/lib/pwa/use-install-prompt.ts`

- [ ] **Step 1: Create the store + hook**

```typescript
import { useSyncExternalStore } from "react"

// The browser's beforeinstallprompt event is not in the standard DOM lib types.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

interface InstallState {
  canInstall: boolean
  isInstalled: boolean
  isIosSafari: boolean
}

const SERVER_STATE: InstallState = { canInstall: false, isInstalled: false, isIosSafari: false }

let deferredPrompt: BeforeInstallPromptEvent | null = null
let initialized = false
const listeners = new Set<() => void>()

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(standalone || iosStandalone)
}

function detectIosSafari(): boolean {
  if (typeof window === "undefined") return false
  const ua = window.navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && "ontouchend" in window.document)
  const isSafari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
  return isIos && isSafari && !detectInstalled()
}

let snapshot: InstallState = {
  canInstall: false,
  isInstalled: detectInstalled(),
  isIosSafari: detectIosSafari(),
}

function recompute(): void {
  snapshot = {
    canInstall: deferredPrompt !== null && !detectInstalled(),
    isInstalled: detectInstalled(),
    isIosSafari: detectIosSafari(),
  }
  listeners.forEach((listener) => listener())
}

// Attach the capture listeners once. Called from initPwa() (so it's gated to
// login-onward routes, exactly where the event can fire once the SW is active) and
// from subscribe() as a backstop.
export function ensureInstallListener(): void {
  if (initialized || typeof window === "undefined") return
  initialized = true
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    recompute()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    recompute()
  })
}

function subscribe(listener: () => void): () => void {
  ensureInstallListener()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): InstallState {
  return snapshot
}

function getServerSnapshot(): InstallState {
  return SERVER_STATE
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  recompute()
  return choice.outcome === "accepted"
}

export function useInstallPrompt(): InstallState & { promptInstall: typeof promptInstall } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { ...state, promptInstall }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pwa/use-install-prompt.ts
git commit -m "feat(pwa): add beforeinstallprompt store and useInstallPrompt hook"
```

---

## Task 8: Service-worker registration `initPwa`

**Files:** Create `src/lib/pwa/register-sw.ts`

- [ ] **Step 1: Create the registration module**

```typescript
import { registerSW } from "virtual:pwa-register"

import { ensureInstallListener } from "./use-install-prompt"
import { shouldRegisterHere } from "./should-register"

const CHUNK_RELOAD_KEY = "profitsync-chunk-reload"
let registered = false

// After a deploy, an old tab may try to lazy-load a hashed chunk that no longer exists.
// Vite fires `vite:preloadError`; we recover with a single reload (guarded so we never loop).
function installChunkErrorReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
    event.preventDefault()
    window.location.reload()
  })
  window.addEventListener("load", () => {
    window.setTimeout(() => sessionStorage.removeItem(CHUNK_RELOAD_KEY), 5000)
  })
}

// Registers the service worker — but ONLY on login/app routes, never on the marketing
// landing page or other pre-auth public routes. Idempotent and safe to call from
// multiple mount points (boot + login/signup/app shells).
export function initPwa(): void {
  if (registered) return
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
  if (!shouldRegisterHere(window.location.pathname)) return
  registered = true

  ensureInstallListener()
  installChunkErrorReload()

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      // Hourly background check so long-lived tabs converge to the latest deploy.
      window.setInterval(() => {
        void registration.update()
      }, 60 * 60 * 1000)
    },
    onNeedRefresh() {
      // New version available: activate it silently (skipWaiting) WITHOUT reloading the
      // current tab. Fresh assets load on the next full navigation/reopen, so an
      // in-progress form is never interrupted.
      void updateSW(false)
    },
  })
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (`virtual:pwa-register` resolves via the type reference from Task 2).

- [ ] **Step 3: Commit**

```bash
git add src/lib/pwa/register-sw.ts
git commit -m "feat(pwa): conditional SW registration with silent form-safe updates"
```

---

## Task 9: i18n `pwa` namespace

**Files:** Modify `src/lib/i18n/index.ts` and all 8 locale files in `src/lib/i18n/locales/`

- [ ] **Step 1: Register the namespace**

In `src/lib/i18n/index.ts`, replace:
```typescript
const PAGE_NAMESPACES = [
  "clients", "transactions", "quotations", "organizations", "members",
  "trash", "subscription", "billing", "theme", "plan", "planGlossary",
] as const
```
with:
```typescript
const PAGE_NAMESPACES = [
  "clients", "transactions", "quotations", "organizations", "members",
  "trash", "subscription", "billing", "theme", "plan", "planGlossary", "pwa",
] as const
```

- [ ] **Step 2: Add the `pwa` block to `en.json`**

In `src/lib/i18n/locales/en.json`, insert this block immediately after the opening `{` (as the first top-level key):
```json
  "pwa": {
    "installTitle": "Install ProfitSync",
    "installBody": "Add ProfitSync to your home screen for quick, full-screen access.",
    "installButton": "Install app",
    "dismiss": "Not now",
    "iosTitle": "Add to Home Screen",
    "iosBody": "Tap the Share icon, then choose “Add to Home Screen”."
  },
```

- [ ] **Step 3: Add the `pwa` block to `it.json`** (immediately after the opening `{`)
```json
  "pwa": {
    "installTitle": "Installa ProfitSync",
    "installBody": "Aggiungi ProfitSync alla schermata Home per un accesso rapido e a schermo intero.",
    "installButton": "Installa app",
    "dismiss": "Non ora",
    "iosTitle": "Aggiungi alla Home",
    "iosBody": "Tocca l’icona Condividi, poi scegli “Aggiungi alla schermata Home”."
  },
```

- [ ] **Step 4: Add the `pwa` block to `de.json`**
```json
  "pwa": {
    "installTitle": "ProfitSync installieren",
    "installBody": "Füge ProfitSync zum Startbildschirm hinzu – für schnellen Vollbildzugriff.",
    "installButton": "App installieren",
    "dismiss": "Jetzt nicht",
    "iosTitle": "Zum Startbildschirm hinzufügen",
    "iosBody": "Tippe auf das Teilen-Symbol und wähle „Zum Home-Bildschirm“."
  },
```

- [ ] **Step 5: Add the `pwa` block to `hi.json`**
```json
  "pwa": {
    "installTitle": "ProfitSync इंस्टॉल करें",
    "installBody": "त्वरित, फ़ुल-स्क्रीन ऐक्सेस के लिए ProfitSync को होम स्क्रीन पर जोड़ें।",
    "installButton": "ऐप इंस्टॉल करें",
    "dismiss": "अभी नहीं",
    "iosTitle": "होम स्क्रीन पर जोड़ें",
    "iosBody": "शेयर आइकन पर टैप करें, फिर “Add to Home Screen” चुनें।"
  },
```

- [ ] **Step 6: Add the `pwa` block to `ml.json`**
```json
  "pwa": {
    "installTitle": "ProfitSync ഇൻസ്റ്റാൾ ചെയ്യുക",
    "installBody": "വേഗത്തിലുള്ള, ഫുൾ-സ്ക്രീൻ ഉപയോഗത്തിന് ProfitSync ഹോം സ്ക്രീനിൽ ചേർക്കുക.",
    "installButton": "ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്യുക",
    "dismiss": "ഇപ്പോൾ വേണ്ട",
    "iosTitle": "ഹോം സ്ക്രീനിൽ ചേർക്കുക",
    "iosBody": "ഷെയർ ഐക്കണിൽ ടാപ്പ് ചെയ്ത് “Add to Home Screen” തിരഞ്ഞെടുക്കുക."
  },
```

- [ ] **Step 7: Add the `pwa` block to `ta.json`**
```json
  "pwa": {
    "installTitle": "ProfitSync ஐ நிறுவவும்",
    "installBody": "விரைவான, முழுத்திரை அணுகலுக்கு ProfitSync ஐ முகப்புத் திரையில் சேர்க்கவும்.",
    "installButton": "ஆப்பை நிறுவவும்",
    "dismiss": "இப்போது வேண்டாம்",
    "iosTitle": "முகப்புத் திரையில் சேர்க்கவும்",
    "iosBody": "பகிர் ஐகானைத் தட்டி, “Add to Home Screen” ஐத் தேர்ந்தெடுக்கவும்."
  },
```

- [ ] **Step 8: Add the `pwa` block to `te.json`**
```json
  "pwa": {
    "installTitle": "ProfitSync ని ఇన్‌స్టాల్ చేయండి",
    "installBody": "వేగవంతమైన, పూర్తి-స్క్రీన్ యాక్సెస్ కోసం ProfitSync ని హోమ్ స్క్రీన్‌కు జోడించండి.",
    "installButton": "యాప్‌ను ఇన్‌స్టాల్ చేయండి",
    "dismiss": "ఇప్పుడు కాదు",
    "iosTitle": "హోమ్ స్క్రీన్‌కు జోడించండి",
    "iosBody": "షేర్ ఐకాన్‌ను నొక్కి, “Add to Home Screen” ఎంచుకోండి."
  },
```

- [ ] **Step 9: Add the `pwa` block to `ar.json`** (RTL — no special handling needed; i18n syncs `dir`)
```json
  "pwa": {
    "installTitle": "تثبيت ProfitSync",
    "installBody": "أضِف ProfitSync إلى الشاشة الرئيسية للوصول السريع بملء الشاشة.",
    "installButton": "تثبيت التطبيق",
    "dismiss": "ليس الآن",
    "iosTitle": "إضافة إلى الشاشة الرئيسية",
    "iosBody": "اضغط على أيقونة المشاركة، ثم اختر «إضافة إلى الشاشة الرئيسية»."
  },
```

- [ ] **Step 10: Verify all 8 JSON files are valid**

Run:
```bash
for f in en it de hi ml ta te ar; do node -e "require('./src/lib/i18n/locales/$f.json').pwa.installButton" || echo "BROKEN: $f"; done; echo done
```
Expected: prints `done` with no `BROKEN` lines.

- [ ] **Step 11: Commit**

```bash
git add src/lib/i18n/index.ts src/lib/i18n/locales/*.json
git commit -m "i18n(pwa): add pwa namespace strings across all 8 locales"
```

---

## Task 10: Install banner + menu item components

**Files:** Create `src/components/InstallAppBanner.tsx`

- [ ] **Step 1: Create the components**

```tsx
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Download, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useInstallPrompt } from "@/lib/pwa/use-install-prompt"

const DISMISS_KEY = "profitsync-pwa-install-dismissed"
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_MS
  } catch {
    return false
  }
}

// Dismissible install card. Renders only on installable browsers (or iOS Safari with
// instructions). Self-hides when already installed or recently dismissed. Mounted on
// login/signup/app screens only — never on the landing page.
export function InstallAppBanner({ className }: { className?: string }) {
  const { t } = useTranslation("pwa")
  const { canInstall, isInstalled, isIosSafari, promptInstall } = useInstallPrompt()
  const [dismissed, setDismissed] = useState<boolean>(recentlyDismissed)

  if (isInstalled || dismissed) return null
  const mode: "install" | "ios" | null = canInstall ? "install" : isIosSafari ? "ios" : null
  if (!mode) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* ignore storage failures */
    }
    setDismissed(true)
  }

  return (
    <div className={cn("relative flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm", className)}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Download className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{mode === "ios" ? t("iosTitle") : t("installTitle")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{mode === "ios" ? t("iosBody") : t("installBody")}</p>
        {mode === "install" && (
          <Button size="sm" className="mt-2" onClick={() => void promptInstall()}>
            {t("installButton")}
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismiss")}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// Compact "Install app" entry for account/menu dropdowns. Shown only when the native
// install prompt is available (Android/desktop Chrome); iOS users use the banner.
export function InstallMenuItem() {
  const { t } = useTranslation("pwa")
  const { canInstall, isInstalled, promptInstall } = useInstallPrompt()
  if (isInstalled || !canInstall) return null
  return (
    <DropdownMenuItem onClick={() => void promptInstall()}>
      <Download className="size-4 mr-2" /> {t("installButton")}
    </DropdownMenuItem>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/InstallAppBanner.tsx
git commit -m "feat(pwa): add InstallAppBanner and InstallMenuItem components"
```

---

## Task 11: Boot registration in `main.tsx`

**Files:** Modify `src/main.tsx`

- [ ] **Step 1: Import and call `initPwa`**

In `src/main.tsx`, after the line `import { ThemeProvider } from "@/components/theme-provider.tsx"`, add:
```typescript
import { initPwa } from "@/lib/pwa/register-sw"
```
Then, after the `createRoot(...).render(...)` call (the closing `)` on the last line), add:
```typescript

// Register the PWA service worker (no-op on the landing page and other pre-auth routes).
initPwa()
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat(pwa): initialize PWA at app boot"
```

---

## Task 12: Mount banner + register on auth screens

**Files:** Modify `src/pages/LoginPage.tsx`, `src/pages/SignupPage.tsx`

- [ ] **Step 1: Update `LoginPage.tsx`**

Replace the entire file `src/pages/LoginPage.tsx` with:
```tsx
import { useEffect } from "react"
import { SignIn } from "@clerk/clerk-react"

import { InstallAppBanner } from "@/components/InstallAppBanner"
import { initPwa } from "@/lib/pwa/register-sw"

export function LoginPage() {
  // Registering here (in addition to boot) covers users who arrive via SPA navigation
  // from the landing page, where boot-time registration was skipped.
  useEffect(() => {
    initPwa()
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 gap-4">
      <SignIn path="/login" routing="path" signUpUrl="/signup" fallbackRedirectUrl="/dashboard" />
      <InstallAppBanner className="w-full max-w-sm" />
    </div>
  )
}
```

- [ ] **Step 2: Update `SignupPage.tsx` imports**

In `src/pages/SignupPage.tsx`, replace:
```tsx
import { useState } from "react"
import { Link } from "react-router-dom"
```
with:
```tsx
import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
```
and add, after the existing `import { ArrowRight, TrendingUp } from "lucide-react"` line:
```tsx
import { InstallAppBanner } from "@/components/InstallAppBanner"
import { initPwa } from "@/lib/pwa/register-sw"
```

- [ ] **Step 3: Add the effect + banner to `SignupPage`**

In `src/pages/SignupPage.tsx`, replace:
```tsx
export function SignupPage() {
  const [agreed, setAgreed] = useState(false)
  const [continued, setContinued] = useState(false)

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
```
with:
```tsx
export function SignupPage() {
  const [agreed, setAgreed] = useState(false)
  const [continued, setContinued] = useState(false)

  useEffect(() => {
    initPwa()
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 gap-4">
```
Then, immediately before the final `</div>` that closes that outer container (the last line before the function's closing `)`), add:
```tsx
      <InstallAppBanner className="w-full max-w-md" />
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.tsx src/pages/SignupPage.tsx
git commit -m "feat(pwa): show install banner and register SW on login/signup"
```

---

## Task 13: Mount banner + menu item in the app shells

**Files:** Modify `src/components/AppLayout.tsx`, `src/components/MobileAppLayout.tsx`

- [ ] **Step 1: Add imports to `AppLayout.tsx`**

In `src/components/AppLayout.tsx`, after the line `import { useIsMobile } from "@/hooks/use-mobile"`, add:
```tsx
import { InstallAppBanner, InstallMenuItem } from "@/components/InstallAppBanner"
import { initPwa } from "@/lib/pwa/register-sw"
```

- [ ] **Step 2: Register the SW when the app shell mounts**

In `src/components/AppLayout.tsx`, replace the outer `AppLayout` effect:
```tsx
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate("/login")
    }
  }, [isLoaded, isSignedIn, navigate])
```
with:
```tsx
  useEffect(() => {
    initPwa()
  }, [])

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate("/login")
    }
  }, [isLoaded, isSignedIn, navigate])
```

- [ ] **Step 3: Add the install menu item to the desktop account dropdown**

In `src/components/AppLayout.tsx`, replace:
```tsx
                <DropdownMenuItem onClick={() => navigate("/organizations")}>
                  <Building2 className="size-4 mr-2" />
                  {t("account.organizations")}
                </DropdownMenuItem>
                {isAdmin && (
```
with:
```tsx
                <DropdownMenuItem onClick={() => navigate("/organizations")}>
                  <Building2 className="size-4 mr-2" />
                  {t("account.organizations")}
                </DropdownMenuItem>
                <InstallMenuItem />
                {isAdmin && (
```

- [ ] **Step 4: Mount the banner above the desktop content area**

In `src/components/AppLayout.tsx`, replace:
```tsx
        <div className="flex-1 overflow-auto">
          {orgLoading ? (
```
with:
```tsx
        <InstallAppBanner className="mx-4 mt-4" />
        <div className="flex-1 overflow-auto">
          {orgLoading ? (
```

- [ ] **Step 5: Add imports to `MobileAppLayout.tsx`**

In `src/components/MobileAppLayout.tsx`, after the line `import { LanguageSwitcher } from "@/components/LanguageSwitcher"`, add:
```tsx
import { InstallAppBanner, InstallMenuItem } from "@/components/InstallAppBanner"
```

- [ ] **Step 6: Add the install menu item to the mobile menu dropdown**

In `src/components/MobileAppLayout.tsx`, replace:
```tsx
              <DropdownMenuItem onClick={() => navigate("/subscription")}>
                <CreditCard className="size-4 mr-2" /> {t("nav.subscription")}
              </DropdownMenuItem>
              <div className="px-1 py-1 flex items-center gap-2">
```
with:
```tsx
              <DropdownMenuItem onClick={() => navigate("/subscription")}>
                <CreditCard className="size-4 mr-2" /> {t("nav.subscription")}
              </DropdownMenuItem>
              <InstallMenuItem />
              <div className="px-1 py-1 flex items-center gap-2">
```

- [ ] **Step 7: Mount the banner at the top of the mobile content**

In `src/components/MobileAppLayout.tsx`, replace:
```tsx
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-32 page-enter" key={location.pathname + (activeOrg?.id ?? "")}>
        {orgLoading ? (
```
with:
```tsx
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-32 page-enter" key={location.pathname + (activeOrg?.id ?? "")}>
        <InstallAppBanner className="mx-4 mt-3" />
        {orgLoading ? (
```

- [ ] **Step 8: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/AppLayout.tsx src/components/MobileAppLayout.tsx
git commit -m "feat(pwa): mount install banner + menu item in app shells; register SW"
```

---

## Task 14: HTML meta tags + apple-touch-icon

**Files:** Modify `index.html`

- [ ] **Step 1: Point apple-touch-icon at the generated 180px icon**

In `index.html`, replace:
```html
  <link rel="apple-touch-icon" href="/favicon.png" />
```
with:
```html
  <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
```

- [ ] **Step 2: Add Apple/standalone meta tags**

In `index.html`, replace:
```html
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
  <title>ProfitSync — Know your profit. Sync your business.</title>
```
with:
```html
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="ProfitSync" />
  <title>ProfitSync — Know your profit. Sync your business.</title>
```

- [ ] **Step 3: Verify the manifest link is auto-injected on build**

Run: `npm run build && grep -o 'rel="manifest"' dist/index.html`
Expected: prints `rel="manifest"` (the plugin injected `<link rel="manifest" href="/manifest.webmanifest">`).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(pwa): add Apple PWA meta tags and apple-touch-icon"
```

---

## Task 15: Vercel headers for SW + manifest

**Files:** Modify `vercel.json`

- [ ] **Step 1: Add a `headers` block**

Replace the entire contents of `vercel.json` with:
```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/index?__apipath=$1"
    },
    {
      "source": "/((?!api|@)[^.]*)",
      "destination": "/"
    }
  ],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },
        { "key": "Content-Type", "value": "application/manifest+json; charset=utf-8" }
      ]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "require('./vercel.json'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(pwa): no-cache headers for sw.js and manifest.webmanifest"
```

---

## Task 16: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

Run: `npm run typecheck && npm run lint && npm run test:ci`
Expected: all PASS (including `should-register` tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: PASS. Confirm artifacts:
```bash
ls dist/sw.js dist/manifest.webmanifest dist/pwa-192x192.png dist/pwa-512x512.png dist/maskable-icon-512x512.png
```
Expected: all listed.

- [ ] **Step 3: Confirm landing chunk excluded from precache**

Run: `grep -c "landing-" dist/sw.js || true`
Expected: `0`.

- [ ] **Step 4: Preview + manual browser checks**

Run: `npm run preview`
Then in the browser (DevTools → Application):
- Visit `/login` → a service worker registers; `manifest.webmanifest` loads; install affordance/banner appears.
- Visit `/` (landing) in a fresh tab → confirm NO service worker controls it (Application → Service Workers shows none scoped/active for that document) and the page loads from network.
- Lighthouse (Application/PWA category) → "Installable" passes; icons + maskable detected.
- Rebuild while preview tab is open, reload once → fresh assets load, no forced auto-reload while idle on a page.

- [ ] **Step 5: Real-device install (manual)**

- Android Chrome: `Install app` button triggers the native prompt; installed app launches at `/dashboard`.
- iOS Safari: banner shows the "Add to Home Screen" instructions; after install, launches standalone at `/dashboard`.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(pwa): verification fixups" || echo "nothing to commit"
```

---

## Self-review (completed by plan author)

**Spec coverage:** §5 layer 1 → Tasks 6/8/12/13; layer 2 → Task 3 (`sw-policy`)/Task 4; layer 3 → Task 3 + Task 4 manualChunk + Task 16 step 3; layer 4 → Task 3 manifest + Task 10/13 gating. §6 update mechanism → Task 8. §7 file plan → all tasks. §8 manifest → Task 3. §9 install UX → Tasks 7/10/12/13. §10 build/test → Tasks 4/14/16. i18n (§3 #6) → Task 9. Icons (§3 #7) → Tasks 3/5. `vercel.json` (§7) → Task 15. Apple metas (§7) → Task 14. No gaps found.

**Placeholder scan:** none — every code/edit step has full content; the only conditional is the `-c` CLI fallback in Task 5 (documented with an exact alternative command).

**Type/name consistency:** `initPwa`, `shouldRegisterHere`, `useInstallPrompt`, `promptInstall`, `ensureInstallListener`, `InstallAppBanner`, `InstallMenuItem`, `buildPwaPlugin`, `manifest`, `NAVIGATE_FALLBACK_DENYLIST`, `PRECACHE_GLOB_IGNORES` are defined once and referenced consistently across tasks.
