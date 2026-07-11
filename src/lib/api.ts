import { emitDataChanged } from "@/lib/data-events"

const ORG_STORAGE_KEY = "ps_active_org"

function readStoredOrg(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(ORG_STORAGE_KEY) : null
  } catch {
    return null
  }
}

// Restore the last active org synchronously so the very first requests carry the
// correct x-org-id header and a stable cache key (avoids a null -> org refetch).
let activeOrgId: string | null = readStoredOrg()

// Short-lived GET cache + in-flight de-duplication. This collapses the bursts of
// identical requests that fire on a single page load (React StrictMode double
// effects in dev, context-driven remounts, multiple components asking for the
// same resource) into one network call, and makes back/forward navigation feel
// instant. Cache is scoped by active org and dropped on any mutation.
type CacheEntry = { ts: number; data: unknown }
const GET_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 50
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()
// Bumped on every clear so an in-flight GET that resolves *after* a mutation
// doesn't re-populate the cache with now-stale data.
let cacheGeneration = 0

function cacheKey(path: string): string {
  return `${activeOrgId ?? ""}::${path}`
}

// Insert with simple LRU eviction so paginating through many pages can't grow
// the cache without bound.
function setCacheEntry(key: string, data: unknown) {
  cache.delete(key) // re-insert at the end → most-recently-used
  cache.set(key, { ts: Date.now(), data })
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

export function clearApiCache() {
  cache.clear()
  inflight.clear()
  cacheGeneration++
}

// Granular invalidation: drop only cache/inflight entries whose path starts with
// one of `prefixes` (scoped to the active org via the cache key), leaving the rest
// of the cache warm. Bumping the generation prevents any in-flight GET started
// before this call from repopulating a stale entry. Prefer this over
// clearApiCache() for mutations so unrelated pages stay instant.
//   invalidateKeys(["/api/transactions", "/api/wealth"])
export function invalidateKeys(prefixes: string[]) {
  const pathOf = (key: string) => key.slice(key.indexOf("::") + 2)
  const matches = (key: string) => prefixes.some((p) => pathOf(key).startsWith(p))
  for (const key of [...cache.keys()]) if (matches(key)) cache.delete(key)
  for (const key of [...inflight.keys()]) if (matches(key)) inflight.delete(key)
  cacheGeneration++
}

export function setActiveOrgId(id: string | null) {
  if (id !== activeOrgId) {
    // Don't clear on the initial null -> org resolution at boot: there's no stale
    // data yet, and keeping the cache lets the burst of boot-time fetches dedupe.
    // Clear on a real org switch (org -> other org) and on logout (org -> null).
    const initialResolve = activeOrgId === null && id !== null
    if (!initialResolve) clearApiCache()
    activeOrgId = id
    try {
      if (id) localStorage.setItem(ORG_STORAGE_KEY, id)
      else localStorage.removeItem(ORG_STORAGE_KEY)
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }
}

export function getActiveOrgId(): string | null {
  return activeOrgId
}

async function request<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(activeOrgId ? { "x-org-id": activeOrgId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

function get<T>(path: string, token: string): Promise<T> {
  const key = cacheKey(path)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.ts < GET_TTL_MS) return Promise.resolve(hit.data as T)

  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const gen = cacheGeneration
  const p = request<T>("GET", path, token)
    .then((data) => {
      inflight.delete(key)
      // Skip caching if a mutation cleared the cache while this GET was in flight.
      if (gen === cacheGeneration) setCacheEntry(key, data)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })
  inflight.set(key, p)
  return p
}

async function mutate<T>(method: string, path: string, token: string, body?: unknown, invalidate?: string[]): Promise<T> {
  const result = await request<T>(method, path, token, body)
  // Default: clear everything (safe — a write can touch any list/aggregate).
  // Pass `invalidate` to drop only the affected scopes and keep the rest warm.
  if (invalidate) invalidateKeys(invalidate)
  else clearApiCache()
  // Notify after invalidation so listeners that refetch get fresh data.
  emitDataChanged(path)
  return result
}

/**
 * Turn a thrown API error into a human message. `request` throws the raw
 * response body, which for our handlers is JSON like `{"reason":…}` (quota) or
 * `{"error":…}` (validation). Extract the readable bit; fall back otherwise.
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const m = err.message.trim()
    if (m === "auth") return fallback
    if (m.startsWith("{")) {
      try {
        const j = JSON.parse(m) as { reason?: string; error?: string }
        return j.reason || j.error || fallback
      } catch {
        /* not JSON — fall through */
      }
    }
    return m
  }
  return fallback
}

/**
 * True when a thrown API error is a quota rejection that hints an upgrade
 * (`{ upgradeHint: true }`, our 402 shape). Lets a caller route the user to the
 * upgrade flow instead of showing a generic error toast.
 */
export function apiErrorUpgradeHint(err: unknown): boolean {
  if (err instanceof Error && err.message.trim().startsWith("{")) {
    try {
      return (JSON.parse(err.message) as { upgradeHint?: boolean }).upgradeHint === true
    } catch {
      /* not JSON */
    }
  }
  return false
}

export const apiGet = <T>(path: string, token: string) => get<T>(path, token)
export const apiPost = <T>(path: string, token: string, body: unknown, invalidate?: string[]) =>
  mutate<T>("POST", path, token, body, invalidate)
export const apiPatch = <T>(path: string, token: string, body: unknown, invalidate?: string[]) =>
  mutate<T>("PATCH", path, token, body, invalidate)
export const apiPut = <T>(path: string, token: string, body: unknown, invalidate?: string[]) =>
  mutate<T>("PUT", path, token, body, invalidate)
export const apiDelete = <T = void>(path: string, token: string, body?: unknown, invalidate?: string[]) =>
  mutate<T>("DELETE", path, token, body, invalidate)
