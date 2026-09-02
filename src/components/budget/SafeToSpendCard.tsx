import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChevronRight, Plus } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { useBudget } from "@/lib/budget-context"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The dashboard's budget card (registry id `budget`).
 *
 * Deliberately compact: the ONE number that answers "can I spend?", its binding
 * reason, and a tap through to /budgets. It reads from the shared BudgetProvider,
 * so it costs no extra request — v1 had every consumer fetch independently.
 *
 * Returns null when there is no plan, which makes the dashboard registry
 * self-hide the card (Dashboard.tsx `cardNodes[id] !== null`) rather than
 * putting an empty prompt on the dashboard.
 */
export function SafeToSpendCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { data, loaded } = useBudget()

  const go = () => navigate("/budgets")
  const money = (n: number) => formatMoney(n, currency)

  // Gate the empty state on `loaded` so a background refresh never flashes
  // "no budget" before the real figure arrives.
  if (!loaded) {
    return (
      <Card className={`py-0 ${className}`}>
        <CardContent className="p-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const canWrite = data?.capabilities?.can_write ?? false

  if (!data?.plan || !data.money) {
    if (!canWrite) return null
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            go()
          }
        }}
        className={`group cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MoneyBag className="size-4 text-muted-foreground" aria-hidden />
            {t("budgetV2.title")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("budgetV2.emptyBody")}</p>
          <Button variant="outline" size="sm" className="mt-3 h-8 text-xs" onClick={go}>
            <Plus className="size-3" /> {t("budgetV2.emptyCta")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const m = data.money
  const negative = m.safe_to_spend < 0
  const flex = data.sections?.flexible

  const binding = () => {
    switch (m.binding) {
      case "plan":
        return t("budgetV2.bindingPlan", { amount: money(m.cash_after_reservations) })
      case "cash":
        return t("budgetV2.bindingCash", { amount: money(m.flexible_headroom) })
      case "both":
        return t("budgetV2.bindingBoth")
      default:
        return t("budgetV2.bindingCashOnly")
    }
  }

  const pct =
    flex && flex.planned > 0 ? Math.max(0, Math.min(100, (flex.spent_net / flex.planned) * 100)) : 0
  const barColor =
    flex?.utilisation === "over" ? "bg-red-500" : flex?.utilisation === "warn" || flex?.utilisation === "full" ? "bg-amber-500" : "bg-emerald-500"

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          go()
        }
      }}
      className={`group cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <MoneyBag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{t("budgetV2.safeToSpend")}</span>
          </div>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground rtl:rotate-180"
            aria-hidden
          />
        </div>

        <dl className="mt-2">
          <dt className="sr-only">{t("budgetV2.safeToSpend")}</dt>
          <dd className={`text-2xl font-bold tabular-nums ${negative ? "text-amber-600 dark:text-amber-400" : ""}`}>
            {money(m.safe_to_spend)}
          </dd>
        </dl>
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{binding()}</p>

        {flex && flex.planned > 0 && (
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("budgetV2.sectionFlexible")}
          >
            <div className={`h-full rounded-full transition-[width] duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
