// Native (Capacitor) FCM push helpers — the phone-side pair of
// src/lib/pwa/web-push.ts, registering device tokens against the same
// /api/notifications/push endpoint with channel:"fcm".
//
// Bundle discipline: @capacitor-firebase/messaging is imported DYNAMICALLY
// inside these helpers (and vite manualChunks routes it to the lazy "native"
// chunk), so the web bundle stays capacitor-free. Everything degrades
// gracefully: on the web, or in a native build without google-services.json
// baked in, the helpers return a reason instead of throwing.
import { apiDelete, apiPost } from "@/lib/api"
import { isNativeAndroid } from "@/lib/native-auth"

// Local intent flag: the OS permission alone can't distinguish "user enabled
// push" from "user granted permission once but toggled push off in the app".
const ENABLED_KEY = "ps_native_push_enabled"

export type NativeSubscribeResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "blocked" | "dismissed" | "unconfigured" | "auth" | "error" }

export function isNativePushSupported(): boolean {
  return isNativeAndroid()
}

async function messaging() {
  const mod = await import("@capacitor-firebase/messaging")
  return mod.FirebaseMessaging
}

export async function nativePushPermission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const fm = await messaging()
    const { receive } = await fm.checkPermissions()
    if (receive === "granted") return "granted"
    if (receive === "denied") return "denied"
    return "prompt"
  } catch {
    return "prompt"
  }
}

export async function isNativePushEnabled(): Promise<boolean> {
  if (!isNativePushSupported()) return false
  if (localStorage.getItem(ENABLED_KEY) !== "1") return false
  return (await nativePushPermission()) === "granted"
}

async function registerCurrentToken(getToken: () => Promise<string | null>): Promise<NativeSubscribeResult> {
  const fm = await messaging()
  let deviceToken: string
  try {
    const res = await fm.getToken()
    if (!res.token) return { ok: false, reason: "unconfigured" }
    deviceToken = res.token
  } catch {
    // Firebase not initialized — the APK was built without google-services.json.
    return { ok: false, reason: "unconfigured" }
  }
  const token = await getToken()
  if (!token) return { ok: false, reason: "auth" }
  try {
    await apiPost("/api/notifications/push", token, {
      channel: "fcm",
      endpoint: deviceToken,
      platform: "android",
    })
    return { ok: true }
  } catch {
    return { ok: false, reason: "error" }
  }
}

export async function enableNativePush(getToken: () => Promise<string | null>): Promise<NativeSubscribeResult> {
  if (!isNativePushSupported()) return { ok: false, reason: "unsupported" }
  try {
    const fm = await messaging()
    const { receive } = await fm.requestPermissions()
    if (receive !== "granted") {
      return { ok: false, reason: receive === "denied" ? "blocked" : "dismissed" }
    }
  } catch {
    return { ok: false, reason: "unconfigured" }
  }
  const result = await registerCurrentToken(getToken)
  if (result.ok) localStorage.setItem(ENABLED_KEY, "1")
  return result
}

export async function disableNativePush(getToken: () => Promise<string | null>): Promise<void> {
  localStorage.removeItem(ENABLED_KEY)
  if (!isNativePushSupported()) return
  try {
    const fm = await messaging()
    const { token: deviceToken } = await fm.getToken().catch(() => ({ token: "" }))
    await fm.deleteToken().catch(() => {})
    if (deviceToken) {
      const token = await getToken()
      if (token) await apiDelete("/api/notifications/push", token, { endpoint: deviceToken }).catch(() => {})
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Boot-time self-heal (the native mirror of ensureSubscriptionSynced): when the
 * user previously enabled push and permission still stands, re-register the
 * CURRENT token — FCM rotates tokens, and the server upsert-by-endpoint makes
 * this idempotent. No-op on web or when push was never enabled here.
 */
export async function ensureNativePushSynced(getToken: () => Promise<string | null>): Promise<void> {
  if (!(await isNativePushEnabled())) return
  await registerCurrentToken(getToken).catch(() => {})
}

/**
 * Attach the notification-tap listener: server pushes carry `data.url`
 * (see api/_lib/push-fcm.ts) and tapping deep-links there. Also re-registers on
 * FCM token rotation. Returns an unlisten cleanup. Call once from the
 * signed-in shell when isNativeAndroid().
 */
export async function initNativePush(
  getToken: () => Promise<string | null>,
  navigate: (url: string) => void,
): Promise<() => void> {
  if (!isNativePushSupported()) return () => {}
  try {
    const fm = await messaging()
    const tap = await fm.addListener("notificationActionPerformed", (event) => {
      const url = (event.notification?.data as Record<string, string> | undefined)?.url
      if (url && url.startsWith("/")) navigate(url)
    })
    const rotate = await fm.addListener("tokenReceived", () => {
      void ensureNativePushSynced(getToken)
    })
    return () => {
      void tap.remove()
      void rotate.remove()
    }
  } catch {
    return () => {}
  }
}
