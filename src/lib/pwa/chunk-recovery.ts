// Shared post-deploy chunk-load recovery.
//
// After a deploy, an old app shell (from the SW precache or HTTP cache) can
// reference content-hashed chunks that 404. We recover by reloading with a
// cache-busting query param (bypasses any stale HTTP cache so Vercel serves a
// fresh index.html), bounded to MAX_RELOAD_ATTEMPTS with backoff and gated by a
// single sessionStorage counter. The counter is SHARED with the dependency-free
// inline script in index.html and the React error boundary, so the three recovery
// paths cooperate and can never loop forever.
//
// This module is intentionally free of any PWA/virtual-module imports so the
// error boundary can use it without pulling in service-worker registration.

export const CHUNK_RELOAD_KEY = "profitsync-chunk-reload"
export const CACHE_BUST_PARAM = "_cache_bust"
const MAX_RELOAD_ATTEMPTS = 3
const RELOAD_BACKOFF_MS = [0, 500, 1500] // immediate, then 500ms, then 1500ms

/**
 * Reload with a fresh cache-bust param, up to MAX_RELOAD_ATTEMPTS (with backoff).
 * Returns false (without reloading) once the budget is exhausted, so callers can
 * fall back to a manual "reload" card instead of looping.
 */
export function reloadWithCacheBust(): boolean {
  let attempt = 0
  try {
    attempt = parseInt(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? "0", 10) || 0
  } catch {
    /* private mode — still attempt the reload */
  }
  if (attempt >= MAX_RELOAD_ATTEMPTS) return false

  attempt += 1
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(attempt))
  } catch {
    /* private mode */
  }

  const run = () => {
    // Strip any prior bust param first so retries never accumulate
    // (?_cache_bust=…&_cache_bust=…). location.replace avoids a junk history entry.
    const params = new URLSearchParams(window.location.search)
    params.delete(CACHE_BUST_PARAM)
    params.set(CACHE_BUST_PARAM, String(Date.now()))
    const query = params.toString()
    window.location.replace(`${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`)
  }

  const delay = RELOAD_BACKOFF_MS[attempt - 1] ?? 0
  if (delay > 0) window.setTimeout(run, delay)
  else run()
  return true
}

/**
 * Call on a clean `load`: scrub the cache-bust param from the address bar and
 * reset the retry budget once the page has stabilized.
 */
export function settleChunkRecovery(): void {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.has(CACHE_BUST_PARAM)) {
      url.searchParams.delete(CACHE_BUST_PARAM)
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
