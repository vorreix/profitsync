import { VitePWA } from "vite-plugin-pwa"

import { manifest } from "./manifest"
import { NAVIGATE_FALLBACK_DENYLIST, PRECACHE_GLOB_IGNORES } from "./sw-policy"

// registerType:'prompt' + injectRegister:null means the plugin never auto-injects a
// registration script; we register manually (every route) in
// src/lib/pwa/register-sw.ts and apply updates silently there without reloading the
// page — so an in-progress form is never interrupted.
//
// skipWaiting + clientsClaim are ON so a freshly deployed service worker activates
// immediately and takes over already-open tabs, instead of sitting in "waiting" until
// every tab is closed. This is what makes installed PWAs auto-update with no user
// action. It is safe here because:
//   • the SW only precaches static, content-hashed assets (never API responses);
//   • new hashed chunks load lazily on the next navigation, so the running page keeps
//     working on its already-loaded chunks until then;
//   • register-sw.ts has a `vite:preloadError` guard that does a single reload if a
//     post-deploy navigation references a chunk that was cleaned up.
// Existing installs converge to the new SW on their next visit / hourly update check.
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
      clientsClaim: true,
      skipWaiting: true,
      maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
    },
    devOptions: {
      // SW disabled in dev (vite dev / vercel dev) to avoid caching surprises while
      // developing. Test the PWA via `npm run build && npm run preview`.
      enabled: false,
    },
  })
}
