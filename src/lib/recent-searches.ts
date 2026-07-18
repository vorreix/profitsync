/**
 * Recent-search store for the global search UIs. Pure + storage-injected so it
 * stays unit-testable (DB-free, DOM-free); callers pass `localStorage`.
 *
 * `scope` must include BOTH the user and the org (`${userId}:${orgId}`) —
 * localStorage survives logout on a shared device, so an org-only key would
 * leak one user's search history to the next user of the same org.
 */

export const RECENTS_LIMIT = 6

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export const recentSearchScope = (userId: string | null | undefined, orgId: string) =>
  `${userId ?? "anon"}:${orgId}`

const storageKey = (scope: string) => `ps_recent_search_${scope}`

export function loadRecents(storage: StorageLike, scope: string): string[] {
  try {
    const raw = storage.getItem(storageKey(scope))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === "string").slice(0, RECENTS_LIMIT)
  } catch {
    return []
  }
}

export function recordRecent(storage: StorageLike, scope: string, query: string): string[] {
  const term = query.trim()
  if (!term) return loadRecents(storage, scope)
  const next = [
    term,
    ...loadRecents(storage, scope).filter((r) => r.toLowerCase() !== term.toLowerCase()),
  ].slice(0, RECENTS_LIMIT)
  try {
    storage.setItem(storageKey(scope), JSON.stringify(next))
  } catch {
    // Quota/private-mode failures just skip persistence.
  }
  return next
}

export function clearRecents(storage: StorageLike, scope: string): void {
  try {
    storage.removeItem(storageKey(scope))
  } catch {
    // ignore
  }
}
