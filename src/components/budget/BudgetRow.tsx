import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Pencil, Play, Plus, Square, Trash2 } from "lucide-react"
import type { SpendingBudget, SpendingViewWindow } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { budgetIcon } from "@/components/budget/budget-icons"
import { BAR_COLOR, DELTA_COLOR, authoredRate, barPct, budgetName, customWindowLabel, fmtDay, inView } from "@/components/budget/budget-format"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { type HandleProps } from "@/components/budget/drag-handle"

export type { HandleProps }

export type BudgetRowActions = {
  onEdit: (b: SpendingBudget) => void
  onAddSub: (parent: SpendingBudget) => void
  onToggleStatus: (b: SpendingBudget) => void
  onMove: (b: SpendingBudget, dir: "up" | "down") => void
  onRemove: (b: SpendingBudget) => void
}

/**
 * One budget in the list — the same three things on every row: a bar, "spent of
 * limit", and what is left or over, all in the window the page is being read
 * in. A budget authored in another rhythm says so underneath, so nobody reads
 * "$69 this week" as the limit they actually set.
 *
 * The row itself opens the budget. Folding its sub-budgets is a separate
 * control, and everything else lives in the ⋯ menu — never two meanings for one
 * tap. While the list is in reorder mode the row stops navigating and a grip
 * takes the place of the fold control, which is what keeps a 44px target from
 * eating the name at phone width.
 */
export function BudgetRow({
  budget,
  view,
  today,
  depth = 0,
  childCount = 0,
  expanded,
  onToggleExpand,
  reordering = false,
  handle = null,
  dragging = false,
  dropEdge = null,
  isFirst,
  isLast,
  canWrite,
  canDelete,
  actions,
}: {
  budget: SpendingBudget
  view: SpendingViewWindow
  today: string
  depth?: 0 | 1
  childCount?: number
  expanded?: boolean
  onToggleExpand?: () => void
  reordering?: boolean
  handle?: HandleProps | null
  dragging?: boolean
  dropEdge?: "before" | "after" | null
  isFirst: boolean
  isLast: boolean
  canWrite: boolean
  canDelete: boolean
  actions: BudgetRowActions
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const money = (n: number) => formatMoney(n, currency)

  const v = inView(budget, view, today)
  const Icon = budgetIcon(budget.icon)
  const name = budgetName(t, budget)
  const closed = budget.status === "closed"
  const custom = budget.period === "once"
  const phase = budget.window.phase
  const dim = closed || (custom && phase !== "active")
  const delta = v.remaining >= 0 ? t("budgets.left", { amount: money(v.remaining) }) : t("budgets.over", { amount: money(-v.remaining) })

  return (
    <li
      className={`relative ${depth === 1 ? "ms-4 border-s ps-2 sm:ms-6 sm:ps-3" : ""} ${dragging ? "opacity-40" : ""}`}
      data-budget={budget.id}
      data-budget-state={v.state}
      data-budget-depth={depth}
    >
      {dropEdge && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-primary ${dropEdge === "before" ? "-top-0.5" : "-bottom-0.5"}`}
        />
      )}
      <div className="group flex items-start gap-1">
        {reordering && canWrite ? (
          <button
            type="button"
            ref={handle?.ref}
            {...(handle?.attributes ?? {})}
            {...(handle?.listeners ?? {})}
            aria-label={t("budgets.menu.reorder")}
            className="pressable mt-1 flex size-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg text-muted-foreground hover:bg-accent active:cursor-grabbing sm:size-9"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : depth === 0 ? (
          <button
            type="button"
            aria-expanded={!!expanded}
            aria-label={expanded ? t("budgets.collapse", { name }) : t("budgets.expand", { name })}
            onClick={onToggleExpand}
            className="pressable mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:size-9"
          >
            {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />}
          </button>
        ) : (
          <span className="mt-1 flex size-11 shrink-0 items-center justify-center sm:size-9" aria-hidden>
            <Icon className={`size-4 ${dim ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
          </span>
        )}

        <button
          type="button"
          disabled={reordering}
          onClick={() => navigate(`/budgets/${budget.id}`)}
          className="pressable min-h-11 min-w-0 flex-1 rounded-lg px-1.5 py-2 text-start transition-colors hover:bg-accent/60 disabled:pointer-events-none"
        >
          <div className="flex items-center gap-2">
            {depth === 0 && <Icon className={`size-4 shrink-0 ${dim ? "text-muted-foreground/50" : "text-muted-foreground"}`} aria-hidden />}
            <span className={`truncate text-sm font-semibold ${dim ? "text-muted-foreground" : ""}`}>{name}</span>
            {closed && <Badge variant="outline" className="shrink-0 text-[10px]">{t("budgets.closed")}</Badge>}
            {!closed && custom && phase === "ended" && <Badge variant="outline" className="shrink-0 text-[10px]">{t("budgets.ended")}</Badge>}
            {!closed && custom && phase === "upcoming" && budget.window.start && (
              <Badge variant="outline" className="shrink-0 text-[10px]">{t("budgets.startsOn", { date: fmtDay(budget.window.start, i18n.language) })}</Badge>
            )}
            {childCount > 0 && !closed && (
              <span className="shrink-0 text-[11px] text-muted-foreground">{t("budgets.subBudgets", { count: childCount })}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground tabular-nums">
              {closed ? t("budgets.closedHint") : t("budgets.spentOf", { spent: money(v.spent), amount: money(v.limit) })}
            </span>
            {!closed && <span className={`shrink-0 font-medium tabular-nums ${DELTA_COLOR[v.state]}`}>{delta}</span>}
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(barPct(v.ratio))}
            aria-label={name}
          >
            <div className={`h-full rounded-full transition-[width] duration-300 ${BAR_COLOR[v.state]}`} style={{ width: `${barPct(v.ratio)}%` }} />
          </div>
          {/* What was actually set, whenever the page is showing an equivalent. */}
          {!closed && (v.converted || custom) && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
              {custom ? customWindowLabel(t, budget, i18n.language) : authoredRate(t, budget, money)}
            </p>
          )}
        </button>

        {canWrite && !reordering && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("budgets.menu.for", { name })}
                className="pressable mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:size-9"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onEdit(budget)}>
                <Pencil className="size-4" /> {t("budgets.menu.edit")}
              </DropdownMenuItem>
              {depth === 0 && !budget.is_overall && (
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onAddSub(budget)}>
                  <Plus className="size-4" /> {t("budgets.menu.addSub")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onToggleStatus(budget)}>
                {closed ? <Play className="size-4" /> : <Square className="size-4" />}
                {closed ? t("budgets.menu.reopen") : t("budgets.menu.close")}
              </DropdownMenuItem>
              {(!isFirst || !isLast) && <DropdownMenuSeparator />}
              {!isFirst && (
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onMove(budget, "up")}>
                  <ArrowUp className="size-4" /> {t("budgets.menu.moveUp")}
                </DropdownMenuItem>
              )}
              {!isLast && (
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onMove(budget, "down")}>
                  <ArrowDown className="size-4" /> {t("budgets.menu.moveDown")}
                </DropdownMenuItem>
              )}
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive sm:min-h-9" onSelect={() => actions.onRemove(budget)}>
                    <Trash2 className="size-4" /> {t("budgets.menu.remove")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}
