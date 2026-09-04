import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import {
  ChevronRight,
  GripVertical,
  Info,
  Loader as Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { toast } from "sonner"
import { apiErrorMessage, apiPatch } from "@/lib/api"
import { formatIsoDate } from "@/lib/dates"
import { useBudget } from "@/lib/budget-context"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import type { BudgetCurrencyLimitation, BudgetEnvelopeView, BudgetSectionName, BudgetStateV2, BudgetView } from "@/lib/types"
import { BudgetWizard } from "@/components/budget/BudgetWizard"
import { AddCommitmentDialog } from "@/components/budget/AddCommitmentDialog"
import { EnvelopeDialog } from "@/components/budget/EnvelopeDialog"
import { envelopeIcon } from "@/components/budget/envelope-icons"
import { EnvelopeDetailSheet } from "@/components/budget/EnvelopeDetailSheet"
import { OverdueList } from "@/components/budget/OverdueList"
import { RefundReview } from "@/components/budget/RefundReview"
import { ResolveOverspendSheet } from "@/components/budget/ResolveOverspendSheet"
import { EnvelopeList, type HandleProps } from "@/components/budget/EnvelopeList"
import { SavingsSection } from "@/components/budget/SavingsSection"
import { MigrationPrompts } from "@/components/budget/MigrationPrompts"
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
  const { t, i18n } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { data, loaded, syncing, error, refresh, sync } = useBudget()
  const [explainOpen, setExplainOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Progressive disclosure (P2): every one of these is CLOSED until the user
  // asks for it. The overview never shows a form.
  const [addSection, setAddSection] = useState<BudgetSectionName | null>(null)
  const [editing, setEditing] = useState<BudgetEnvelopeView | null>(null)
  const [addBillOpen, setAddBillOpen] = useState(false)
  const [detailFor, setDetailFor] = useState<BudgetEnvelopeView | null>(null)
  const [overspendFor, setOverspendFor] = useState<BudgetEnvelopeView | null>(null)
  const [revision, setRevision] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()

  const money = (n: number) => formatMoney(n, currency)

  // A legacy /budgets/:key bookmark resolves to ?envelope=<id> (§13.6), so open
  // that envelope's detail once and then drop the param — otherwise a refresh
  // or a back-navigation would keep reopening the sheet.
  //
  // Declared HERE, above the loading / error / empty guards: those return early,
  // so a hook placed after them would not run in the same order on every render.
  const deepLinkId = searchParams.get("envelope")
  useEffect(() => {
    if (!deepLinkId) return
    const all = Object.values(data?.sections ?? {}).flatMap(
      (sec) => (sec as { envelopes?: BudgetEnvelopeView[] }).envelopes ?? [],
    )
    const found = all.find((e) => e.id === deepLinkId)
    if (found) setDetailFor(found)
    const next = new URLSearchParams(searchParams)
    next.delete("envelope")
    setSearchParams(next, { replace: true })
  }, [deepLinkId, data, searchParams, setSearchParams])

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

  // Categories another envelope already claims, so the add dialog can show them
  // as unavailable BEFORE the user picks one and hits the 409.
  const claimedKeys = [
    ...new Set(
      Object.values(data.sections ?? {}).flatMap((sec) =>
        ((sec as { envelopes?: BudgetEnvelopeView[] }).envelopes ?? []).flatMap((e) => e.match_keys ?? []),
      ),
    ),
  ]
  const commitmentEnvelopes = [
    ...(data.sections?.commitment.envelopes ?? []),
    ...(data.sections?.debt.envelopes ?? []),
  ]

  // Every mutation re-reads the plan rather than patching state locally: these
  // figures are derived from each other (a reallocation moves safe-to-spend as
  // well as two envelopes), so a local patch would show a self-inconsistent
  // plan for a moment.
  const afterChange = () => {
    setRevision((r) => r + 1)
    void refresh()
  }

  const togglePause = async () => {
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/budgets/v2", token, { status: paused ? "active" : "paused" }, ["/api/budgets"])
      await sync()
    } catch (err) {
      // Pause/resume is owner/admin on the server (§18.2); an editor's tap must
      // say so rather than fail silently. request() throws before mutate()
      // invalidates anything, so there is nothing to refresh here.
      toast.error(apiErrorMessage(err, t("budgetV2.syncFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <Header
        right={
          canWrite ? (
            <Button variant="outline" size="sm" className="h-9" onClick={togglePause} disabled={busy}>
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
            date: data.plan.paused_at ? formatIsoDate(data.plan.paused_at, i18n.language) : "—",
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

      {/* The migration's unanswered questions come FIRST: both change the
          figures below them, so settling one before reading the numbers is the
          right order (§13.4, §13.8). Renders nothing for a natively created
          plan. */}
      <MigrationPrompts view={data} money={money} canWrite={canWrite} onResolved={afterChange} />

      {data.money && data.period && (
        <>
          <SafeToSpendHero
            view={data}
            money={money}
            syncing={syncing}
            onExplain={() => setExplainOpen(true)}
            className={paused ? "opacity-70" : ""}
          />

          {/* Overdue is the single most consequential thing on the screen, and
              each row is actionable in one tap rather than being a warning the
              user has to go somewhere else to act on. */}
          <OverdueList
            occurrences={data.occurrences_overdue}
            money={money}
            canWrite={canWrite && !paused}
            onChanged={afterChange}
          />

          {/* A provisional refund is a GUESS the user can correct — surfaced
              only when there is one to review. */}
          <RefundReview
            revision={revision}
            money={money}
            canWrite={canWrite && !paused}
            onChanged={afterChange}
          />

          <Sections
            view={data}
            money={money}
            canWrite={canWrite && !paused}
            onAdd={setAddSection}
            onAddBill={() => setAddBillOpen(true)}
            onOpenDetail={setDetailFor}
            onResolveOverspend={setOverspendFor}
            onEdit={setEditing}
            onChanged={afterChange}
          />

          {/* Machine-readable honesty about what this build cannot do (§21.4). */}
          {data.limitations.length > 0 && <Limitations codes={data.limitations} currency={data.currency_limitation ?? null} />}
        </>
      )}

      <SafeToSpendExplainer open={explainOpen} onOpenChange={setExplainOpen} view={data} money={money} />

      <EnvelopeDialog
        open={addSection !== null}
        onOpenChange={(v) => !v && setAddSection(null)}
        section={addSection ?? "flexible"}
        claimedKeys={claimedKeys}
        onSaved={afterChange}
      />

      {/* Same component in EDIT mode — the fields are identical, and a separate
          edit dialog is how the two drift apart. */}
      <EnvelopeDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        section={editing?.section ?? "flexible"}
        envelope={editing}
        claimedKeys={claimedKeys}
        onSaved={afterChange}
      />

      <AddCommitmentDialog
        open={addBillOpen}
        onOpenChange={setAddBillOpen}
        envelopes={commitmentEnvelopes}
        onCreated={afterChange}
      />

      <EnvelopeDetailSheet envelope={detailFor} money={money} onOpenChange={() => setDetailFor(null)} />

      <ResolveOverspendSheet
        envelope={overspendFor}
        siblings={overspendFor ? sameSection(data, overspendFor.section) : []}
        unallocated={data.money?.unallocated_available ?? 0}
        money={money}
        onOpenChange={() => setOverspendFor(null)}
        onResolved={afterChange}
      />
    </div>
  )
}

/** Every envelope in one section — the candidates a reallocation can draw from. */
function sameSection(view: BudgetView, section: BudgetSectionName): BudgetEnvelopeView[] {
  const s = view.sections
  if (!s) return []
  const bucket = (s as unknown as Record<string, { envelopes?: BudgetEnvelopeView[] }>)[section]
  return bucket?.envelopes ?? []
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
            {/* The icon stays small so it does not compete with the figure, but
                the HIT AREA is a full 36px: the same DOM runs in the native
                WebView, where an 18px target is genuinely hard to tap. */}
            <button
              type="button"
              onClick={onExplain}
              className="-m-2 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
function Sections({
  view,
  money,
  canWrite,
  onAdd,
  onAddBill,
  onOpenDetail,
  onResolveOverspend,
  onEdit,
  onChanged,
}: {
  view: BudgetView
  money: (n: number) => string
  canWrite: boolean
  onAdd: (section: BudgetSectionName) => void
  onAddBill: () => void
  onOpenDetail: (env: BudgetEnvelopeView) => void
  onResolveOverspend: (env: BudgetEnvelopeView) => void
  onEdit: (env: BudgetEnvelopeView) => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const s = view.sections!
  const m = view.money!

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {/* Flexible — the only section with a utilisation bar. */}
      <Card className="py-0 sm:col-span-2">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t("budgetV2.sectionFlexible")}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{stateLabel(t, s.flexible.utilisation)}</span>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1 px-2 text-xs"
                  onClick={() => onAdd("flexible")}
                >
                  <Plus className="size-3" aria-hidden /> {t("budgetV2.addCategory")}
                </Button>
              )}
            </div>
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
          {/* Where the rest of the spending went. Answering this is the whole
              point of having a catch-all rather than dropping unmatched rows. */}
          {s.flexible.uncategorised > 0 && s.flexible.envelopes.some((e) => !e.is_catch_all) && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("budgetV2.uncategorisedNote", { amount: money(s.flexible.uncategorised) })}
            </p>
          )}

          {s.flexible.envelopes.length > 0 && (
            <EnvelopeList envelopes={s.flexible.envelopes} canWrite={canWrite} onChanged={onChanged}>
              {(e, handle) => (
                <EnvelopeRow
                  env={e}
                  money={money}
                  canWrite={canWrite}
                  handle={handle}
                  onOpenDetail={onOpenDetail}
                  onResolveOverspend={onResolveOverspend}
                  onEdit={onEdit}
                />
              )}
            </EnvelopeList>
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

      {/* Commitments — hidden entirely when there are none, not shown at zero,
          except for the one affordance that lets a user create the first one. */}
      {s.commitment.envelopes.length > 0 ? (
        <Card className="py-0">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("budgetV2.sectionCommitment")}</p>
              {canWrite && (
                <Button size="sm" variant="outline" className="h-9 gap-1 px-2 text-xs" onClick={onAddBill}>
                  <Plus className="size-3" aria-hidden /> {t("budgetV2.addBill")}
                </Button>
              )}
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <Row label={t("budgetV2.commitmentSettled")} value={money(s.commitment.settled)} />
              <Row label={t("budgetV2.commitmentOutstanding")} value={money(s.commitment.outstanding)} />
            </dl>
            <ul className="mt-3 space-y-2 border-t pt-3">
              {s.commitment.envelopes.map((e) => (
                <li key={e.id}>
                  <EnvelopeRow
                    env={e}
                    money={money}
                    canWrite={canWrite}
                    handle={null}
                    onOpenDetail={onOpenDetail}
                    onResolveOverspend={onResolveOverspend}
                    onEdit={onEdit}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        canWrite && (
          <Card className="py-0">
            <CardContent className="p-4">
              <p className="text-sm font-semibold">{t("budgetV2.sectionCommitment")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("budgetV2.commitmentEmpty")}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-9 gap-1 text-xs"
                onClick={() => onAdd("commitment")}
              >
                <Plus className="size-3" aria-hidden /> {t("budgetV2.addBillsGroup")}
              </Button>
            </CardContent>
          </Card>
        )
      )}

      {/* Savings — funds with their own confirmation flow (§8.9.1). */}
      <SavingsSection
        view={view}
        money={money}
        canWrite={canWrite}
        onAdd={() => onAdd("savings")}
        onOpenDetail={onOpenDetail}
        onEdit={onEdit}
        onChanged={onChanged}
      />

      {/* Debt — paid / outstanding, NEVER mixed into spending: a debt payment
          reduces what you owe, it is not consumption (§8.7). */}
      {s.debt.envelopes.length > 0 && (
        <Card className="py-0">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{t("budgetV2.sectionDebt")}</p>
              {canWrite && (
                <Button size="sm" variant="outline" className="h-9 gap-1 px-2 text-xs" onClick={onAddBill}>
                  <Plus className="size-3" aria-hidden /> {t("budgetV2.addPayment")}
                </Button>
              )}
            </div>
            <dl className="mt-2 space-y-1 text-xs">
              <Row label={t("budgetV2.debtPaid")} value={money(s.debt.paid)} />
              <Row label={t("budgetV2.debtOutstanding")} value={money(s.debt.outstanding)} />
            </dl>
            <ul className="mt-3 space-y-2 border-t pt-3">
              {s.debt.envelopes.map((e) => (
                <li key={e.id}>
                  <EnvelopeRow
                    env={e}
                    money={money}
                    canWrite={canWrite}
                    handle={null}
                    onOpenDetail={onOpenDetail}
                    onResolveOverspend={onResolveOverspend}
                    onEdit={onEdit}
                  />
                </li>
              ))}
            </ul>
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

/**
 * One envelope, as a card.
 *
 * Shows EXACTLY four figures — planned, spent, pending, remaining — and nothing
 * else (spec §6.5). Anything more belongs in the detail sheet, which is one tap
 * away; a card that tried to show rollover, refunds, carry policy and priority
 * at once is what made v1's list unreadable.
 *
 * `remaining` is this envelope's OWN signed figure even when the plan nets it
 * across the section: an overspent category must look overspent, and the netting
 * only ever applies to the plan-wide headroom.
 */
function EnvelopeRow({
  env,
  money,
  canWrite,
  handle,
  onOpenDetail,
  onResolveOverspend,
  onEdit,
}: {
  env: BudgetEnvelopeView
  money: (n: number) => string
  canWrite: boolean
  /** Drag activator, when this row sits in a reorderable list. */
  handle: HandleProps | null
  onOpenDetail: (env: BudgetEnvelopeView) => void
  onResolveOverspend: (env: BudgetEnvelopeView) => void
  onEdit: (env: BudgetEnvelopeView) => void
}) {
  const { t } = useTranslation()

  // SECTION VOCABULARY IS NOT INTERCHANGEABLE (spec §8.7).
  //
  // Only a FLEXIBLE envelope can be "over": it has a target that caps spending,
  // so exceeding it is a real overspend with real options. A commitment or debt
  // envelope carries no target — its money is defined by the bills inside it —
  // so `remaining` there is structurally negative the moment a bill is pending.
  // Rendering that as "$1,056.40 over" in red would tell the user they have
  // overspent when in fact the money is merely RESERVED and not yet paid, which
  // is exactly the conflation this redesign exists to remove.
  const capped = env.section === "flexible"
  const over = capped && env.remaining < 0
  const obligation = env.section === "commitment" || env.section === "debt"
  const Glyph = envelopeIcon(env.icon, env.section)

  const trailing = obligation
    ? // Unpaid is a fact about an obligation, not a judgement about spending.
      { text: t("budgetV2.unpaidAmount", { amount: money(env.pending) }), tone: "" }
    : over
      ? { text: t("budgetV2.over", { amount: money(-env.remaining) }), tone: "text-red-600 dark:text-red-400" }
      : { text: t("budgetV2.left", { amount: money(env.remaining) }), tone: "" }

  return (
    <div className="rounded-lg transition-colors hover:bg-accent/40">
      <div className="flex items-center gap-1">
        {/* The drag activator is a SEPARATE control from the row button, so a
            tap still opens the envelope and only the grip starts a drag. It is
            aria-hidden because the move up/down buttons in EnvelopeList are the
            accessible way to reorder — a drag handle announced to a screen
            reader that cannot be operated by one is worse than none. */}
        {handle && (
          <span
            ref={handle.ref}
            {...handle.listeners}
            {...handle.attributes}
            aria-hidden
            tabIndex={-1}
            // A 24px glyph with a 44px hit area (the ::after inset), so the grip
            // meets the touch floor without spending 20px of a 390px row.
            className="relative flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/40 transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-muted-foreground active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpenDetail(env)}
          className="flex min-h-11 w-full flex-1 items-center justify-between gap-2 px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("budgetV2.openEnvelope", { name: env.name })}
        >
        <Glyph className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          {/* The NAME truncates; the tag never does. `truncate` on the flex
              parent clipped the tag instead of the name, so a narrow row showed
              "Everyday spending  lefto" — the one word that explains the row. */}
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <span className="truncate">{env.name}</span>
            {env.is_catch_all && (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                {t("budgetV2.leftoverTag")}
              </span>
            )}
          </p>
          {/* The figures each section actually has. An obligation envelope has
              no target to report, so showing "Planned 0" there would be noise. */}
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {obligation ? (
              <>
                {t("budgetV2.paidShort")} {money(env.settled)}
                {env.overdue_amount > 0 && ` · ${t("budgetV2.overdueShort")} ${money(env.overdue_amount)}`}
              </>
            ) : (
              <>
                {t("budgetV2.plannedShort")} {money(env.planned)} · {t("budgetV2.spentShort")} {money(env.spent_net)}
                {env.pending > 0 && ` · ${t("budgetV2.pendingShort")} ${money(env.pending)}`}
              </>
            )}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-medium tabular-nums ${trailing.tone || "text-muted-foreground"}`}>
          {trailing.text}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60 rtl:rotate-180" aria-hidden />
        </button>
        {/* Edit sits IN the row rather than on a line of its own — a row that is
            not overspent has nothing else to put there, and a lone pencil under
            an empty paragraph reads as a layout accident. Editing and deleting
            both live in the dialog, so there is ONE place a category changes. */}
        {canWrite && (
          <button
            type="button"
            onClick={() => onEdit(env)}
            aria-label={t("budgetV2.editEnvelope", { name: env.name })}
            className="pressable flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {/* USED vs LEFT, per envelope.
          Only for a capped (flexible) envelope: a bills envelope has no target,
          so a proportion bar there would be measuring against nothing. The bar
          caps at 100 % while the text carries the real overspend, because a bar
          that overflows its track reads as a rendering bug rather than as
          information. */}
      {capped && env.planned > 0 && (
        <div className="px-1 pb-1.5">
          <Bar
            state={env.state}
            spent={env.spent_net + env.pending}
            planned={env.planned}
            label={t("budgetV2.usedOfPlanned", { name: env.name })}
          />
          <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
            <span>{t("budgetV2.usedAmount", { amount: money(env.spent_net) })}</span>
            <span>
              {over
                ? t("budgetV2.overAmount", { amount: money(-env.remaining) })
                : t("budgetV2.leftAmount", { amount: money(env.remaining) })}
            </span>
          </p>
        </div>
      )}

      {/* An overspend offers the way OUT, right where it is visible. Supportive,
          not scolding: it states the amount and offers options (P7). Offered for
          capped envelopes only — there is nothing to "resolve" about a bill that
          simply has not been paid yet. */}
      {over && canWrite && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1.5">
          <p className="text-[11px] text-muted-foreground">{t("budgetV2.overspendInline")}</p>
          <Button size="sm" variant="outline" className="h-9 px-2 text-[11px]" onClick={() => onResolveOverspend(env)}>
            {t("budgetV2.resolve")}
          </Button>
        </div>
      )}
    </div>
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
function Limitations({ codes, currency }: { codes: string[]; currency: BudgetCurrencyLimitation | null }) {
  const { t } = useTranslation()
  const MAP: Record<string, string> = {
    credit_cards_unsupported: "budgetV2.limitCreditCards",
    loan_split_unsupported: "budgetV2.limitLoanSplit",
    manual_pending_unsupported: "budgetV2.limitPending",
    currency_changed: "budgetV2.limitCurrencyChanged",
  }
  const known = codes.filter((c) => MAP[c])
  if (!known.length) return null
  // The currency limitation names WHICH currencies disagree (§12.4): the plan's
  // and the workspace's. Nothing is converted — the payload says so.
  const label = (c: string) =>
    c === "currency_changed"
      ? t(MAP[c], { old: currency?.plan_currency ?? "", new: currency?.org_currency ?? "" })
      : t(MAP[c])
  return (
    <details className="rounded-xl border bg-muted/30 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">{t("budgetV2.limitationsTitle")}</summary>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {known.map((c) => (
          <li key={c}>· {label(c)}</li>
        ))}
      </ul>
    </details>
  )
}

export default BudgetOverviewPage
