import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, Loader as Loader2 } from "lucide-react"
import { apiPost } from "@/lib/api"
import { OrgProvider, useOrg } from "@/lib/org-context"
import { useSyncProfileLanguage } from "@/lib/i18n/use-language"
import { detectDefaultCurrency } from "@/lib/currencies"
import type { Organization } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CurrencyCombobox } from "@/components/CurrencyCombobox"
import { OnboardingShell } from "@/components/onboarding/shell"
import { MoneyWizard } from "@/components/onboarding/MoneyWizard"
import { PlanStep } from "@/components/onboarding/PlanStep"

type Phase = "details" | "money" | "plan"
const PROGRESS: Record<Phase, number> = { details: 0.2, money: 0.55, plan: 0.9 }

/**
 * Immersive "create a new organization" wizard: name + currency → money wizard
 * (cash + bank + budgets) → plan/upgrade. The org is created when leaving the
 * details step, so every Back/Skip stays inside the flow (Back from details
 * cancels and returns to where the user came from). New orgs are always companies.
 */
function OrgSetupInner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { switchOrg, refresh } = useOrg()
  useSyncProfileLanguage()

  const [phase, setPhase] = useState<Phase>("details")
  const [name, setName] = useState("")
  const [currency, setCurrency] = useState(() => detectDefaultCurrency())
  const [creating, setCreating] = useState(false)

  const createOrg = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) return
      const created = await apiPost<Organization>("/api/organizations", token, { name: name.trim(), currency })
      // Make the new org active (server + local) so the money/plan steps target it.
      await switchOrg(created.id)
      await refresh()
      setPhase("money")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("organizations.failedToCreateOrganization"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <OnboardingShell progress={PROGRESS[phase]}>
      {phase === "details" && (
        <section className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col justify-center py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("onboarding.newOrgTitle")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{t("onboarding.newOrgSubtitle")}</p>
            <div className="mt-6 space-y-5">
              <div>
                <label htmlFor="newOrgName" className="text-sm font-medium">{t("onboarding.companyNameLabel")}</label>
                <Input
                  id="newOrgName"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void createOrg() }}
                  placeholder={t("onboarding.companyNamePlaceholder")}
                  className="mt-1.5 h-11"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("onboarding.currencyLabel")}</label>
                <div className="mt-1.5">
                  <CurrencyCombobox value={currency} onValueChange={setCurrency} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.currencyDetectedHint")}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-6">
            <Button size="lg" className="h-12 w-full text-base" disabled={!name.trim() || creating} onClick={createOrg}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : <>{t("onboarding.continue")} <ArrowRight className="size-4" /></>}
            </Button>
            <button type="button" onClick={() => navigate(-1)} disabled={creating} className="pressable mx-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> {t("onboarding.back")}
            </button>
          </div>
        </section>
      )}

      {phase === "money" && (
        <MoneyWizard accountType="business" currency={currency} onBack={() => setPhase("details")} onDone={() => setPhase("plan")} />
      )}

      {phase === "plan" && (
        <PlanStep accountType="business" onBack={() => setPhase("money")} redirectTo="/dashboard" />
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
