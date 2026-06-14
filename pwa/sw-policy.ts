// SINGLE SOURCE OF TRUTH for what the service worker must NOT treat as part of the
// installable app.

// Navigations matching this are left entirely to the network: the marketing landing
// page, public legal pages, the public blog, pre-auth invitation links and the API
// are never answered by the service worker (no caching, no offline fallback), so
// they always reflect the live site (and the SSR'd <head> for crawlers).
export const NAVIGATION_DENY_RE = /^\/(?:$|privacy-policy|terms-of-service|refund-policy|blog(?:\/|$)|invitations\/|api\/|@)/

// The navigation matcher serialized into the generated service worker (see
// runtimeCaching in vite-pwa.ts). workbox-build stringifies this function into the
// worker source, so it MUST be self-contained: the regex is intentionally written
// out inline rather than referencing NAVIGATION_DENY_RE — a closure over an import
// would throw ReferenceError inside the generated worker. sw-policy.test.ts guards
// that the inline copy and NAVIGATION_DENY_RE never drift apart.
export const matchAppNavigation = (ctx: { request: Request; url: URL }): boolean =>
  ctx.request.mode === "navigate" &&
  !/^\/(?:$|privacy-policy|terms-of-service|refund-policy|blog(?:\/|$)|invitations\/|api\/|@)/.test(ctx.url.pathname)

// Kept out of the precache entirely:
//  - the isolated marketing chunk (see the `landing` manualChunk in vite.config.ts),
//    so landing assets are never cached;
//  - kill-sw.js, the legacy-recovery worker served at /sw.js (see vercel.json) — it
//    must never be treated as an app asset.
//  - push-sw.js, importScripts()'d into the generated worker (see vite-pwa.ts) — it
//    is loaded by the SW itself, not precached as an app asset.
export const PRECACHE_GLOB_IGNORES: string[] = ["**/landing-*.js", "**/landing-*.css", "kill-sw.js", "push-sw.js"]
