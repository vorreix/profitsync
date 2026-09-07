import { canPersist, invalidationFor, policyFor } from "@/lib/api-cache"
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

/**
 * THE READ PATH. Every apiGet in the app funnels through `get()` below, so the
 * caching policy lives here and nowhere else — no call site needs to know.
 *
 * Two tiers:
 *   L1, this Map — every GET, dies with the tab.
 *   L2, localStorage — config and the organization list ONLY
 *       (src/lib/api-cache.ts decides), so a cold start has part of the shell
 *       in hand before the first request. Money never reaches disk, and
 *       neither does anything that decides which workspace you are in.
 *
 * Serving a cached body is only half of it. A GET that comes back from cache is
 * a body someone may act on, so anything past its freshness window is painted
 * AND revalidated behind the paint; when the fresh copy differs, we emit the
 * ordinary data-changed event. That is the trick that let this ship without
 * touching 235 call sites: they already refetch on that event (via
 * DataRefreshProvider), and their refetch lands on the now-fresh cache, so it
 * costs a render and no extra request. New code can subscribe directly with
 * `useApiQuery`.
 */
type Entry = { ts: number; data: unknown }

const MAX_CACHE_ENTRIES = 200
/** After a failed revalidation, don't retry that key for this long. */
const REVALIDATE_BACKOFF_MS = 5_000
/**
 * The longest an `alwaysFetch` route may be served from cache without the
 * request going out. Deliberately independent of any TTL: it bounds how long
 * the server-side money work (autopay, statement filing, recurring
 * materialisation) can go unrun while someone is actively using the app.
 */
const SYNC_FLOOR_MS = 5_000

const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()
const failedAt = new Map<string, number>()
/** Keyed by PATH, not by cache key — see subscribeApiPath. */
const watchers = new Map<string, Set<() => void>>()
/** Keys already looked for in localStorage — a miss is not worth re-reading. */
const hydrated = new Set<string>()

// Bumped on every invalidation so an in-flight GET that resolves *after* a
// mutation doesn't re-populate the cache with now-stale data.
let cacheGeneration = 0

// ── Identity ────────────────────────────────────────────────────────────────
// The cache key carries WHO as well as WHAT. Two people sharing a browser (or
// one person switching Clerk sessions) must never see each other's rows, and
// without this the only thing standing between them is a 30-second timer.

const ANON = "anon"
let activeUserId = ANON

/** The `sub` claim, without pulling in a JWT library — untrusted, key material only. */
function subjectOf(token: string): string {
  const part = token.split(".")[1]
  if (!part) return ANON
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    return (JSON.parse(json) as { sub?: string }).sub || ANON
  } catch {
    return ANON
  }
}

/**
 * Called on every request. A different subject means a different person is
 * holding the browser, so everything the last one cached goes — including what
 * reached disk. This is the belt to `useIdentityPurge`'s braces: that hook
 * catches sign-OUT (which makes no request at all), this catches a session
 * swap that never unmounts the app.
 */
function noteIdentity(token: string) {
  const sub = subjectOf(token)
  if (sub === activeUserId) return
  if (activeUserId !== ANON) purgeApiCache()
  activeUserId = sub
  // First identity of this page load. Entries on disk under any OTHER subject
  // are someone else's shell — a name and an email sitting in a shared
  // browser's localStorage because their sign-out never got to run its effect.
  // Nothing can read them (the key won't match), but they shouldn't be there.
  dropForeignStorage(sub)
}

function cacheKey(path: string): string {
  return `${activeUserId}|${activeOrgId ?? ""}|${path}`
}

const pathOfKey = (key: string) => key.slice(key.indexOf("|", key.indexOf("|") + 1) + 1)

// ── L2: localStorage ────────────────────────────────────────────────────────
// Synchronous on purpose. An async store (IndexedDB) would mean either awaiting
// hydration inside get() — which stalls every screen behind a disk read, the
// exact lag this is meant to remove — or a hydration race with the first fetch.
// The allowlist is five small endpoints, so the space argument for IDB doesn't
// apply either.

const LS_PREFIX = "ps_apic1:"
/** Refuse to store a single oversized body rather than evict the whole shell for it. */
const LS_MAX_ENTRY_BYTES = 256_000

let storageOk = true

function storage(): Storage | null {
  if (!storageOk) return null
  try {
    if (typeof localStorage === "undefined") return null
    return localStorage
  } catch {
    storageOk = false
    return null
  }
}

/** Drop every entry we own — used on sign-out and when a write hits the quota. */
function clearStorage() {
  const s = storage()
  if (!s) return
  try {
    const doomed: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      // `ps_apic` (no version) sweeps entries left by an older payload shape.
      if (k && k.startsWith("ps_apic")) doomed.push(k)
    }
    for (const k of doomed) s.removeItem(k)
  } catch {
    /* private mode, or the store vanished mid-iteration */
  }
}

/** Remove stored entries belonging to any subject but `sub`. */
function dropForeignStorage(sub: string) {
  const s = storage()
  if (!s) return
  try {
    const doomed: string[] = []
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (k?.startsWith(LS_PREFIX) && !k.startsWith(`${LS_PREFIX}${sub}|`)) doomed.push(k)
    }
    for (const k of doomed) { s.removeItem(k); hydrated.delete(k.slice(LS_PREFIX.length)) }
  } catch {
    /* ignore */
  }
}

function readStored(key: string): Entry | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(LS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { t?: number; d?: unknown }
    if (typeof parsed?.t !== "number") return null
    return { ts: parsed.t, data: parsed.d }
  } catch {
    return null
  }
}

function writeStored(key: string, entry: Entry) {
  const s = storage()
  if (!s) return
  try {
    const raw = JSON.stringify({ t: entry.ts, d: entry.data })
    if (raw.length > LS_MAX_ENTRY_BYTES) return
    s.setItem(LS_PREFIX + key, raw)
  } catch {
    // Out of quota (ours or someone else's). Ours is a few KB of shell, so the
    // useful move is to drop it all and let it refill, not to fight for space.
    clearStorage()
  }
}

// ── L1 bookkeeping ──────────────────────────────────────────────────────────

function setEntry(key: string, path: string, data: unknown) {
  cache.delete(key) // re-insert at the end → most-recently-used
  const entry = { ts: Date.now(), data }
  cache.set(key, entry)
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      cache.delete(oldest)
      // It may still be on disk; let the next reader look again.
      hydrated.delete(oldest)
    }
  }
  // Only persist once we know which workspace this body belongs to. At boot,
  // before the org resolves, requests go out with no x-org-id and the server
  // answers for whatever the profile says — so the body IS org-specific while
  // the key is not. Written to disk, the next load starts in the same
  // unresolved state, reads that key back, and gets the PREVIOUS workspace's
  // categories. In memory it is harmless (the key becomes unreachable the
  // moment the org resolves); on disk it outlives the resolution.
  if (activeOrgId && canPersist(path)) writeStored(key, entry)
}

/**
 * The best copy we hold, or null. On the first ask for a persistable path this
 * is where the cold start gets its head start: one synchronous localStorage
 * read, then the entry lives in the Map like any other.
 */
function lookup(key: string, path: string): Entry | null {
  const hit = cache.get(key)
  if (hit) return hit
  if (hydrated.has(key) || !canPersist(path)) return null
  hydrated.add(key)
  const stored = readStored(key)
  if (!stored) return null
  const pol = policyFor(path)
  if (Date.now() - stored.ts > pol.fresh + pol.maxStale) {
    const s = storage()
    try { s?.removeItem(LS_PREFIX + key) } catch { /* ignore */ }
    return null
  }
  cache.set(key, stored)
  return stored
}

function notify(key: string) {
  const set = watchers.get(pathOfKey(key))
  if (!set) return
  for (const fn of [...set]) fn()
}

/**
 * Subscribe to one cached path. `useApiQuery` is built on this; it is the only
 * way a component learns about a body that arrived from a background
 * revalidation rather than from its own call.
 *
 * Keyed by path rather than by cache key on purpose: a subscriber is asking
 * "has this resource changed", and at the first render of a cold start the
 * identity half of the cache key is not known yet.
 */
export function subscribeApiPath(path: string, fn: () => void): () => void {
  let set = watchers.get(path)
  if (!set) watchers.set(path, (set = new Set()))
  set.add(fn)
  return () => {
    const s = watchers.get(path)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) watchers.delete(path)
  }
}

/**
 * The cached body for a path, if one is usable right now — no network, no
 * promise. This is what lets a revisited screen render with its data already in
 * place instead of a skeleton.
 *
 * Pass `userId` when the caller knows who is signed in and the store might not
 * yet: on a cold start nothing has sent a request, so the store's idea of the
 * subject is still empty, and without this the entry sitting on disk would be
 * looked up under the wrong key and missed. It is NOT restored from storage
 * behind the caller's back — guessing the subject is how the previous user's
 * shell ends up painted for a frame.
 */
export function peekApiCache<T>(path: string, userId?: string | null): T | undefined {
  const key = userId ? `${userId}|${activeOrgId ?? ""}|${path}` : cacheKey(path)
  const hit = lookup(key, path)
  if (!hit) return undefined
  const pol = policyFor(path)
  return Date.now() - hit.ts <= pol.fresh + pol.maxStale ? (hit.data as T) : undefined
}

// ── Invalidation ────────────────────────────────────────────────────────────

/**
 * Drop everything, memory and disk. Sign-out, account deletion, a different
 * user. Not for ordinary writes — that is what `invalidateKeys` is for.
 */
export function purgeApiCache() {
  clearApiCache()
  activeUserId = ANON
}

/**
 * Drop everything, memory and disk. Kept under its historical name because a
 * handful of call sites reach for it directly.
 *
 * It has to take the disk copy with it: `lookup()` rehydrates from storage on a
 * memory miss, so a memory-only clear would hand the very next reader the stale
 * body it was just told to forget.
 */
export function clearApiCache() {
  const keys = [...cache.keys(), ...[...watchers.keys()].map((p) => `||${p}`)]
  cache.clear()
  inflight.clear()
  failedAt.clear()
  hydrated.clear()
  cacheGeneration++
  clearStorage()
  for (const key of keys) notify(key)
}

/**
 * Drop the entries whose path starts with one of `prefixes`, for the current
 * user across every org — a write in one workspace can change what another
 * shows (shared members, plan limits), and the cost of being generous here is a
 * refetch, while the cost of being precise and wrong is a stale balance.
 */
export function invalidateKeys(prefixes: string[]) {
  const matches = (key: string) => prefixes.some((p) => pathOfKey(key).startsWith(p))
  const hit: string[] = []
  for (const key of [...cache.keys()]) if (matches(key)) { cache.delete(key); hit.push(key) }
  for (const key of [...inflight.keys()]) if (matches(key)) inflight.delete(key)
  for (const key of [...failedAt.keys()]) if (matches(key)) failedAt.delete(key)
  const s = storage()
  if (s) {
    try {
      const doomed: string[] = []
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k?.startsWith(LS_PREFIX) && matches(k.slice(LS_PREFIX.length))) doomed.push(k)
      }
      for (const k of doomed) { s.removeItem(k); hydrated.delete(k.slice(LS_PREFIX.length)) }
    } catch {
      /* ignore */
    }
  }
  cacheGeneration++
  for (const key of hit) notify(key)
}

/**
 * Move the boot-time entries onto the org that has just been resolved.
 *
 * The first requests of a cold start go out before anyone knows which workspace
 * is active, so they carry no x-org-id and land under an empty org in the key —
 * but the server answered them for THIS org, from the profile. Re-keying them
 * is what stops the profile and the organization list being fetched a second
 * time the moment the org resolves.
 */
function adoptBootEntries(orgId: string) {
  for (const key of [...cache.keys()]) {
    const [sub, org, ...rest] = key.split("|")
    if (org !== "") continue
    const path = rest.join("|")
    const entry = cache.get(key)!
    cache.delete(key)
    const next = `${sub}|${orgId}|${path}`
    if (!cache.has(next)) {
      cache.set(next, entry)
      if (canPersist(path)) writeStored(next, entry)
    }
  }
}

export function setActiveOrgId(id: string | null) {
  if (id !== activeOrgId) {
    // Don't clear on the initial null -> org resolution at boot: there's no stale
    // data yet, and keeping the cache lets the burst of boot-time fetches dedupe.
    // Clear on a real org switch (org -> other org) and on logout (org -> null).
    const initialResolve = activeOrgId === null && id !== null
    activeOrgId = id
    if (initialResolve) adoptBootEntries(id)
    else clearApiCache()
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

// ── Network ─────────────────────────────────────────────────────────────────

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

/** One network GET, shared by every caller waiting on the same key. */
function fetchShared<T>(key: string, path: string, token: string): Promise<T> {
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const gen = cacheGeneration
  const p = request<T>("GET", path, token)
    .then((data) => {
      inflight.delete(key)
      failedAt.delete(key)
      // Skip caching if an invalidation landed while this GET was in flight.
      if (gen === cacheGeneration) setEntry(key, path, data)
      return data
    })
    .catch((err) => {
      inflight.delete(key)
      failedAt.set(key, Date.now())
      throw err
    })
  inflight.set(key, p)
  return p
}

/**
 * Refresh behind an already-painted body. Silent by design: the caller has a
 * usable answer, and a background failure (offline, a 401 mid-refresh) must not
 * surface as a rejected promise nobody is holding.
 *
 * When the new body differs from what was painted, this emits the same
 * data-changed event a mutation does, which is how the screen catches up.
 */
function revalidate(key: string, path: string, token: string, painted: unknown) {
  const failed = failedAt.get(key)
  if (failed !== undefined && Date.now() - failed < REVALIDATE_BACKOFF_MS) return
  if (inflight.has(key)) return
  void fetchShared(key, path, token)
    .then((fresh) => {
      if (!changed(painted, fresh)) return
      notify(key)
      emitDataChanged(path)
    })
    .catch(() => {
      /* keep showing what we have */
    })
}

function changed(a: unknown, b: unknown): boolean {
  if (a === b) return false
  try {
    return JSON.stringify(a) !== JSON.stringify(b)
  } catch {
    return true // not comparable → assume it moved
  }
}

function get<T>(path: string, token: string): Promise<T> {
  noteIdentity(token)
  const pol = policyFor(path)
  const key = cacheKey(path)

  // no-store: one-shot URLs, metered AI calls, anything whose body is a
  // credential. Never held, not even for the length of a burst.
  if (pol.fresh === 0 && pol.maxStale === 0) return request<T>("GET", path, token)

  const hit = lookup(key, path)
  if (hit) {
    const age = Date.now() - hit.ts
    if (age <= pol.fresh + pol.maxStale) {
      // `alwaysFetch` is the load-bearing half of this branch. Nine GET routes
      // materialise due recurring transactions, file statements and run autopay
      // while serving the read, so a cached body may paint but the request has
      // to keep going out — skip it indefinitely and someone's rent silently
      // never posts. They revalidate on a floor of their own (SYNC_FLOOR_MS)
      // rather than on `fresh`, so raising a TTL later can never starve the
      // server-side work; the floor still collapses one screen's burst into one
      // request.
      if (age > pol.fresh || (pol.alwaysFetch && age > SYNC_FLOOR_MS)) revalidate(key, path, token, hit.data)
      return Promise.resolve(hit.data as T)
    }
  }

  return fetchShared<T>(key, path, token)
}

async function mutate<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  noteIdentity(token)
  const result = await request<T>(method, path, token, body)
  // What this write invalidates is NOT the call site's decision. It used to be
  // an optional argument, and all 28 sites that passed one were narrower than
  // the truth — a transfer between spaces dropped /api/spaces and left the
  // transaction list, the analytics and the budget spend it had just changed
  // sitting in the cache. One table answers it now, for every write.
  const inv = invalidationFor(path)
  if (inv.kind === "all") purgeApiCache()
  else invalidateKeys(inv.prefixes)
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
export const apiPost = <T>(path: string, token: string, body: unknown) => mutate<T>("POST", path, token, body)
export const apiPatch = <T>(path: string, token: string, body: unknown) => mutate<T>("PATCH", path, token, body)
export const apiPut = <T>(path: string, token: string, body: unknown) => mutate<T>("PUT", path, token, body)
export const apiDelete = <T = void>(path: string, token: string, body?: unknown) => mutate<T>("DELETE", path, token, body)
