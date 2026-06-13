import { useTranslation } from "react-i18next"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { budgetState, type BudgetPeriod } from "@/lib/budget"
import { formatMoney } from "@/lib/wealth"

const PERIOD_KEY: Record<BudgetPeriod, string> = {
  lifetime: "budget.lifetime",
  monthly: "budget.monthly",
  weekly: "budget.weekly",
  daily: "budget.daily",
}

const BAR: Record<"ok" | "warn" | "over", string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  over: "bg-red-500",
}
const TEXT: Record<"ok" | "warn" | "over", string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  over: "text-red-600 dark:text-red-400",
}

/**
 * Compact spend-vs-budget indicator: a period label, a progress bar coloured by
 * state (under / nearing / over), and "spent of amount" with the remaining/over
 * delta. Used on client cards, the personal dashboard, and the budget dialog.
 */
export function BudgetIndicator({
  amount,
  spent,
  period,
  currency,
  className = "",
  showPeriodIcon = false,
}: {
  amount: number
  spent: number
  period: BudgetPeriod
  currency: string
  className?: string
  /** Show a small piggy-bank icon right after the period label (opt-in; used on
   *  the clients list where the line has no header icon of its own). */
  showPeriodIcon?: boolean
}) {
  const { t } = useTranslation()
  const { ratio, remaining, state } = budgetState(spent, amount)
  const pct = Math.max(0, Math.min(1, ratio)) * 100

  return (
    <div className={className} aria-label={t("budget.title")}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          {t(PERIOD_KEY[period])}
          {showPeriodIcon && <MoneyBag className="size-4 text-muted-foreground/70" />}
        </span>
        <span className={`font-medium ${TEXT[state]}`}>
          {remaining >= 0
            ? t("budget.left", { amount: formatMoney(remaining, currency) })
            : t("budget.over", { amount: formatMoney(-remaining, currency) })}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${BAR[state]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {t("budget.spentOf", { spent: formatMoney(spent, currency), amount: formatMoney(amount, currency) })}
      </div>
    </div>
  )
}
