import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Loader as Loader2 } from "lucide-react"
import { OrgProvider, useOrg } from "@/lib/org-context"
import { useSyncProfileLanguage } from "@/lib/i18n/use-language"
import type { AccountType } from "@/lib/types"
import { OnboardingShell } from "@/components/onboarding/shell"
import { MoneyWizard } from "@/components/onboarding/MoneyWizard"
import { PlanStep } from "@/components/onboarding/PlanStep"

/**
 * Setup flow for a JUST-CREATED organization — reuses the onboarding money wizard
 * (cash + bank + budgets) and the plan/upgrade step for the now-active org, so a
 * new company isn't dropped onto an empty dashboard. The org already exists (the
 * create dialog made it + switched to it), so this starts at the money wizard.
 * Everything is optional; any exit routes to the new org's dashboard.
 */
function OrgSetupInner() {
  const navigate = useNavigate()
  useSyncProfileLanguage()
  const { activeOrg, loading } = useOrg()
  const [phase, setPhase] = useState<"money" | "plan">("money")

  if (loading || !activeOrg) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const accountType = (activeOrg.account_type ?? "business") as AccountType
  const currency = activeOrg.currency ?? "USD"

  return (
    <OnboardingShell progress={phase === "money" ? 0.45 : 0.9}>
      {phase === "money" ? (
        <MoneyWizard
          accountType={accountType}
          currency={currency}
          onBack={() => navigate("/dashboard", { replace: true })}
          onDone={() => setPhase("plan")}
        />
      ) : (
        <PlanStep accountType={accountType} onBack={() => setPhase("money")} redirectTo="/dashboard" />
      )}
    </OnboardingShell>
  )
}

export function OrgSetupPage() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()
  useEffect(() => {
    if (isLoaded && !isSignedIn) navigate("/login", { replace: true })
  }, [isLoaded, isSignedIn, navigate])
  if (!isLoaded || !isSignedIn) return null
  return (
    <OrgProvider>
      <OrgSetupInner />
    </OrgProvider>
  )
}

export default OrgSetupPage
