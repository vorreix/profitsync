import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  Info,
  Loader as Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { toast } from "sonner"
import { apiDelete, apiErrorMessage, apiPatch, apiPost } from "@/lib/api"
import { formatIsoDate } from "@/lib/dates"
import { useBudget } from "@/lib/budget-context"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import type {
  BudgetEnvelopeView,
  BudgetGroupView,
  BudgetItemView,
  BudgetListView,
  BudgetStateV2,
  BudgetView,
  BudgetViewWindow,
} from "@/lib/types"
import { BudgetWizard } from "@/components/budget/BudgetWizard"
import { BudgetItemDialog } from "@/components/budget/BudgetItemDialog"
import { envelopeIcon } from "@/components/budget/envelope-icons"
import { EnvelopeDetailSheet } from "@/components/budget/EnvelopeDetailSheet"
import { OverdueList } from "@/components/budget/OverdueList"
import { ResolveOverspendSheet } from "@/components/budget/ResolveOverspendSheet"
import { MigrationPrompts } from "@/components/budget/MigrationPrompts"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"

// Semantic state colours — a healthy budget is emerald or neutral; red appears
// only when a figure is genuinely exceeded (spec §6.0).
const BAR: Record<BudgetStateV2, string> = {
  none: "bg-muted-foreground/40",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  full: "bg-amber-500",
  over: "bg-red-500",
}

type Line = BudgetItemView | BudgetGroupView

/**
 * The budgets page (docs/budget-v2/SIMPLE.md).
 *
 * One question, answered at a glance: where am I with each budget? The page is
 * the safe-to-spend hero, then ONE list — macro budgets (groups) that add up the
 * budgets inside them, and the ungrouped budgets — read through a week / month
 * / year toggle. Every row shows the same three things: a bar, "spent of limit",
 * and what is left or over. Everything else is one tap away in a row menu.
 *
 * Bills, savings and debt are tracked elsewhere (Recurring, Spaces, Debt &
 * Loans) and are no longer laid out here; the engine still reserves for them,
 * which the hero and its explainer say.
 */
export function BudgetOverviewPage() {
  const { t, i18n } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { data, loaded, syncing, error, refresh, sync, window: chosenWindow, setWindow } = useBudget()
  const [explainOpen, setExplainOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // Progressive disclosure: every one of these is CLOSED until asked for.
  const [adding, setAdding] = useState<"category" | "group" | null>(null)
  const [editing, setEditing] = useState<Line | null>(null)
  const [removing, setRemoving] = useState<Line | null>(null)
  const [detailFor, setDetailFor] = useState<BudgetItemView | null>(null)
  const [overspendFor, setOverspendFor] = useState<BudgetItemView | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const money = (n: number) => formatMoney(n, currency)

  // A legacy /budgets/:key bookmark resolves to ?envelope=<id> (§13.6), so open
  // that budget's detail once and then drop the param.
  //
  // Declared HERE, above the loading / error / empty guards: those return early,
  // so a hook placed after them would not run in the same order on every render.
  const deepLinkId = searchParams.get("envelope")
  useEffect(() => {
    if (!deepLinkId) return
    const found = allItems(data?.budgets).find((e) => e.id === deepLinkId)
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
        <Skeleton className="h-64 w-full rounded-2xl" />
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
  const budgets = data.budgets
  const groups = budgets?.groups ?? []
  const claimedKeys = [...new Set(allItems(budgets).flatMap((e) => e.match_keys ?? []))]
  const activeWindow: BudgetViewWindow = budgets?.window ?? chosenWindow ?? "month"

  // Every mutation re-reads the plan rather than patching state locally: the
  // figures are derived from each other (a group is the sum of its children,
  // the hero moves with the plan), so a local patch would show a
  // self-inconsistent page for a moment.
  const afterChange = () => void refresh()

  const patchLine = async (line: Line, body: Record<string, unknown>, done: string) => {
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/budgets/v2/envelopes/${line.id}`, token, body, ["/api/budgets"])
      toast.success(t(done, { name: line.name }))
      afterChange()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("budgetV2.changeFailed")))
    }
  }

  const reorder = async (ids: string[]) => {
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/budgets/v2/envelopes/reorder", token, { ids }, ["/api/budgets"])
      afterChange()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("budgetV2.reorderFailed")))
    }
  }

  const togglePause = async () => {
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/budgets/v2", token, { status: paused ? "active" : "paused" }, ["/api/budgets"])
      await sync()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("budgetV2.syncFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <Header
        right={
          <div className="flex flex-wrap items-center gap-2">
            {budgets && (
              <ToggleGroup
                type="single"
                variant="outline"
                value={activeWindow}
                onValueChange={(v) => v && setWindow(v as BudgetViewWindow)}
                aria-label={t("budgetV2.windowAria")}
              >
                <ToggleGroupItem value="week" className="h-9 px-3 text-xs">
                  {t("budgetV2.windowWeek")}
                </ToggleGroupItem>
                <ToggleGroupItem value="month" className="h-9 px-3 text-xs">
                  {t("budgetV2.windowMonth")}
                </ToggleGroupItem>
                <ToggleGroupItem value="year" className="h-9 px-3 text-xs">
                  {t("budgetV2.windowYear")}
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            {canWrite && (
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
            )}
          </div>
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
          wizard creates the plan, then sync opens the period). */}
      {(!data.money || !data.period) && (
        <Card className="py-0">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("budgetV2.updating")}
          </CardContent>
        </Card>
      )}

      {/* The migration's unanswered questions come FIRST — both change the
          figures below them. Renders nothing for a natively created plan. */}
      <MigrationPrompts view={data} money={money} canWrite={canWrite} onResolved={afterChange} />

      {data.money && data.period && budgets && (
        <>
          <SafeToSpendHero
            view={data}
            money={money}
            syncing={syncing}
            onExplain={() => setExplainOpen(true)}
            className={paused ? "opacity-70" : ""}
          />

          {/* An overdue bill still reserves money, so it stays actionable here
              even though bills are no longer laid out on this page. Renders
              nothing when nothing is overdue. */}
          <OverdueList
            occurrences={data.occurrences_overdue}
            money={money}
            canWrite={canWrite && !paused}
            onChanged={afterChange}
          />

          <BudgetsCard
            list={budgets}
            money={money}
            canWrite={canWrite && !paused}
            onAdd={setAdding}
            onEdit={setEditing}
            onRemove={setRemoving}
            onOpen={setDetailFor}
            onResolve={setOverspendFor}
            onPatch={patchLine}
            onReorder={reorder}
          />
        </>
      )}

      <SafeToSpendExplainer open={explainOpen} onOpenChange={setExplainOpen} view={data} money={money} />

      <BudgetItemDialog
        open={adding !== null}
        onOpenChange={(v) => !v && setAdding(null)}
        kind={adding ?? "category"}
        groups={groups}
        claimedKeys={claimedKeys}
        planCadence={data.plan.cadence}
        onSaved={afterChange}
      />
      {/* Same component in EDIT mode — the fields are identical, and a separate
          edit dialog is how the two drift apart. */}
      <BudgetItemDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        kind={editing?.kind ?? "category"}
        item={editing}
        groups={groups}
        claimedKeys={claimedKeys}
        planCadence={data.plan.cadence}
        onSaved={afterChange}
      />

      <RemoveDialog
        line={removing}
        onOpenChange={() => setRemoving(null)}
        onRemoved={afterChange}
      />

      <EnvelopeDetailSheet
        envelope={detailFor ? asEnvelopeView(detailFor) : null}
        money={money}
        onOpenChange={() => setDetailFor(null)}
      />

      <ResolveOverspendSheet
        envelope={overspendFor ? asEnvelopeView(overspendFor) : null}
        siblings={allItems(budgets)
          .filter((i) => i.active && i.id !== overspendFor?.id)
          .map(asEnvelopeView)}
        unallocated={data.money?.unallocated_available ?? 0}
        money={money}
        onOpenChange={() => setOverspendFor(null)}
        onResolved={afterChange}
      />
    </div>
  )
}

/** Every budget line (grouped and ungrouped), flat. */
function allItems(list: BudgetListView | null | undefined): BudgetItemView[] {
  if (!list) return []
  return [...list.groups.flatMap((g) => g.children), ...list.items]
}

/**
 * The detail and overspend sheets predate the list and read an envelope view.
 * A budget line carries the same money in the same names; the rest of the
 * envelope shape is filled with its neutral value.
 */
function asEnvelopeView(i: BudgetItemView): BudgetEnvelopeView {
  return {
    id: i.id,
    name: i.name,
    section: "flexible",
    planned: i.planned,
    rollover_in: 0,
    authored_amount: i.authored_amount,
    authored_cadence: i.authored_cadence,
    spent_gross: i.spent,
    refunds_confirmed: 0,
    refunds_provisional: 0,
    spent_net: i.spent,
    pending: 0,
    remaining: i.remaining,
    state: i.state,
    priority: "important",
    carry_policy: "none",
    is_catch_all: i.is_catch_all,
    reimbursable: false,
    funding_mode: null,
    auto_fund: false,
    goal_amount: null,
    target_date: null,
    balance: null,
    contribution_status: null,
    needs_attention: false,
    excluded_occurrence_count: 0,
    match_keys: i.match_keys,
    icon: i.icon,
    goal_progress: null,
    suggested_monthly: null,
    settled: 0,
    overdue_count: 0,
    overdue_amount: 0,
  }
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
        <dl>
          <dt className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {t("budgetV2.safeToSpend")}
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

// ─────────────────────────────────────────────────────────────────────────────
// The list
// ─────────────────────────────────────────────────────────────────────────────

type PatchFn = (line: Line, body: Record<string, unknown>, done: string) => Promise<void>

function BudgetsCard({
  list,
  money,
  canWrite,
  onAdd,
  onEdit,
  onRemove,
  onOpen,
  onResolve,
  onPatch,
  onReorder,
}: {
  list: BudgetListView
  money: (n: number) => string
  canWrite: boolean
  onAdd: (kind: "category" | "group") => void
  onEdit: (line: Line) => void
  onRemove: (line: Line) => void
  onOpen: (item: BudgetItemView) => void
  onResolve: (item: BudgetItemView) => void
  onPatch: PatchFn
  onReorder: (ids: string[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [showHidden, setShowHidden] = useState(false)

  // Groups first, then the ungrouped budgets, "Everything else" last: a fixed
  // order the eye can learn. Hidden lines fold into one row at the bottom.
  const visibleGroups = list.groups.filter((g) => !g.hidden)
  const hiddenGroups = list.groups.filter((g) => g.hidden)
  const ordered = useMemo(() => {
    const items = list.items.slice().sort((a, b) => Number(a.is_catch_all) - Number(b.is_catch_all))
    return items
  }, [list.items])
  const visibleItems = ordered.filter((i) => !i.hidden)
  const hiddenItems = ordered.filter((i) => i.hidden)
  // A hidden budget INSIDE a visible group folds into the same footer as a
  // hidden top-level one — its group keeps counting it, the page just stops
  // showing it there.
  const hiddenChildren = visibleGroups.flatMap((g) => g.children.filter((c) => c.hidden))
  const hiddenCount =
    hiddenGroups.length + hiddenItems.length + hiddenChildren.length + hiddenGroups.reduce((n, g) => n + g.children.length, 0)
  const onlyCatchAll = list.groups.length === 0 && list.items.length === 1 && list.items[0]?.is_catch_all

  const rangeLabel =
    list.window === "week" ? t("budgetV2.rangeWeek") : list.window === "year" ? t("budgetV2.rangeYear") : t("budgetV2.rangeMonth")

  /** The full id order the server expects: groups, each with its children, then the ungrouped lines. */
  const flatOrder = (groups: BudgetGroupView[], items: BudgetItemView[]) => [
    ...groups.flatMap((g) => [g.id, ...g.children.map((c) => c.id)]),
    ...items.map((i) => i.id),
  ]
  const moveLine = (line: Line, delta: number) => {
    const groups = list.groups.slice()
    const items = ordered.slice()
    if (line.kind === "group") {
      swap(groups, groups.findIndex((g) => g.id === line.id), delta)
    } else if (line.parent_id) {
      const g = groups.find((x) => x.id === line.parent_id)
      if (!g) return
      const children = g.children.slice()
      swap(children, children.findIndex((c) => c.id === line.id), delta)
      groups[groups.indexOf(g)] = { ...g, children }
    } else {
      swap(items, items.findIndex((i) => i.id === line.id), delta)
    }
    void onReorder(flatOrder(groups, items))
  }

  const menuFor = (line: Line, siblings: Line[]) =>
    canWrite ? (
      <RowMenu
        line={line}
        groups={list.groups}
        index={siblings.findIndex((s) => s.id === line.id)}
        count={siblings.length}
        onEdit={() => onEdit(line)}
        onRemove={() => onRemove(line)}
        onPatch={onPatch}
        onMove={(d) => moveLine(line, d)}
      />
    ) : null

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t("budgetV2.budgetsTitle")}</p>
            <p className="text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-9 gap-1 px-3 text-xs">
                  <Plus className="size-3.5" aria-hidden /> {t("budgetV2.add")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onClick={() => onAdd("category")}>
                  <Plus className="size-4" aria-hidden /> {t("budgetV2.addBudget")}
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onClick={() => onAdd("group")}>
                  <FolderPlus className="size-4" aria-hidden /> {t("budgetV2.addGroup")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* The whole list's total — the same three things every row shows. */}
        <Figures line={list} money={money} big />

        {!list.is_period && <p className="mt-2 text-[11px] text-muted-foreground">{t("budgetV2.scaledNote")}</p>}

        <ul className="mt-3 space-y-1 border-t pt-3">
          {visibleGroups.map((g) => (
            <li key={g.id}>
              <GroupRow
                group={g}
                money={money}
                canWrite={canWrite}
                isPeriod={list.is_period}
                menu={menuFor(g, visibleGroups)}
                childMenu={(c) => menuFor(c, g.children)}
                onOpen={onOpen}
                onResolve={onResolve}
                onPatch={onPatch}
              />
            </li>
          ))}
          {visibleItems.map((i) => (
            <li key={i.id}>
              <BudgetRow
                item={i}
                money={money}
                canWrite={canWrite}
                isPeriod={list.is_period}
                menu={menuFor(i, visibleItems.filter((x) => !x.is_catch_all))}
                onOpen={onOpen}
                onResolve={onResolve}
                onPatch={onPatch}
              />
            </li>
          ))}
        </ul>

        {onlyCatchAll && <p className="mt-3 text-xs text-muted-foreground">{t("budgetV2.onlyCatchAll")}</p>}

        {hiddenCount > 0 && (
          <div className="mt-3 border-t pt-3">
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              aria-expanded={showHidden}
              className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <EyeOff className="size-3.5" aria-hidden />
                {t("budgetV2.hiddenCount", { count: hiddenCount })}
              </span>
              <span className="font-medium">{showHidden ? t("budgetV2.collapseHidden") : t("budgetV2.showHidden")}</span>
            </button>
            {showHidden && (
              <ul className="mt-2 space-y-1 opacity-80">
                {hiddenGroups.map((g) => (
                  <li key={g.id}>
                    <GroupRow
                      group={g}
                      money={money}
                      canWrite={canWrite}
                      isPeriod={list.is_period}
                      menu={menuFor(g, hiddenGroups)}
                      childMenu={(c) => menuFor(c, g.children)}
                      onOpen={onOpen}
                      onResolve={onResolve}
                      onPatch={onPatch}
                    />
                  </li>
                ))}
                {hiddenItems.map((i) => (
                  <li key={i.id}>
                    <BudgetRow
                      item={i}
                      money={money}
                      canWrite={canWrite}
                      isPeriod={list.is_period}
                      menu={menuFor(i, hiddenItems)}
                      onOpen={onOpen}
                      onResolve={onResolve}
                      onPatch={onPatch}
                    />
                  </li>
                ))}
                {hiddenChildren.map((c) => (
                  <li key={c.id}>
                    <BudgetRow
                      item={c}
                      money={money}
                      canWrite={canWrite}
                      isPeriod={list.is_period}
                      menu={menuFor(c, list.groups.find((g) => g.id === c.parent_id)?.children ?? [c])}
                      onOpen={onOpen}
                      onResolve={onResolve}
                      onPatch={onPatch}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function swap<T>(arr: T[], from: number, delta: number) {
  const to = from + delta
  if (from < 0 || to < 0 || to >= arr.length) return
  const [row] = arr.splice(from, 1)
  arr.splice(to, 0, row)
}

/** "spent of limit" with the bar and what is left or over — the three things every line shows. */
function Figures({
  line,
  money,
  big = false,
}: {
  line: { planned: number; spent: number; remaining: number; state: BudgetStateV2 }
  money: (n: number) => string
  big?: boolean
}) {
  const { t } = useTranslation()
  const over = line.remaining < 0
  return (
    <div className={big ? "mt-2" : "mt-1"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`tabular-nums ${big ? "text-lg font-bold" : "text-xs text-muted-foreground"}`}>
          {big ? money(line.spent) : t("budgetV2.spentOf", { spent: money(line.spent), planned: money(line.planned) })}
          {big && <span className="text-sm font-normal text-muted-foreground"> / {money(line.planned)}</span>}
        </p>
        <p
          className={`shrink-0 text-xs font-semibold tabular-nums ${over ? "text-red-600 dark:text-red-400" : big ? "" : "text-muted-foreground"}`}
        >
          {over ? t("budgetV2.over", { amount: money(-line.remaining) }) : t("budgetV2.left", { amount: money(line.remaining) })}
        </p>
      </div>
      <Bar state={line.state} spent={line.spent} planned={line.planned} />
    </div>
  )
}

function GroupRow({
  group,
  money,
  canWrite,
  isPeriod,
  menu,
  childMenu,
  onOpen,
  onResolve,
  onPatch,
}: {
  group: BudgetGroupView
  money: (n: number) => string
  canWrite: boolean
  isPeriod: boolean
  menu: React.ReactNode
  childMenu: (c: BudgetItemView) => React.ReactNode
  onOpen: (item: BudgetItemView) => void
  onResolve: (item: BudgetItemView) => void
  onPatch: PatchFn
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const Glyph = envelopeIcon(group.icon, "flexible")
  const inactive = !group.active
  // Hidden children are shown in the page's hidden footer, not here — unless the
  // group itself is hidden, in which case this row IS in that footer.
  const shown = group.hidden ? group.children : group.children.filter((c) => !c.hidden)

  return (
    <div className={`rounded-lg ${inactive ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t("budgetV2.toggleGroup", { name: group.name })}
          className="flex min-h-11 w-full flex-1 items-center gap-2 px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60 rtl:rotate-180" aria-hidden />
          )}
          <Glyph className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <span className="truncate">{group.name}</span>
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                {t("budgetV2.groupTag", { count: group.children.length })}
              </span>
              {inactive && <InactiveTag />}
            </p>
            {inactive ? (
              <p className="text-[11px] text-muted-foreground">{t("budgetV2.inactiveNote")}</p>
            ) : (
              <Figures line={group} money={money} />
            )}
          </div>
        </button>
        {inactive && canWrite && (
          <Button size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={() => void onPatch(group, { status: "active" }, "budgetV2.budgetActivated")}>
            {t("budgetV2.activate")}
          </Button>
        )}
        {menu}
      </div>
      {open && (
        <ul className="ms-4 space-y-1 border-s ps-2">
          {group.children.length === 0 && <li className="px-1 py-1.5 text-xs text-muted-foreground">{t("budgetV2.groupEmpty")}</li>}
          {shown.map((c) => (
            <li key={c.id}>
              <BudgetRow
                item={c}
                money={money}
                canWrite={canWrite}
                isPeriod={isPeriod}
                menu={childMenu(c)}
                onOpen={onOpen}
                onResolve={onResolve}
                onPatch={onPatch}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One budget. Three lines: name and what is left or over · a bar · spent of
 * limit. An overspent budget offers Resolve right there (period view only —
 * moving planned money is a period action). Everything else is in the menu.
 */
function BudgetRow({
  item,
  money,
  canWrite,
  isPeriod,
  menu,
  onOpen,
  onResolve,
  onPatch,
}: {
  item: BudgetItemView
  money: (n: number) => string
  canWrite: boolean
  isPeriod: boolean
  menu: React.ReactNode
  onOpen: (item: BudgetItemView) => void
  onResolve: (item: BudgetItemView) => void
  onPatch: PatchFn
}) {
  const { t } = useTranslation()
  const Glyph = envelopeIcon(item.icon, "flexible")
  const inactive = !item.active
  const over = item.active && item.remaining < 0

  return (
    <div className={`rounded-lg transition-colors hover:bg-accent/40 ${inactive ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex min-h-11 w-full flex-1 items-center gap-2 px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("budgetV2.openEnvelope", { name: item.name })}
        >
          <Glyph className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <span className="truncate">{item.name}</span>
              {item.is_catch_all && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                  {t("budgetV2.leftoverTag")}
                </span>
              )}
              {inactive && <InactiveTag />}
            </p>
            {inactive ? (
              <p className="text-[11px] text-muted-foreground">{t("budgetV2.inactiveNote")}</p>
            ) : (
              <Figures line={item} money={money} />
            )}
          </div>
        </button>
        {inactive && canWrite && (
          <Button size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={() => void onPatch(item, { status: "active" }, "budgetV2.budgetActivated")}>
            {t("budgetV2.activate")}
          </Button>
        )}
        {menu}
      </div>
      {/* The way out of an overspend, right under it — on its own line so the
          figures above keep their room on a phone. Period view only: moving
          planned money is a period action. */}
      {over && isPeriod && canWrite && (
        <div className="flex items-center justify-between gap-2 px-1 pb-1.5 ps-7">
          <p className="text-[11px] text-muted-foreground">{t("budgetV2.overspendInline")}</p>
          <Button size="sm" variant="outline" className="h-9 px-3 text-xs" onClick={() => onResolve(item)}>
            {t("budgetV2.resolve")}
          </Button>
        </div>
      )}
    </div>
  )
}

function InactiveTag() {
  const { t } = useTranslation()
  return (
    <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-normal text-amber-700 dark:text-amber-300">
      {t("budgetV2.inactiveTag")}
    </span>
  )
}

/** Everything you can do to a line, one tap away, never on the row itself. */
function RowMenu({
  line,
  groups,
  index,
  count,
  onEdit,
  onRemove,
  onPatch,
  onMove,
}: {
  line: Line
  groups: BudgetGroupView[]
  index: number
  count: number
  onEdit: () => void
  onRemove: () => void
  onPatch: PatchFn
  onMove: (delta: number) => void
}) {
  const { t } = useTranslation()
  const isItem = line.kind === "category"
  const catchAll = isItem && line.is_catch_all
  const groupable = isItem && !catchAll && groups.length > 0
  const item = "min-h-11 sm:min-h-9"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("budgetV2.rowMenu", { name: line.name })}
          className="pressable flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem className={item} onClick={onEdit}>
          <Pencil className="size-4" aria-hidden /> {t("budgetV2.menuEdit")}
        </DropdownMenuItem>
        {groupable && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={item}>{t("budgetV2.menuMoveTo")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                className={item}
                disabled={!line.parent_id}
                onClick={() => void onPatch(line, { parent_id: null }, "budgetV2.budgetMoved")}
              >
                {t("budgetV2.noGroup")}
              </DropdownMenuItem>
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  className={item}
                  disabled={line.parent_id === g.id}
                  onClick={() => void onPatch(line, { parent_id: g.id }, "budgetV2.budgetMoved")}
                >
                  {g.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={item}
          onClick={() => void onPatch(line, { hidden: !line.hidden }, line.hidden ? "budgetV2.budgetShown" : "budgetV2.budgetHidden")}
        >
          {line.hidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
          {line.hidden ? t("budgetV2.menuShow") : t("budgetV2.menuHide")}
        </DropdownMenuItem>
        {!catchAll && (
          <DropdownMenuItem
            className={item}
            onClick={() =>
              void onPatch(
                line,
                { status: line.active ? "paused" : "active" },
                line.active ? "budgetV2.budgetDeactivated" : "budgetV2.budgetActivated",
              )
            }
          >
            {line.active ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {line.active ? t("budgetV2.menuDeactivate") : t("budgetV2.menuActivate")}
          </DropdownMenuItem>
        )}
        {!catchAll && count > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={item} disabled={index <= 0} onClick={() => onMove(-1)}>
              {t("budgetV2.menuMoveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem className={item} disabled={index < 0 || index >= count - 1} onClick={() => onMove(1)}>
              {t("budgetV2.menuMoveDown")}
            </DropdownMenuItem>
          </>
        )}
        {!catchAll && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={`${item} text-destructive focus:text-destructive`} onClick={onRemove}>
              <Trash2 className="size-4" aria-hidden /> {t("budgetV2.menuRemove")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Remove, with the consequence stated, never on the row itself. */
function RemoveDialog({
  line,
  onOpenChange,
  onRemoved,
}: {
  line: Line | null
  onOpenChange: (v: boolean) => void
  onRemoved: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    if (!line) return
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/budgets/v2/envelopes/${line.id}`, token, undefined, ["/api/budgets"])
      toast.success(t("budgetV2.envelopeRemoved", { name: line.name }))
      onOpenChange(false)
      onRemoved()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("budgetV2.envelopeRemoveFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={Boolean(line)} onOpenChange={(v) => !v && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("budgetV2.removeTitle", { name: line?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {line?.kind === "group" ? t("budgetV2.removeGroupBody") : t("budgetV2.removeBudgetBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 sm:h-9">{t("budgetV2.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="h-11 bg-destructive text-white hover:bg-destructive/90 sm:h-9"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              void remove()
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : t("budgetV2.menuRemove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Bar({ state, spent, planned }: { state: BudgetStateV2; spent: number; planned: number }) {
  const pct = planned > 0 ? Math.max(0, Math.min(100, (spent / planned) * 100)) : spent > 0 ? 100 : 0
  return (
    <div
      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full transition-[width] duration-300 ${BAR[state]}`} style={{ width: `${pct}%` }} />
    </div>
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
            <p>{t("budgetV2.explainCash", { available: money(m.available_now), reserved: money(m.reserved) })}</p>
            <p className="font-medium">{t("budgetV2.explainCashResult", { amount: money(m.cash_after_reservations) })}</p>
            {m.reserved === 0 && <p className="text-muted-foreground">{t("budgetV2.explainNothingReserved")}</p>}

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
              <p>
                {t("budgetV2.unallocated")}: {money(m.unallocated)} · {t("budgetV2.fundingCapacity")}: {money(view.period?.funding_capacity ?? 0)}
              </p>
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

export default BudgetOverviewPage
