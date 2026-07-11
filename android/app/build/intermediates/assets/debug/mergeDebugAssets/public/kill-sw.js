// ProfitSync legacy-recovery ("amnesty") service worker.
//
// Served at /sw.js via a vercel.json rewrite — the script URL every HISTORIC
// registration keeps polling for updates. The real app worker now lives at
// /app-sw.js, so any client still updating from /sw.js is by definition stuck
// in a legacy state: a pre-rename registration, or a worker registered on
// www.profitsync.net before the domain was unified onto the apex (a service
// worker can never update through a redirect, so without this file those
// clients would serve their frozen, broken precache forever — the post-deploy
// "white screen" users could not escape).
//
// On install it takes over immediately (skipWaiting is safe here: this worker
// has NO fetch handler, so it can't break a running page's assets), then:
// claims the open pages, deletes every cache, unregisters itself, and reloads
// each window. The fresh load comes straight from the network (or follows the
// www → apex redirect), boots the current app, and re-registers the real
// worker at /app-sw.js. One-time, self-erasing reset.
self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Claim first so client.navigate() below is permitted (it requires this
        // worker to be the page's active worker in some engines).
        await self.clients.claim()
      } catch {
        /* best effort */
      }
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      } catch {
        /* best effort */
      }
      try {
        await self.registration.unregister()
      } catch {
        /* best effort */
      }
      try {
        const clients = await self.clients.matchAll({ type: "window" })
        await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)))
      } catch {
        /* best effort — an unreloaded page simply heals on its next navigation */
      }
    })(),
  )
})
