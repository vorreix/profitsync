/**
 * Per-org recent-search store for the global search UIs. Pure + storage-injected
 * so it stays unit-testable (DB-free, DOM-free); callers pass `localStorage`.
 */

export const RECENTS_LIMIT = 6

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

const storageKey = (orgId: string) => `ps_recent_search_${orgId}`

export function loadRecents(storage: StorageLike, orgId: string): string[] {
  try {
    const raw = storage.getItem(storageKey(orgId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === "string").slice(0, RECENTS_LIMIT)
  } catch {
    return []
  }
}

export function recordRecent(storage: StorageLike, orgId: string, query: string): string[] {
  const term = query.trim()
  if (!term) return loadRecents(storage, orgId)
  const next = [
    term,
    ...loadRecents(storage, orgId).filter((r) => r.toLowerCase() !== term.toLowerCase()),
  ].slice(0, RECENTS_LIMIT)
  try {
    storage.setItem(storageKey(orgId), JSON.stringify(next))
  } catch {
    // Quota/private-mode failures just skip persistence.
  }
  return next
}

export function clearRecents(storage: StorageLike, orgId: string): void {
  try {
    storage.removeItem(storageKey(orgId))
  } catch {
    // ignore
  }
}
