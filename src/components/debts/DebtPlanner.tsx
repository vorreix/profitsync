import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, Check, Info } from "lucide-react"
import type { Debt } from "@/lib/types"
import { fromCents, monthlyEquivalent, toCents } from "@/lib/debt-math"
import { affordability, comparePlans, debtPaymentRatio, simulatePlan, STRATEGIES, type PlannerDebt, type PlanResult, type Strategy } from "@/lib/debt-planner"
import { formatMoney } from "@/lib/wealth"
import { useOrg } from "@/lib/org-context"
import { monthsFromNow } from "@/lib/debt-format"
import { cn } from "@/lib/utils"
import { FxExcludedNotice } from "@/components/FxExcludedNotice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

type Saved = { strategy: Strategy; extra: number; lump: number; order: string[] }

/**
 * The payment plan: how much can go to debt each month, which order to clear
 * it, and what each choice costs. All maths is the pure planner
 * (src/lib/debt-planner.ts) run in the browser and memoised per input, so
 * dragging the slider never touches the server. When the budget cannot cover
 * the scheduled payments the screen switches to STABILISATION: what is due,
 * what is short — no strategy recommendation.
 */
export function DebtPlanner({ debts, currency, today, averageMonthlyIncome, incomeExcludedCount = 0, balancesVisible = true }: {
  debts: Debt[]
  /** The overview's currency — the one `averageMonthlyIncome` was converted into. */
  currency: string
  today: string
  averageMonthlyIncome: number
  /** Income rows the server could not convert (no rate) and left out of the average. */
  incomeExcludedCount?: number
  balancesVisible?: boolean
}) {
  const { t } = useTranslation("debts")
  const { activeOrg } = useOrg()
  // Open loans only: a settled one has nothing left to plan.
  const open = useMemo(() => debts.filter((d) => d.balance > 0 && (d.lifecycle === "active" || d.lifecycle === "paused")), [debts])
  // Debts in different currencies cannot be added up, so each currency gets a
  // plan of its own (MC-095) — before, everything outside the overview's
  // currency was dropped, and after a workspace currency change that was every
  // debt. The overview's currency comes first (income is measured in it), then
  // the one with the most debts.
  const currencies = useMemo(() => {
    const count = new Map<string, number>()
    for (const d of open) count.set(d.currency || currency, (count.get(d.currency || currency) ?? 0) + 1)
    return [...count].sort((a, b) => Number(b[0] === currency) - Number(a[0] === currency) || b[1] - a[1]).map(([c]) => c)
  }, [open, currency])
  const [picked, setPicked] = useState<string | null>(null)
  const planCurrency = picked && currencies.includes(picked) ? picked : (currencies[0] ?? currency)
  const storageKey = `ps_debt_plan_${activeOrg?.id ?? ""}_${planCurrency}`

  if (open.length === 0) {
    return <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noPlanDebts")}</div>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("planIntro")}</p>
      {currencies.length > 1 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("planCurrency")}>
            {currencies.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === planCurrency} onClick={() => setPicked(c)}
                className={cn(
                  "pressable ios-tap min-h-11 min-w-16 rounded-xl border px-4 text-sm font-semibold transition-colors",
                  c === planCurrency ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/40",
                )}>
                {c}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("planPerCurrency")}</p>
        </div>
      )}
      {/* Remounted per workspace and currency: the extra and the lump sum are
          amounts IN that currency, so each plan keeps its own (MC-143) — one
          shared key carried ₹5,000 a month into a USD workspace as $5,000. */}
      <CurrencyPlan
        key={storageKey}
        storageKey={storageKey}
        inheritsLegacy={planCurrency === currency}
        debts={open.filter((d) => (d.currency || currency) === planCurrency)}
        currency={planCurrency}
        today={today}
        // Income is in the overview's currency; another plan has nothing to set it against.
        averageMonthlyIncome={planCurrency === currency ? averageMonthlyIncome : null}
        incomeExcludedCount={planCurrency === currency ? incomeExcludedCount : 0}
        balancesVisible={balancesVisible}
      />
    </div>
  )
}

const LEGACY_PLAN_KEY = "ps_debt_plan"

/** One currency's plan — every amount on it is in `currency`. */
function CurrencyPlan({ storageKey, inheritsLegacy, debts, currency, today, averageMonthlyIncome, incomeExcludedCount, balancesVisible }: {
  storageKey: string
  /** The overview currency's plan, which may adopt the plan saved before plans were per workspace and currency. */
  inheritsLegacy: boolean
  /** Open debts in `currency`. */
  debts: Debt[]
  currency: string
  today: string
  averageMonthlyIncome: number | null
  incomeExcludedCount: number
  balancesVisible: boolean
}) {
  const { t } = useTranslation("debts")
  const money = (cents: number) => formatMoney(fromCents(cents), currency, balancesVisible)

  const plannable = useMemo<PlannerDebt[]>(
    () => debts.map((d) => ({ id: d.id, name: d.name, balance: toCents(d.balance), annualRatePct: d.annual_rate_pct, minPayment: monthlyEquivalent(toCents(d.payment_amount ?? 0), d.payment_frequency) })),
    [debts],
  )
  const required = plannable.reduce((s, d) => s + d.minPayment, 0)

  const [saved, setSaved] = useState<Saved>(() => {
    try {
      // The plan used to live under one global key. The first overview-currency
      // plan opened adopts it (the effect below then retires it, so no second
      // workspace does): nobody loses their strategy, extra and order.
      const raw = localStorage.getItem(storageKey) ?? (inheritsLegacy ? localStorage.getItem(LEGACY_PLAN_KEY) : null)
      return { strategy: "avalanche", extra: 0, lump: 0, order: [], ...(JSON.parse(raw ?? "{}") as Partial<Saved>) }
    } catch {
      return { strategy: "avalanche", extra: 0, lump: 0, order: [] }
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved))
      if (inheritsLegacy) localStorage.removeItem(LEGACY_PLAN_KEY)
    } catch { /* private mode */ }
  }, [storageKey, saved, inheritsLegacy])
  const [budgetText, setBudgetText] = useState(() => String(fromCents(required + toCents(saved.extra))))
  useEffect(() => { setBudgetText(String(fromCents(required + toCents(saved.extra)))) }, [required]) // eslint-disable-line react-hooks/exhaustive-deps

  const budget = toCents(Number(budgetText) || 0)
  const afford = affordability(required, budget)
  const extra = afford.mode === "optimize" ? afford.extra : 0
  const lump = toCents(saved.lump)
  const order = useMemo(() => {
    const ids = plannable.map((d) => d.id)
    const kept = saved.order.filter((id) => ids.includes(id))
    return [...kept, ...ids.filter((id) => !kept.includes(id))]
  }, [plannable, saved.order])

  const comparison = useMemo(() => (plannable.length ? comparePlans({ debts: plannable, extraMonthly: extra, customOrder: order, lumpSumNow: lump }) : null), [plannable, extra, order, lump])
  const chosen: PlanResult | null = useMemo(() => {
    if (!plannable.length) return null
    return saved.strategy === "minimum" ? comparison!.baseline : simulatePlan({ debts: plannable, strategy: saved.strategy, extraMonthly: extra, customOrder: order, lumpSumNow: lump })
  }, [plannable, saved.strategy, extra, order, lump, comparison])

  const ratio = averageMonthlyIncome == null ? null : debtPaymentRatio(required, toCents(averageMonthlyIncome))
  const sliderMax = Math.max(required * 2, toCents(500), budget + toCents(100))

  const monthsLabel = (m: number | null) => (m == null ? t("never") : monthsFromNow(m, today))
  const debtName = (id: string) => plannable.find((d) => d.id === id)?.name ?? ""
  const best = comparison ? [...comparison.plans].sort((a, b) => (a.totalInterest - b.totalInterest) || ((a.months ?? 1e9) - (b.months ?? 1e9)))[0] : null
  const snow = comparison?.plans.find((p) => p.strategy === "snowball")
  const aval = comparison?.plans.find((p) => p.strategy === "avalanche")
  const custom = comparison?.plans.find((p) => p.strategy === "custom")

  return (
    <div className="space-y-4">
      {/* Budget */}
      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("requiredMinimums")}</p>
          <p className="text-xl font-bold tabular-nums">{money(required)}<span className="text-xs font-normal text-muted-foreground">{t("perMonth")}</span></p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="plan-budget">{t("monthlyBudget")}</Label>
          {/* Stacked on a phone. Sharing one row left the slider ~200px of rail
              to drag next to an input that needed none of it, and the thumb is
              16px — so the slider gets the full width and `py-3` gives it a
              hit area a thumb can actually find. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input id="plan-budget" type="number" inputMode="decimal" min="0" step="1" value={budgetText} onChange={(e) => { setBudgetText(e.target.value); setSaved((s) => ({ ...s, extra: Math.max(0, fromCents(toCents(Number(e.target.value) || 0) - required)) })) }} className="h-11 w-full tabular-nums sm:h-9 sm:w-36" />
            <Slider value={[budget]} min={0} max={sliderMax} step={100} onValueChange={([v]) => { setBudgetText(String(fromCents(v))); setSaved((s) => ({ ...s, extra: Math.max(0, fromCents(v - required)) })) }} aria-label={t("monthlyBudget")} className="w-full py-3 sm:flex-1 sm:py-0" />
          </div>
          <p className="text-xs text-muted-foreground">{t("planBudgetHint", { required: money(required) })}</p>
        </div>
      </div>

      {ratio != null ? (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("pressure")}</p>
          <p className="text-xl font-bold tabular-nums">{ratio}%</p>
          <p className="text-sm">{t("pressureExplain", { ratio: Math.round(ratio) })}</p>
          <p className="text-xs text-muted-foreground">{t("pressureBasis")}</p>
          {/* Income with no exchange rate is left out, so the ratio reads high — say so. */}
          <FxExcludedNotice count={incomeExcludedCount} className="mt-1" />
        </div>
      ) : averageMonthlyIncome != null && (
        <FxExcludedNotice count={incomeExcludedCount} />
      )}

      {afford.mode === "stabilize" ? (
        <section className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4" aria-live="polite">
          <h3 className="text-sm font-semibold">{t("stabilizeTitle")}</h3>
          <p className="text-sm">{t("stabilizeBody", { required: money(required), budget: money(budget), gap: money(afford.gap) })}</p>
          <p className="text-xs text-muted-foreground">{t("stabilizeHint")}</p>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("stabilizeList")}</p>
            <ul className="divide-y rounded-xl border bg-card">
              {debts.filter((d) => d.next_due_date && d.payment_amount && d.balance > 0).sort((a, b) => a.next_due_date!.localeCompare(b.next_due_date!)).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{d.next_due_date}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatMoney(d.payment_amount!, d.currency, balancesVisible)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : comparison && chosen && (
        <>
          {/* Strategy choice.
              Five full-width cards, each carrying its own explanation, took
              about a third of a phone screen to answer one question. Below
              `sm` they pair up and show the name alone, with a tick on the one
              that is chosen — and the explanation is said ONCE underneath, for
              the strategy actually selected, which is the only one being
              decided. The five-across row with inline hints is unchanged on a
              wider screen, where there is room for it. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t("compare.strategy")}>
            {STRATEGIES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={saved.strategy === s} onClick={() => setSaved((v) => ({ ...v, strategy: s }))}
                className={cn(
                  "pressable ios-tap flex min-h-11 items-center gap-2 rounded-xl border p-3 text-left transition-colors last:odd:col-span-2 sm:block sm:last:odd:col-span-1",
                  saved.strategy === s ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/40",
                )}>
                <Check className={cn("size-4 shrink-0 text-primary transition-opacity sm:hidden", saved.strategy === s ? "opacity-100" : "opacity-0")} aria-hidden />
                {/* Spans, not paragraphs: a button may only contain phrasing
                    content, and these were <p> inside <button>. */}
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(`strategy.${s}`)}</span>
                  <span className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{t(`strategyHint.${s}`)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground sm:hidden" aria-live="polite">{t(`strategyHint.${saved.strategy}`)}</p>

          {saved.strategy === "custom" && (
            <div className="rounded-2xl border bg-card p-3">
              <p className="mb-2 text-xs text-muted-foreground">{t("customOrder")}</p>
              <ol className="divide-y">
                {order.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">{debtName(id)}</span>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={t("moveUp")} disabled={i === 0} onClick={() => setSaved((s) => { const o = [...order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; return { ...s, order: o } })}><ArrowUp className="size-4" /></Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label={t("moveDown")} disabled={i === order.length - 1} onClick={() => setSaved((s) => { const o = [...order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; return { ...s, order: o } })}><ArrowDown className="size-4" /></Button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Chosen plan headline */}
          <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5" aria-live="polite">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`strategy.${chosen.strategy}`)}</p>
            <p className="mt-1 text-3xl font-bold">{chosen.months == null ? t("debtFreeUnknown") : monthsLabel(chosen.months)}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t("compare.interest")} value={money(chosen.totalInterest)} />
              <Stat label={t("compare.firstCleared")} value={chosen.firstCleared ? `${debtName(chosen.firstCleared.id)} · ${t("months", { count: chosen.firstCleared.month })}` : "—"} />
              {comparison.savings[chosen.strategy].monthsSaved != null && chosen.strategy !== "minimum" && (
                <Stat label={t("vsMinimum")} value={`${t("monthsSaved", { count: comparison.savings[chosen.strategy].monthsSaved! })} · ${t("interestSaved", { amount: money(comparison.savings[chosen.strategy].interestSaved!) })}`} />
              )}
              {chosen.assumedZeroRate.length > 0 && <Stat label={t("estimated")} value={t("assumedZeroRate")} />}
            </div>
            <PayoffChart series={chosen.series} today={today} currency={currency} visible={balancesVisible} />
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 size-3 shrink-0" aria-hidden /> {t("rollover")} {t("disclaimer")}</p>
          </section>

          {/* What-if */}
          <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
            <p className="text-sm font-semibold sm:col-span-2">{t("whatIf")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="plan-extra">{t("extraPerMonth")}</Label>
              <Input id="plan-extra" type="number" inputMode="decimal" min="0" step="10" value={String(saved.extra)} onChange={(e) => { const v = Math.max(0, Number(e.target.value) || 0); setSaved((s) => ({ ...s, extra: v })); setBudgetText(String(fromCents(required + toCents(v)))) }} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-lump">{t("lumpSumToday")}</Label>
              <Input id="plan-lump" type="number" inputMode="decimal" min="0" step="50" value={String(saved.lump)} onChange={(e) => setSaved((s) => ({ ...s, lump: Math.max(0, Number(e.target.value) || 0) }))} className="tabular-nums" />
            </div>
          </div>

          {/* Comparison */}
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("compare.strategy")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("compare.debtFree")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("compare.interest")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("compare.firstCleared")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[comparison.baseline, ...comparison.plans].map((p) => (
                  <tr key={p.strategy} className={cn(p.strategy === chosen.strategy && "bg-primary/5")}>
                    <td className="px-3 py-2 font-medium">{t(`strategy.${p.strategy}`)}</td>
                    <td className="px-3 py-2">{monthsLabel(p.months)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(p.totalInterest)}</td>
                    <td className="px-3 py-2">{p.firstCleared ? `${debtName(p.firstCleared.id)} · ${t("months", { count: p.firstCleared.month })}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 text-sm">
            {best && <p>{t("savesInterest", { strategy: t(`strategy.${best.strategy}`) })}</p>}
            {snow && aval && snow.firstCleared && aval.firstCleared && snow.totalInterest > aval.totalInterest && aval.firstCleared.month > snow.firstCleared.month && (
              <p>{t("tradeoff", { strategy: t("strategy.snowball"), amount: money(snow.totalInterest - aval.totalInterest), months: aval.firstCleared.month - snow.firstCleared.month })}</p>
            )}
            {saved.strategy === "custom" && custom && aval && custom.firstCleared && (
              custom.totalInterest > aval.totalInterest
                ? <p>{t("customCost", { name: debtName(custom.firstCleared.id), amount: money(custom.totalInterest - aval.totalInterest) })}</p>
                : <p>{t("customSaves")}</p>
            )}
          </div>
        </>
      )}

    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card/60 p-2.5">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/** Balance over time as a small inline SVG — today, each year, and the debt-free point. */
function PayoffChart({ series, today, currency, visible }: { series: { month: number; balance: number }[]; today: string; currency: string; visible: boolean }) {
  const { t } = useTranslation("debts")
  if (series.length < 2) return null
  const w = 600, h = 120, pad = 8
  const maxBal = Math.max(...series.map((s) => s.balance), 1)
  const maxM = Math.max(...series.map((s) => s.month), 1)
  const pt = (s: { month: number; balance: number }) => [pad + (s.month / maxM) * (w - 2 * pad), pad + (1 - s.balance / maxBal) * (h - 2 * pad)] as const
  const path = series.map((s, i) => `${i === 0 ? "M" : "L"}${pt(s)[0].toFixed(1)},${pt(s)[1].toFixed(1)}`).join(" ")
  const labels = series.filter((_, i) => i === 0 || i === series.length - 1 || series.length <= 6 || i % Math.ceil(series.length / 5) === 0)
  return (
    <figure className="mt-4">
      <figcaption className="text-xs text-muted-foreground">{t("chartTitle")}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-28 w-full" role="img" aria-label={t("chartTitle")}>
        <path d={`${path} L${pt(series[series.length - 1])[0]},${h - pad} L${pad},${h - pad} Z`} className="fill-primary/10" />
        <path d={path} className="fill-none stroke-primary" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {series.map((s) => <circle key={s.month} cx={pt(s)[0]} cy={pt(s)[1]} r={3} className="fill-primary" />)}
      </svg>
      <div className="flex justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
        {labels.map((s) => (
          <span key={s.month} className="text-center">
            {s.month === 0 ? t("today") : monthsFromNow(s.month, today)}<br />{formatMoney(fromCents(s.balance), currency, visible)}
          </span>
        ))}
      </div>
    </figure>
  )
}
