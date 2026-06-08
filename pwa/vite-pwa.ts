import { VitePWA } from "vite-plugin-pwa"

import { manifest } from "./manifest"
import { NAVIGATE_FALLBACK_DENYLIST, PRECACHE_GLOB_IGNORES } from "./sw-policy"

// registerType:'prompt' + injectRegister:null means the plugin never auto-injects a
// registration script; we register manually (every route) in
// src/lib/pwa/register-sw.ts and apply updates silently there without reloading the
// page — so an in-progress form is never interrupted.
//
// skipWaiting + clientsClaim are OFF — this is the fix for the post-deploy "white
// screen requiring multiple reloads" bug.
//
//   Previously (ON), a freshly deployed SW activated and claimed already-open tabs
//   BEFORE its new precache was ready, while cleanupOutdatedCaches deleted the OLD
//   hashed chunks. The running page (still the old app) then lazy-loaded an old chunk
//   that had just been deleted and no longer existed on the server → 404 → blank
//   screen the reload guards couldn't escape (the SW kept serving the stale shell).
//
//   With both OFF, a new SW INSTALLS but WAITS. The old SW keeps serving its own
//   intact precache, so every open tab stays fully consistent (old shell + old chunks)
//   — no 404, no white screen, no interrupted form. The new SW activates only at a
//   clean boundary: the next cold load when no old tab is controlling, where shell and
//   chunks are guaranteed to match. register-sw.ts must therefore NOT force-activate it
//   (no updateSW on onNeedRefresh); it only keeps a bounded cache-bust reload as a
//   defensive net for any residual stale-HTTP-cache case.
//
//   Tradeoff: an already-open tab keeps running the version it loaded with until its
//   next cold start (or the hourly update check + reopen). Acceptable: no interruption,
//   and never a white screen.
export function buildPwaPlugin() {
  return VitePWA({
    registerType: "prompt",
    injectRegister: null,
    strategies: "generateSW",
    manifest,
    includeAssets: ["favicon.ico", "favicon-96x96.png", "apple-touch-icon.png"],
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
