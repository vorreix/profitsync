import { Capacitor } from "@capacitor/core"

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

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
}

export function nativeAuthLog(event: string, details: AuthLogDetails = {}) {
  if (!isNativeAndroid()) return
  console.info("[ProfitSync Android Auth]", JSON.stringify({ event, ...details }))
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
