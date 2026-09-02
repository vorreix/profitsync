import { useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Info, Loader as Loader2, Pause, Play, RefreshCw } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { apiPatch } from "@/lib/api"
import { useBudget } from "@/lib/budget-context"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import type { BudgetEnvelopeView, BudgetStateV2, BudgetView } from "@/lib/types"
import { BudgetWizard } from "@/components/budget/BudgetWizard"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

// Semantic state colours — a healthy plan is emerald or neutral; red appears
// only when a figure is genuinely exceeded (spec §6.0).
const BAR: Record<BudgetStateV2, string> = {
  none: "bg-muted-foreground/40",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  full: "bg-amber-500",
  over: "bg-red-500",
}

export function BudgetOverviewPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { data, loaded, syncing, error, refresh, sync } = useBudget()
  const [explainOpen, setExplainOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const money = (n: number) => formatMoney(n, currency)

  // ── loading: skeletons shaped like the final content, never a bare spinner ──
  if (!loaded) {
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-3 sm:p-6">
        <div className="rounded-2xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">{t("budgetV2.loadFailed")}</p>
          <Button className="mt-4" variant="outline" onClick={() => void refresh()}>
            {t("budgetV2.retry")}
          </Button>
        </div>
      </div>
    )
  }

  const canWrite = data?.capabilities?.can_write ?? false

  // ── empty: one line, one action (§6.2) ─────────────────────────────────────
  if (!data?.plan) {
    return (
      <div className="p-3 sm:p-6">
        <Header />
        <div className="mt-4 rounded-2xl border border-dashed py-12 text-center sm:py-16">
          <MoneyBag className="mx-auto mb-3 size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">{t("budgetV2.emptyTitle")}</p>
          <p className="mt-1 px-6 text-xs text-muted-foreground">
            {canWrite ? t("budgetV2.emptyBody") : t("budgetV2.emptyReadOnly")}
          </p>
          {canWrite && (
            <div className="mt-8">
              <BudgetWizard onCreated={() => void refresh()} />
            </div>
          )}
        </div>
      </div>
    )
  }

  const paused = data.plan.status === "paused"

  const togglePause = async () => {
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/budgets/v2", token, { status: paused ? "active" : "paused" }, ["/api/budgets"])
      await sync()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <Header
        right={
          canWrite ? (
            <Button variant="outline" size="sm" onClick={togglePause} disabled={busy}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : paused ? (
                <Play className="size-3.5" />
              ) : (
                <Pause className="size-3.5" />
              )}
              {paused ? t("budgetV2.resume") : t("budgetV2.pause")}
            </Button>
          ) : undefined
        }
      />

      {/* Paused is NOT empty: the plan and its history are intact (§6.13). */}
      {paused && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {t("budgetV2.pausedBanner", {
            date: data.plan.paused_at ? new Date(data.plan.paused_at).toLocaleDateString() : "—",
          })}
        </div>
      )}

      {/* A plan can exist for a moment before its first period is opened (the
          wizard creates the plan, then sync opens the period). Render the
          setting-up state rather than a blank body — the provider's self-heal
          is already in flight. */}
      {(!data.money || !data.period) && (
        <Card className="py-0">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("budgetV2.updating")}
          </CardContent>
        </Card>
      )}

      {data.money && data.period && (
        <>
          <SafeToSpendHero
            view={data}
            money={money}
            syncing={syncing}
            onExplain={() => setExplainOpen(true)}
            className={paused ? "opacity-70" : ""}
          />

          {/* Overdue is the single most consequential thing on the screen. */}
          {data.occurrences_overdue.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                {t("budgetV2.overdueTitle", {
                  count: data.occurrences_overdue.length,
                  amount: money(data.occurrences_overdue.reduce((s, o) => s + o.amount, 0)),
                })}
              </p>
            </div>
          )}

          <Sections view={data} money={money} />

          {/* Machine-readable honesty about what this build cannot do (§21.4). */}
          {data.limitations.length > 0 && <Limitations codes={data.limitations} />}
        </>
      )}

      <SafeToSpendExplainer open={explainOpen} onOpenChange={setExplainOpen} view={data} money={money} />
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <MoneyBag className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          {t("budgetV2.title")}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("budgetV2.subtitle")}</p>
      </div>
      {right}
    </div>
  )
}

/**
 * The headline. `binding` is rendered directly beneath the figure — it is the
 * most important string in the product, because it turns "why is this €20?" into
 * one sentence (§6.3).
 */
function SafeToSpendHero({
  view,
  money,
  syncing,
  onExplain,
  className = "",
}: {
  view: BudgetView
  money: (n: number) => string
  syncing: boolean
  onExplain: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const m = view.money!
  const p = view.period!
  const negative = m.safe_to_spend < 0

  const bindingText = () => {
    switch (m.binding) {
      case "plan":
        return t("budgetV2.bindingPlan", { amount: money(m.cash_after_reservations) })
      case "cash":
        return t("budgetV2.bindingCash", { amount: money(m.flexible_headroom) })
      case "both":
        return t("budgetV2.bindingBoth")
      case "cash_only":
        return t("budgetV2.bindingCashOnly")
    }
  }

  return (
    <Card className={`py-0 ${className}`}>
      <CardContent className="p-4 sm:p-5">
        {/* A definition list, so each label↔value pair is programmatically linked. */}
        <dl>
          <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {t("budgetV2.safeToSpend")}
            <button
              type="button"
              onClick={onExplain}
              className="rounded-full p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("budgetV2.explainTitle")}
            >
              <Info className="size-3.5" aria-hidden />
            </button>
            {syncing && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="size-3 animate-spin" aria-hidden /> {t("budgetV2.updating")}
              </span>
            )}
          </dt>
          {/* One live region only, on the figure that actually matters. */}
          <dd
            aria-live="polite"
            className={`mt-1 text-3xl font-bold tabular-nums sm:text-4xl ${negative ? "text-amber-600 dark:text-amber-400" : ""}`}
          >
            {money(m.safe_to_spend)}
          </dd>
        </dl>

        <p className="mt-1.5 text-xs text-muted-foreground">{bindingText()}</p>
        {negative && (
          <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">{t("budgetV2.negativeSafe")}</p>
        )}
        {!negative && m.binding === "plan" && m.safe_to_spend === 0 && (
          <p className="mt-1 text-xs font-medium">{t("budgetV2.planFullyUsed")}</p>
        )}

        {/* Context strip — Available / Reserved / days left. */}
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">{t("budgetV2.availableNow")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{money(m.available_now)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("budgetV2.reserved")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{money(m.reserved)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("budgetV2.forecast")}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{money(m.forecast_balance)}</dd>
          </div>
        </dl>

        <p className="mt-3 text-[11px] text-muted-foreground">
          {t("budgetV2.daysLeft", { count: p.days_left })}
          {p.is_partial ? ` · ${t("budgetV2.partialPeriod")}` : ""}
          {view.plan?.income_mode === "available" ? ` · ${t("budgetV2.basedOnWhatYouHave")}` : ""}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * Section cards. Each section uses its OWN vocabulary and shape — income is
 * expected/received, commitments are paid/unpaid, savings are set-aside — because
 * one "spent of planned" ratio across them is meaningless (§8.7).
 *
 * A progress bar appears ONLY on flexible spending: a bar implies "X of Y used",
 * which says nothing useful about income or an unpaid bill.
 */
function Sections({ view, money }: { view: BudgetView; money: (n: number) => string }) {
  const { t } = useTranslation()
  const s = view.sections!
  const m = view.money!

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* Flexible — the only section with a utilisation bar. */}
      <Card className="py-0 sm:col-span-2">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t("budgetV2.sectionFlexible")}</p>
            <span className="text-xs text-muted-foreground">{stateLabel(t, s.flexible.utilisation)}</span>
          </div>
          <p className="mt-2 text-lg font-bold tabular-nums">
            {money(s.flexible.spent_net)}
            <span className="text-sm font-normal text-muted-foreground"> / {money(s.flexible.planned)}</span>
          </p>
          <Bar state={s.flexible.utilisation} spent={s.flexible.spent_net} planned={s.flexible.planned} label={t("budgetV2.sectionFlexible")} />
          {/* The SIGNED remaining, so an overspent plan is visible. */}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {s.flexible.remaining >= 0
              ? t("budgetV2.left", { amount: money(s.flexible.remaining) })
              : t("budgetV2.over", { amount: money(-s.flexible.remaining) })}
          </p>
          {s.flexible.envelopes.length > 0 && (
            <ul className="mt-3 space-y-2 border-t pt-3">
              {s.flexible.envelopes.map((e) => (
                <EnvelopeRow key={e.id} env={e} money={money} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Income — expected / received / still to come. */}
      <Card className="py-0">
        <CardContent className="p-4">
          <p className="text-sm font-semibold">{t("budgetV2.sectionIncome")}</p>
          <dl className="mt-2 space-y-1 text-xs">
            {s.income.expected != null && (
              <Row label={t("budgetV2.incomeExpected")} value={money(s.income.expected)} />
            )}
            <Row label={t("budgetV2.incomeReceived")} value={money(s.income.received)} />
            {s.income.outstanding != null && (
              <Row label={t("budgetV2.incomeOutstanding")} value={money(s.income.outstanding)} />
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Commitments — hidden entirely when there are none, not shown at zero. */}
      {(s.commitment.planned > 0 || s.commitment.outstanding > 0 || s.commitment.envelopes.length > 0) && (
        <Card className="py-0">
          <CardContent className="p-4">
            <p className="text-sm font-semibold">{t("budgetV2.sectionCommitment")}</p>
            <dl className="mt-2 space-y-1 text-xs">
              <Row label={t("budgetV2.commitmentSettled")} value={money(s.commitment.settled)} />
              <Row label={t("budgetV2.commitmentOutstanding")} value={money(s.commitment.outstanding)} />
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Savings — funded / reserved-not-confirmed / balance. */}
      {(s.savings.planned > 0 || s.savings.balance > 0 || s.savings.envelopes.length > 0) && (
        <Card className="py-0">
          <CardContent className="p-4">
            <p className="text-sm font-semibold">{t("budgetV2.sectionSavings")}</p>
            <dl className="mt-2 space-y-1 text-xs">
              <Row label={t("budgetV2.savingsFunded")} value={money(s.savings.funded)} />
              <Row label={t("budgetV2.reserved")} value={money(s.savings.reserved)} />
            </dl>
            {s.savings.awaiting_confirmation > 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                {t("budgetV2.savingsAwaiting", { count: s.savings.awaiting_confirmation })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Debt — paid / outstanding, never mixed into spending. */}
      {(s.debt.planned > 0 || s.debt.outstanding > 0) && (
        <Card className="py-0">
          <CardContent className="p-4">
            <p className="text-sm font-semibold">{t("budgetV2.sectionDebt")}</p>
            <dl className="mt-2 space-y-1 text-xs">
              <Row label={t("budgetV2.debtPaid")} value={money(s.debt.paid)} />
              <Row label={t("budgetV2.debtOutstanding")} value={money(s.debt.outstanding)} />
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Unallocated is a BUFFER, shown neutrally — never folded into safe-to-spend. */}
      <Card className="py-0">
        <CardContent className="p-4">
          <p className="text-sm font-semibold">{t("budgetV2.unallocated")}</p>
          <p className="mt-2 text-lg font-bold tabular-nums">{money(m.unallocated)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("budgetV2.fundingCapacity")}: {money(view.period!.funding_capacity)}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** An envelope row keeps its OWN signed remaining, even when the plan nets it. */
function EnvelopeRow({ env, money }: { env: BudgetEnvelopeView; money: (n: number) => string }) {
  const { t } = useTranslation()
  return (
    <li className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{env.name}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {t("budgetV2.spent")} {money(env.spent_net)} / {money(env.planned)}
          {env.rollover_in !== 0 && ` · ${t("budgetV2.carriedIn", { amount: money(env.rollover_in) })}`}
        </p>
        {env.refunds_provisional > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {t("budgetV2.includesRefund", { amount: money(env.refunds_provisional) })}
          </p>
        )}
      </div>
      <span
        className={`shrink-0 text-xs font-medium tabular-nums ${
          env.remaining < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
        }`}
      >
        {env.remaining >= 0
          ? t("budgetV2.left", { amount: money(env.remaining) })
          : t("budgetV2.over", { amount: money(-env.remaining) })}
      </span>
    </li>
  )
}

function Bar({
  state,
  spent,
  planned,
  label,
}: {
  state: BudgetStateV2
  spent: number
  planned: number
  label: string
}) {
  const pct = planned > 0 ? Math.max(0, Math.min(100, (spent / planned) * 100)) : spent > 0 ? 100 : 0
  return (
    <div
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${BAR[state]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function stateLabel(t: (k: string) => string, s: BudgetStateV2): string {
  return t(
    s === "ok"
      ? "budgetV2.stateOk"
      : s === "warn"
        ? "budgetV2.stateWarn"
        : s === "full"
          ? "budgetV2.stateFull"
          : s === "over"
            ? "budgetV2.stateOver"
            : "budgetV2.stateNone",
  )
}

/** The most important explainer in the product: it must teach that TWO limits apply. */
function SafeToSpendExplainer({
  open,
  onOpenChange,
  view,
  money,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  view: BudgetView
  money: (n: number) => string
}) {
  const { t } = useTranslation()
  const m = view.money
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("budgetV2.explainTitle")}</DrawerTitle>
          <DrawerDescription>{t("budgetV2.subtitle")}</DrawerDescription>
        </DrawerHeader>
        {m && (
          <div className="space-y-3 px-4 pb-8 text-sm">
            {/* (a) the cash bound */}
            <p>{t("budgetV2.explainCash", { available: money(m.available_now), reserved: money(m.reserved) })}</p>
            <p className="font-medium">{t("budgetV2.explainCashResult", { amount: money(m.cash_after_reservations) })}</p>
            {m.reserved === 0 && <p className="text-muted-foreground">{t("budgetV2.explainNothingReserved")}</p>}

            {/* (b) the plan bound — ONE netted subtraction, not a list of leftovers */}
            {m.ceiling_defined ? (
              <>
                <p>{t("budgetV2.explainPlan", { amount: money(m.flexible_headroom) })}</p>
                <p className="font-semibold">{t("budgetV2.explainLower", { amount: money(m.safe_to_spend) })}</p>
              </>
            ) : (
              <p className="text-muted-foreground">{t("budgetV2.explainNoCeiling")}</p>
            )}

            <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
              <p>{t("budgetV2.explainSpaces")}</p>
              {m.reserved_breakdown.virtual_fund_balances > 0 && <p>{t("budgetV2.explainVirtual")}</p>}
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

/** States what this build cannot do, rather than approximating it (§21.4). */
function Limitations({ codes }: { codes: string[] }) {
  const { t } = useTranslation()
  const MAP: Record<string, string> = {
    credit_cards_unsupported: "budgetV2.limitCreditCards",
    loan_split_unsupported: "budgetV2.limitLoanSplit",
    manual_pending_unsupported: "budgetV2.limitPending",
    currency_changed: "budgetV2.limitCurrencyChanged",
  }
  const known = codes.filter((c) => MAP[c])
  if (!known.length) return null
  return (
    <details className="rounded-xl border bg-muted/30 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">{t("budgetV2.limitationsTitle")}</summary>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {known.map((c) => (
          <li key={c}>· {t(MAP[c])}</li>
        ))}
      </ul>
    </details>
  )
}

export default BudgetOverviewPage
