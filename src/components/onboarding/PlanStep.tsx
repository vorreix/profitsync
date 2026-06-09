import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, Check, CreditCard, Loader as Loader2, ShieldCheck, Sparkles } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { usePlanText } from "@/lib/i18n/plan-text"
import type { AccountType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ACCENTS } from "@/components/onboarding/accents"

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
  promo_note?: string
  feature_labels?: Record<string, string>
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
// Round the discounted cents the way Dodo does, so the shown price matches checkout.
const discounted = (amount: number, pct: number) => Math.round(amount * (1 - pct / 100))

function PlanSummary({ plan, cycle, accountType }: { plan: Plan; cycle: Cycle; accountType: AccountType }) {
  const { t } = useTranslation()
  const planText = usePlanText()
  const accent = ACCENTS[accountType]
  const local = plan.local_pricing
  const base = cycle === "yearly" ? local.yearly : local.monthly
  const pct = cycle === "yearly" ? local.yearly_discount_pct : local.monthly_discount_pct
  const final = discounted(base, pct)
  const suffix = cycle === "yearly" ? t("onboarding.perYear") : t("onboarding.perMonth")
  const customFeatures = Object.values(plan.feature_labels ?? {}).filter(Boolean).map(planText)
  const perks =
    customFeatures.length > 0
      ? customFeatures
      : [t(`onboarding.${accountType}Point1`), t(`onboarding.${accountType}Point2`), t(`onboarding.${accountType}Point3`)]
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className={`pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-gradient-to-br ${accent.glow} to-transparent blur-2xl`} />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex size-10 items-center justify-center rounded-xl border ${accent.chip}`}>
            <accent.icon className="size-5" />
          </div>
          <div>
            <p className="font-semibold leading-tight">{planText(plan.name)}</p>
            <p className="text-xs text-muted-foreground">{t(`onboarding.${accountType}Tagline`)}</p>
          </div>
        </div>
        {(plan.promo_note?.trim() || pct > 0) && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
            <Sparkles className="size-3" /> {plan.promo_note?.trim() || t("onboarding.launchDiscount", { discount: pct })}
          </span>
        )}
      </div>
      <div className="relative mt-4 flex items-end gap-2">
        {pct > 0 && <span className="mb-1 text-base text-muted-foreground line-through">{formatMinor(base, local.currency)}</span>}
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

/**
 * The plan-choice + hosted-checkout step. Self-contained (fetches pricing). Used as
 * the final onboarding step and the new-organization setup step. On checkout it
 * redirects to Dodo; in stub mode (no Dodo creds) it applies server-side and routes
 * to `redirectTo`. "Maybe later" routes to `redirectTo` without charging.
 */
export function PlanStep({
  accountType,
  onBack,
  redirectTo = "/dashboard",
  title,
}: {
  accountType: AccountType
  onBack: () => void
  redirectTo?: string
  title?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [cycle, setCycle] = useState<Cycle>("monthly")
  const [pricing, setPricing] = useState<PricingResponse | null>(null)
  const [pricingLoading, setPricingLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<PricingResponse>("/api/billing/pricing", token)
        if (!cancelled) setPricing(res)
      } catch {
        /* pricing best-effort */
      } finally {
        if (!cancelled) setPricingLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [getToken])

  const selectedPlan = useMemo(() => pricing?.plans.find((p) => p.key === accountType) ?? null, [pricing, accountType])

  const checkout = async () => {
    if (submitting) return
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
      toast.success(result.message || "You're all set!")
      navigate(redirectTo, { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed")
      setSubmitting(false)
    }
  }

  return (
    <section className="flex flex-1 flex-col py-6 sm:py-8">
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-300">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title ?? t("onboarding.choosePlan")}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{t("onboarding.planSubtitle", { discount: 50 })}</p>
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
          <PlanSummary plan={selectedPlan} cycle={cycle} accountType={accountType} />
        ) : (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">{t("onboarding.freeIncluded")}</div>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-6">
        <Button size="lg" className="h-12 w-full text-base" disabled={submitting} onClick={checkout}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <><CreditCard className="size-4" />{t("onboarding.continueToCheckout")}</>}
        </Button>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onBack} disabled={submitting} className="pressable inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {t("onboarding.back")}
          </button>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <ShieldCheck className="size-3.5" /> {t("onboarding.securedByDodo")}
            </span>
            <button type="button" onClick={() => navigate(redirectTo, { replace: true })} disabled={submitting} className="pressable text-sm text-muted-foreground hover:text-foreground">
              {t("onboarding.maybeLater")}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
