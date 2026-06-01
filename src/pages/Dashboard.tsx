import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPatch } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  ChevronDown,
  Search,
  Sparkles,
  Building2,
  Tag,
  X,
} from "lucide-react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Compact currency for chart axis ticks (e.g. "$5K", "€1.2M"). Currency-aware so
// the axis tracks the active org currency instead of a hardcoded symbol.
function formatCompactCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount)
}

function formatTxDate(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

const UPSELL_REAPPEAR_MS = 72 * 60 * 60 * 1000 // banner returns 72h after a dismissal

// Compact KPI tile — keeps a single figure readable without consuming a full
// card's worth of vertical space on small screens.
function StatCard({
  label, value, valueClass = "", hint, loading,
}: {
  label: string
  value: string
  valueClass?: string
  hint?: ReactNode
  loading?: boolean
}) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5 sm:px-4 sm:py-3.5">
      <p className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">
        {label}
      </p>
      {loading ? (
        <Skeleton className="h-6 sm:h-8 w-20 sm:w-28 mt-1.5" />
      ) : (
        <>
          <p className={`text-lg sm:text-2xl font-bold mt-1 tabular-nums truncate ${valueClass}`}>{value}</p>
          {hint && (
            <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
              {hint}
            </p>
          )}
        </>
      )}
    </div>
  )
}

type FilterOption = { id: string; label: string; sublabel?: string; badge?: string }

// Reusable multi-select dropdown used for both the client and category filters.
function MultiSelectFilter({
  triggerLabel, allLabel, searchPlaceholder, emptyText, options, selected, onChange, icon,
}: {
  triggerLabel: string
  allLabel: string
  searchPlaceholder: string
  emptyText: string
  options: FilterOption[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  icon: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const q = search.toLowerCase()
  const filtered = options.filter(
    (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? "").toLowerCase().includes(q),
  )
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between sm:w-52">
          <span className="flex items-center gap-2 truncate">
            {icon}
            <span className="truncate">
              {selected.size === 0 ? triggerLabel : t("dashboard.selectedCount", { count: selected.size })}
            </span>
          </span>
          <ChevronDown className="size-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-1.5rem))] p-0" align="end">
        <div className="border-b p-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder={searchPlaceholder} className="pl-8 h-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollArea className="h-64">
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Checkbox
                id="ms-all"
                checked={selected.size === options.length && options.length > 0}
                onCheckedChange={(c) => onChange(c ? new Set(options.map((o) => o.id)) : new Set())}
              />
              <Label htmlFor="ms-all" className="text-sm font-medium cursor-pointer flex-1">{allLabel}</Label>
            </div>
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">{emptyText}</p>
            ) : (
              filtered.map((o) => (
                <div key={o.id} className="flex items-center gap-2 py-1">
                  <Checkbox id={`ms-${o.id}`} checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                  <Label htmlFor={`ms-${o.id}`} className="text-sm cursor-pointer flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{o.label}</span>
                      {o.badge && (
                        <span className="rounded-full border px-1.5 py-0 text-[10px] text-muted-foreground shrink-0">{o.badge}</span>
                      )}
                    </div>
                    {o.sublabel && <div className="text-xs text-muted-foreground truncate">{o.sublabel}</div>}
                  </Label>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
        {selected.size > 0 && (
          <div className="border-t p-2 flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onChange(new Set())}>{t("common.clear")}</Button>
            <Button size="sm" className="flex-1" onClick={() => setOpen(false)}>{t("common.done")}</Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// Invites a user with no company workspace to try one. Dismissable (returns
// after 72h) with a durable "don't show again" opt-out — both persisted on the
// user profile so the choice follows them across devices.
function CompanyUpsellBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { orgs, profile, refresh } = useOrg()
  const [closed, setClosed] = useState(false)
  const [busy, setBusy] = useState(false)

  const hasCompany = orgs.some((o) => !o.is_personal)
  const dismissedAt = profile?.company_upsell_dismissed_at
  const recentlyDismissed = dismissedAt
    ? Date.now() - new Date(dismissedAt).getTime() < UPSELL_REAPPEAR_MS
    : false
  const visible =
    !!profile && !hasCompany && !profile.company_upsell_hidden && !recentlyDismissed && !closed

  if (!visible) return null

  const persist = async (patch: Record<string, unknown>) => {
    setBusy(true)
    setClosed(true) // optimistic — hide immediately
    try {
      const token = await getToken()
      if (token) await apiPatch("/api/profile", token, patch)
      await refresh()
    } catch {
      // Non-fatal: the banner is hidden for this session regardless.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 sm:p-5">
      <div className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-primary/15 blur-2xl" />
      <button
        type="button"
        aria-label={t("dashboard.companyUpsellDismiss")}
        onClick={() => persist({ company_upsell_dismissed_at: new Date().toISOString() })}
        disabled={busy}
        className="pressable absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary sm:size-12">
          <Building2 className="size-5 sm:size-6" />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold sm:text-base">
            <Sparkles className="size-4 shrink-0 text-primary" />
            {t("dashboard.companyUpsellTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{t("dashboard.companyUpsellBody")}</p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Button size="sm" className="h-9" onClick={() => navigate("/organizations")}>
            {t("dashboard.companyUpsellCta")}
            <ArrowRight className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => persist({ company_upsell_hidden: true })}
            disabled={busy}
            className="pressable text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {t("dashboard.companyUpsellNeverShow")}
          </button>
        </div>
      </div>
    </div>
  )
}

// Compact list of the most recent transactions across the workspace.
function LatestTransactionsCard({
  transactions,
  loading,
  currency,
  showClient,
}: {
  transactions: Transaction[]
  loading: boolean
  currency: string
  showClient: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">{t("dashboard.latestTransactions")}</CardTitle>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/transactions")}>
          {t("common.viewAll")} <ArrowRight className="size-3 ml-1" />
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        ) : transactions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.latestTransactionsEmpty")}</div>
        ) : (
          <div className="divide-y">
            {transactions.map((tx) => {
              const incoming = tx.type === "incoming"
              const sub = [showClient ? tx.client_name : null, tx.category?.trim() || null]
                .filter(Boolean)
                .join(" · ")
              return (
                <div key={tx.id} className="flex items-center gap-3 py-2.5">
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                      incoming
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {incoming ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {tx.description?.trim() || sub || t(`chart.${tx.type}`)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {sub ? `${sub} · ` : ""}{formatTxDate(tx.date)}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      incoming ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {incoming ? "+" : "−"}{formatCurrency(Number(tx.amount), currency)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const UNCATEGORIZED = "__uncat__"

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"

  const chartConfig: ChartConfig = {
    incoming: { label: t("chart.incoming"), color: "var(--chart-2)" },
    outgoing: { label: t("chart.outgoing"), color: "var(--chart-5)" },
  }

  const [clients, setClients] = useState<Client[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set())
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const [clientList, txList] = await Promise.all([
          apiGet<Client[]>("/api/clients", token),
          apiGet<Transaction[]>("/api/transactions", token),
        ])
        setClients(clientList)
        setTransactions(txList)
      } catch (err) {
        console.error("Failed to load dashboard:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; getToken is stable
  }, [])

  const clientsById = useMemo(() => {
    const m = new Map<string, Client>()
    for (const c of clients) m.set(c.id, c)
    return m
  }, [clients])

  const catKey = (tx: Transaction) => tx.category?.trim() || UNCATEGORIZED
  const catLabel = (key: string) => (key === UNCATEGORIZED ? t("dashboard.uncategorized") : key)

  // Distinct categories present in the data, for the category filter.
  const categoryOptions: FilterOption[] = useMemo(() => {
    const set = new Set<string>()
    for (const tx of transactions) set.add(catKey(tx))
    return [...set]
      .sort((a, b) => catLabel(a).localeCompare(catLabel(b)))
      .map((k) => ({ id: k, label: catLabel(k) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions])

  // Real (non-own) clients drive the business client filter; the own client is
  // shown with a distinct badge and pinned first.
  const clientOptions: FilterOption[] = useMemo(
    () =>
      clients.map((c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.company || undefined,
        badge: c.is_own ? t("dashboard.ownLabel") : undefined,
      })),
    [clients, t],
  )

  const filteredTx = useMemo(
    () =>
      transactions.filter((tx) => {
        const clientOk = isPersonal || selectedClientIds.size === 0 || selectedClientIds.has(tx.client_id)
        const catOk = selectedCategories.size === 0 || selectedCategories.has(catKey(tx))
        return clientOk && catOk
      }),
     
    [transactions, selectedClientIds, selectedCategories, isPersonal],
  )

  const displayIncoming = filteredTx.reduce((s, t) => (t.type === "incoming" ? s + Number(t.amount) : s), 0)
  const displayOutgoing = filteredTx.reduce((s, t) => (t.type === "outgoing" ? s + Number(t.amount) : s), 0)
  const netProfit = displayIncoming - displayOutgoing
  const profitMargin = displayIncoming > 0 ? ((netProfit / displayIncoming) * 100).toFixed(1) : "0"
  const filtersActive = selectedClientIds.size > 0 || selectedCategories.size > 0

  const realClients = clients.filter((c) => !c.is_own)
  const activeClients = realClients.filter((c) => c.status === "active").length

  const latestTx = useMemo(
    () =>
      [...filteredTx]
        .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
        .slice(0, 20),
    [filteredTx],
  )

  // Chart + side-card breakdown: by client for business, by category for personal.
  type Bucket = { key: string; name: string; incoming: number; outgoing: number }
  const buckets = useMemo(() => {
    const m = new Map<string, Bucket>()
    for (const tx of filteredTx) {
      const key = isPersonal ? catKey(tx) : tx.client_id
      const name = isPersonal ? catLabel(catKey(tx)) : clientsById.get(tx.client_id)?.name ?? "—"
      const b = m.get(key) ?? { key, name, incoming: 0, outgoing: 0 }
      if (tx.type === "incoming") b.incoming += Number(tx.amount)
      else b.outgoing += Number(tx.amount)
      m.set(key, b)
    }
    return [...m.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTx, isPersonal, clientsById])

  const chartData = [...buckets]
    .sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing))
    .slice(0, 6)
    .map((b) => ({ name: b.name.split(" ")[0] || b.name, incoming: b.incoming, outgoing: b.outgoing }))

  const topBuckets = [...buckets]
    .map((b) => ({ ...b, profit: b.incoming - b.outgoing, total: b.incoming + b.outgoing }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <CompanyUpsellBanner />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filtersActive ? t("dashboard.filtered") : t("dashboard.overview")}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {!isPersonal && (
            <MultiSelectFilter
              triggerLabel={t("dashboard.allClients")}
              allLabel={t("dashboard.allClients")}
              searchPlaceholder={t("dashboard.searchClients")}
              emptyText={t("dashboard.noClientsFound")}
              options={clientOptions}
              selected={selectedClientIds}
              onChange={setSelectedClientIds}
              icon={<Building2 className="size-4 opacity-60" />}
            />
          )}
          <MultiSelectFilter
            triggerLabel={t("dashboard.allCategories")}
            allLabel={t("dashboard.allCategories")}
            searchPlaceholder={t("dashboard.searchCategories")}
            emptyText={t("dashboard.noCategoriesFound")}
            options={categoryOptions}
            selected={selectedCategories}
            onChange={setSelectedCategories}
            icon={<Tag className="size-4 opacity-60" />}
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-2.5 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          loading={loading}
          label={t("dashboard.totalRevenue")}
          value={formatCurrency(displayIncoming, currency)}
          hint={
            <>
              <ArrowUpRight className="size-3 text-emerald-500 shrink-0" />
              {t("dashboard.allTimeIncoming")}
            </>
          }
        />
        <StatCard
          loading={loading}
          label={t("dashboard.totalExpenses")}
          value={formatCurrency(displayOutgoing, currency)}
          hint={
            <>
              <ArrowDownRight className="size-3 text-destructive shrink-0" />
              {t("dashboard.allTimeOutgoing")}
            </>
          }
        />
        <StatCard
          loading={loading}
          label={t("dashboard.netProfit")}
          value={formatCurrency(netProfit, currency)}
          valueClass={netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}
          hint={t("dashboard.margin", { value: profitMargin })}
        />
        {isPersonal ? (
          <StatCard
            loading={loading}
            label={t("dashboard.transactionsKpi")}
            value={String(filteredTx.length)}
            hint={t("dashboard.transactionsTotal", { count: transactions.length })}
          />
        ) : (
          <StatCard
            loading={loading}
            label={t("dashboard.activeClients")}
            value={String(activeClients)}
            hint={t("dashboard.totalClients", { count: realClients.length })}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-5">
        {/* Chart */}
        <Card className="lg:col-span-3 min-w-0">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              {isPersonal ? t("dashboard.revenueVsCategories") : t("dashboard.revenueVsExpenses")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                {t("dashboard.noDataYet")}
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
                <BarChart data={chartData} accessibilityLayer>
                  <CartesianGrid vertical={false} className="stroke-border" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={(v) => formatCompactCurrency(Number(v), currency)} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <>
                            <div
                              className="size-2.5 shrink-0 rounded-[2px]"
                              style={{ backgroundColor: `var(--color-${name})` }}
                            />
                            <div className="flex flex-1 items-center justify-between gap-2 leading-none">
                              <span className="text-muted-foreground">
                                {chartConfig[String(name)]?.label ?? name}
                              </span>
                              <span className="font-mono font-medium tabular-nums text-foreground">
                                {formatCurrency(Number(value), currency)}
                              </span>
                            </div>
                          </>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="incoming" fill="var(--color-incoming)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outgoing" fill="var(--color-outgoing)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Top breakdown */}
        <Card className="lg:col-span-2 min-w-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">
              {isPersonal ? t("dashboard.topCategories") : t("dashboard.topClients")}
            </CardTitle>
            {!isPersonal && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/clients")}>
                {t("common.viewAll")} <ArrowRight className="size-3 ml-1" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : topBuckets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.noDataYet")}</div>
            ) : (
              <div className="space-y-1">
                {topBuckets.map((b) => {
                  const own = !isPersonal && clientsById.get(b.key)?.is_own
                  const row = (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-1.5">
                          {isPersonal ? <Tag className="size-3 text-muted-foreground shrink-0" /> : null}
                          {b.name}
                          {own && <Badge variant="outline" className="text-[10px] py-0">{t("dashboard.ownLabel")}</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatCurrency(b.incoming, currency)} · {formatCurrency(b.outgoing, currency)}
                        </p>
                      </div>
                      <p className={`text-sm font-semibold tabular-nums shrink-0 ml-2 ${b.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                        {formatCurrency(b.profit, currency)}
                      </p>
                    </>
                  )
                  return isPersonal ? (
                    <div key={b.key} className="flex items-center justify-between p-2 rounded-md">{row}</div>
                  ) : (
                    <button
                      key={b.key}
                      onClick={() => navigate(`/clients/${b.key}`)}
                      className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      {row}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Latest activity across the workspace */}
      <LatestTransactionsCard transactions={latestTx} loading={loading} currency={currency} showClient={!isPersonal} />
    </div>
  )
}
