import { useEffect } from "react"

import { isNativeApp } from "@/lib/native-auth"
import { initNativeShell, syncStatusBarToTheme } from "@/lib/native-shell"

/** Resolve the CURRENTLY-applied theme from the <html> class our ThemeProvider
 *  writes (authoritative), falling back to the OS preference before it runs. */
function isDarkNow(): boolean {
  const el = document.documentElement
  if (el.classList.contains("dark")) return true
  if (el.classList.contains("light")) return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * Invisible controller mounted once at the app root. On native it brings up the
 * shell (splash/keyboard/status bar) and keeps the status bar's icon colour in
 * step with the theme by observing the <html> class the ThemeProvider toggles —
 * decoupled from the theme context, so it works on every route incl. login.
 * Renders nothing and no-ops entirely on the web.
 */
export function NativeShell() {
  useEffect(() => {
    if (!isNativeApp()) return
    void initNativeShell(isDarkNow())

    const observer = new MutationObserver(() => void syncStatusBarToTheme(isDarkNow()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return null
}
