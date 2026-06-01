import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, RotateCw, Sparkles } from "lucide-react"
import { cn } from "../lib/cn"
import { formatMinor, discountedAmount } from "../lib/format"
import { usePricing, type PublicPlan } from "../lib/usePricing"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { Reveal } from "../components/Reveal"
import { SectionHeading } from "../components/SectionHeading"

type Cycle = "monthly" | "yearly"

// Same limit keys the app's billing screen renders, in display order.
const LIMIT_KEYS = [
  "clients",
  "transactionsPerClient",
  "quotations",
  "attachmentSizeKb",
  "attachmentsPerTx",
  "noteLength",
] as const

export function Pricing() {
  const { t, i18n } = useTranslation()
  const { data, loading, error, reload } = usePricing()
  const [cycle, setCycle] = useState<Cycle>("monthly")

  const locale = i18n.language
  const cycleSuffix = cycle === "yearly" ? t("pricing.perYr") : t("pricing.perMo")

  const limitValue = (key: string, val: number): string => {
    if (key === "attachmentSizeKb") return `${(val / 1024).toFixed(1)}MB`
    if (key === "noteLength") return t("pricing.charsValue", { value: val.toLocaleString(locale) })
    return val.toLocaleString(locale)
  }

  const planFeatures = (plan: PublicPlan) =>
    LIMIT_KEYS.map((key) => {
      const custom = plan.feature_labels?.[key]
      const val = plan.limits?.[key] ?? 0
      return { key, custom, val }
    }).filter(({ custom, val }) => !!custom || val > 0)

  // Order: free first, then paid plans.
  const plans = data?.plans
    ? [...data.plans].sort((a, b) => (a.key === "free" ? -1 : b.key === "free" ? 1 : 0))
    : []
  const cols = Math.min(Math.max(plans.length, 1), 3)
  const gridCols = cols >= 3 ? "lg:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "max-w-md mx-auto"
  // A successful response with no plans is treated like an error so the section
  // never renders blank.
  const unavailable = !loading && (error || plans.length === 0)

  // Highest yearly discount across paid plans — drives the "Save X%" badge on the
  // Yearly toggle, matching the per-card yearly discount. Straight from live data.
  const yearlySave = plans
    .filter((p) => p.key !== "free")
    .reduce((best, p) => Math.max(best, p.local_pricing.yearly_discount_pct || 0), 0)

  return (
    <section id="pricing" className="scroll-mt-24 py-20 sm:py-28">
      <Container>
        <SectionHeading eyebrow={t("pricing.eyebrow")} title={t("pricing.title")} subtitle={t("pricing.subtitle")} />

        {/* Billing cycle toggle */}
        <Reveal className="mt-10 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-border bg-muted/50 p-1">
            {(["monthly", "yearly"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                aria-pressed={cycle === c}
                className={cn(
                  "inline-flex items-center rounded-full px-5 py-2 text-sm font-medium transition-all cursor-pointer",
                  cycle === c
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`pricing.${c}`)}
                {c === "yearly" && yearlySave > 0 && (
                  <span className="ms-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {t("pricing.save", { pct: yearlySave })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-12">
          {loading && (
            <div className={cn("grid gap-6", gridCols === "max-w-md mx-auto" ? "max-w-md mx-auto" : "sm:grid-cols-2")}>
              {[0, 1].map((i) => (
                <div key={i} className="h-[26rem] animate-pulse rounded-3xl border border-border bg-muted/40" />
              ))}
            </div>
          )}

          {unavailable && (
            <Reveal className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-border bg-card p-10 text-center">
              <p className="text-sm text-muted-foreground">{t("pricing.loadError")}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={reload}>
                  <RotateCw className="size-4" />
                  {t("pricing.retry")}
                </Button>
                <Button href="/signup" size="sm">
                  {t("pricing.ctaFree")}
                </Button>
              </div>
            </Reveal>
          )}

          {!loading && !error && plans.length > 0 && (
            <div className={cn("grid gap-6", gridCols)}>
              {plans.map((plan, idx) => {
                const isFree = plan.key === "free"
                const popular = !isFree && idx === plans.findIndex((p) => p.key !== "free")
                const local = plan.local_pricing
                const base = cycle === "yearly" ? local.yearly : local.monthly
                const discount = cycle === "yearly" ? local.yearly_discount_pct : local.monthly_discount_pct
                const finalAmount = discountedAmount(base, discount)
                const promo =
                  (plan.promo_note && plan.promo_note.trim()) ||
                  (discount > 0 ? t("pricing.save", { pct: discount }) : "")
                const features = planFeatures(plan)

                return (
                  <Reveal key={plan.id} delay={idx * 90}>
                    <div
                      className={cn(
                        "relative flex h-full flex-col overflow-hidden rounded-3xl border bg-card p-7 shadow-sm transition-all duration-300 hover:shadow-lg",
                        popular ? "border-foreground/25 ring-1 ring-foreground/15" : "border-border",
                      )}
                    >
                      {popular && (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute -right-12 -top-14 size-44 rounded-full bg-emerald-500/10 blur-3xl"
                        />
                      )}

                      {/* Reserved row keeps plan titles aligned across all cards */}
                      <div className="relative mb-4 flex h-6 items-center">
                        {popular && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background">
                            <Sparkles className="size-3" />
                            {t("pricing.mostPopular")}
                          </span>
                        )}
                      </div>

                      <h3 className="ps-display text-lg font-semibold text-foreground">{plan.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isFree ? t("pricing.freeBlurb") : t("pricing.premiumBlurb")}
                      </p>

                      {/* Price */}
                      <div className="mt-6 min-h-[4.5rem]">
                        {isFree ? (
                          <p className="ps-display text-4xl font-bold text-foreground">{t("pricing.free")}</p>
                        ) : (
                          <div>
                            {discount > 0 && (
                              <p className="ps-tnum text-sm text-muted-foreground line-through">
                                {formatMinor(base, local.currency, locale)}
                                {cycleSuffix}
                              </p>
                            )}
                            <p className="ps-display flex items-baseline gap-1 text-foreground">
                              <span className="ps-tnum text-4xl font-bold">
                                {formatMinor(finalAmount, local.currency, locale)}
                              </span>
                              <span className="text-sm font-medium text-muted-foreground">{cycleSuffix}</span>
                            </p>
                            {promo && (
                              <p className="mt-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">{promo}</p>
                            )}
                          </div>
                        )}
                      </div>

                      <Button
                        href="/signup"
                        size="md"
                        variant={isFree ? "outline" : "primary"}
                        className="mt-6 w-full"
                      >
                        {isFree ? t("pricing.ctaFree") : t("pricing.ctaPremium")}
                      </Button>

                      {/* Features */}
                      {features.length > 0 && (
                      <div className="mt-7 border-t border-border pt-6">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("pricing.included")}
                        </p>
                        <ul className="mt-4 space-y-3">
                          {features.map(({ key, custom, val }) => (
                            <li key={key} className="flex items-start gap-2.5 text-sm">
                              <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                              {custom ? (
                                <span className="text-foreground/90">{custom}</span>
                              ) : (
                                <span className="text-foreground/90">
                                  <span className="text-muted-foreground">{t(`pricing.limits.${key}`)}: </span>
                                  <span className="ps-tnum font-medium">{limitValue(key, val)}</span>
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                      )}
                    </div>
                  </Reveal>
                )
              })}
            </div>
          )}

          {!loading && !error && plans.length > 0 && (
            <p className="mx-auto mt-8 max-w-xl text-center text-xs text-muted-foreground">{t("pricing.note")}</p>
          )}
        </div>
      </Container>
    </section>
  )
}
