import { useEffect, useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { useAuth, useUser } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, Check, Loader as Loader2 } from "lucide-react"
import { apiPost, setActiveOrgId } from "@/lib/api"
import { OrgProvider, useOrg } from "@/lib/org-context"
import { useSyncProfileLanguage } from "@/lib/i18n/use-language"
import { detectDefaultCurrency } from "@/lib/currencies"
import type { AccountType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { CurrencyCombobox } from "@/components/CurrencyCombobox"
import { Input } from "@/components/ui/input"
import { ACCENTS } from "@/components/onboarding/accents"
import { OnboardingShell } from "@/components/onboarding/shell"
import { MoneyWizard } from "@/components/onboarding/MoneyWizard"
import { PlanStep } from "@/components/onboarding/PlanStep"

type Phase = "type" | "details" | "money" | "plan"
const PROGRESS: Record<Phase, number> = { type: 0.12, details: 0.37, money: 0.65, plan: 0.92 }

function ChoiceCard({ type, selected, onSelect }: { type: AccountType; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation()
  const accent = ACCENTS[type]
  const Icon = accent.icon
  const points = [t(`onboarding.${type}Point1`), t(`onboarding.${type}Point2`), t(`onboarding.${type}Point3`)]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group pressable ios-tap relative w-full overflow-hidden rounded-2xl border bg-card p-5 text-left transition-all duration-200 sm:p-6 ${
        selected ? `${accent.ring} ring-2 shadow-lg` : "border-border hover:border-foreground/20 hover:shadow-md"
      }`}
    >
      <div className={`pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-gradient-to-br ${accent.glow} to-transparent blur-2xl transition-opacity duration-300 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-70"}`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className={`flex size-12 items-center justify-center rounded-xl border ${accent.chip} sm:size-14`}>
          <Icon className="size-6 sm:size-7" />
        </div>
        <span className={`flex size-6 items-center justify-center rounded-full border transition-all duration-200 ${selected ? `${accent.dot} border-transparent text-white` : "border-border text-transparent"}`}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </div>
      <div className="relative mt-4">
        <h3 className="text-lg font-semibold tracking-tight sm:text-xl">{t(`onboarding.${type}Title`)}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{t(`onboarding.${type}Tagline`)}</p>
      </div>
      <ul className="relative mt-4 space-y-2">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-2 text-sm">
            <span className={`size-1.5 shrink-0 rounded-full ${accent.dot}`} />
            <span className="text-foreground/80">{p}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}

function OnboardingInner() {
  const { t } = useTranslation()
  const { user } = useUser()
  const { getToken } = useAuth()
  useSyncProfileLanguage()
  const { profile, needsOnboarding, loading, refresh } = useOrg()

  const [phase, setPhase] = useState<Phase>("type")
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  const [companyName, setCompanyName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [currency, setCurrency] = useState(() => detectDefaultCurrency())

  const firstName = user?.firstName?.trim()

  // Create/resolve the workspace with the chosen type + name + currency, then move
  // into the money wizard. Runs at the end of the DETAILS step.
  const createWorkspace = async () => {
    if (!accountType || submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ organization_id: string; account_type: AccountType }>("/api/onboarding", token, {
        account_type: accountType,
        company_name: accountType === "business" ? companyName : undefined,
        currency,
      })
      setActiveOrgId(result.organization_id)
      setPhase("money")
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  // Already onboarded and not mid-flow → bounce out (no flash) before the form shows.
  if (profile && !needsOnboarding && phase === "type") return <Navigate to="/dashboard" replace />

  return (
    <OnboardingShell progress={PROGRESS[phase]}>
      {phase === "type" && (
        <section className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col justify-center py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {firstName ? t("onboarding.greeting", { name: firstName }) : t("onboarding.welcome")}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t("onboarding.q1Title")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{t("onboarding.q1Subtitle")}</p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              {(["personal", "business"] as AccountType[]).map((type, i) => (
                <div key={type} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-500" style={{ animationDelay: `${120 + i * 90}ms`, animationFillMode: "backwards" }}>
                  <ChoiceCard type={type} selected={accountType === type} onSelect={() => setAccountType(type)} />
                </div>
              ))}
            </div>
          </div>
          <div className="pt-6">
            <Button size="lg" className="h-12 w-full text-base" disabled={!accountType} onClick={() => setPhase("details")}>
              {t("onboarding.continue")} <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      )}

      {phase === "details" && (
        <section className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col justify-center py-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-6 motion-safe:duration-300">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("onboarding.detailsTitle")}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{t("onboarding.detailsSubtitle")}</p>
            <div className="mt-6 space-y-5">
              {accountType === "business" && (
                <div>
                  <label htmlFor="companyName" className="text-sm font-medium">{t("onboarding.companyNameLabel")}</label>
                  <Input id="companyName" value={companyName} autoFocus onChange={(e) => setCompanyName(e.target.value)} placeholder={t("onboarding.companyNamePlaceholder")} className="mt-1.5 h-11" />
                  <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.companyNameOptional")}</p>
                </div>
              )}
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
            <Button size="lg" className="h-12 w-full text-base" disabled={submitting} onClick={createWorkspace}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <>{t("onboarding.continue")} <ArrowRight className="size-4" /></>}
            </Button>
            <button type="button" onClick={() => setPhase("type")} disabled={submitting} className="pressable mx-auto inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-4" /> {t("onboarding.back")}
            </button>
          </div>
        </section>
      )}

      {phase === "money" && accountType && (
        <MoneyWizard accountType={accountType} currency={currency} onBack={() => setPhase("details")} onDone={() => setPhase("plan")} />
      )}

      {phase === "plan" && accountType && (
        <PlanStep accountType={accountType} onBack={() => setPhase("money")} redirectTo="/dashboard" />
      )}
    </OnboardingShell>
  )
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()
  useEffect(() => {
    if (isLoaded && !isSignedIn) navigate("/login", { replace: true })
  }, [isLoaded, isSignedIn, navigate])
  if (!isLoaded || !isSignedIn) return null
  return (
    <OrgProvider>
      <OnboardingInner />
    </OrgProvider>
  )
}

export default OnboardingPage
