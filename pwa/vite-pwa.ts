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
