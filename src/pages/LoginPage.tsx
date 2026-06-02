import { useEffect } from "react"
import { SignIn } from "@clerk/clerk-react"

import { InstallAppBanner } from "@/components/InstallAppBanner"
import { initPwa } from "@/lib/pwa/register-sw"

export function LoginPage() {
  // Registering here (in addition to boot) covers users who arrive via SPA navigation
  // from the landing page, where boot-time registration was skipped.
  useEffect(() => {
    initPwa()
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 gap-4">
      <SignIn path="/login" routing="path" signUpUrl="/signup" fallbackRedirectUrl="/dashboard" />
      <InstallAppBanner className="w-full max-w-sm" />
    </div>
  )
}
