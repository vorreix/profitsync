import { useCallback, useEffect, useState } from "react"

// Self-contained theme hook for the landing. It reads/writes the SAME
// `localStorage["theme"]` key and toggles the SAME `.light/.dark` class on
// <html> that the app's ThemeProvider uses, so the two never fight and the
// choice is consistent across the landing and the app — without importing app code.
type Theme = "light" | "dark"
const STORAGE_KEY = "theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

function resolveInitial(): Theme {
  if (typeof window === "undefined") return "light"
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === "light" || stored === "dark") return stored
  // null or "system" → resolve from the OS preference.
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(resolveInitial)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")
    root.classList.add(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    setThemeState(next)
  }, [])

  const toggle = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "dark" ? "light" : "dark"
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  return { theme, setTheme, toggle }
}
