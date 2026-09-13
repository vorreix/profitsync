import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, Info } from "lucide-react"
import type { Debt } from "@/lib/types"
import { fromCents, monthlyEquivalent, toCents } from "@/lib/debt-math"
import { affordability, comparePlans, debtPaymentRatio, simulatePlan, STRATEGIES, type PlannerDebt, type PlanResult, type Strategy } from "@/lib/debt-planner"
import { formatMoney } from "@/lib/wealth"
import { monthsFromNow } from "@/lib/debt-format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"

const PLAN_KEY = "ps_debt_plan"

type Saved = { strategy: Strategy; extra: number; lump: number; order: string[] }

/**
 * The payment plan: how much can go to debt each month, which order to clear
 * it, and what each choice costs. All maths is the pure planner
 * (src/lib/debt-planner.ts) run in the browser and memoised per input, so
 * dragging the slider never touches the server. When the budget cannot cover
 * the scheduled payments the screen switches to STABILISATION: what is due,
 * what is short — no strategy recommendation.
 */
export function DebtPlanner({ debts, currency, today, averageMonthlyIncome, balancesVisible = true }: {
  debts: Debt[]
  currency: string
  today: string
  averageMonthlyIncome: number
  balancesVisible?: boolean
}) {
  const { t } = useTranslation("debts")
  const money = (cents: number) => formatMoney(fromCents(cents), currency, balancesVisible)

  // Only debts in the workspace currency can be summed; others are listed as excluded.
  const plannable = useMemo<PlannerDebt[]>(
    () => debts
      .filter((d) => d.currency === currency && d.balance > 0 && (d.lifecycle === "active" || d.lifecycle === "paused"))
      .map((d) => ({ id: d.id, name: d.name, balance: toCents(d.balance), annualRatePct: d.annual_rate_pct, minPayment: monthlyEquivalent(toCents(d.payment_amount ?? 0), d.payment_frequency) })),
    [debts, currency],
  )
  const excluded = debts.filter((d) => d.currency !== currency && d.balance > 0)
  const required = plannable.reduce((s, d) => s + d.minPayment, 0)

  const [saved, setSaved] = useState<Saved>(() => {
    try { return { strategy: "avalanche", extra: 0, lump: 0, order: [], ...(JSON.parse(localStorage.getItem(PLAN_KEY) ?? "{}") as Partial<Saved>) } } catch { return { strategy: "avalanche", extra: 0, lump: 0, order: [] } }
  })
  useEffect(() => { try { localStorage.setItem(PLAN_KEY, JSON.stringify(saved)) } catch { /* private mode */ } }, [saved])
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

  const ratio = debtPaymentRatio(required, toCents(averageMonthlyIncome))
  const sliderMax = Math.max(required * 2, toCents(500), budget + toCents(100))

  if (plannable.length === 0 && excluded.length === 0) {
    return <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noPlanDebts")}</div>
  }

  const monthsLabel = (m: number | null) => (m == null ? t("never") : monthsFromNow(m, today))
  const debtName = (id: string) => plannable.find((d) => d.id === id)?.name ?? ""
  const best = comparison ? [...comparison.plans].sort((a, b) => (a.totalInterest - b.totalInterest) || ((a.months ?? 1e9) - (b.months ?? 1e9)))[0] : null
  const snow = comparison?.plans.find((p) => p.strategy === "snowball")
  const aval = comparison?.plans.find((p) => p.strategy === "avalanche")
  const custom = comparison?.plans.find((p) => p.strategy === "custom")

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("planIntro")}</p>

      {/* Budget */}
      <div className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("requiredMinimums")}</p>
          <p className="text-xl font-bold tabular-nums">{money(required)}<span className="text-xs font-normal text-muted-foreground">{t("perMonth")}</span></p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="plan-budget">{t("monthlyBudget")}</Label>
          <div className="flex items-center gap-3">
            <Input id="plan-budget" type="number" inputMode="decimal" min="0" step="1" value={budgetText} onChange={(e) => { setBudgetText(e.target.value); setSaved((s) => ({ ...s, extra: Math.max(0, fromCents(toCents(Number(e.target.value) || 0) - required)) })) }} className="w-36 tabular-nums" />
            <Slider value={[budget]} min={0} max={sliderMax} step={100} onValueChange={([v]) => { setBudgetText(String(fromCents(v))); setSaved((s) => ({ ...s, extra: Math.max(0, fromCents(v - required)) })) }} aria-label={t("monthlyBudget")} className="flex-1" />
          </div>
          <p className="text-xs text-muted-foreground">{t("planBudgetHint", { required: money(required) })}</p>
        </div>
      </div>

      {ratio != null && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("pressure")}</p>
          <p className="text-xl font-bold tabular-nums">{ratio}%</p>
          <p className="text-sm">{t("pressureExplain", { ratio: Math.round(ratio) })}</p>
          <p className="text-xs text-muted-foreground">{t("pressureBasis")}</p>
        </div>
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
          {/* Strategy choice */}
          <div className="grid gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t("compare.strategy")}>
            {STRATEGIES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={saved.strategy === s} onClick={() => setSaved((v) => ({ ...v, strategy: s }))}
                className={cn("pressable ios-tap min-h-11 rounded-xl border p-3 text-left transition-colors", saved.strategy === s ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/40")}>
                <p className="text-sm font-medium">{t(`strategy.${s}`)}</p>
                <p className="text-xs text-muted-foreground">{t(`strategyHint.${s}`)}</p>
              </button>
            ))}
          </div>

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

      {excluded.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {excluded.map((d) => `${d.name} (${d.currency})`).join(", ")} — {t("receivablesHint")}
        </p>
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
