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
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

function cacheKey(path: string): string {
  return `${activeOrgId ?? ""}::${path}`
}

export function clearApiCache() {
  cache.clear()
  inflight.clear()
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

  const p = request<T>("GET", path, token)
    .then((data) => {
      cache.set(key, { ts: Date.now(), data })
      inflight.delete(key)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })
  inflight.set(key, p)
  return p
}

async function mutate<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const result = await request<T>(method, path, token, body)
  clearApiCache() // writes can change any list/aggregate — invalidate everything
  return result
}

export const apiGet = <T>(path: string, token: string) => get<T>(path, token)
export const apiPost = <T>(path: string, token: string, body: unknown) => mutate<T>("POST", path, token, body)
export const apiPatch = <T>(path: string, token: string, body: unknown) => mutate<T>("PATCH", path, token, body)
export const apiDelete = <T = void>(path: string, token: string, body?: unknown) =>
  mutate<T>("DELETE", path, token, body)
