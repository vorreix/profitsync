import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Plus, Repeat, TriangleAlert } from "lucide-react"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { monthlyEquivalent } from "@/lib/spaces"
import { formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { formatByCurrency } from "@/lib/debt-format"
import type { RecurringRule } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SummaryCard } from "@/components/dashboard/SummaryCard"
import { appLocale } from "@/lib/format-date"

/**
 * The dashboard's Recurring card (registry id `recurring`).
 *
 * It answers the one question the hub is for: what does my schedule cost me
 * every month, and what lands next. Both figures come from GET /api/recurring —
 * the same body the page reads, so arriving there costs no request.
 *
 * EVERY RHYTHM IS CONVERTED TO A MONTH. A weekly coffee and a yearly domain
 * belong in the same figure or the number means nothing, so both go through
 * `monthlyEquivalent` (the same conversion the Spaces auto-save uses) rather
 * than being summed as written.
 *
 * A rule the materializer is REFUSING to run (an archived account, a frozen
 * card, a plan limit) is the one thing here worth interrupting for: it is money
 * the user believes is moving and isn't. It gets its own amber line — the count
 * only, never the stored reason, which is English server text.
 *
 * Nothing scheduled at all → an invitation for someone who can add one, and
 * null for someone who cannot: a dashboard of empty boxes is worse than a
 * shorter dashboard, and Recurring keeps its permanent place in the sidebar.
 */
export function RecurringCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const { balancesVisible } = useBalancePrivacy()
  const { data, loading } = useApiQuery<RecurringRule[]>("/api/recurring")
  const money = (n: number, c?: string) => formatMoney(n, c ?? currency, balancesVisible)

  const summary = useMemo(() => {
    const rules = data ?? []
    const active = rules.filter((r) => r.active)
    // Per currency: rules post in their own account's currency, and a EUR
    // salary plus an INR rent is not one number without a rate.
    const inBy = new Map<string, number>()
    const outBy = new Map<string, number>()
    for (const r of active) {
      const per = monthlyEquivalent(Number(r.amount), r.frequency_unit, r.frequency_interval)
      const by = r.type === "incoming" ? inBy : outBy
      const c = r.currency_code ?? currency
      by.set(c, (by.get(c) ?? 0) + per)
    }
    const parts = (m: Map<string, number>) => [...m].map(([c, amount]) => ({ currency: c, amount }))
    const inPerMonth = parts(inBy)
    const outPerMonth = parts(outBy)
    // The soonest thing that will actually post. A blocked rule's cursor sits in
    // the past, so it is not "next" — it is broken, and says so separately.
    const next = active
      .filter((r) => !r.last_error)
      .reduce<RecurringRule | null>((best, r) => (!best || r.next_due_at < best.next_due_at ? r : best), null)
    return {
      total: rules.length,
      active: active.length,
      blocked: active.filter((r) => r.last_error).length,
      paused: rules.length - active.length,
      inPerMonth,
      outPerMonth,
      next,
    }
  }, [data, currency])

  if (loading) {
    return (
      <Card className={`h-full min-w-0 ${className}`}>
        <CardContent className="space-y-2.5 p-3 sm:p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-12 rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  if (summary.total === 0) {
    if (!canWrite) return null
    const go = () => navigate("/recurring")
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
            <Repeat className="size-4 text-muted-foreground" aria-hidden />
            {t("nav.recurring")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("recurring.emptyHint")}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 h-9 text-xs"
            onClick={(e) => { e.stopPropagation(); navigate("/recurring?new=1") }}
          >
            <Plus className="size-3" /> {t("recurring.add")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  // The headline is what the schedule TAKES each month; a workspace whose rules
  // only bring money in gets that figure instead, rather than a proud zero.
  const hasIn = summary.inPerMonth.some((x) => x.amount > 0)
  const hasOut = summary.outPerMonth.some((x) => x.amount > 0)
  const incomeOnly = !hasOut && hasIn
  const perMonth = (xs: { currency: string; amount: number }[]) => formatByCurrency(xs, balancesVisible) || money(0)
  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(appLocale(), { day: "numeric", month: "short" })

  return (
    <SummaryCard
      className={className}
      icon={<Repeat className="size-4" aria-hidden />}
      title={t("nav.recurring")}
      count={summary.active}
      headline={perMonth(incomeOnly ? summary.inPerMonth : summary.outPerMonth)}
      headlineClass={incomeOnly ? "text-emerald-600 dark:text-emerald-400" : undefined}
      subline={incomeOnly ? t("recurring.perMonthIn") : t("recurring.perMonthOut")}
      storageKey={`ps_dash_recurring_open_${activeOrg?.id ?? ""}`}
      onOpen={() => navigate("/recurring")}
    >
      {!incomeOnly && hasIn && (
        <p className="text-xs text-muted-foreground">
          {t("recurring.perMonthIn")}: <span className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">{perMonth(summary.inPerMonth)}</span>
        </p>
      )}

      {summary.next && (
        <button
          type="button"
          onClick={() => navigate(`/recurring/${summary.next!.id}`)}
          className="pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2 text-left transition-colors hover:border-primary/40"
        >
          <span className="min-w-0">
            <span className="block text-[11px] text-muted-foreground">{t("recurring.nextPayment")}</span>
            <span className="block truncate text-sm font-semibold">{summary.next.name}</span>
          </span>
          <span className="shrink-0 text-end">
            <span className={`block text-sm font-bold tabular-nums ${summary.next.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
              {summary.next.type === "incoming" ? "+" : "−"}{money(Number(summary.next.amount), summary.next.currency_code ?? undefined)}
            </span>
            <span className="block text-[11px] text-muted-foreground">{fmtDate(summary.next.next_due_at)}</span>
          </span>
        </button>
      )}

      {summary.blocked > 0 && (
        <button
          type="button"
          onClick={() => navigate("/recurring")}
          className="pressable flex min-h-11 w-full items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-start text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {t("recurring.notRunning", { count: summary.blocked })}
        </button>
      )}
    </SummaryCard>
  )
}
