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
