import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ChevronDown, Eye, EyeOff, HandCoins, Plus, Sparkles } from "lucide-react"
import { apiGet } from "@/lib/api"
import { WEALTH_CHANGED_EVENT } from "@/lib/data-events"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canWriteRole } from "@/lib/roles"
import type { Debt, DebtDirection, DebtsOverview } from "@/lib/types"
import { formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { formatByCurrency, formatLongDate, formatMonthYear } from "@/lib/debt-format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DebtCard } from "@/components/debts/DebtCard"
import { DebtFormSheet } from "@/components/debts/DebtFormSheet"
import { DebtPlanner } from "@/components/debts/DebtPlanner"
import { UpcomingPayments } from "@/components/debts/UpcomingPayments"

type Tab = "overview" | "debts" | "plan" | "upcoming"
const TABS: Tab[] = ["overview", "debts", "plan", "upcoming"]

/**
 * The Debt Hub. Answers, in order: how much do I owe, what must I pay this
 * month, what is due next, how far along am I, when am I debt-free, and how
 * could I get there faster. Tabs keep the advanced parts (plan, calendar) one
 * tap away without bloating the global navigation.
 */
export function DebtsPage() {
  const { t } = useTranslation("debts")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const canWrite = canWriteRole(activeOrg?.role)
  const { balancesVisible, setBalancesVisible } = useBalancePrivacy()
  const [params, setParams] = useSearchParams()
  const tab = (TABS as string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "overview"
  const setTab = (next: Tab) => setParams((p) => { const n = new URLSearchParams(p); if (next === "overview") n.delete("tab"); else n.set("tab", next); return n }, { replace: true })

  const [data, setData] = useState<DebtsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  // The add sheet stays MOUNTED and is toggled via `open` (the repo's dialog
  // pattern): mounting a Radix Dialog in the same tick the dropdown menu closes
  // lets the menu's dismissal close the dialog before it is even seen.
  const [form, setForm] = useState<{ direction: DebtDirection } | null>(null)
  // Opened from plain buttons (never from a dropdown menu: a Radix menu's late
  // dismissal can close a dialog opened from one of its items). The direction
  // (I owe / owed to me) is chosen inside the sheet.
  const openForm = (direction: DebtDirection) => setForm({ direction })
  const [closedOpen, setClosedOpen] = useState(false)

  const load = useCallback(async ({ silent = false } = {}) => {
    const token = await getToken()
    if (!token) return
    if (!silent) setLoading(true)
    try {
      setData(await apiGet<DebtsOverview>("/api/debts", token))
    } catch {
      if (!silent) toast.error(t("couldNotLoad"))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [getToken, t])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => void load({ silent: true })
    window.addEventListener(WEALTH_CHANGED_EVENT, h)
    return () => window.removeEventListener(WEALTH_CHANGED_EVENT, h)
  }, [load])

  const open = useMemo(() => (data?.debts ?? []).filter((d) => d.balance > 0 && (d.lifecycle === "active" || d.lifecycle === "paused")), [data])
  const s = data?.summary
  const money = (n: number, cur = currency) => formatMoney(n, cur, balancesVisible)
  const openDebt = (id: string) => navigate(`/debts/${id}`)

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="icon" aria-label={balancesVisible ? t("wealth:hideBalances") : t("wealth:showBalances")} onClick={() => setBalancesVisible((v) => !v)}>
          {balancesVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
        {canWrite && (
          <Button size="sm" onClick={() => openForm("owed")} disabled={loading}><Plus className="size-4" /> {t("addDebt")}</Button>
        )}
      </div>
    </div>
  )

  // ONE sheet element, rendered in every branch below, so its identity never
  // changes when the page moves from loading → empty → loaded (a remount while
  // open would dismiss it).
  const sheet = (
    <DebtFormSheet
      open={!!form}
      onOpenChange={(o) => { if (!o) setForm(null) }}
      direction={form?.direction ?? "owed"}
      orgCurrency={currency}
      onSaved={(d: Debt) => { void load({ silent: true }); openDebt(d.id) }}
    />
  )

  if (loading || !data || !s) {
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        {header}
        <Skeleton className="h-40 rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
        {sheet}
      </div>
    )
  }

  const hasAnyHistory = data.debts.length + data.receivables.length + data.closed.length > 0
  const debtFree = open.length === 0 && hasAnyHistory

  // ── Empty / debt-free states ────────────────────────────────────────────────
  if (!hasAnyHistory) {
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><HandCoins className="size-6" /></span>
          <p className="text-base font-semibold">{t("emptyTitle")}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          {canWrite && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button onClick={() => openForm("owed")}><Plus className="size-4" /> {t("iOwe")}</Button>
              <Button variant="outline" onClick={() => openForm("receivable")}><HandCoins className="size-4" /> {t("owedToMe")}</Button>
            </div>
          )}
        </div>
        {sheet}
      </div>
    )
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {header}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          {TABS.map((k) => <TabsTrigger key={k} value={k}>{t(`tabs.${k}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      {tab === "overview" && (
        <div className="space-y-4">
          {/* Hero */}
          <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6" aria-live="polite">
            {debtFree ? (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("debtFreeTitle")}</p>
                <p className="mt-1 text-3xl font-bold sm:text-4xl">{t("debtFreeTitle")} <Sparkles className="inline size-6 text-emerald-500" aria-hidden /></p>
                <p className="mt-1 text-sm text-muted-foreground">{t("debtFreeBody")}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label={t("totalRepaidLifetime")} value={money(s.total_repaid)} />
                  <Stat label={t("requiredThisMonth")} value={money(0)} />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("totalDebt")}</p>
                <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">{formatByCurrency(s.owed_by_currency, balancesVisible) || money(0)}</p>
                {s.debt_free_date ? (
                  <p className="mt-1.5 text-sm text-muted-foreground">{t("currentPace", { date: formatMonthYear(s.debt_free_date) })}</p>
                ) : (
                  <p className="mt-1.5 text-sm text-muted-foreground">{t("debtFreeUnknown")}. {t("debtFreeUnknownHint")}</p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label={t("requiredThisMonth")} value={money(s.month.required)} />
                  <Stat label={t("alreadyPaid")} value={money(s.month.paid)} tone="good" />
                  <Stat label={t("stillToPay")} value={money(s.month.remaining)} />
                  <Stat label={t("overdue")} value={s.overdue_count > 0 ? money(s.month.overdue) : t("noOverdue")} tone={s.overdue_count > 0 ? "warn" : undefined} />
                </div>
                {s.next_payment && (
                  <button type="button" onClick={() => openDebt(s.next_payment!.debt_id)} className="pressable mt-4 flex w-full items-center justify-between gap-3 rounded-xl border bg-card/70 px-4 py-3 text-left hover:bg-card">
                    <span>
                      <span className="block text-xs text-muted-foreground">{t("nextPayment")}</span>
                      <span className="block text-sm font-semibold">{s.next_payment.name}</span>
                    </span>
                    <span className="text-end">
                      <span className="block text-sm font-bold tabular-nums">{money(s.next_payment.amount, s.next_payment.currency)}</span>
                      <span className="block text-xs text-muted-foreground">{formatLongDate(s.next_payment.date)}</span>
                    </span>
                  </button>
                )}
              </>
            )}
          </section>

          {/* Insights */}
          {s.insights.length > 0 && (
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("insightsTitle")}</h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {s.insights.map((i, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{t(`insight.${i.key}`, {
                      ...i.params,
                      amount: typeof i.params.amount === "number" ? money(i.params.amount, String(i.params.currency ?? currency)) : i.params.amount,
                      date: typeof i.params.date === "string" ? formatMonthYear(i.params.date) : i.params.date,
                    })}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Debts (compact) */}
          {open.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {open.slice(0, 6).map((d) => <DebtCard key={d.id} debt={d} onOpen={() => openDebt(d.id)} balancesVisible={balancesVisible} />)}
            </div>
          )}
          {open.length > 6 && <Button variant="outline" className="w-full" onClick={() => setTab("debts")}>{t("tabs.debts")} ({open.length})</Button>}
        </div>
      )}

      {tab === "debts" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.debts.filter((d) => d.lifecycle === "active" || d.lifecycle === "paused").map((d) => <DebtCard key={d.id} debt={d} onOpen={() => openDebt(d.id)} balancesVisible={balancesVisible} />)}
            {data.debts.filter((d) => d.lifecycle !== "active" && d.lifecycle !== "paused").map((d) => <DebtCard key={d.id} debt={d} onOpen={() => openDebt(d.id)} balancesVisible={balancesVisible} />)}
          </div>
          {data.receivables.length > 0 && (
            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-semibold">{t("receivablesTitle")} <span className="text-muted-foreground tabular-nums">· {formatByCurrency(s.receivable_by_currency, balancesVisible)}</span></h2>
                <p className="text-xs text-muted-foreground">{t("receivablesHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.receivables.map((d) => <DebtCard key={d.id} debt={d} onOpen={() => openDebt(d.id)} balancesVisible={balancesVisible} />)}
              </div>
            </section>
          )}
          {data.closed.length > 0 && (
            <section className="rounded-2xl border bg-card">
              <button type="button" onClick={() => setClosedOpen((v) => !v)} aria-expanded={closedOpen} className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium">
                <span>{t("closedDebts")} <span className="text-muted-foreground">({data.closed.length})</span></span>
                <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", closedOpen && "rotate-180")} />
              </button>
              {closedOpen && (
                <div className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.closed.map((d) => <DebtCard key={d.id} debt={d} onOpen={() => openDebt(d.id)} balancesVisible={balancesVisible} />)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {tab === "plan" && (
        <DebtPlanner debts={data.debts} currency={currency} today={data.today} averageMonthlyIncome={s.average_monthly_income} balancesVisible={balancesVisible} />
      )}

      {tab === "upcoming" && (
        <UpcomingPayments upcoming={data.upcoming} debts={data.debts} onOpen={openDebt} balancesVisible={balancesVisible} />
      )}

      {sheet}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border bg-card/60 p-2.5 sm:p-3">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
      <p className={cn("mt-1 truncate text-sm font-bold tabular-nums sm:text-lg", tone === "good" && "text-emerald-600 dark:text-emerald-400", tone === "warn" && "text-amber-700 dark:text-amber-300")}>{value}</p>
    </div>
  )
}
