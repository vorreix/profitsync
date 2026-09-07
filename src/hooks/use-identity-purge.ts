import { useEffect, useRef } from "react"
import { useAuth } from "@clerk/clerk-react"
import { purgeApiCache } from "@/lib/api"

/**
 * Empties the API cache the moment the signed-in user changes — including to
 * nobody.
 *
 * Sign-out is the case that needs it. Everything else that invalidates the
 * cache is triggered by a request, and signing out makes none: without this,
 * the last screen's rows sit in memory (and the shell on disk) until the tab
 * closes, ready for whoever signs in next on a shared machine. The cache key
 * carries the user's subject, so they could never be *read* by the next person
 * — this is about not keeping them at all.
 *
 * Mount it once, above the auth guard, so it sees the transition on every
 * route — six different places call `signOut()` and the next one to be added
 * shouldn't have to remember this.
 */
export function useIdentityPurge() {
  const { isLoaded, userId } = useAuth()
  const seen = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!isLoaded) return
    const now = userId ?? null
    const before = seen.current
    seen.current = now
    // `undefined` is "we hadn't looked yet" — the first resolution of a page
    // load is not a change of user, and a fresh module has nothing cached.
    if (before === undefined || before === now) return
    purgeApiCache()
  }, [isLoaded, userId])
}
