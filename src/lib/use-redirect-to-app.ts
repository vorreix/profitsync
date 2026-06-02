import { useAuth } from "@clerk/clerk-react"

// Clerk sets a non-HttpOnly "__client_uat" cookie ("client updated-at"): a
// positive timestamp while a session exists, and "0"/absent when signed out.
// Reading it synchronously lets the "/" route bounce a returning signed-in user
// to the app on the very first paint — before Clerk's JS finishes booting and
// before the (lazy) marketing bundle is even fetched. It is only a hint: the
// confirmed useAuth() state is the source of truth, and a stale hint degrades
// gracefully (worst case, AppLayout bounces an actually-signed-out user from
// /dashboard back to /login).
function clerkHasSession(): boolean {
  if (typeof document === "undefined") return false
  const match = document.cookie.match(/(?:^|;\s*)__client_uat=([^;]+)/)
  return !!match && Number(match[1]) > 0
}

// True when the public landing route should hand off to the app instead of
// rendering marketing: the visitor is signed in — confirmed once Clerk has
// loaded, or optimistically inferred from the session cookie while it is still
// loading.
export function useShouldRedirectToApp(): boolean {
  const { isLoaded, isSignedIn } = useAuth()
  if (isLoaded) return !!isSignedIn
  return clerkHasSession()
}
