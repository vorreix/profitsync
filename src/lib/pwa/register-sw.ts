import { registerSW } from "virtual:pwa-register"

import { ensureInstallListener } from "./use-install-prompt"
import { reloadWithCacheBust, settleChunkRecovery } from "./chunk-recovery"

let registered = false

const CHUNK_ERROR_RE =
  /loading (?:css )?chunk|dynamically imported module|importing a module script failed|failed to fetch dynamically/i

// After a deploy, an old tab may try to lazy-load a hashed chunk that no longer
// exists. Vite fires `vite:preloadError`; some failures surface only as an
// unhandled promise rejection (a rejected dynamic import() not wrapped by Vite's
// helper). Recover from both with the shared bounded cache-bust reload.
function installChunkErrorReload(): void {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault()
    reloadWithCacheBust()
  })
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason
    const msg = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "")
    if (CHUNK_ERROR_RE.test(msg)) reloadWithCacheBust()
  })
  window.addEventListener("load", settleChunkRecovery)
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

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      // Hourly check: a new SW installs and then WAITS (skipWaiting is off in
      // pwa/vite-pwa.ts). This tab keeps running the version it loaded with — fully
      // consistent, never a white screen — and converges to the new SW on its next
      // cold start, when no old tab is controlling.
      window.setInterval(() => {
        void registration.update()
      }, 60 * 60 * 1000)
    },
    onNeedRefresh() {
      // A new version is WAITING. We deliberately DO NOT activate it on the running
      // tab. Forcing skipWaiting here (the old `updateSW(false)` call) let the new SW
      // delete this page's still-needed hashed chunks mid-session and white-screen it
      // — the exact post-deploy bug we are fixing. It activates safely on the next
      // cold load. See the rationale in pwa/vite-pwa.ts.
    },
  })
}
