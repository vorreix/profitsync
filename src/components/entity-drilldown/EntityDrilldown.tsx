import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { useNavigate } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, FileText, User, ChevronRight } from "lucide-react"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import type { DrilldownItem, DrilldownSort } from "@/lib/types"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type DrilldownTypeOption = { value: string; label: string }

type Props = {
  open: boolean
  onClose: () => void
  /** Display heading (a category name or "#tag"). */
  title: string
  /** Server endpoint, e.g. "/api/categories/entities" or "/api/tags/entities". */
  endpoint: string
  /** The identity param(s), e.g. { name: "Marketing" } or { tag: "#travel" }. */
  query: Record<string, string>
  /** The filterable type chips (values must match the server `counts` keys). */
  typeOptions: DrilldownTypeOption[]
}

const SORTS: DrilldownSort[] = ["date_desc", "date_asc", "amount_desc", "amount_asc", "name_asc"]
const sortLabelKey: Record<DrilldownSort, string> = {
  date_desc: "drilldown.sortNewest",
  date_asc: "drilldown.sortOldest",
  amount_desc: "drilldown.sortAmountHigh",
  amount_asc: "drilldown.sortAmountLow",
  name_asc: "drilldown.sortName",
}

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/** True if an item belongs to a given category/tag type value. */
function itemMatchesType(item: DrilldownItem, typeValue: string): boolean {
  if (typeValue === "incoming" || typeValue === "outgoing") {
    return item.entity_type === "transaction" && item.tx_type === typeValue
  }
  if (typeValue === "transaction") return item.entity_type === "transaction"
  return item.entity_type === typeValue // "client" | "quotation"
}

/**
 * Generic "every entity matching X" drilldown overlay, shared by the category
 * and tag managers. Type chips filter client-side (so their counts stay stable
 * regardless of selection); date range + sort are applied server-side.
 */
export function EntityDrilldown({ open, onClose, title, endpoint, query, typeOptions }: Props) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const navigate = useNavigate()

  const [items, setItems] = useState<DrilldownItem[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [activeTypes, setActiveTypes] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [sort, setSort] = useState<DrilldownSort>("date_desc")

  // Stable identity of the drilldown target; reset filters when it changes.
  const queryKey = JSON.stringify(query)
  useEffect(() => {
    setActiveTypes([])
    setDateFrom("")
    setDateTo("")
    setSort("date_desc")
  }, [queryKey])

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams(query)
      if (dateFrom) params.set("dateFrom", dateFrom)
      if (dateTo) params.set("dateTo", dateTo)
      params.set("sort", sort)
      const res = await apiGet<{ items: DrilldownItem[]; counts: Record<string, number> }>(
        `${endpoint}?${params.toString()}`,
        token,
      )
      setItems(Array.isArray(res?.items) ? res.items : [])
      setCounts(res?.counts ?? {})
    } catch {
      setItems([])
      setCounts({})
    } finally {
      setLoading(false)
    }
  }, [getToken, endpoint, query, dateFrom, dateTo, sort])

  // Debounce so char-by-char date entry doesn't hammer the endpoint.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(fetchItems, 200)
    return () => clearTimeout(id)
  }, [open, fetchItems])

  // Only offer a chip for a type that actually has entities here — so the chip
  // counts always reconcile with the item total (a category/tag can be declared
  // for types that no entity currently uses, and entities can reference it via
  // free-text for types it isn't declared for). A selected type whose chip
  // vanishes (e.g. a date filter zeroes it out) is dropped from the filter
  // rather than stranding the list on an empty set.
  const availableOptions = useMemo(
    () => typeOptions.filter((o) => (counts[o.value] ?? 0) > 0),
    [typeOptions, counts],
  )
  const effectiveActive = useMemo(
    () => activeTypes.filter((ty) => availableOptions.some((o) => o.value === ty)),
    [activeTypes, availableOptions],
  )
  const visible = useMemo(
    () => (effectiveActive.length === 0 ? items : items.filter((i) => effectiveActive.some((ty) => itemMatchesType(i, ty)))),
    [items, effectiveActive],
  )

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col gap-0">
        <SheetHeader className="border-b px-4 py-3 sm:px-6">
          <SheetTitle className="truncate">{title}</SheetTitle>
          <SheetDescription>
            {loading ? t("drilldown.loading") : t("drilldown.itemCount", { count: visible.length })}
          </SheetDescription>
        </SheetHeader>

        {/* Filters */}
        <div className="border-b px-4 py-3 sm:px-6 space-y-3">
          {availableOptions.length > 0 && (
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              spacing={2}
              value={effectiveActive}
              onValueChange={setActiveTypes}
              className="w-full flex-wrap"
            >
              {availableOptions.map((opt) => (
                <ToggleGroupItem key={opt.value} value={opt.value} className="gap-1.5 rounded-md data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary">
                  {opt.label}
                  <Badge variant="secondary" className="px-1.5 text-[10px]">{counts[opt.value] ?? 0}</Badge>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input type="date" aria-label={t("filters.from")} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            <Input type="date" aria-label={t("filters.to")} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            <Select value={sort} onValueChange={(v) => setSort(v as DrilldownSort)}>
              <SelectTrigger className="h-9 w-[7.5rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => <SelectItem key={s} value={s}>{t(sortLabelKey[s])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {loading ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{t("drilldown.empty")}</div>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((item) => (
                <li key={`${item.entity_type}-${item.id}`}>
                  <button
                    type="button"
                    // Replace the pushed `?<key>=…` entry with the destination in one
                    // navigation: no race with a separate close()'s navigate(-1), and the
                    // browser back button returns to the clean list rather than reopening.
                    onClick={() => navigate(item.link, { replace: true })}
                    className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <EntityIcon item={item} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{item.title}</p>
                      {item.subtitle && <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      {item.amount != null && item.tx_type && (
                        <p className={`text-sm font-semibold tabular-nums ${item.tx_type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {item.tx_type === "incoming" ? "+" : "-"}{formatMoney(Math.abs(Number(item.amount)), currency)}
                        </p>
                      )}
                      {item.date && <p className="text-[11px] text-muted-foreground">{formatDate(item.date)}</p>}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EntityIcon({ item }: { item: DrilldownItem }) {
  if (item.entity_type === "transaction") {
    const incoming = item.tx_type === "incoming"
    return (
      <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${incoming ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
        {incoming
          ? <ArrowDownLeft className="size-4 text-emerald-600 dark:text-emerald-400" />
          : <ArrowUpRight className="size-4 text-red-600 dark:text-red-400" />}
      </div>
    )
  }
  if (item.entity_type === "client") {
    return (
      <div className="size-9 rounded-lg flex items-center justify-center shrink-0 bg-blue-100 dark:bg-blue-900/30">
        <User className="size-4 text-blue-600 dark:text-blue-400" />
      </div>
    )
  }
  return (
    <div className="size-9 rounded-lg flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/30">
      <FileText className="size-4 text-amber-600 dark:text-amber-400" />
    </div>
  )
}
