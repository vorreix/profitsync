import { useTranslation } from "react-i18next"
import { ChevronRight } from "lucide-react"
import type { Debt } from "@/lib/types"
import { debtMoney, formatMonthYear, formatShortDate } from "@/lib/debt-format"
import { cn } from "@/lib/utils"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { Progress } from "@/components/ui/progress"
import { DebtStatusBadge } from "@/components/debts/DebtStatusBadge"

/**
 * One debt in the list: what is left, how far along it is, what comes next and
 * when it ends — in the debt's own currency. Tap anywhere to open it.
 */
export function DebtCard({ debt, onOpen, balancesVisible = true }: { debt: Debt; onOpen: () => void; balancesVisible?: boolean }) {
  const { t } = useTranslation("debts")
  const money = (n: number) => debtMoney(n, debt, balancesVisible)
  const isOpen = debt.lifecycle === "active" || debt.lifecycle === "paused"
  const frequencyWord = debt.payment_frequency && debt.payment_frequency !== "irregular" ? t(`frequency.${debt.payment_frequency}`) : null

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${debt.name} — ${t("viewDebt")}`}
      className="pressable ios-tap group flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
    >
      <div className="flex items-start gap-3">
        <WealthAccountIcon account={{ type: debt.direction === "receivable" ? "bank" : "loan", icon: debt.icon, logo_src: debt.logo_src }} className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{debt.name}</p>
            <DebtStatusBadge status={debt.status} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {t(`kinds.${debt.kind}`)}{debt.counterparty && debt.counterparty !== debt.name ? ` · ${debt.counterparty}` : ""}
          </p>
        </div>
        <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180" aria-hidden />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("remaining")}{debt.balance_is_estimate && <span className="ml-1 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">{t("estimated")}</span>}</p>
          <p className="text-2xl font-bold tabular-nums">{money(debt.balance)}</p>
        </div>
        {isOpen && debt.payment_amount && frequencyWord && (
          <div className="text-end">
            <p className="text-xs text-muted-foreground">{debt.next_due_date ? t("dueOn", { date: formatShortDate(debt.next_due_date) }) : t("payment")}</p>
            <p className="text-sm font-semibold tabular-nums">{money(debt.payment_amount)} <span className="text-xs font-normal text-muted-foreground">/ {frequencyWord}</span></p>
          </div>
        )}
      </div>

      {debt.progress_pct !== null && (
        <div className="space-y-1">
          <Progress value={debt.progress_pct} aria-label={t("repaid", { pct: debt.progress_pct })} className={cn("h-1.5", debt.status === "paid_off" && "[&>div]:bg-emerald-500")} />
          <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{t("repaid", { pct: Math.round(debt.progress_pct) })}</span>
            {debt.original_amount != null && <span>{t("ofOriginal", { amount: money(debt.original_amount) })}</span>}
          </div>
        </div>
      )}

      {isOpen && debt.estimate.kind === "date" && (
        <p className="text-xs text-muted-foreground">
          {t("debtFreeDate")}: <span className="font-medium text-foreground">{formatMonthYear(debt.estimate.date)}</span>
          {debt.estimate.assumedZeroRate && <span className="ml-1">({t("assumedZeroRate")})</span>}
        </p>
      )}
    </button>
  )
}
