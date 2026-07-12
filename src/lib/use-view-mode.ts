import { useCallback, useState } from "react"

export type ViewMode = "card" | "list" | "table"

export const ALL_VIEW_MODES: readonly ViewMode[] = ["card", "list", "table"]

const STORAGE_PREFIX = "ps_view_"

/**
 * Resolve a raw stored string to a valid mode. Legacy migration: the first Clients
 * toggle stored `"grid"` for the card layout, so `"grid"` maps to `"card"`. Anything
 * outside `allowed` (corrupt, tampered, or a since-removed mode) → `fallback`, so a
 * bad value can never wedge the UI. Pure + DOM-free → unit-tested directly.
 */
export function normalizeViewMode(
  raw: string | null | undefined,
  allowed: readonly ViewMode[],
  fallback: ViewMode,
): ViewMode {
  const value = raw === "grid" ? "card" : raw
  return (allowed as readonly string[]).includes(value ?? "") ? (value as ViewMode) : fallback
}

function readStored(key: string, allowed: readonly ViewMode[], fallback: ViewMode): ViewMode {
  // SSR (api/ssr.ts) and the Capacitor cold-boot both run this module without a
  // DOM — guard `window`/`localStorage` so importing a page never throws there.
  if (typeof window === "undefined") return fallback
  try {
    return normalizeViewMode(window.localStorage.getItem(STORAGE_PREFIX + key), allowed, fallback)
  } catch {
    // Private-mode / disabled storage — fall back silently, never crash the page.
    return fallback
  }
}

/**
 * Per-section view preference (Card grid · List rows · dense Table), persisted to
 * `localStorage` under `ps_view_<key>` so it survives navigation and app restarts.
 *
 * `allowed` narrows which modes a page offers (both Quotations and Clients use all
 * three). A stored value outside `allowed` — or corrupt/legacy — resolves to
 * `fallback`, so tampering or a removed mode can never wedge the UI.
 *
 *   const [view, setView] = useViewMode("clients")            // "card" default
 *   const [view, setView] = useViewMode("quotations", "list") // custom default
 */
export function useViewMode(
  key: string,
  fallback: ViewMode = "card",
  allowed: readonly ViewMode[] = ALL_VIEW_MODES,
): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => readStored(key, allowed, fallback))

  const set = useCallback(
    (next: ViewMode) => {
      if (!(allowed as readonly string[]).includes(next)) return
      setMode(next)
      if (typeof window === "undefined") return
      try {
        window.localStorage.setItem(STORAGE_PREFIX + key, next)
      } catch {
        // Ignore write failures (quota / private mode) — in-memory state still updates.
      }
    },
    [key, allowed],
  )

  return [mode, set]
}
