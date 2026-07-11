import { useEffect, useState } from "react"
import { useClerk } from "@clerk/clerk-react"
import { Loader2 } from "lucide-react"

import { nativeAuthLog, nativeAuthUrlLog } from "@/lib/native-auth"

export function OAuthCallbackPage() {
  const clerk = useClerk()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function completeOAuth() {
      nativeAuthUrlLog("callback_route_loaded", window.location.href)
      try {
        await clerk.handleRedirectCallback(
          {
            signInUrl: "/login",
            signUpUrl: "/signup",
            redirectUrl: "/dashboard",
          },
          async (to) => {
            nativeAuthLog("final_navigation", { to })
            window.history.replaceState(null, "", to)
          },
        )
        nativeAuthLog("clerk_callback_success")
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Google sign-in callback failed."
        nativeAuthLog("clerk_callback_failure", { message })
        if (!cancelled) setError(message)
      }
    }

    void completeOAuth()

    return () => {
      cancelled = true
    }
  }, [clerk])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/30 p-4 text-center">
      {error ? (
        <>
          <h1 className="text-lg font-semibold">Google sign-in failed</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
        </>
      ) : (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Finishing Google sign-in...</p>
        </>
      )}
    </div>
  )
}
