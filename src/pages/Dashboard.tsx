import { useEffect, useState, type ReactNode } from "react"
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
  ChevronRight,
  Search,
  Sparkles,
  Building2,
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

type ClientWithStats = Client & {
  totalIncoming: number
  totalOutgoing: number
  profit: number
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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
}: {
  transactions: Transaction[]
  loading: boolean
  currency: string
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
                      {tx.description?.trim() || tx.client_name || t(`chart.${tx.type}`)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tx.client_name ? `${tx.client_name} · ` : ""}{formatTxDate(tx.date)}
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

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const chartConfig: ChartConfig = {
    incoming: { label: t("chart.incoming"), color: "var(--chart-2)" },
    outgoing: { label: t("chart.outgoing"), color: "var(--chart-5)" },
  }
  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [latestTx, setLatestTx] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set())
  const [clientSearch, setClientSearch] = useState("")
  const [popoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        if (!token) return
        const [clientList, txList] = await Promise.all([
          apiGet<Client[]>("/api/clients", token),
          apiGet<Transaction[]>("/api/transactions", token),
        ])

        // Group transactions by client once (O(n)) rather than scanning the whole
        // transaction list for every client (O(n*m)).
        const txByClient = new Map<string, Transaction[]>()
        for (const t of txList) {
          const arr = txByClient.get(t.client_id)
          if (arr) arr.push(t)
          else txByClient.set(t.client_id, [t])
        }

        const withStats: ClientWithStats[] = clientList.map((c) => {
          let incoming = 0
          let outgoing = 0
          for (const t of txByClient.get(c.id) ?? []) {
            if (t.type === "incoming") incoming += Number(t.amount)
            else if (t.type === "outgoing") outgoing += Number(t.amount)
          }
          return { ...c, totalIncoming: incoming, totalOutgoing: outgoing, profit: incoming - outgoing }
        })

        // Latest 20 transactions across the workspace, newest first. Derived from
        // the list we already fetched (no extra round-trip).
        const latest = [...txList]
          .sort((a, b) => (b.date.localeCompare(a.date)) || b.created_at.localeCompare(a.created_at))
          .slice(0, 20)

        setClients(withStats)
        setLatestTx(latest)
      } catch (err) {
        console.error("Failed to load dashboard:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; getToken is stable
  }, [])

  // Filter data by selected clients
  const filteredClients = selectedClientIds.size === 0 ? clients : clients.filter((c) => selectedClientIds.has(c.id))
  const filteredClientsForSearch = clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.company.toLowerCase().includes(clientSearch.toLowerCase()))

  const toggleClient = (clientId: string) => {
    const newSelection = new Set(selectedClientIds)
    if (newSelection.has(clientId)) {
      newSelection.delete(clientId)
    } else {
      newSelection.add(clientId)
    }
    setSelectedClientIds(newSelection)
  }

  const clearSelection = () => {
    setSelectedClientIds(new Set())
    setClientSearch("")
  }

  const netProfit = filteredClients.reduce((s, c) => s + c.profit, 0)
  const displayIncoming = filteredClients.reduce((s, c) => s + c.totalIncoming, 0)
  const displayOutgoing = filteredClients.reduce((s, c) => s + c.totalOutgoing, 0)
  const profitMargin = displayIncoming > 0 ? ((netProfit / displayIncoming) * 100).toFixed(1) : "0"
  const activeClients = filteredClients.filter((c) => c.status === "active").length

  // Build chart data
  const chartDataValue = filteredClients.length === 0
    ? []
    : filteredClients.length === 1
    ? [{ name: filteredClients[0].name.split(" ")[0], incoming: filteredClients[0].totalIncoming, outgoing: filteredClients[0].totalOutgoing }]
    : [...filteredClients]
        .sort((a, b) => b.totalIncoming - a.totalIncoming)
        .slice(0, 6)
        .map((c) => ({
          name: c.name.split(" ")[0],
          incoming: c.totalIncoming,
          outgoing: c.totalOutgoing,
        }))

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <CompanyUpsellBanner />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedClientIds.size > 0
              ? t("dashboard.viewingClients", { count: selectedClientIds.size })
              : t("dashboard.overview")}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="truncate">{selectedClientIds.size === 0 ? t("dashboard.allClients") : t("dashboard.selectedCount", { count: selectedClientIds.size })}</span>
                <ChevronRight className="size-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[90vw] max-w-sm sm:w-72 p-0" align="end">
              <div className="border-b p-3 sticky top-0 bg-background">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input placeholder={t("dashboard.searchClients")} className="pl-8 h-8" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                </div>
              </div>
              <ScrollArea className="h-64">
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox id="all-clients" checked={selectedClientIds.size === clients.length && clients.length > 0} onCheckedChange={(checked) => { if (checked) { setSelectedClientIds(new Set(clients.map((c) => c.id))) } else { setSelectedClientIds(new Set()) } }} />
                    <Label htmlFor="all-clients" className="text-sm font-medium cursor-pointer flex-1">{t("dashboard.allClients")}</Label>
                  </div>
                  {filteredClientsForSearch.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">{t("dashboard.noClientsFound")}</p>
                  ) : (
                    filteredClientsForSearch.map((client) => (
                      <div key={client.id} className="flex items-center gap-2 py-1">
                        <Checkbox id={client.id} checked={selectedClientIds.has(client.id)} onCheckedChange={() => toggleClient(client.id)} />
                        <Label htmlFor={client.id} className="text-sm cursor-pointer flex-1">
                          <div><span className="font-medium">{client.name}</span></div>
                          <div className="text-xs text-muted-foreground">{client.company}</div>
                        </Label>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              {selectedClientIds.size > 0 && (
                <div className="border-t p-2 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={clearSelection}>{t("common.clear")}</Button>
                  <Button size="sm" className="flex-1" onClick={() => setPopoverOpen(false)}>{t("common.done")}</Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
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
              {selectedClientIds.size > 0 ? t("dashboard.selectedIncome") : t("dashboard.allTimeIncoming")}
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
              {selectedClientIds.size > 0 ? t("dashboard.selectedExpenses") : t("dashboard.allTimeOutgoing")}
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
        <StatCard
          loading={loading}
          label={t("dashboard.activeClients")}
          value={String(activeClients)}
          hint={t("dashboard.totalClients", { count: clients.length })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-5">
        {/* Chart */}
        <Card className="lg:col-span-3 min-w-0">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              {selectedClientIds.size > 0 ? t("dashboard.transactionSummary") : t("dashboard.revenueVsExpenses")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : chartDataValue.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                {t("dashboard.noDataYet")}
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="min-h-[200px] w-full">
                <BarChart data={chartDataValue} accessibilityLayer>
                  <CartesianGrid vertical={false} className="stroke-border" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="incoming" fill="var(--color-incoming)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outgoing" fill="var(--color-outgoing)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Top Clients */}
        <Card className="lg:col-span-2 min-w-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">{selectedClientIds.size > 0 ? t("dashboard.selectedClientsSummary") : t("dashboard.topClients")}</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/clients")}>
              {t("common.viewAll")} <ChevronRight className="size-3 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : filteredClients.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.noClientsToDisplay")}</div>
            ) : selectedClientIds.size > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {filteredClients.map((client) => (
                  <div key={client.id} className="p-3 rounded-md border space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{client.name}</p>
                        <p className="text-xs text-muted-foreground">{client.company}</p>
                      </div>
                      <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs shrink-0">
                        {t(`status.${client.status}`)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">{t("dashboard.income")}</p>
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(client.totalIncoming, currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("dashboard.expenses")}</p>
                        <p className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(client.totalOutgoing, currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t("dashboard.profit")}</p>
                        <p className={`font-semibold ${client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                          {formatCurrency(client.profit, currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {[...clients]
                  .sort((a, b) => b.profit - a.profit)
                  .slice(0, 5)
                  .map((client) => (
                    <button
                      key={client.id}
                      onClick={() => navigate(`/clients/${client.id}`)}
                      className="w-full flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{client.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{client.company || "—"}</p>
                      </div>
                      <div className="text-right ml-2 shrink-0">
                        <p className={`text-sm font-semibold ${client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                          {formatCurrency(client.profit, currency)}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {t(`status.${client.status}`)}
                        </Badge>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Latest activity across the workspace */}
      <LatestTransactionsCard transactions={latestTx} loading={loading} currency={currency} />
    </div>
  )
}
