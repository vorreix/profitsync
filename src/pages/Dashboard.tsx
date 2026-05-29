import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
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
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Search,
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

const chartConfig: ChartConfig = {
  incoming: { label: "Incoming", color: "var(--chart-2)" },
  outgoing: { label: "Outgoing", color: "var(--chart-5)" },
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function Dashboard() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set())
  const [clientSearch, setClientSearch] = useState("")
  const [popoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (!token) return
      const [clientList, txList] = await Promise.all([
        apiGet<Client[]>("/api/clients", token),
        apiGet<Transaction[]>("/api/transactions", token),
      ])

      let grandIncoming = 0
      let grandOutgoing = 0

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
        grandIncoming += incoming
        grandOutgoing += outgoing
        return { ...c, totalIncoming: incoming, totalOutgoing: outgoing, profit: incoming - outgoing }
      })

      setClients(withStats)
      setLoading(false)
    }
    load()
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
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedClientIds.size > 0 ? `Viewing ${selectedClientIds.size} client${selectedClientIds.size === 1 ? "" : "s"}` : "Financial overview across all clients"}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="truncate">{selectedClientIds.size === 0 ? "All Clients" : `${selectedClientIds.size} Selected`}</span>
                <ChevronRight className="size-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[90vw] max-w-sm sm:w-72 p-0" align="end">
              <div className="border-b p-3 sticky top-0 bg-background">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input placeholder="Search clients..." className="pl-8 h-8" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
                </div>
              </div>
              <ScrollArea className="h-64">
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Checkbox id="all-clients" checked={selectedClientIds.size === clients.length && clients.length > 0} onCheckedChange={(checked) => { if (checked) { setSelectedClientIds(new Set(clients.map((c) => c.id))) } else { setSelectedClientIds(new Set()) } }} />
                    <Label htmlFor="all-clients" className="text-sm font-medium cursor-pointer flex-1">All Clients</Label>
                  </div>
                  {filteredClientsForSearch.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No clients found</p>
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
                  <Button size="sm" variant="outline" className="flex-1" onClick={clearSelection}>Clear</Button>
                  <Button size="sm" className="flex-1" onClick={() => setPopoverOpen(false)}>Done</Button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <DollarSign className="size-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{formatCurrency(displayIncoming, currency)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <ArrowUpRight className="size-3 text-emerald-500" />
                  {selectedClientIds.size > 0 ? "Selected income" : "All time incoming"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Expenses
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <TrendingDown className="size-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{formatCurrency(displayOutgoing, currency)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <ArrowDownRight className="size-3 text-destructive" />
                  {selectedClientIds.size > 0 ? "Selected expenses" : "All time outgoing"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Net Profit
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-4 text-muted-foreground" />
                  <span className={`text-2xl font-bold ${netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                    {formatCurrency(netProfit, currency)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {profitMargin}% margin
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Active Clients
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{activeClients}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {clients.length} total clients
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Chart */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              {selectedClientIds.size > 0 ? "Transaction Summary" : "Revenue vs Expenses by Client"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-48 w-full" />
            ) : chartDataValue.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                No data yet. Add clients and transactions to see chart.
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
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">{selectedClientIds.size > 0 ? "Selected Clients Summary" : "Top Clients"}</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate("/clients")}>
              View all <ChevronRight className="size-3 ml-1" />
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : filteredClients.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No clients to display</div>
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
                        {client.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Income</p>
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(client.totalIncoming, currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Expenses</p>
                        <p className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(client.totalOutgoing, currency)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Profit</p>
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
                          {client.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
