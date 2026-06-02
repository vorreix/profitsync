// Mirrors pwa/sw-policy.ts: the service worker (and therefore the PWA) must never be
// registered on the marketing landing page or other pre-auth public routes. Everything
// else (auth + app) is fair game.
const EXCLUDED_PREFIXES = ["/privacy-policy", "/terms-of-service", "/invitations"]

export function shouldRegisterHere(pathname: string): boolean {
  if (pathname === "/") return false
  for (const prefix of EXCLUDED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return false
  }
  return true
}
