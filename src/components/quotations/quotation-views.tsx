import { memo, type DOMAttributes } from "react"
import { useTranslation } from "react-i18next"
import {
  Archive, ArrowDown, ArrowUp, ArrowUpDown, Building2, Calendar, ExternalLink,
  Mail, Pencil, Phone, Trash2, UserPlus,
} from "lucide-react"
import type { Client, Quotation } from "@/lib/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { cn } from "@/lib/utils"
import { STATUS_COLORS, formatQuotationDate, quotationStatusLabel as statusLabel } from "@/lib/quotation-display"

/** Long-press handler bundle produced by `useLongPress().bind` (spread onto a row). */
type LongPressProps = DOMAttributes<HTMLElement>

/**
 * Stable action contract shared by all three views. The page builds this once
 * (latest-ref pattern) so the memoized rows below never re-render just because a
 * parent handler closure changed — only a change to `q`, `selected`,
 * `selectionMode`, `linkedClient`, or `canDelete` re-renders a given row.
 */
export interface QuotationActions {
  onView: (q: Quotation) => void
  onEdit: (q: Quotation) => void
  onConvert: (q: Quotation) => void
  onClose: (id: string) => void
  onDelete: (q: Quotation) => void
  onToggleSelect: (id: string) => void
  onEnterSelection: (id: string) => void
  onOpenClient: (id: string) => void
  formatAmount: (n: number) => string
  bindLongPress: (onLongPress: () => void) => LongPressProps
  didLongPress: () => boolean
}

interface ItemProps {
  q: Quotation
  linkedClient?: Client
  selected: boolean
  selectionMode: boolean
  canDelete: boolean
  actions: QuotationActions
}

const canConvertQuotation = (q: Quotation) =>
  !q.linked_client_id && (q.status === "draft" || q.status === "sent")

/** Trailing quick-action cluster (convert / edit / close / delete), shared by card + list. */
function RowActions({ q, canDelete, actions }: { q: Quotation; canDelete: boolean; actions: QuotationActions }) {
  const { t } = useTranslation("quotations")
  return (
    <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
      {canConvertQuotation(q) && (
        <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => actions.onConvert(q)}>
          <UserPlus className="size-3" />
          {t("convertToClientBtn")}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="size-8 p-0 shrink-0" aria-label={t("editBtn")} onClick={() => actions.onEdit(q)}>
        <Pencil className="size-3.5" />
      </Button>
      <Button
        size="sm" variant="ghost" className="size-8 p-0 shrink-0 text-muted-foreground"
        aria-label={t("closed.close")} title={t("closed.close")} onClick={() => actions.onClose(q.id)}
      >
        <Archive className="size-3.5" />
      </Button>
      {canDelete && (
        <Button
          size="sm" variant="ghost" className="size-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t("moveToTrashBtn")} onClick={() => actions.onDelete(q)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

export const QuotationCard = memo(function QuotationCard({
  q, linkedClient, selected, selectionMode, canDelete, actions,
}: ItemProps) {
  return (
    <Card
      className={cn("group cursor-pointer hover:shadow-md transition-shadow py-0", selected && "ring-2 ring-primary")}
      onClick={() => {
        if (selectionMode) { actions.onToggleSelect(q.id); return }
        if (actions.didLongPress()) return
        actions.onView(q)
      }}
      {...(canDelete ? actions.bindLongPress(() => actions.onEnterSelection(q.id)) : {})}
    >
      <CardContent className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
        <div className="flex items-start justify-between gap-2">
          {selectionMode && (
            <Checkbox
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={() => actions.onToggleSelect(q.id)}
              className="mt-0.5 shrink-0"
              aria-label={`Select ${q.title}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{q.title}</p>
            <p className="text-sm text-muted-foreground truncate">{q.prospect_name}</p>
            {q.category && <Badge variant="outline" className="mt-1 text-[10px]">{q.category}</Badge>}
          </div>
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full shrink-0", STATUS_COLORS[q.status])}>
            {statusLabel(q.status)}
          </span>
        </div>

        <div className="space-y-1">
          {q.company && (
            <div className="flex items-center gap-1.5">
              <Building2 className="size-3 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground truncate">{q.company}</p>
            </div>
          )}
          {q.email && (
            <div className="flex items-center gap-1.5">
              <Mail className="size-3 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground truncate">{q.email}</p>
            </div>
          )}
          {q.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="size-3 text-muted-foreground shrink-0" />
              <p className="text-xs text-muted-foreground truncate">{q.phone}</p>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Calendar className="size-3 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">{formatQuotationDate(q.created_at)}</p>
            <AttachmentBadge count={q.attachment_count} className="ml-auto" />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t">
          <p className="text-base font-bold">{actions.formatAmount(Number(q.amount))}</p>
          {linkedClient ? (
            <button
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={(e) => { e.stopPropagation(); actions.onOpenClient(linkedClient.id) }}
            >
              <ExternalLink className="size-3" />
              {linkedClient.name}
            </button>
          ) : q.linked_client_id ? (
            <Badge variant="outline" className="text-xs">Converted</Badge>
          ) : null}
        </div>

        {!selectionMode && <RowActions q={q} canDelete={canDelete} actions={actions} />}
      </CardContent>
    </Card>
  )
})

export const QuotationListRow = memo(function QuotationListRow({
  q, linkedClient, selected, selectionMode, canDelete, actions,
}: ItemProps) {
  const { t } = useTranslation("quotations")
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-3 cursor-pointer hover:bg-accent/40 transition-colors min-h-11",
        selected && "ring-2 ring-primary",
      )}
      onClick={() => {
        if (selectionMode) { actions.onToggleSelect(q.id); return }
        if (actions.didLongPress()) return
        actions.onView(q)
      }}
      {...(canDelete ? actions.bindLongPress(() => actions.onEnterSelection(q.id)) : {})}
    >
      {selectionMode && (
        <Checkbox
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={() => actions.onToggleSelect(q.id)}
          className="shrink-0"
          aria-label={`Select ${q.title}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium text-sm truncate">{q.title}</p>
          <AttachmentBadge count={q.attachment_count} />
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {q.prospect_name}{q.company ? ` · ${q.company}` : ""}
        </p>
      </div>
      {linkedClient && (
        <button
          className="hidden md:flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
          onClick={(e) => { e.stopPropagation(); actions.onOpenClient(linkedClient.id) }}
        >
          <ExternalLink className="size-3" />
          <span className="max-w-28 truncate">{linkedClient.name}</span>
        </button>
      )}
      <span className={cn("hidden sm:inline text-xs font-medium px-2 py-0.5 rounded-full shrink-0", STATUS_COLORS[q.status])}>
        {statusLabel(q.status)}
      </span>
      <p className="text-sm font-semibold tabular-nums shrink-0 w-24 text-right">{actions.formatAmount(Number(q.amount))}</p>
      <p className="hidden lg:block text-xs text-muted-foreground shrink-0 w-24 text-right">{formatQuotationDate(q.created_at)}</p>
      {!selectionMode && (
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {canConvertQuotation(q) && (
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t("convertToClientBtn")} title={t("convertToClientBtn")} onClick={() => actions.onConvert(q)}>
              <UserPlus className="size-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-8" aria-label={t("editBtn")} title={t("editBtn")} onClick={() => actions.onEdit(q)}>
            <Pencil className="size-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t("closed.close")} title={t("closed.close")} onClick={() => actions.onClose(q.id)}>
            <Archive className="size-3.5" />
          </Button>
          {canDelete && (
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label={t("moveToTrashBtn")} title={t("moveToTrashBtn")} onClick={() => actions.onDelete(q)}>
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  )
})

// ── Table view ────────────────────────────────────────────────────────────────

export type SortDir = "asc" | "desc"
/** A sortable column maps to `<column>_<dir>` server sort keys (see api/_routes/quotations.ts). */
export interface QuotationColumn {
  key: "title" | "prospect" | "amount" | "status" | "date"
  labelKey: string
  align?: "right"
  className?: string
}

const QuotationTableRow = memo(function QuotationTableRow({
  q, linkedClient, selected, selectionMode, canDelete, actions,
}: ItemProps) {
  const { t } = useTranslation("quotations")
  return (
    <tr
      className={cn("border-b last:border-0 cursor-pointer hover:bg-accent/40 transition-colors", selected && "bg-primary/5")}
      onClick={() => {
        if (selectionMode) { actions.onToggleSelect(q.id); return }
        actions.onView(q)
      }}
    >
      {selectionMode && (
        <td className="p-2 w-8" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={() => actions.onToggleSelect(q.id)} aria-label={`Select ${q.title}`} />
        </td>
      )}
      <td className="p-2 max-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{q.title}</span>
          <AttachmentBadge count={q.attachment_count} />
        </div>
        {q.category && <span className="text-[10px] text-muted-foreground">{q.category}</span>}
      </td>
      <td className="p-2 max-w-0">
        <span className="truncate block">{q.prospect_name}</span>
        {linkedClient && (
          <button
            className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
            onClick={(e) => { e.stopPropagation(); actions.onOpenClient(linkedClient.id) }}
          >
            <ExternalLink className="size-3" /><span className="max-w-24 truncate">{linkedClient.name}</span>
          </button>
        )}
      </td>
      <td className="p-2 text-right tabular-nums font-semibold whitespace-nowrap">{actions.formatAmount(Number(q.amount))}</td>
      <td className="p-2 whitespace-nowrap">
        <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", STATUS_COLORS[q.status])}>{statusLabel(q.status)}</span>
      </td>
      <td className="p-2 whitespace-nowrap text-muted-foreground">{formatQuotationDate(q.created_at)}</td>
      {!selectionMode && (
        <td className="p-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5 justify-end">
            <Button size="icon" variant="ghost" className="size-8" aria-label={t("editBtn")} title={t("editBtn")} onClick={() => actions.onEdit(q)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t("closed.close")} title={t("closed.close")} onClick={() => actions.onClose(q.id)}>
              <Archive className="size-3.5" />
            </Button>
            {canDelete && (
              <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label={t("moveToTrashBtn")} title={t("moveToTrashBtn")} onClick={() => actions.onDelete(q)}>
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </td>
      )}
    </tr>
  )
})

interface QuotationTableProps {
  quotations: Quotation[]
  clientFor: (id: string | null) => Client | undefined
  isSelected: (id: string) => boolean
  selectionMode: boolean
  canDelete: boolean
  actions: QuotationActions
  sort: string
  onSort: (key: QuotationColumn["key"]) => void
}

const COLUMNS: QuotationColumn[] = [
  { key: "title", labelKey: "table.title" },
  { key: "prospect", labelKey: "table.prospect" },
  { key: "amount", labelKey: "table.amount", align: "right" },
  { key: "status", labelKey: "table.status" },
  { key: "date", labelKey: "table.date" },
]

export function QuotationTable({
  quotations, clientFor, isSelected, selectionMode, canDelete, actions, sort, onSort,
}: QuotationTableProps) {
  const { t } = useTranslation("quotations")
  const [sortKey, sortDir] = sort.split("_") as [string, SortDir]
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm min-w-[640px]">
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
          {quotations.map((q) => (
            <QuotationTableRow
              key={q.id}
              q={q}
              linkedClient={clientFor(q.linked_client_id)}
              selected={isSelected(q.id)}
              selectionMode={selectionMode}
              canDelete={canDelete}
              actions={actions}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
