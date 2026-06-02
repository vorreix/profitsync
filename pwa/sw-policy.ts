// SINGLE SOURCE OF TRUTH for what the service worker must NOT treat as part of the
// installable app. Mirrored (in intent) by src/lib/pwa/should-register.ts on the client.

// Navigation requests matching these are never served the cached app-shell fallback,
// so the landing page, legal pages, invitation links and the API always hit the network.
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [
  /^\/$/, // marketing landing page
  /^\/privacy-policy/, // legal
  /^\/terms-of-service/, // legal
  /^\/invitations\//, // pre-auth invitation links
  /^\/api\//, // serverless API — never SW-handled
  /^\/@/, // Vite internal "@" paths
]

// The isolated marketing chunk (see the `landing` manualChunk in vite.config.ts) is
// kept out of the precache entirely, so landing assets are never cached.
export const PRECACHE_GLOB_IGNORES: string[] = ["**/landing-*.js", "**/landing-*.css"]
