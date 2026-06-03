import { registerSW } from "virtual:pwa-register"

import { ensureInstallListener } from "./use-install-prompt"

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

// Registers the service worker on every route so the whole origin — including the
// marketing landing page — is installable (the browser only fires
// `beforeinstallprompt` for origins with a registered SW). The landing page's
// content chunk is still excluded from precache (see pwa/sw-policy.ts), so the
// marketing page itself stays network-fresh. Idempotent.
export function initPwa(): void {
  if (registered) return
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
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
