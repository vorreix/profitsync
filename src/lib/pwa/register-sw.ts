import { registerSW } from "virtual:pwa-register"

import { ensureInstallListener } from "./use-install-prompt"

const CHUNK_RELOAD_KEY = "profitsync-chunk-reload"
let registered = false

// Reload at most once (guarded so we never loop). The guard key is shared with
// the inline recovery script in index.html and AppErrorBoundary, so the recovery
// paths cooperate instead of fighting over reloads.
function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1")
  } catch {
    /* private mode — still attempt a single reload */
  }
  window.location.reload()
  return true
}

const CHUNK_ERROR_RE =
  /loading (?:css )?chunk|dynamically imported module|importing a module script failed|failed to fetch dynamically/i

// After a deploy, an old tab may try to lazy-load a hashed chunk that no longer exists.
// Vite fires `vite:preloadError`; some failures surface only as an unhandled
// promise rejection (a rejected dynamic import() not wrapped by Vite's helper).
// Recover from both with a single guarded reload.
function installChunkErrorReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault()
    reloadOnce()
  })
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    const msg = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "")
    if (CHUNK_ERROR_RE.test(msg)) reloadOnce()
  })
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      } catch {
        /* ignore */
      }
    }, 10000)
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
