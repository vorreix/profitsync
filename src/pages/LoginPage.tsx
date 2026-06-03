import { useEffect } from "react"
import { Link } from "react-router-dom"
import { SignIn } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"

import { InstallAppBanner } from "@/components/InstallAppBanner"
import { initPwa } from "@/lib/pwa/register-sw"

export function LoginPage() {
  const { t } = useTranslation()

  // Registering here (in addition to boot) covers users who arrive via SPA navigation
  // from the landing page, where boot-time registration was skipped.
  useEffect(() => {
    initPwa()
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 gap-4">
      <SignIn path="/login" routing="path" signUpUrl="/signup" fallbackRedirectUrl="/dashboard" />
      <Link
        to="/forgot-password"
        className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
      >
        {t("forgotPassword.linkLabel")}
      </Link>
      <InstallAppBanner className="w-full max-w-sm" />
    </div>
  )
}
