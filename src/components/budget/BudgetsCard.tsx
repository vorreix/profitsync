import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChevronRight, Plus } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { formatMoney } from "@/lib/wealth"
import type { SpendingBudgetsResponse } from "@/lib/types"
import { budgetIcon } from "@/components/budget/budget-icons"
import { BAR_COLOR, DELTA_COLOR, barPct, budgetName } from "@/components/budget/budget-format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The dashboard's budgets card (registry id `budget`, personal workspaces).
 *
 * Up to three main budgets, the fullest first, each with its bar and what is
 * left; the whole card opens /budgets. Reads the same cached body as the
 * budgets page, so it costs no extra request once either has loaded. Returns
 * null with nothing to show for a viewer, so the dashboard registry hides it.
 */
export function BudgetsCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const { data, loading } = useApiQuery<SpendingBudgetsResponse>("/api/spending-budgets")
  const money = (n: number) => formatMoney(n, currency)
  const go = () => navigate("/budgets")

  if (loading) {
    return (
      <Card className={`py-0 ${className}`}>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-1.5 w-full" />
        </CardContent>
      </Card>
    )
  }

  const top = (data?.budgets ?? [])
    .filter((b) => !b.parent_id && b.status === "active" && b.window.phase === "active")
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
    .slice(0, 3)

  if (!top.length) {
    if (!canWrite) return null
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } }}
        className={`group cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MoneyBag className="size-4 text-muted-foreground" aria-hidden />
            {t("budgets.card.title")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("budgets.card.empty")}</p>
          <Button variant="outline" size="sm" className="mt-3 h-9 text-xs" onClick={(e) => { e.stopPropagation(); go() }}>
            <Plus className="size-3" /> {t("budgets.card.cta")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } }}
      className={`group cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <MoneyBag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{t("budgets.card.title")}</span>
          </div>
          <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
            {t("budgets.card.viewAll")} <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </span>
        </div>
        <ul className="mt-3 space-y-3">
          {top.map((b) => {
            const Icon = budgetIcon(b.icon)
            return (
              <li key={b.id} data-budget={b.id}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-medium">{budgetName(t, b)}</span>
                  </span>
                  <span className={`shrink-0 font-medium tabular-nums ${DELTA_COLOR[b.state]}`}>
                    {b.remaining >= 0 ? t("budgets.left", { amount: money(b.remaining) }) : t("budgets.over", { amount: money(-b.remaining) })}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full transition-[width] duration-300 ${BAR_COLOR[b.state]}`} style={{ width: `${barPct(b)}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
