import { useEffect, useMemo, useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { useAuth, useUser } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CreditCard,
  Loader as Loader2,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react"
import { apiGet, apiPost, setActiveOrgId } from "@/lib/api"
import { OrgProvider, useOrg } from "@/lib/org-context"
import { useSyncProfileLanguage } from "@/lib/i18n/use-language"
import type { AccountType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type PlanLocalPricing = {
  currency: string
  monthly: number
  yearly: number
  monthly_discount_pct: number
  yearly_discount_pct: number
}

type Plan = {
  id: string
  key: string
  name: string
  account_type: string | null
  local_pricing: PlanLocalPricing
}

type PricingResponse = { plans: Plan[]; detectedCountry: string }

type Cycle = "monthly" | "yearly"

function formatMinor(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100)
}

function discounted(amount: number, pct: number): number {
  // Floor so a 50% launch discount on $4.99 shows $2.49 (not $2.50) and on
  // $9.99 shows $4.99 — matching the advertised launch prices.
  return Math.floor(amount * (1 - pct / 100))
}

/** Visual treatment per account type — kept in one place for consistency. */
const ACCENTS: Record<
  AccountType,
  { icon: typeof User; ring: string; chip: string; glow: string; dot: string }
> = {
  personal: {
    icon: User,
    ring: "ring-emerald-500/60 border-emerald-500/50",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    glow: "from-emerald-500/20",
    dot: "bg-emerald-500",
  },
  business: {
    icon: Building2,
    ring: "ring-indigo-500/60 border-indigo-500/50",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    glow: "from-indigo-500/20",
    dot: "bg-indigo-500",
  },
}

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i + 1 === current ? "w-7 bg-primary" : i + 1 < current ? "w-4 bg-primary/60" : "w-4 bg-border"
          }`}
        />
      ))}
    </div>
  )
}

function ChoiceCard({
  type,
  selected,
  onSelect,
}: {
  type: AccountType
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const accent = ACCENTS[type]
  const Icon = accent.icon
  const points = [
    t(`onboarding.${type}Point1`),
    t(`onboarding.${type}Point2`),
    t(`onboarding.${type}Point3`),
  ]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group pressable ios-tap relative w-full overflow-hidden rounded-2xl border bg-card p-5 text-left transition-all duration-200 sm:p-6 ${
        selected
          ? `${accent.ring} ring-2 shadow-lg`
          : "border-border hover:border-foreground/20 hover:shadow-md"
      }`}
    >
      {/* atmospheric corner glow */}
      <div
        className={`pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-gradient-to-br ${accent.glow} to-transparent blur-2xl transition-opacity duration-300 ${
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-70"
        }`}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div
          className={`flex size-12 items-center justify-center rounded-xl border ${accent.chip} sm:size-14`}
        >
          <Icon className="size-6 sm:size-7" />
        </div>
        <span
          className={`flex size-6 items-center justify-center rounded-full border transition-all duration-200 ${
            selected ? `${accent.dot} border-transparent text-white` : "border-border text-transparent"
          }`}
        >
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
  const navigate = useNavigate()
  const { user } = useUser()
  useSyncProfileLanguage()
  const { profile, needsOnboarding, loading, refresh } = useOrg()

  const [step, setStep] = useState<1 | 2>(1)
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  const [companyName, setCompanyName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [cycle, setCycle] = useState<Cycle>("monthly")
  const [pricing, setPricing] = useState<PricingResponse | null>(null)
  const [pricingLoading, setPricingLoading] = useState(false)
  const { getToken } = useAuth()

  const firstName = user?.firstName?.trim()

  const loadPricing = async () => {
    setPricingLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<PricingResponse>("/api/billing/pricing", token)
      setPricing(res)
    } catch {
      // Pricing is best-effort; the user can still continue to the app.
    } finally {
      setPricingLoading(false)
    }
  }

  const handleChoose = async () => {
    if (!accountType || submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ organization_id: string; account_type: AccountType }>(
        "/api/onboarding",
        token,
        { account_type: accountType, company_name: accountType === "business" ? companyName : undefined },
      )
      // Point the app at the chosen workspace, then advance to the plan step.
      setActiveOrgId(result.organization_id)
      setStep(2)
      await Promise.all([refresh(), loadPricing()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  const handleCheckout = async () => {
    if (!accountType || submitting) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) return
      const result = await apiPost<{ checkout_url?: string | null; message?: string }>(
        "/api/billing/create-subscription",
        token,
        { plan_key: accountType, cycle },
      )
      if (result.checkout_url) {
        window.location.href = result.checkout_url
        return
      }
      // Stub mode (no Dodo creds) — subscription applied server-side.
      toast.success(result.message || "You're all set!")
      navigate("/dashboard", { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed")
      setSubmitting(false)
    }
  }

  const selectedPlan = useMemo(
    () => pricing?.plans.find((p) => p.key === accountType) ?? null,
    [pricing, accountType],
  )

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Already onboarded and not mid-flow → bounce out at render time (no flash of
  // the onboarding UI before an effect fires).
  if (profile && !needsOnboarding && step === 1) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      {/* Background atmosphere: soft grid + radial light. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.25]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
        }}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/10 to-transparent blur-3xl" />

      <div className="safe-pt safe-pb relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 pb-28 pt-6 sm:px-6 sm:pb-10 sm:pt-10">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">ProfitSync</span>
          </div>
          <Stepper current={step} total={2} />
        </header>

        {step === 1 ? (
          <section className="flex flex-1 flex-col justify-center py-8 sm:py-10">
            <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {firstName ? t("onboarding.greeting", { name: firstName }) : t("onboarding.welcome")}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("onboarding.q1Title")}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{t("onboarding.q1Subtitle")}</p>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:mt-8 sm:grid-cols-2 sm:gap-4">
              {(["personal", "business"] as AccountType[]).map((type, i) => (
                <div
                  key={type}
                  className="animate-in fade-in slide-in-from-bottom-4 duration-500"
                  style={{ animationDelay: `${120 + i * 90}ms`, animationFillMode: "backwards" }}
                >
                  <ChoiceCard type={type} selected={accountType === type} onSelect={() => setAccountType(type)} />
                </div>
              ))}
            </div>

            {accountType === "business" && (
              <div className="mt-4 animate-in fade-in slide-in-from-top-1 duration-300">
                <label htmlFor="companyName" className="text-sm font-medium">
                  {t("onboarding.companyNameLabel")}
                </label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder={t("onboarding.companyNamePlaceholder")}
                  className="mt-1.5 h-11"
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.companyNameOptional")}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="flex flex-1 flex-col justify-center py-8 sm:py-10">
            <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="pressable inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" /> {t("onboarding.back")}
              </button>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
                {t("onboarding.choosePlan")}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">
                {t("onboarding.planSubtitle", { discount: 50 })}
              </p>
            </div>

            <div className="mt-5 flex justify-center sm:justify-start">
              <Tabs value={cycle} onValueChange={(v) => setCycle(v as Cycle)}>
                <TabsList>
                  <TabsTrigger value="monthly">{t("onboarding.monthly")}</TabsTrigger>
                  <TabsTrigger value="yearly">{t("onboarding.yearly")}</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="mt-5">
              {pricingLoading && !selectedPlan ? (
                <div className="flex h-44 items-center justify-center rounded-2xl border bg-card">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : selectedPlan ? (
                <PlanSummary plan={selectedPlan} cycle={cycle} accountType={accountType!} />
              ) : (
                <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
                  {t("onboarding.freeIncluded")}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Sticky action bar — thumb-reachable on mobile, inline on desktop. */}
        <div className="safe-pb fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 px-4 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
          <div className="mx-auto w-full max-w-2xl">
            {step === 1 ? (
              <Button
                size="lg"
                className="h-12 w-full text-base"
                disabled={!accountType || submitting}
                onClick={handleChoose}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    {t("onboarding.continue")}
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  size="lg"
                  className="h-12 w-full text-base"
                  disabled={submitting}
                  onClick={handleCheckout}
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      <CreditCard className="size-4" />
                      {t("onboarding.continueToCheckout")}
                    </>
                  )}
                </Button>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/dashboard", { replace: true })}
                    className="pressable text-sm text-muted-foreground hover:text-foreground"
                    disabled={submitting}
                  >
                    {t("onboarding.maybeLater")}
                  </button>
                  <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                    <ShieldCheck className="size-3.5" /> {t("onboarding.securedByDodo")}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlanSummary({
  plan,
  cycle,
  accountType,
}: {
  plan: Plan
  cycle: Cycle
  accountType: AccountType
}) {
  const { t } = useTranslation()
  const accent = ACCENTS[accountType]
  const local = plan.local_pricing
  const base = cycle === "yearly" ? local.yearly : local.monthly
  const pct = cycle === "yearly" ? local.yearly_discount_pct : local.monthly_discount_pct
  const final = discounted(base, pct)
  const suffix = cycle === "yearly" ? t("onboarding.perYear") : t("onboarding.perMonth")
  const perks = [
    t(`onboarding.${accountType}Point1`),
    t(`onboarding.${accountType}Point2`),
    t(`onboarding.${accountType}Point3`),
  ]
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div
        className={`pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-gradient-to-br ${accent.glow} to-transparent blur-2xl`}
      />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex size-10 items-center justify-center rounded-xl border ${accent.chip}`}>
            <accent.icon className="size-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">{plan.name}</p>
            <p className="text-xs text-muted-foreground">{t(`onboarding.${accountType}Tagline`)}</p>
          </div>
        </div>
        {pct > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            <Sparkles className="size-3" /> {t("onboarding.launchDiscount", { discount: pct })}
          </span>
        )}
      </div>

      <div className="relative mt-4 flex items-end gap-2">
        {pct > 0 && (
          <span className="mb-1 text-base text-muted-foreground line-through">
            {formatMinor(base, local.currency)}
          </span>
        )}
        <span className="text-4xl font-semibold tracking-tight">{formatMinor(final, local.currency)}</span>
        <span className="mb-1 text-sm text-muted-foreground">{suffix}</span>
      </div>

      <ul className="relative mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {perks.map((p) => (
          <li key={p} className="flex items-center gap-2 text-sm">
            <Check className="size-4 shrink-0 text-emerald-500" />
            <span className="text-foreground/80">{p}</span>
          </li>
        ))}
      </ul>
    </div>
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
