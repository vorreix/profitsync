import { registerSW } from "virtual:pwa-register"

import { ensureInstallListener } from "./use-install-prompt"
import { reloadWithCacheBust, settleChunkRecovery } from "./chunk-recovery"
import { offerUpdate } from "./update-prompt-store"

let registered = false

const CHUNK_ERROR_RE =
  /loading (?:css )?chunk|dynamically imported module|importing a module script failed|failed to fetch dynamically/i

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

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
  // Native (Capacitor) WebViews bundle the app locally and update through the
  // store / app updates — a web service worker there would only fight the
  // native update model and precache a copy nobody serves. Runtime global
  // check (no @capacitor import) so the web bundle stays capacitor-free.
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) return
  registered = true

  ensureInstallListener()
  installChunkErrorReload()

  let swRegistration: ServiceWorkerRegistration | undefined

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      swRegistration = registration
      // A new SW installs and then WAITS (skipWaiting is off in pwa/vite-pwa.ts);
      // onNeedRefresh below surfaces it as an update prompt. Check hourly and
      // whenever the app returns to the foreground — installed PWAs on phones can
      // stay "running" for days, and the visibility check is what lets them see a
      // release without a full relaunch.
      const check = () => {
        registration.update().catch(() => {
          /* offline / transient — the next check will succeed */
        })
      }
      window.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check()
      })
    },
    onNeedRefresh() {
      // A new version is WAITING. Never force-activate it behind the page's back —
      // activating deletes the old precache while the running page still needs its
      // chunks (the historical post-deploy white-screen bug). Instead:
      //
      //  - If the incumbent worker is the legacy kill switch (script URL /sw.js —
      //    see public/kill-sw.js), there is nothing to break: activate + reload
      //    immediately so the user never sees a prompt during legacy recovery.
      //  - Otherwise show the update banner; accepting calls updateSW(true), which
      //    posts SKIP_WAITING and reloads this tab onto the new version.
      const activeUrl = swRegistration?.active?.scriptURL ?? ""
      const incumbentIsKillSwitch = /\/(?:kill-)?sw\.js$/.test(activeUrl) && !activeUrl.endsWith("/app-sw.js")
      if (incumbentIsKillSwitch) {
        void updateSW(true)
        return
      }
      offerUpdate(() => {
        void updateSW(true)
        // Fail-safe: if the waiting worker vanished (e.g. yet another deploy landed
        // in between) controllerchange may never fire — fall back to a hard reload,
        // which the network-only navigation strategy turns into a fresh shell.
        window.setTimeout(() => {
          window.location.reload()
        }, 10000)
      })
    },
  })
}
