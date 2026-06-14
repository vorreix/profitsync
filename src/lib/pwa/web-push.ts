// Client-side Web Push subscription helpers. Pairs with api/_routes/notifications/push.ts
// and the SW handlers in public/push-sw.js. Everything degrades gracefully: if
// push is unsupported, unconfigured (no VAPID public key) or the SW isn't active
// (e.g. the dev server, where the SW is disabled), the helpers return a reason
// instead of throwing or hanging.
import { apiDelete, apiPost } from "@/lib/api"

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type SubscribeResult = { ok: true } | { ok: false; reason: "unsupported" | "unconfigured" | "blocked" | "dismissed" | "no_sw" | "auth" | "error" }

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function isPushConfigured(): boolean {
  return !!VAPID_PUBLIC_KEY
}

export function pushPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "default"
  return Notification.permission
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  // Back the view with a plain ArrayBuffer so the type satisfies BufferSource
  // (applicationServerKey) under strict lib.dom typings.
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Resolve the active SW registration without hanging forever (navigator.
// serviceWorker.ready never resolves when no SW is registered, e.g. in dev).
async function readyRegistration(timeoutMs = 3000): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) return null
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ])
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  const reg = await readyRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function isSubscribed(): Promise<boolean> {
  return (await getExistingSubscription()) !== null
}

export async function subscribeToPush(getToken: () => Promise<string | null>): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" }
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: "unconfigured" }

  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "blocked" : "dismissed" }
  }

  const reg = await readyRegistration()
  if (!reg) return { ok: false, reason: "no_sw" }

  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }))
    const token = await getToken()
    if (!token) return { ok: false, reason: "auth" }
    const json = sub.toJSON()
    await apiPost("/api/notifications/push", token, {
      endpoint: sub.endpoint,
      keys: json.keys,
      platform: "web",
    })
    return { ok: true }
  } catch {
    return { ok: false, reason: "error" }
  }
}

export async function unsubscribeFromPush(getToken: () => Promise<string | null>): Promise<void> {
  const sub = await getExistingSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  try {
    await sub.unsubscribe()
  } catch {
    /* ignore */
  }
  const token = await getToken()
  if (token) await apiDelete("/api/notifications/push", token, { endpoint }).catch(() => {})
}
