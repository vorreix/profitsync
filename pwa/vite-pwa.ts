import { VitePWA } from "vite-plugin-pwa"

import { manifest } from "./manifest"
import { matchAppNavigation, PRECACHE_GLOB_IGNORES } from "./sw-policy"

// ────────────────────────────────────────────────────────────────────────────
// The post-deploy white-screen problem, and how this config prevents it
//
// A white screen happens when a page (the "shell") references content-hashed
// chunks that no longer exist — a stale shell after a deploy. Two rules make
// that structurally impossible here:
//
// 1. Navigations are NETWORK-ONLY (with the precached shell as offline/timeout
//    fallback). A cold load therefore always gets the CURRENT index.html, whose
//    hashed assets exist on the server by definition. Only when the network is
//    unreachable (or slower than the timeout) does the SW serve its own
//    precached shell — and that shell's chunks are in the same precache, so it
//    is self-consistent too.
//
// 2. skipWaiting + clientsClaim are OFF. A new SW installs and WAITS; the old
//    SW's precache stays intact, so pages running the old version keep finding
//    their chunks. The waiting SW activates only when the user accepts the
//    in-app update prompt (src/lib/pwa/register-sw.ts calls updateSW(true),
//    which reloads onto the new version) or at the next cold start. Never
//    force-activate it without a reload — that is the historical bug where the
//    new SW deleted the running page's chunks mid-session.
//
// registerType:'prompt' + injectRegister:null means the plugin never auto-
// injects a registration script; we register manually in register-sw.ts.
//
// filename is "app-sw.js", NOT "sw.js": /sw.js is reserved (vercel.json) for a
// tiny self-destroying worker (public/kill-sw.js) that rescues every legacy
// registration — old clients keep polling /sw.js, receive the kill switch,
// purge their caches, reload fresh, and re-register this worker at /app-sw.js.
// ────────────────────────────────────────────────────────────────────────────
export function buildPwaPlugin() {
  return VitePWA({
    registerType: "prompt",
    injectRegister: null,
    strategies: "generateSW",
    filename: "app-sw.js",
    manifest,
    includeAssets: ["favicon.ico", "favicon-96x96.png", "apple-touch-icon.png"],
    workbox: {
      globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
      globIgnores: PRECACHE_GLOB_IGNORES,
      // Explicit null: vite-plugin-pwa otherwise injects its default
      // navigateFallback ("index.html"), whose NavigationRoute would be
      // registered BEFORE the runtimeCaching route below and answer every
      // navigation with the precached (i.e. potentially stale) shell.
      navigateFallback: null,
      runtimeCaching: [
        {
          urlPattern: matchAppNavigation,
          handler: "NetworkOnly",
          options: {
            // Offline (or any network failure): fall back to the self-consistent
            // precached shell. No artificial timeout — a slow network behaves
            // like any plain website would.
            precacheFallback: { fallbackURL: "/index.html" },
          },
        },
      ],
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
