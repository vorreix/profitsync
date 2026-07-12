export const NATIVE_OAUTH_REDIRECT_URL = "com.vorreix.profitsync://oauth-callback"
export const OAUTH_CALLBACK_PATH = "/sso-callback"

type AuthLogDetails = Record<string, string | number | boolean | null | undefined>

function redactUrl(value: string | URL): string {
  try {
    const url = typeof value === "string" ? new URL(value) : new URL(value.toString())
    const sensitiveParams = ["code", "ticket", "token", "state", "session_id", "__clerk_status"]
    for (const key of sensitiveParams) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "[redacted]")
    }
    if (url.hash) url.hash = "#[redacted]"
    return url.toString()
  } catch {
    return "[unparseable-url]"
  }
}

// Reads the window.Capacitor bridge global instead of importing @capacitor/core:
// this module is statically imported by App.tsx (and the auth pages), so a static
// capacitor import would drag the Capacitor runtime into the WEB bundle. Inside
// the native WebView the bridge always defines window.Capacitor.
export function nativePlatform(): "android" | "ios" | null {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor
  if (!cap?.isNativePlatform?.()) return null
  const platform = cap.getPlatform?.()
  return platform === "android" || platform === "ios" ? platform : null
}

// Generic native check covering EVERY Capacitor platform (android + ios). Prefer
// this at shared call sites — routing, the OAuth deep-link listener, native push,
// reminders — so iOS is covered without touching each site again. Reserve
// isNativeAndroid() for genuinely Android-only branches.
export function isNativeApp(): boolean {
  return nativePlatform() !== null
}

export function isNativeAndroid(): boolean {
  return nativePlatform() === "android"
}

export function nativeAuthLog(event: string, details: AuthLogDetails = {}) {
  if (!isNativeApp()) return
  console.info("[ProfitSync Native Auth]", JSON.stringify({ event, ...details }))
}

export function nativeAuthUrlLog(event: string, url: string | URL, details: AuthLogDetails = {}) {
  nativeAuthLog(event, { ...details, url: redactUrl(url) })
}

export function toInternalOAuthCallbackPath(callbackUrl: string): string | null {
  try {
    const url = new URL(callbackUrl)
    if (url.protocol !== "com.vorreix.profitsync:" || url.host !== "oauth-callback") return null
    return `${OAUTH_CALLBACK_PATH}${url.search}${url.hash}`
  } catch {
    return null
  }
}
