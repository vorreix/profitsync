import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { toast } from "sonner"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Landmark,
  ListFilter,
  Network,
  Repeat,
  Search,
  Tag,
  Users,
  Wallet,
  Workflow,
} from "lucide-react"
import { apiGet } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { accountTypeAllows } from "@/lib/types"
import {
  buildFlowGraph,
  buildTimelineGraph,
  groupKeyId,
  type FlowData,
  type FlowGroup,
  type FlowLeaf,
  type TimelineData,
  type TimelinePeriod,
} from "@/lib/money-flow"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"

type GroupBy = "account" | "client" | "category"
type Option = { id: string; label: string }

// ── Custom node components ───────────────────────────────────────────────────
// React Flow renders these by `type`. Each reads typed data injected by the
// page below; currency formatting + the toggle callback are passed through data.

function Money({ value, sign, currency, className }: { value: number; sign?: "+" | "−"; currency: string; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {sign}{formatMoney(value, currency)}
    </span>
  )
}

type RootData = {
  label: string; income: number; expense: number; net: number; tx_count: number; balance: number
  collapsed: boolean; currency: string; onToggle: () => void
}
function RootNode({ data }: NodeProps<Node<RootData>>) {
  const { t } = useTranslation()
  return (
    <div className="w-[240px] rounded-2xl border-2 border-primary/50 bg-card p-4 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Workflow className="size-5" /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.label}</p>
          <p className="text-[11px] text-muted-foreground">{t("flow.workspaceTotals")}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between"><dt className="text-muted-foreground">{t("flow.revenue")}</dt><dd><Money value={data.income} sign="+" currency={data.currency} className="font-semibold text-emerald-600 dark:text-emerald-400" /></dd></div>
        <div className="flex items-center justify-between"><dt className="text-muted-foreground">{t("flow.expenses")}</dt><dd><Money value={data.expense} sign="−" currency={data.currency} className="font-semibold text-red-600 dark:text-red-400" /></dd></div>
        <div className="flex items-center justify-between border-t pt-1.5"><dt className="font-medium">{t("flow.net")}</dt><dd><Money value={data.net} currency={data.currency} className={cn("font-bold", data.net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")} /></dd></div>
        <div className="flex items-center justify-between"><dt className="text-muted-foreground">{t("flow.balance")}</dt><dd><Money value={data.balance} currency={data.currency} className="font-medium" /></dd></div>
      </dl>
      <button
        type="button"
        onClick={data.onToggle}
        className="nodrag mt-3 flex w-full items-center justify-center gap-1 rounded-lg border py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
      >
        {data.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        {data.collapsed ? t("flow.expandAll") : t("flow.collapseAll")}
      </button>
      <Handle type="source" position={Position.Right} className="!size-2 !border-2 !border-primary !bg-background" />
    </div>
  )
}

const GROUP_ICON = { account: Landmark, client: Users, category: Tag } as const

type GroupData = FlowGroup & { expanded: boolean; currency: string; onToggle: () => void }
function GroupNode({ data }: NodeProps<Node<GroupData>>) {
  const { t } = useTranslation()
  const Icon = data.kind === "account" ? (data.account_type === "cash" ? Wallet : Landmark) : GROUP_ICON[data.kind]
  const showBalances = data.kind === "account" && data.current_balance != null
  return (
    <div className="w-[256px] rounded-2xl border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <Handle type="target" position={Position.Left} className="!size-2 !border-2 !border-muted-foreground/40 !bg-background" />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={data.label}>{data.label}</p>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{data.tx_count}</span>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div><dt className="text-muted-foreground">{t("flow.in")}</dt><dd><Money value={data.income} sign="+" currency={data.currency} className="font-medium text-emerald-600 dark:text-emerald-400" /></dd></div>
        <div><dt className="text-muted-foreground">{t("flow.out")}</dt><dd><Money value={data.expense} sign="−" currency={data.currency} className="font-medium text-red-600 dark:text-red-400" /></dd></div>
        {showBalances ? (
          <>
            <div><dt className="text-muted-foreground">{t("flow.opening")}</dt><dd><Money value={data.opening_balance ?? 0} currency={data.currency} /></dd></div>
            <div><dt className="text-muted-foreground">{t("flow.current")}</dt><dd><Money value={data.current_balance ?? 0} currency={data.currency} className="font-medium" /></dd></div>
          </>
        ) : (
          <div className="col-span-2 border-t pt-1"><dt className="text-muted-foreground">{t("flow.net")}</dt><dd className="inline"> <Money value={data.net} currency={data.currency} className={cn("font-semibold", data.net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")} /></dd></div>
        )}
      </dl>
      {data.tx_count > 0 && (
        <button
          type="button"
          onClick={data.onToggle}
          className="nodrag mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          {data.expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {data.expanded ? t("flow.hideTransactions") : t("flow.showTransactions")}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-2 !border-muted-foreground/40 !bg-background" />
    </div>
  )
}

type LeafData = FlowLeaf & { currency: string; formatDate: (d: string) => string; onOpen: () => void }
function LeafNode({ data }: NodeProps<Node<LeafData>>) {
  const { t } = useTranslation()
  const inc = data.type === "incoming"
  return (
    // `nodrag` lets the click through (React Flow won't start a node drag here);
    // a whole-card button opens the transaction.
    <button
      type="button"
      onClick={data.onOpen}
      title={t("flow.openTransaction")}
      className="nodrag flex w-[230px] items-center gap-2 rounded-xl border bg-card/80 p-2.5 text-left text-xs shadow-sm transition-colors hover:border-primary/40"
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border !border-muted-foreground/40 !bg-background" />
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", inc ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30")}>
        {inc ? <ArrowUpRight className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight className="size-3.5 text-red-600 dark:text-red-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate font-medium">
          {data.description || (inc ? t("flow.income") : t("flow.expense"))}
          {data.recurring && <Repeat className="size-3 shrink-0 text-violet-500" />}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">{data.formatDate(data.date)}{data.category ? ` · ${data.category}` : ""}</span>
      </span>
      <Money value={data.amount} sign={inc ? "+" : "−"} currency={data.currency} className={cn("shrink-0 font-semibold", inc ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")} />
    </button>
  )
}

type MoreData = { count: number; onOpen: () => void }
function MoreNode({ data }: NodeProps<Node<MoreData>>) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={data.onOpen}
      className="nodrag flex w-[230px] items-center justify-center gap-1.5 rounded-xl border border-dashed bg-card/60 px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
    >
      <Handle type="target" position={Position.Left} className="!size-1.5 !border !border-muted-foreground/40 !bg-background" />
      <ListFilter className="size-3.5" /> {t("flow.viewMore", { count: data.count })}
    </button>
  )
}

// ── Timeline nodes: a running-balance chain ──────────────────────────────────
type TimelinePeriodNodeData = TimelinePeriod & { expanded: boolean; currency: string; formatPeriod: (key: string, bucket: string) => string; onToggle: () => void }
function TimelinePeriodNode({ data }: NodeProps<Node<TimelinePeriodNodeData>>) {
  const { t } = useTranslation()
  return (
    <div className="w-[268px] rounded-2xl border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md">
      <Handle type="target" position={Position.Left} className="!size-2 !border-2 !border-muted-foreground/40 !bg-background" />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarClock className="size-4" /></span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{data.formatPeriod(data.key, data.bucket)}</p>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{data.tx_count}</span>
      </div>
      {/* before → net → after: the running cumulative chain */}
      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-[11px]">
        <span className="text-center"><span className="block text-[9px] uppercase text-muted-foreground">{t("flow.before")}</span><Money value={data.before} currency={data.currency} className="font-medium" /></span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground rtl:rotate-180" />
        <span className="text-center"><span className="block text-[9px] uppercase text-muted-foreground">{t("flow.net")}</span><Money value={data.net} sign={data.net >= 0 ? "+" : "−"} currency={data.currency} className={cn("font-semibold", data.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")} /></span>
        <ArrowRight className="size-3 shrink-0 text-muted-foreground rtl:rotate-180" />
        <span className="text-center"><span className="block text-[9px] uppercase text-muted-foreground">{t("flow.after")}</span><Money value={data.after} currency={data.currency} className="font-bold" /></span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px]">
        <div><dt className="inline text-muted-foreground">{t("flow.in")} </dt><Money value={data.income} sign="+" currency={data.currency} className="font-medium text-emerald-600 dark:text-emerald-400" /></div>
        <div className="text-right"><dt className="inline text-muted-foreground">{t("flow.out")} </dt><Money value={data.expense} sign="−" currency={data.currency} className="font-medium text-red-600 dark:text-red-400" /></div>
      </div>
      {data.tx_count > 0 && (
        <button
          type="button"
          onClick={data.onToggle}
          className="nodrag mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          {data.expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {data.expanded ? t("flow.hideTransactions") : t("flow.showTransactions")}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!size-2 !border-2 !border-muted-foreground/40 !bg-background" />
    </div>
  )
}

type TimelineFinalNodeData = TimelineData["final"] & { period_count: number; currency: string }
function TimelineFinalNode({ data }: NodeProps<Node<TimelineFinalNodeData>>) {
  const { t } = useTranslation()
  return (
    <div className="w-[240px] rounded-2xl border-2 border-primary/50 bg-card p-4 shadow-lg">
      <Handle type="target" position={Position.Left} className="!size-2 !border-2 !border-primary !bg-background" />
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Workflow className="size-5" /></span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.label}</p>
          <p className="text-[11px] text-muted-foreground">{t("flow.finalEntity")}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between"><dt className="text-muted-foreground">{t("flow.revenue")}</dt><dd><Money value={data.total_in} sign="+" currency={data.currency} className="font-semibold text-emerald-600 dark:text-emerald-400" /></dd></div>
        <div className="flex items-center justify-between"><dt className="text-muted-foreground">{t("flow.expenses")}</dt><dd><Money value={data.total_out} sign="−" currency={data.currency} className="font-semibold text-red-600 dark:text-red-400" /></dd></div>
        <div className="flex items-center justify-between border-t pt-1.5"><dt className="font-medium">{t("flow.netTotal")}</dt><dd><Money value={data.total_net} currency={data.currency} className={cn("font-bold", data.total_net >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300")} /></dd></div>
        <div className="flex items-center justify-between"><dt className="text-muted-foreground">{t("flow.balance")}</dt><dd><Money value={data.balance} currency={data.currency} className="font-medium" /></dd></div>
      </dl>
    </div>
  )
}

const NODE_TYPES = { root: RootNode, group: GroupNode, leaf: LeafNode, more: MoreNode, tlperiod: TimelinePeriodNode, tlfinal: TimelineFinalNode }

// ── Searchable multi-select filter (compact, mobile-safe) ────────────────────
function MultiCheck({ label, options, selected, onChange, searchPlaceholder }: { label: string; options: Option[]; selected: Set<string>; onChange: (s: Set<string>) => void; searchPlaceholder: string }) {
  const [query, setQuery] = useState("")
  if (options.length === 0) return null
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  // Search box appears once the list is long enough to warrant it.
  const showSearch = options.length > 6
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {selected.size > 0 && <span className="text-[10px] text-muted-foreground">{selected.size} selected</span>}
      </div>
      <div className="rounded-lg border">
        {showSearch && (
          <div className="relative border-b p-1.5">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} className="h-8 pl-7 text-sm" />
          </div>
        )}
        <div className="max-h-40 space-y-1 overflow-y-auto p-2 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-center text-xs text-muted-foreground">No matches</p>
          ) : (
            filtered.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggle(o.id)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const GROUP_BYS: GroupBy[] = ["account", "client", "category"]

export function MoneyFlowPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const isPersonal = activeOrg?.account_type === "personal"
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")

  const [data, setData] = useState<FlowData | TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<"grouped" | "timeline">("grouped")
  const [bucket, setBucket] = useState<"day" | "week" | "month" | "year">("month")
  const [groupBy, setGroupBy] = useState<GroupBy>(isPersonal ? "category" : "client")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [selCats, setSelCats] = useState<Set<string>>(new Set())
  const [selClients, setSelClients] = useState<Set<string>>(new Set())
  const [selAccounts, setSelAccounts] = useState<Set<string>>(new Set())
  const [catOptions, setCatOptions] = useState<Option[]>([])
  const [clientOptions, setClientOptions] = useState<Option[]>([])
  const [accountOptions, setAccountOptions] = useState<Option[]>([])
  const [rootCollapsed, setRootCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Bumped on every successful fetch; part of the structural key that triggers
  // a node rebuild (so drags persist between rebuilds — see the effect below).
  const [dataVersion, setDataVersion] = useState(0)

  // Filter options (loaded once).
  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      try {
        const token = await getToken()
        if (!token) return
        const [cats, accounts, clientsResp] = await Promise.all([
          apiGet<{ name: string }[]>("/api/categories", token).catch(() => []),
          apiGet<{ id: string; nickname?: string; bank_name?: string; archived_at?: string | null }[]>("/api/wealth/accounts", token).catch(() => []),
          hasClients ? apiGet<{ data?: { id: string; name: string; is_own?: boolean }[] } | { id: string; name: string; is_own?: boolean }[]>("/api/clients", token).catch(() => []) : Promise.resolve([]),
        ])
        if (cancelled) return
        const catList = Array.isArray(cats) ? cats : []
        setCatOptions([...new Set(catList.map((c) => c.name).filter(Boolean))].map((n) => ({ id: n, label: n })))
        setAccountOptions(accounts.filter((a) => !a.archived_at).map((a) => ({ id: a.id, label: a.nickname || a.bank_name || "Account" })))
        const cl = Array.isArray(clientsResp) ? clientsResp : (clientsResp.data ?? [])
        setClientOptions(cl.filter((c) => !c.is_own).map((c) => ({ id: c.id, label: c.name })))
      } catch {
        /* options are best-effort */
      }
    }
    loadOptions()
    return () => { cancelled = true }
  }, [getToken, hasClients])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams()
      if (viewMode === "timeline") { params.set("mode", "timeline"); params.set("bucket", bucket) }
      else params.set("groupBy", groupBy)
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      if (selCats.size) params.set("category", [...selCats].join(","))
      if (selClients.size) params.set("clientId", [...selClients].join(","))
      if (selAccounts.size) params.set("accountId", [...selAccounts].join(","))
      const resp = await apiGet<FlowData | TimelineData>(`/api/flow?${params}`, token)
      setData(resp)
      setDataVersion((v) => v + 1)
    } catch {
      toast.error(t("flow.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [getToken, viewMode, bucket, groupBy, from, to, selCats, selClients, selAccounts, t])

  useEffect(() => { load() }, [load])

  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)

  // Re-fit on viewport resize / rotation so nodes never end up stranded
  // off-screen (React Flow doesn't auto-fit on container resize).
  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, maxZoom: 1 }))
    }
    window.addEventListener("resize", onResize)
    return () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(raf) }
  }, [])

  const formatDate = useCallback((d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" }), [i18n.language])
  const formatPeriod = useCallback((key: string, b: string) => {
    const d = new Date(`${key}T00:00:00`)
    if (b === "year") return String(d.getFullYear())
    if (b === "month") return d.toLocaleDateString(i18n.language, { month: "short", year: "numeric" })
    if (b === "week") return `${t("flow.weekOf")} ${d.toLocaleDateString(i18n.language, { day: "numeric", month: "short" })}`
    return d.toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })
  }, [i18n.language, t])

  const toggleKey = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Where a group's "+N more" leaf links to (precise per dimension/period).
  const openTransactions = useCallback(() => {
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    navigate(`/transactions${params.toString() ? `?${params}` : ""}`)
  }, [navigate, from, to])
  const openMoreForGroup = useCallback((g: FlowGroup) => {
    if (g.kind === "client" && g.key) { navigate(`/clients/${g.key}`); return }
    if (g.kind === "account" && g.key) { navigate(`/wealth/${g.key}`); return }
    openTransactions()
  }, [navigate, openTransactions])
  const openLeaf = useCallback((id: string) => navigate(`/transactions?view=${id}`), [navigate])

  // ── Controlled nodes/edges so user DRAGS persist between structural rebuilds ─
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Rebuild + re-fit only when the STRUCTURE changes (data fetch, mode, groupBy,
  // bucket, collapse/expand) — NOT on drag, so dragging a node sticks until the
  // next deliberate change. A signature string is the dependency.
  const structuralKey = useMemo(() => {
    if (!data) return "none"
    return [viewMode, groupBy, bucket, dataVersion, rootCollapsed, [...expanded].sort().join(",")].join("|")
  }, [data, viewMode, groupBy, bucket, dataVersion, rootCollapsed, expanded])

  useEffect(() => {
    if (!data) { setNodes([]); setEdges([]); return }
    const built =
      data.mode === "timeline"
        ? buildTimelineGraph(data, expanded)
        : buildFlowGraph(data, { rootCollapsed, expanded })
    const rf: Node[] = built.nodes.map((n) => {
      switch (n.type) {
        case "root":
          return { ...n, data: { ...n.data, currency, onToggle: () => setRootCollapsed((c) => !c) } } as Node
        case "group": {
          const g = n.data as unknown as FlowGroup
          return { ...n, data: { ...n.data, currency, onToggle: () => toggleKey(groupKeyId(g)) } } as Node
        }
        case "tlperiod": {
          const p = n.data as unknown as TimelinePeriod
          return { ...n, data: { ...n.data, currency, formatPeriod, onToggle: () => toggleKey(p.key) } } as Node
        }
        case "tlfinal":
          return { ...n, data: { ...n.data, currency } } as Node
        case "leaf": {
          const leaf = n.data as unknown as FlowLeaf
          return { ...n, data: { ...n.data, currency, formatDate, onOpen: () => openLeaf(leaf.id) } } as Node
        }
        case "more": {
          const g = (n.data as { group?: FlowGroup }).group
          return { ...n, data: { ...n.data, onOpen: () => (g ? openMoreForGroup(g) : openTransactions()) } } as Node
        }
        default:
          return n as Node
      }
    })
    setNodes(rf)
    setEdges(built.edges as Edge[])
    const id = requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }))
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structuralKey is the intentional trigger; callbacks/currency are stable
  }, [structuralKey])

  const activeFilterCount = selCats.size + selClients.size + selAccounts.size + (from ? 1 : 0) + (to ? 1 : 0)
  const empty = !loading && data && (data.mode === "timeline" ? data.periods.length === 0 : data.root.tx_count === 0)

  const filterPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="flow-from" className="text-xs">{t("flow.from")}</Label>
          <Input id="flow-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="flow-to" className="text-xs">{t("flow.to")}</Label>
          <Input id="flow-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </div>
      </div>
      <MultiCheck label={t("flow.categories")} searchPlaceholder={t("flow.searchCategories")} options={catOptions} selected={selCats} onChange={setSelCats} />
      {hasClients && <MultiCheck label={t("flow.clients")} searchPlaceholder={t("flow.searchClients")} options={clientOptions} selected={selClients} onChange={setSelClients} />}
      <MultiCheck label={t("flow.accounts")} searchPlaceholder={t("flow.searchAccounts")} options={accountOptions} selected={selAccounts} onChange={setSelAccounts} />
      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => { setFrom(""); setTo(""); setSelCats(new Set()); setSelClients(new Set()); setSelAccounts(new Set()) }}>
          {t("flow.clearFilters")}
        </Button>
      )}
    </div>
  )

  const BUCKETS = ["day", "week", "month", "year"] as const

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col p-3 sm:h-[calc(100svh-1rem)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <Workflow className="size-5 text-primary" /> {t("flow.title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{viewMode === "timeline" ? t("flow.timelineSubtitle") : t("flow.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View-mode toggle: grouped mind-map vs running-balance timeline */}
          <div className="flex rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => { setViewMode("grouped"); setExpanded(new Set()); setRootCollapsed(false) }}
              aria-pressed={viewMode === "grouped"}
              className={cn("flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "grouped" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              <Network className="size-3.5" /> {t("flow.viewGrouped")}
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("timeline"); setExpanded(new Set()) }}
              aria-pressed={viewMode === "timeline"}
              className={cn("flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "timeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
            >
              <CalendarClock className="size-3.5" /> {t("flow.viewTimeline")}
            </button>
          </div>
          {/* Grouped: dimension switch. Timeline: bucket switch. */}
          {viewMode === "grouped" ? (
            <div className="flex rounded-lg border p-0.5">
              {GROUP_BYS.filter((g) => g !== "client" || hasClients).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => { setGroupBy(g); setExpanded(new Set()); setRootCollapsed(false) }}
                  aria-pressed={groupBy === g}
                  className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", groupBy === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  {t(`flow.by_${g}` as const)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex rounded-lg border p-0.5">
              {BUCKETS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => { setBucket(b); setExpanded(new Set()) }}
                  aria-pressed={bucket === b}
                  className={cn("rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors", bucket === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
                >
                  {t(`flow.bucket_${b}` as const)}
                </button>
              ))}
            </div>
          )}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0">
                <ListFilter className="size-4" /> {t("flow.filters")}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[88vw] max-w-sm">
              <SheetHeader><SheetTitle>{t("flow.filters")}</SheetTitle></SheetHeader>
              <ScrollArea className="mt-4 h-[calc(100svh-6rem)] pr-3">{filterPanel}</ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border bg-muted/20">
        {loading && !data ? (
          <div className="flex h-full items-center justify-center"><Skeleton className="h-3/4 w-11/12 rounded-xl" /></div>
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Workflow className="size-8 opacity-40" />
            <p className="text-sm font-medium">{t("flow.empty")}</p>
            <p className="max-w-xs text-xs">{t("flow.emptyHint")}</p>
          </div>
        ) : (
          <ReactFlow
            onInit={(inst) => { flowRef.current = inst }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.5}
            nodesDraggable
            elementsSelectable
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ type: "smoothstep", style: { strokeWidth: 1.5 }, animated: false }}
            onlyRenderVisibleElements
          >
            <Background gap={20} className="text-border" />
            <Controls showInteractive={false} className="!rounded-lg !border !shadow-sm" />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}
