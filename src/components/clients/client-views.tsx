import { memo, type DOMAttributes } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowDown, ArrowUp, ArrowUpDown, Building2, ChevronRight, DollarSign, Eye,
  Mail, Pencil, Phone, TrendingDown, TrendingUp,
} from "lucide-react"
import type { Budget, Client } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { cn } from "@/lib/utils"

/** A client row with its money aggregates resolved to numbers + derived profit. */
export type ClientWithStats = Client & { profit: number }

/** Long-press handler bundle produced by `useLongPress().bind` (spread onto a row). */
type LongPressProps = DOMAttributes<HTMLElement>

/**
 * Stable action contract shared by all three views. The page builds this once
 * (latest-ref pattern) so the memoized rows below never re-render just because a
 * parent handler closure changed — only a change to `client`, `selected`,
 * `selectionMode`, `budget`, `canDelete`/`canWrite`, or `currency` re-renders a row.
 */
export interface ClientActions {
  onOpen: (id: string) => void
  onQuickView: (client: ClientWithStats) => void
  onEditBudget: (client: ClientWithStats) => void
  onOpenBudget: (id: string) => void
  onToggleSelect: (id: string) => void
  onEnterSelection: (id: string) => void
  formatAmount: (n: number) => string
  bindLongPress: (onLongPress: () => void) => LongPressProps
  didLongPress: () => boolean
}

interface ItemProps {
  client: ClientWithStats
  selected: boolean
  selectionMode: boolean
  canDelete: boolean
  canWrite: boolean
  currency: string
  budget?: Budget
  actions: ClientActions
}

/** The internal/own-company client can never be deleted, so it's never selectable. */
const isSelectable = (client: ClientWithStats, canDelete: boolean) => canDelete && !client.is_own

/** Budget indicator (navigates to the budget page) + edit pencil — shared by the card. */
function BudgetBlock({
  client, budget, canWrite, currency, actions,
}: { client: ClientWithStats; budget?: Budget; canWrite: boolean; currency: string; actions: ClientActions }) {
  const { t } = useTranslation("clients")
  if (budget) {
    return (
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="group/budget min-w-0 flex-1 rounded-md p-1 text-left transition-colors hover:bg-accent/50"
          onClick={(e) => { e.stopPropagation(); actions.onOpenBudget(client.id) }}
          aria-label={t("nav.budgets")}
        >
          <BudgetIndicator amount={budget.amount} spent={budget.spent ?? 0} period={budget.period} currency={currency} showPeriodIcon />
        </button>
        {canWrite && (
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent/50 hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); actions.onEditBudget(client) }}
            aria-label={t("budget.edit")}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
    )
  }
  if (!canWrite) return null
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      onClick={(e) => { e.stopPropagation(); actions.onEditBudget(client) }}
    >
      <MoneyBag className="size-3" /> {t("budget.set")}
    </button>
  )
}

export const ClientCard = memo(function ClientCard({
  client, selected, selectionMode, canDelete, canWrite, currency, budget, actions,
}: ItemProps) {
  const { t } = useTranslation("clients")
  const selectable = isSelectable(client, canDelete)
  return (
    <Card
      className={cn("group cursor-pointer hover:shadow-md transition-shadow py-0", selected && "ring-2 ring-primary")}
      onClick={() => {
        if (selectionMode && selectable) { actions.onToggleSelect(client.id); return }
        if (actions.didLongPress()) return
        actions.onOpen(client.id)
      }}
      {...(selectable ? actions.bindLongPress(() => actions.onEnterSelection(client.id)) : {})}
    >
      <CardContent className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
        <div className="flex items-start justify-between gap-2">
          {selectionMode && selectable && (
            <Checkbox
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => actions.onToggleSelect(client.id)}
              className="mt-0.5 shrink-0"
              aria-label={`Select ${client.name}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm truncate">{client.name}</p>
              {client.is_own && (
                <Badge variant="outline" className="text-xs shrink-0 border-primary/40 text-primary">
                  <Building2 className="size-3 mr-0.5" /> {t("ownCompany")}
                </Badge>
              )}
              <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs shrink-0">
                {client.status}
              </Badge>
              <AttachmentBadge count={client.attachment_count} />
              {client.category && (
                <Badge variant="outline" className="text-xs shrink-0">{client.category}</Badge>
              )}
            </div>
            {client.company && (
              <div className="flex items-center gap-1.5 mt-1">
                <Building2 className="size-3 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground truncate">{client.company}</p>
              </div>
            )}
          </div>
          {/* Mobile: an explicit "view" (eye) opens a quick details sheet; desktop
              keeps the chevron nav hint. */}
          {!selectionMode && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 -mt-1 -mr-1 sm:hidden"
              aria-label={`View ${client.name}`}
              onClick={(e) => { e.stopPropagation(); actions.onQuickView(client) }}
            >
              <Eye className="size-4" />
            </Button>
          )}
          <ChevronRight className="hidden sm:block size-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{t("incomeLabel")}</p>
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
              <TrendingUp className="size-3" />
              {actions.formatAmount(Number(client.total_incoming ?? 0))}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">{t("expenseLabel")}</p>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
              <TrendingDown className="size-3" />
              {actions.formatAmount(Number(client.total_outgoing ?? 0))}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">{t("profitLabel")}</p>
            <p className={cn("text-sm font-semibold flex items-center gap-1 mt-0.5",
              client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
              <DollarSign className="size-3" />
              {actions.formatAmount(client.profit)}
            </p>
          </div>
        </div>

        <BudgetBlock client={client} budget={budget} canWrite={canWrite} currency={currency} actions={actions} />

        {(client.email || client.phone) && (
          <div className="hidden sm:block space-y-1 pt-1">
            {client.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="size-3 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground truncate">{client.email}</p>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="size-3 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground truncate">{client.phone}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
})

export const ClientListRow = memo(function ClientListRow({
  client, selected, selectionMode, canDelete, actions,
}: ItemProps) {
  const { t } = useTranslation("clients")
  const selectable = isSelectable(client, canDelete)
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors group min-h-11",
        selected && "ring-2 ring-primary",
      )}
      onClick={() => {
        if (selectionMode && selectable) { actions.onToggleSelect(client.id); return }
        if (actions.didLongPress()) return
        actions.onOpen(client.id)
      }}
      {...(selectable ? actions.bindLongPress(() => actions.onEnterSelection(client.id)) : {})}
    >
      {selectionMode && selectable && (
        <Checkbox
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={() => actions.onToggleSelect(client.id)}
          className="shrink-0"
          aria-label={`Select ${client.name}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{client.name}</span>
          {client.is_own && (
            <Badge variant="outline" className="text-xs border-primary/40 text-primary">
              <Building2 className="size-3 mr-0.5" /> {t("ownCompany")}
            </Badge>
          )}
          <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs">
            {client.status}
          </Badge>
          <AttachmentBadge count={client.attachment_count} />
        </div>
        {client.company && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{client.company}</p>
        )}
      </div>
      <div className="hidden sm:flex items-center gap-1.5 w-40 shrink-0">
        <Mail className="size-3 text-muted-foreground shrink-0" />
        <p className="text-xs text-muted-foreground truncate">{client.email || "—"}</p>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="hidden md:block text-right">
          <p className="text-xs text-muted-foreground">{t("incomeLabel")}</p>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
            {actions.formatAmount(Number(client.total_incoming ?? 0))}
          </p>
        </div>
        <div className="hidden md:block text-right">
          <p className="text-xs text-muted-foreground">{t("expenseLabel")}</p>
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            {actions.formatAmount(Number(client.total_outgoing ?? 0))}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{t("profitLabel")}</p>
          <p className={cn("text-sm font-semibold",
            client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
            {actions.formatAmount(client.profit)}
          </p>
        </div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
    </div>
  )
})

// ── Table view ────────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc"
/** A sortable column maps to `<column>_<dir>` server sort keys (see api/_routes/clients.ts). */
export interface ClientColumn {
  key: "name" | "company" | "income" | "expense" | "profit" | "date"
  labelKey: string
  align?: "right"
}

const ClientTableRow = memo(function ClientTableRow({
  client, selected, selectionMode, canDelete, canWrite, actions,
}: ItemProps) {
  const { t } = useTranslation("clients")
  const selectable = isSelectable(client, canDelete)
  const income = Number(client.total_incoming ?? 0)
  const outgoing = Number(client.total_outgoing ?? 0)
  return (
    <tr
      className={cn("border-b last:border-0 cursor-pointer hover:bg-accent/40 transition-colors", selected && "bg-primary/5")}
      onClick={() => {
        if (selectionMode && selectable) { actions.onToggleSelect(client.id); return }
        actions.onOpen(client.id)
      }}
    >
      {selectionMode && (
        <td className="p-2 w-8" onClick={(e) => e.stopPropagation()}>
          {selectable && (
            <Checkbox checked={selected} onCheckedChange={() => actions.onToggleSelect(client.id)} aria-label={`Select ${client.name}`} />
          )}
        </td>
      )}
      <td className="p-2 max-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{client.name}</span>
          {client.is_own && <Building2 className="size-3 text-primary shrink-0" />}
          <AttachmentBadge count={client.attachment_count} />
        </div>
        {client.category && <span className="text-[10px] text-muted-foreground">{client.category}</span>}
      </td>
      <td className="p-2 max-w-0 text-muted-foreground">
        <span className="truncate block">{client.company || "—"}</span>
      </td>
      <td className="p-2 text-right tabular-nums font-semibold whitespace-nowrap text-emerald-600 dark:text-emerald-400">
        {actions.formatAmount(income)}
      </td>
      <td className="p-2 text-right tabular-nums font-semibold whitespace-nowrap text-red-600 dark:text-red-400">
        {actions.formatAmount(outgoing)}
      </td>
      <td className={cn("p-2 text-right tabular-nums font-semibold whitespace-nowrap",
        client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
        {actions.formatAmount(client.profit)}
      </td>
      <td className="p-2 whitespace-nowrap text-muted-foreground">
        {new Date(client.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
      </td>
      {!selectionMode && (
        <td className="p-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5 justify-end">
            <Button size="icon" variant="ghost" className="size-8" aria-label={`View ${client.name}`} title={t("view.label")} onClick={() => actions.onQuickView(client)}>
              <Eye className="size-3.5" />
            </Button>
            {canWrite && (
              <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t("budget.edit")} title={t("budget.edit")} onClick={() => actions.onEditBudget(client)}>
                <Pencil className="size-3.5" />
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
})

interface ClientTableProps {
  clients: ClientWithStats[]
  budgetFor: (id: string) => Budget | undefined
  isSelected: (id: string) => boolean
  selectionMode: boolean
  canDelete: boolean
  canWrite: boolean
  currency: string
  actions: ClientActions
  sort: string
  onSort: (key: ClientColumn["key"]) => void
}

const COLUMNS: ClientColumn[] = [
  { key: "name", labelKey: "table.name" },
  { key: "company", labelKey: "table.company" },
  { key: "income", labelKey: "table.income", align: "right" },
  { key: "expense", labelKey: "table.expense", align: "right" },
  { key: "profit", labelKey: "table.profit", align: "right" },
  { key: "date", labelKey: "table.date" },
]

export function ClientTable({
  clients, budgetFor, isSelected, selectionMode, canDelete, canWrite, currency, actions, sort, onSort,
}: ClientTableProps) {
  const { t } = useTranslation("clients")
  const [sortKey, sortDir] = sort.split("_") as [string, SortDir]
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            {selectionMode && <th className="p-2 w-8" aria-label="select" />}
            {COLUMNS.map((col) => {
              const active = sortKey === col.key
              const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th key={col.key} className={cn("p-2 font-medium", col.align === "right" && "text-right")}>
                  <button
                    type="button"
                    className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground", col.align === "right" && "flex-row-reverse")}
                    onClick={() => onSort(col.key)}
                    aria-label={t("table.sortBy", { column: t(col.labelKey) })}
                  >
                    {t(col.labelKey)}
                    <Icon className={cn("size-3", !active && "opacity-40")} />
                  </button>
                </th>
              )
            })}
            {!selectionMode && <th className="p-2 text-right font-medium">{t("table.actions")}</th>}
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <ClientTableRow
              key={client.id}
              client={client}
              selected={isSelected(client.id)}
              selectionMode={selectionMode}
              canDelete={canDelete}
              canWrite={canWrite}
              currency={currency}
              budget={budgetFor(client.id)}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
