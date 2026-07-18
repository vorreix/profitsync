/**
 * Persisted preferences for the mobile search edge handle (the thin "bump" on
 * the screen wall): which edge it sits on and how far down. Pure + storage-
 * injected so it stays unit-testable.
 */
import type { StorageLike } from "@/lib/recent-searches"

export type SearchHandleSide = "left" | "right"
export type SearchHandlePref = { side: SearchHandleSide; topPct: number }

export const SEARCH_HANDLE_KEY = "ps_search_handle"
// Keep the handle clear of the top bar and the bottom tab bar / + FAB.
export const HANDLE_TOP_MIN = 0.12
export const HANDLE_TOP_MAX = 0.72

const DEFAULT_PREF: SearchHandlePref = { side: "right", topPct: 0.58 }

export function clampHandleTop(pct: number): number {
  if (!Number.isFinite(pct)) return HANDLE_TOP_MIN
  return Math.min(HANDLE_TOP_MAX, Math.max(HANDLE_TOP_MIN, pct))
}

export function loadSearchHandlePref(storage: StorageLike): SearchHandlePref {
  try {
    const raw = storage.getItem(SEARCH_HANDLE_KEY)
    if (!raw) return { ...DEFAULT_PREF }
    const parsed = JSON.parse(raw) as Partial<SearchHandlePref>
    return {
      side: parsed.side === "left" || parsed.side === "right" ? parsed.side : DEFAULT_PREF.side,
      topPct: clampHandleTop(typeof parsed.topPct === "number" ? parsed.topPct : DEFAULT_PREF.topPct),
    }
  } catch {
    return { ...DEFAULT_PREF }
  }
}

export function saveSearchHandlePref(storage: StorageLike, pref: SearchHandlePref): void {
  try {
    storage.setItem(SEARCH_HANDLE_KEY, JSON.stringify({ side: pref.side, topPct: clampHandleTop(pref.topPct) }))
  } catch {
    // Quota/private-mode failures just skip persistence.
  }
}
