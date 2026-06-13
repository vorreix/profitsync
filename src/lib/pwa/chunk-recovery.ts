// Shared post-deploy chunk-load recovery.
//
// After a deploy, a stale app shell (from an HTTP cache or a service worker in a
// bad state) can reference content-hashed chunks that 404. Recovery is a bounded
// reload ladder, gated by an attempt counter SHARED with the dependency-free
// inline script in index.html and the React error boundary, so the three recovery
// paths cooperate and can never loop forever:
//
//   attempt 1: reload with a cache-busting query param — bypasses any stale HTTP
//              cache, and (because app navigations are network-only, see
//              pwa/vite-pwa.ts) fetches the current shell straight from Vercel.
//   attempt 2+: NUCLEAR — additionally unregister every service worker and
//              delete every CacheStorage cache first. This is what rescues a
//              zombie/legacy worker that keeps answering navigations with a
//              frozen precached shell (a plain reload can never escape that:
//              the query param does not bypass a SW's navigation handler).
//
// The counter lives in sessionStorage AND in a query param on the recovery URL:
// in private/incognito mode sessionStorage writes can throw, and with only the
// (silently failing) storage counter every reload would restart from attempt 0 —
// an infinite 0ms reload loop on a persistent failure. The URL copy survives
// exactly as long as the recovery chain does (it is scrubbed only after a
// successful boot, in settleChunkRecovery), so the budget holds everywhere.
//
// This module is intentionally free of any PWA/virtual-module imports so the
// error boundary can use it without pulling in service-worker registration.

export const CHUNK_RELOAD_KEY = "profitsync-chunk-reload"
export const CACHE_BUST_PARAM = "_cache_bust"
export const RELOAD_ATTEMPT_PARAM = "_cache_bust_n"
const MAX_RELOAD_ATTEMPTS = 3
const RELOAD_BACKOFF_MS = [0, 500, 1500] // immediate, then 500ms, then 1500ms

function readAttempt(): number {
  let stored = 0
  try {
    stored = parseInt(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0", 10) || 0
  } catch {
    /* private mode — the URL counter below carries the count instead */
  }
  let fromUrl = 0
  try {
    fromUrl = parseInt(new URLSearchParams(window.location.search).get(RELOAD_ATTEMPT_PARAM) ?? "0", 10) || 0
  } catch {
    /* ignore */
  }
  return Math.max(stored, fromUrl)
}

// Best-effort teardown of every service worker + cache on this origin. Never
// throws — recovery must proceed to the reload regardless (a failed purge is
// still bounded by the attempt budget, and refusing to reload would also break
// the common no-SW case where there is simply nothing to purge).
async function purgeServiceWorkersAndCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister().catch(() => false)))
    }
  } catch {
    /* best effort */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)))
    }
  } catch {
    /* best effort */
  }
}

/**
 * Reload with a fresh cache-bust param, up to MAX_RELOAD_ATTEMPTS (with backoff);
 * from the second attempt on, also purge service workers + caches first.
 * Returns false (without reloading) once the budget is exhausted, so callers can
 * fall back to a manual "reload" card instead of looping.
 */
export function reloadWithCacheBust(): boolean {
  let attempt = readAttempt()
  if (attempt >= MAX_RELOAD_ATTEMPTS) return false

  attempt += 1
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(attempt))
  } catch {
    /* private mode — the URL param below carries the count instead */
  }

  const reload = () => {
    // Strip any prior recovery params first so retries never accumulate
    // (?_cache_bust=…&_cache_bust=…). location.replace avoids a junk history entry.
    const params = new URLSearchParams(window.location.search)
    params.delete(CACHE_BUST_PARAM)
    params.delete(RELOAD_ATTEMPT_PARAM)
    params.set(CACHE_BUST_PARAM, String(Date.now()))
    params.set(RELOAD_ATTEMPT_PARAM, String(attempt))
    const query = params.toString()
    window.location.replace(`${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`)
  }

  const run =
    attempt >= 2
      ? () => {
          void purgeServiceWorkersAndCaches().then(reload, reload)
        }
      : reload

  const delay = RELOAD_BACKOFF_MS[attempt - 1] ?? 0
  if (delay > 0) window.setTimeout(run, delay)
  else run()
  return true
}

/**
 * Call on a clean `load`: scrub the recovery params from the address bar and
 * reset the retry budget once the page has stabilized.
 */
export function settleChunkRecovery(): void {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has(CACHE_BUST_PARAM) || url.searchParams.has(RELOAD_ATTEMPT_PARAM)) {
      url.searchParams.delete(CACHE_BUST_PARAM)
      url.searchParams.delete(RELOAD_ATTEMPT_PARAM)
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }
  } catch {
    /* ignore */
  }
  window.setTimeout(clearChunkReloadGuard, 30000)
}

export function clearChunkReloadGuard(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY)
  } catch {
    /* ignore */
  }
}
