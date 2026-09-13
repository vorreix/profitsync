import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowRight, HandCoins, Plus } from "lucide-react"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { formatByCurrency, formatLongDate, formatMonthYear } from "@/lib/debt-format"
import { formatMoney, useBalancePrivacy } from "@/lib/wealth"
import type { DebtsOverview } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The dashboard's Debt & Loans card (registry id `debts`).
 *
 * Every figure here is computed by GET /api/debts — the same body the hub
 * reads, so arriving from /debts costs no request and paints with no skeleton.
 * Nothing is re-derived on the client, which is what keeps the card and the hub
 * from ever disagreeing.
 *
 * MONEY IS NEVER SUMMED ACROSS CURRENCIES. `owed_by_currency` is a list, and
 * the next payment carries its own currency; `formatByCurrency` joins them
 * rather than adding euros to rupees.
 *
 * THREE STATES, not two. Nothing tracked at all is a one-line invitation for
 * someone who can add a debt, and nothing at all for someone who cannot —
 * returning null takes the card out of the grid entirely (see `visibleCards`),
 * because a dashboard of empty boxes is worse than a shorter dashboard, and
 * Debt & Loans already has a permanent place in the sidebar. Debt-free WITH
 * history is the third: that is an achievement, so the card stays and says so.
 */
export function DebtsCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const { balancesVisible } = useBalancePrivacy()
  const { data, loading } = useApiQuery<DebtsOverview>("/api/debts")
  const money = (n: number, c?: string) => formatMoney(n, c ?? currency, balancesVisible)

  if (loading) {
    return (
      <Card className={`min-w-0 ${className}`}>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-24 rounded-2xl" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-[60px] rounded-xl" />
            <Skeleton className="h-[60px] rounded-xl" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const s = data?.summary
  const open = data?.debts ?? []
  const receivables = data?.receivables ?? []
  const closed = data?.closed ?? []
  const hasHistory = open.length + receivables.length + closed.length > 0

  // Nothing ever tracked: an invitation, or nothing at all.
  if (!s || !hasHistory) {
    if (!canWrite) return null
    const go = () => navigate("/debts")
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } }}
        className={`group min-w-0 cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HandCoins className="size-4 text-muted-foreground" aria-hidden />
            {t("debts.title")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("debts.emptyBody")}</p>
          <Button variant="outline" size="sm" className="mt-3 h-9 text-xs" onClick={(e) => { e.stopPropagation(); go() }}>
            <Plus className="size-3" /> {t("debts.addDebt")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const owed = formatByCurrency(s.owed_by_currency, balancesVisible) || money(0)
  const owedToMe = formatByCurrency(s.receivable_by_currency, balancesVisible)
  const clear = open.length === 0

  return (
    <Card className={`min-w-0 ${className}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <HandCoins className="size-4 text-primary" aria-hidden /> {t("debts.title")}
          {open.length > 0 && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">{open.length}</span>
          )}
        </CardTitle>
        {/* h-11 on a phone: `size="sm"` is 32px, and this is the card's only
            way through to the full page. */}
        <Button variant="ghost" size="sm" className="h-11 shrink-0 text-xs sm:h-8" onClick={() => navigate("/debts")}>
          {t("common.viewAll")} <ArrowRight className="size-3 ml-1 rtl:rotate-180" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* Everything cleared, but there IS history: the number that matters is
            what was paid off, not what is left. */}
        {clear ? (
          <div className="rounded-2xl border bg-gradient-to-br from-emerald-500/10 to-transparent p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("debts.totalRepaidLifetime")}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{money(s.total_repaid)}</p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border bg-gradient-to-br from-primary/10 to-transparent p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("debts.totalDebt")}</p>
              <p className="mt-1 truncate text-2xl font-bold tabular-nums sm:text-3xl">{owed}</p>
              {/* Only when the server could actually compute one — the hub's
                  two-sentence explanation of why it could not is too long here. */}
              {s.debt_free_date && (
                <p className="mt-1 text-xs text-muted-foreground">{t("debts.currentPace", { date: formatMonthYear(s.debt_free_date) })}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Tile label={t("debts.stillToPay")} value={money(s.month.remaining)} />
              {s.overdue_count > 0 ? (
                <Tile label={t("debts.overdue")} value={money(s.month.overdue)} tone="warn" />
              ) : (
                <Tile label={t("debts.alreadyPaid")} value={money(s.month.paid)} tone="good" />
              )}
            </div>
          </>
        )}

        {owedToMe && (
          <p className="text-xs text-muted-foreground">
            {t("debts.owedToMe")}: <span className="font-medium tabular-nums text-foreground">{owedToMe}</span>
          </p>
        )}

        {s.next_payment && (
          <button
            type="button"
            onClick={() => navigate(`/debts/${s.next_payment!.debt_id}`)}
            className="pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-primary/40"
          >
            <span className="min-w-0">
              <span className="block text-[11px] text-muted-foreground">{t("debts.nextPayment")}</span>
              <span className="block truncate text-sm font-semibold">{s.next_payment.name}</span>
            </span>
            <span className="shrink-0 text-end">
              <span className="block text-sm font-bold tabular-nums">{money(s.next_payment.amount, s.next_payment.currency)}</span>
              <span className="block text-[11px] text-muted-foreground">{formatLongDate(s.next_payment.date)}</span>
            </span>
          </button>
        )}
      </CardContent>
    </Card>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="min-w-0 rounded-xl border p-3">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-0.5 truncate text-base font-semibold tabular-nums",
        tone === "good" && "text-emerald-600 dark:text-emerald-400",
        tone === "warn" && "text-amber-600 dark:text-amber-400",
      )}>{value}</p>
    </div>
  )
}
