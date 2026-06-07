import { Capacitor } from "@capacitor/core"

export type NativeAuthDebugEvent = {
  id: number
  at: string
  name: string
  data?: unknown
  level: "debug" | "error"
}

const MAX_EVENTS = 25
let nextEventId = 1
let events: NativeAuthDebugEvent[] = []

export function isNativeAuthDebugEnabled() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && import.meta.env.VITE_NATIVE_AUTH_DEBUG === "true"
}

export function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    const redactedSearch = Array.from(url.searchParams.keys())
      .map((key) => `${key}=<redacted>`)
      .join("&")
    return `${url.protocol}//${url.host}${url.pathname}${redactedSearch ? `?${redactedSearch}` : ""}${
      url.hash ? "#<redacted>" : ""
    }`
  } catch {
    return "<invalid-url>"
  }
}

export function describeUrlForNativeAuthLog(rawUrl: string) {
  try {
    const url = new URL(rawUrl)
    return {
      redactedUrl: redactUrl(rawUrl),
      protocol: url.protocol,
      host: url.host,
      pathname: url.pathname,
      searchKeys: Array.from(url.searchParams.keys()),
      hasHash: Boolean(url.hash),
    }
  } catch {
    return { redactedUrl: "<invalid-url>" }
  }
}

export function describeNativeAuthError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return error
}

export function getNativeAuthDebugEvents() {
  return events
}

export function nativeAuthDebugLog(name: string, data?: unknown, level: "debug" | "error" = "debug") {
  if (!isNativeAuthDebugEnabled()) return

  const event: NativeAuthDebugEvent = {
    id: nextEventId++,
    at: new Date().toISOString(),
    name,
    data,
    level,
  }
  events = [...events, event].slice(-MAX_EVENTS)

  const log = level === "error" ? console.error : console.debug
  log(`[native-google-oauth] ${name}`, data)
  window.dispatchEvent(new CustomEvent("native-auth-debug", { detail: event }))
}
