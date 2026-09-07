import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, ArrowDown, ArrowUp } from "lucide-react"
import type { SpendingBudget } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { budgetIcon } from "@/components/budget/budget-icons"
import { BAR_COLOR, DELTA_COLOR, barPct, budgetName, customWindowLabel, fmtDay } from "@/components/budget/budget-format"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type BudgetRowActions = {
  onEdit: (b: SpendingBudget) => void
  onAddSub: (parent: SpendingBudget) => void
  onToggleStatus: (b: SpendingBudget) => void
  onMove: (b: SpendingBudget, dir: "up" | "down") => void
  onRemove: (b: SpendingBudget) => void
}

/**
 * One budget in the list: a bar, "spent of limit", and what is left or over —
 * the same three things on every row, as the approved page shape had it. A
 * main budget lists its sub-budgets underneath (indented, own bar each) and a
 * muted footnote for the spend none of them claims.
 *
 * Two controls, never one ambiguous tap: the row itself opens the detail; a
 * separate chevron button folds the sub-budgets; the ⋯ menu holds everything
 * else. Every control is ≥ 44 px on a phone.
 */
export function BudgetRow({
  budget,
  children = [],
  depth = 0,
  isFirst,
  isLast,
  canWrite,
  canDelete,
  actions,
}: {
  budget: SpendingBudget
  children?: SpendingBudget[]
  depth?: 0 | 1
  isFirst: boolean
  isLast: boolean
  canWrite: boolean
  canDelete: boolean
  actions: BudgetRowActions
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const [open, setOpen] = useState(true)
  const money = (n: number) => formatMoney(n, currency)
  const Icon = budgetIcon(budget.icon)
  const name = budgetName(t, budget)
  const paused = budget.status === "paused"
  const phase = budget.window.phase
  const dim = paused || phase !== "active"
  const hasKids = children.length > 0
  const delta = budget.remaining >= 0 ? t("budgets.left", { amount: money(budget.remaining) }) : t("budgets.over", { amount: money(-budget.remaining) })
  const showRest = hasKids && open && budget.other_spent !== null && budget.other_spent > 0.004

  const go = () => navigate(`/budgets/${budget.id}`)

  return (
    <li className={depth === 1 ? "ms-4 border-s ps-2 sm:ms-6 sm:ps-3" : ""} data-budget={budget.id} data-budget-state={budget.state}>
      <div className="group flex items-start gap-1">
        {/* Fold/unfold — a control of its own, so the row stays a plain link. */}
        {hasKids ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t("common.collapse", { defaultValue: "Collapse" }) : t("common.expand", { defaultValue: "Expand" })}
            onClick={() => setOpen((v) => !v)}
            className="pressable mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:mt-1 sm:size-9"
          >
            {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />}
          </button>
        ) : (
          <span className="mt-2 flex size-11 shrink-0 items-center justify-center sm:mt-1 sm:size-9" aria-hidden>
            <Icon className={`size-4 ${dim ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
          </span>
        )}

        <button
          type="button"
          onClick={go}
          className="pressable min-h-11 min-w-0 flex-1 rounded-lg px-1.5 py-2 text-start transition-colors hover:bg-accent/60"
        >
          <div className="flex items-center gap-2">
            {hasKids && <Icon className={`size-4 shrink-0 ${dim ? "text-muted-foreground/50" : "text-muted-foreground"}`} aria-hidden />}
            <span className={`truncate text-sm font-semibold ${dim ? "text-muted-foreground" : ""}`}>{name}</span>
            {paused && <Badge variant="outline" className="shrink-0 text-[10px]">{t("budgets.paused")}</Badge>}
            {!paused && phase === "ended" && <Badge variant="outline" className="shrink-0 text-[10px]">{t("budgets.ended")}</Badge>}
            {!paused && phase === "upcoming" && budget.window.start && (
              <Badge variant="outline" className="shrink-0 text-[10px]">{t("budgets.startsOn", { date: fmtDay(budget.window.start, i18n.language) })}</Badge>
            )}
            {hasKids && !paused && (
              <span className="shrink-0 text-[11px] text-muted-foreground">{t("budgets.subBudgets", { count: children.length })}</span>
            )}
            {budget.period === "once" && !paused && (
              <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{customWindowLabel(t, budget, i18n.language)}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground tabular-nums">
              {paused
                ? t("budgets.pausedHint")
                : t("budgets.spentOf", { spent: money(budget.spent), amount: money(budget.amount) })}
            </span>
            {!paused && <span className={`shrink-0 font-medium tabular-nums ${DELTA_COLOR[budget.state]}`}>{delta}</span>}
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(barPct(budget))} aria-label={name}>
            <div className={`h-full rounded-full transition-[width] duration-300 ${BAR_COLOR[budget.state]}`} style={{ width: `${barPct(budget)}%` }} />
          </div>
        </button>

        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("common.moreActions", { defaultValue: "More actions" })}
                className="pressable mt-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground sm:size-9"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onEdit(budget)}>
                <Pencil className="size-4" /> {t("budgets.menu.edit")}
              </DropdownMenuItem>
              {depth === 0 && (
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onAddSub(budget)}>
                  <Plus className="size-4" /> {t("budgets.menu.addSub")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onToggleStatus(budget)}>
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />} {paused ? t("budgets.menu.resume") : t("budgets.menu.pause")}
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

      {hasKids && open && (
        <ul className="mt-1 space-y-1">
          {children.map((c, i) => (
            <BudgetRow
              key={c.id}
              budget={c}
              depth={1}
              isFirst={i === 0}
              isLast={i === children.length - 1}
              canWrite={canWrite}
              canDelete={canDelete}
              actions={actions}
            />
          ))}
        </ul>
      )}
      {showRest && (
        <p className="ms-14 mt-1 text-[11px] text-muted-foreground sm:ms-12">
          {t("budgets.notInSubBudgets", { amount: money(budget.other_spent!) })}
        </p>
      )}
    </li>
  )
}
