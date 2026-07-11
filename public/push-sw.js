/* ProfitSync push handlers, imported into the generated service worker via
 * workbox `importScripts` (see pwa/vite-pwa.ts). Kept as a plain, dependency-free
 * static file so it can be importScripts()'d at SW install. Adds ONLY push +
 * notificationclick listeners — it does not touch caching, skipWaiting or the
 * navigation strategy, so the white-screen-safe SW pipeline is unaffected.
 *
 * Payload shape (see api/_lib/push.ts): { title, body?, url?, tag?, image? }
 */
/* global self, clients */
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: event.data ? event.data.text() : "ProfitSync" }
  }
  const title = data.title || "ProfitSync"
  const options = {
    body: data.body || "",
    icon: "/favicon-96x96.png",
    badge: "/favicon-96x96.png",
    tag: data.tag || undefined,
    // `image` shows a large hero image (admin broadcasts) where the platform
    // supports it; ignored gracefully where it doesn't.
    image: data.image || undefined,
    data: { url: data.url || "/notifications" },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// Browsers occasionally rotate a push subscription (key/endpoint change). If we
// don't rebind, the server keeps sending to a dead endpoint and this device
// goes silent until the next page load's ensureSubscriptionSynced. Re-subscribe
// with the same VAPID key and tell the server to retarget the OLD endpoint's
// row (capability-authorized — no user session exists inside a SW).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription
        const key = oldSub && oldSub.options ? oldSub.options.applicationServerKey : null
        if (!oldSub || !key) return
        const newSub =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
        await fetch("/api/notifications/push/rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ old_endpoint: oldSub.endpoint, subscription: newSub.toJSON() }),
        })
      } catch (e) {
        /* best-effort — the next page load re-syncs the subscription */
      }
    })(),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || "/notifications"
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true })
      // Focus an existing tab on the same origin and navigate it, if possible.
      for (const client of all) {
        try {
          const url = new URL(client.url)
          if (url.origin === self.location.origin && "focus" in client) {
            await client.focus()
            if ("navigate" in client) await client.navigate(targetUrl)
            return
          }
        } catch (e) {
          /* ignore malformed client urls */
        }
      }
      if (clients.openWindow) await clients.openWindow(targetUrl)
    })(),
  )
})
