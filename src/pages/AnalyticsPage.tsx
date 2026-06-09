import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { useDataRefresh } from "@/lib/data-refresh-context"
import { apiGet } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FitText } from "@/components/FitText"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts"
import { TrendingUp, ArrowUpRight, ArrowDownRight, Tag } from "lucide-react"

type Granularity = "day" | "week" | "month" | "year"
type Analytics = {
  range: { from: string; to: string; granularity: Granularity }
  summary: { income: number; expense: number; profit: number; tx_count: number }
  series: { period: string; income: number; expense: number; profit: number }[]
  by_category: { category: string; income: number; expense: number }[]
  by_client: { id: string; name: string; income: number; expense: number; profit: number }[]
}

function formatCurrency(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)
}

// Default lookback window per granularity (kept small so charts stay readable).
function defaultRange(gran: Granularity): { from: string; to: string } {
  const to = new Date()
  const from = new Date(to)
  if (gran === "day") from.setDate(from.getDate() - 29)
  else if (gran === "week") from.setDate(from.getDate() - 7 * 11)
  else if (gran === "month") from.setMonth(from.getMonth() - 11)
  else from.setFullYear(from.getFullYear() - 4)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

function labelFor(period: string, gran: Granularity): string {
  const d = new Date(period)
  if (isNaN(d.getTime())) return period
  if (gran === "year") return String(d.getUTCFullYear())
  if (gran === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export function AnalyticsPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"

  const [granularity, setGranularity] = useState<Granularity>("month")
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  const range = custom ?? defaultRange(granularity)
  const { revision } = useDataRefresh()

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ granularity, from: range.from, to: range.to })
      const d = await apiGet<Analytics>(`/api/analytics?${params}`, token)
      setData(d)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [getToken, granularity, range.from, range.to])

  useEffect(() => { load() }, [load])

  // A transaction added via the global + FAB refreshes the analytics in place
  // (silent — no skeleton).
  useEffect(() => {
    if (revision > 0) void load({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the signal
  }, [revision])

  const chartConfig: ChartConfig = {
    income: { label: t("chart.incoming"), color: "var(--chart-2)" },
    expense: { label: t("chart.outgoing"), color: "var(--chart-5)" },
    profit: { label: t("analytics.profit"), color: "var(--chart-1)" },
  }

  const chartData = useMemo(
    () => (data?.series ?? []).map((s) => ({ ...s, label: labelFor(s.period, granularity) })),
    [data, granularity],
  )

  const appliedCount = custom ? 1 : 0
  const maxCat = Math.max(1, ...(data?.by_category ?? []).map((c) => c.income + c.expense))

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("analytics.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("analytics.subtitle")}</p>
        </div>
        <FilterSheet
          count={appliedCount}
          onClear={() => setCustom(null)}
          registerFloating={false}
        >
          <FilterSection label={t("filters.dateRange")}>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" aria-label={t("filters.from")} value={range.from} max={range.to} onChange={(e) => setCustom({ from: e.target.value, to: range.to })} />
              <Input type="date" aria-label={t("filters.to")} value={range.to} min={range.from} onChange={(e) => setCustom({ from: range.from, to: e.target.value })} />
            </div>
          </FilterSection>
        </FilterSheet>
      </div>

      {/* Granularity */}
      <Tabs value={granularity} onValueChange={(v) => { setGranularity(v as Granularity); setCustom(null) }}>
        <TabsList>
          <TabsTrigger value="day">{t("analytics.daily")}</TabsTrigger>
          <TabsTrigger value="week">{t("analytics.weekly")}</TabsTrigger>
          <TabsTrigger value="month">{t("analytics.monthly")}</TabsTrigger>
          <TabsTrigger value="year">{t("analytics.yearly")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* KPIs */}
      <div className="grid gap-2.5 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <KpiCard loading={loading} label={t("analytics.totalIncome")} value={formatCurrency(data?.summary.income ?? 0, currency)} className="text-emerald-600 dark:text-emerald-400" icon={<ArrowUpRight className="size-3.5 text-emerald-500" />} />
        <KpiCard loading={loading} label={t("analytics.totalExpense")} value={formatCurrency(data?.summary.expense ?? 0, currency)} className="text-red-600 dark:text-red-400" icon={<ArrowDownRight className="size-3.5 text-red-500" />} />
        <KpiCard loading={loading} label={t("analytics.netProfit")} value={formatCurrency(data?.summary.profit ?? 0, currency)} className={(data?.summary.profit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"} icon={<TrendingUp className="size-3.5 text-muted-foreground" />} />
        <KpiCard loading={loading} label={t("analytics.transactions")} value={String(data?.summary.tx_count ?? 0)} icon={<Tag className="size-3.5 text-muted-foreground" />} />
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">{t("analytics.incomeVsExpense")}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("analytics.noData")}</p>
          ) : (
            <ChartContainer config={chartConfig} className="h-[240px] w-full">
              <BarChart data={chartData} margin={{ left: 4, right: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={(v) => formatCurrency(Number(v), currency)} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="income" fill="var(--color-income)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" fill="var(--color-expense)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Profit trend */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">{t("analytics.profitTrend")}</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[200px] w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t("analytics.noData")}</p>
          ) : (
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <LineChart data={chartData} margin={{ left: 4, right: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} interval="preserveStartEnd" />
                <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={(v) => formatCurrency(Number(v), currency)} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line dataKey="profit" stroke="var(--color-profit)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">{t("analytics.topCategories")}</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {loading ? (
              [1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : (data?.by_category.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("analytics.noData")}</p>
            ) : (
              data!.by_category.map((c) => (
                <div key={c.category} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{c.category}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency(c.income + c.expense, currency)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.round(((c.income + c.expense) / maxCat) * 100)}%` }} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {!isPersonal && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">{t("analytics.topClients")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)
              ) : (data?.by_client.length ?? 0) === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("analytics.noData")}</p>
              ) : (
                data!.by_client.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 text-sm border-b last:border-0 pb-2 last:pb-0">
                    <span className="truncate">{c.name}</span>
                    <span className={`shrink-0 tabular-nums font-medium ${c.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{formatCurrency(c.profit, currency)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function KpiCard({ loading, label, value, className, icon }: { loading: boolean; label: string; value: string; className?: string; icon?: React.ReactNode }) {
  return (
    <Card className="py-0">
      <CardContent className="p-3 sm:p-4">
        <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center gap-1">{icon}{label}</p>
        {loading ? <Skeleton className="h-6 w-20 mt-1.5" /> : <FitText className={`mt-1 ${className ?? ""}`} textClassName="text-base sm:text-xl font-bold tabular-nums">{value}</FitText>}
      </CardContent>
    </Card>
  )
}
