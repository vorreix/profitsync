import { useTranslation } from "react-i18next"
import { CheckCircle2 } from "lucide-react"
import type { Debt, DebtsOverview } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { formatMonthYear, formatShortDate } from "@/lib/debt-format"
import { cn } from "@/lib/utils"

/**
 * The next three months of scheduled debt payments, grouped by month with a
 * required / paid / remaining header. Paid rows are recorded payments in that
 * calendar month; irregular debts have no schedule and are not shown here.
 */
export function UpcomingPayments({ upcoming, debts, onOpen, balancesVisible = true }: {
  upcoming: DebtsOverview["upcoming"]
  debts: Debt[]
  onOpen: (debtId: string) => void
  balancesVisible?: boolean
}) {
  const { t } = useTranslation("debts")
  const byId = new Map(debts.map((d) => [d.id, d]))
  const months = new Map<string, DebtsOverview["upcoming"]>()
  for (const u of upcoming) {
    const key = u.date.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), u])
  }
  if (upcoming.length === 0) {
    return <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{t("noUpcoming")}</div>
  }
  return (
    <div className="space-y-4">
      {[...months].map(([key, rows]) => {
        // Totals per currency, since debts keep their native currency.
        const totals = new Map<string, { required: number; paid: number }>()
        for (const r of rows) {
          const cur = byId.get(r.debt_id)?.currency ?? ""
          const t0 = totals.get(cur) ?? { required: 0, paid: 0 }
          totals.set(cur, { required: t0.required + r.amount, paid: t0.paid + Math.min(r.amount, r.paid_amount) })
        }
        return (
          <section key={key} aria-labelledby={`up-${key}`} className="overflow-hidden rounded-2xl border bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-muted/30 px-4 py-3">
              <h3 id={`up-${key}`} className="text-sm font-semibold">{t("monthObligations", { month: formatMonthYear(`${key}-01`) })}</h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                {[...totals].map(([cur, v]) => (
                  <span key={cur} className="ml-3 first:ml-0">
                    {formatMoney(v.required, cur || "USD", balancesVisible)} · {t("paidMark")} {formatMoney(v.paid, cur || "USD", balancesVisible)} · {t("remaining")} {formatMoney(Math.max(0, v.required - v.paid), cur || "USD", balancesVisible)}
                  </span>
                ))}
              </p>
            </div>
            <ul className="divide-y">
              {rows.map((r, i) => {
                const d = byId.get(r.debt_id)
                return (
                  <li key={`${r.debt_id}-${r.date}-${i}`}>
                    <button type="button" onClick={() => onOpen(r.debt_id)} className="pressable ios-tap flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
                      <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{formatShortDate(r.date)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{d?.name ?? ""}</span>
                      {r.paid && <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3.5" aria-hidden /> {t("paidMark")}</span>}
                      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", r.paid && "text-muted-foreground line-through")}>{formatMoney(r.amount, d?.currency ?? "USD", balancesVisible)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
