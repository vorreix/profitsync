import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import {
  Background,
  BackgroundVariant,
  Controls,
  getBezierPath,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type ColorMode,
  type Edge,
  type EdgeProps,
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
  Info,
  Landmark,
  ListFilter,
  Loader2,
  Maximize2,
  Minimize2,
  Network,
  Plus,
  Repeat,
  Search,
  Sparkles,
  Tag,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { apiGet } from "@/lib/api"
import { useDataRefresh } from "@/lib/data-refresh-context"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { useTheme } from "@/components/theme-provider"
import { useIsMobile } from "@/hooks/use-mobile"
import { useBackClose } from "@/hooks/use-back-close"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { accountTypeAllows } from "@/lib/types"
import {
  applyExtraLeaves,
  buildFlowGraph,
  buildTimelineGraph,
  groupKeyId,
  type FlowData,
  type FlowEdgeData,
  type FlowGroup,
  type FlowLeaf,
  type TimelineData,
  type TimelinePeriod,
} from "@/lib/money-flow"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"

type GroupBy = "account" | "client" | "category"
type Option = { id: string; label: string }

// ── Hover focus ──────────────────────────────────────────────────────────────
// When a node is hovered we light up that node + the edges/nodes it touches and
// dim everything else, so a busy graph collapses into "just this money path".
// Shared through context so nodes/edges self-style without rebuilding state.
type FocusState = { active: Set<string>; edges: Set<string> } | null
const FocusContext = createContext<FocusState>(null)
function useFocus(id: string, isEdge = false): "active" | "dim" | "none" {
  const focus = useContext(FocusContext)
  if (!focus) return "none"
  return (isEdge ? focus.edges : focus.active).has(id) ? "active" : "dim"
}

// ── Money + ratio primitives ─────────────────────────────────────────────────
function Money({ value, sign, currency, className }: { value: number; sign?: "+" | "−"; currency: string; className?: string }) {
  // When an explicit sign is supplied, show the magnitude so a negative value
  // can't render a double minus (e.g. net −$6,000, not "−-$6,000").
  return (
    <span className={cn("tabular-nums", className)}>
      {sign}{formatMoney(sign ? Math.abs(value) : value, currency)}
    </span>
  )
}

// A slim in/out proportion bar — instant read of how balanced a node is.
function RatioBar({ income, expense, className }: { income: number; expense: number; className?: string }) {
  const total = income + expense
  const inPct = total > 0 ? (income / total) * 100 : 0
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {total > 0 ? (
        <>
          <span className="h-full bg-emerald-500/80 dark:bg-emerald-400/80" style={{ width: `${inPct}%` }} />
          <span className="h-full bg-rose-500/80 dark:bg-rose-400/80" style={{ width: `${100 - inPct}%` }} />
        </>
      ) : null}
    </div>
  )
}

// Theme-aware glow + dim shared by every node card.
function nodeFx(state: "active" | "dim" | "none") {
  return cn(
    "transition-[opacity,box-shadow,transform] duration-200 motion-reduce:transition-none",
    state === "dim" && "opacity-40 saturate-50",
    state === "active" && "opacity-100",
  )
}

// A node icon chip that shows an uploaded logo (workspace / bank) when present,
// else the gradient-chip glyph — falling back to the glyph if the image fails.
function NodeLogo({ src, fallback, chipClass, className = "size-9" }: { src?: string | null; fallback: ReactNode; chipClass: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  // Retry when the logo URL changes (e.g. the user uploads a new one mid-session).
  useEffect(() => { setFailed(false) }, [src])
  if (src && !failed) {
    return (
      <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-2xl border bg-card", className)}>
        <img src={src} alt="" className="size-full scale-105 object-cover" onError={() => setFailed(true)} />
      </span>
    )
  }
  return <span className={cn("grid shrink-0 place-items-center rounded-2xl", chipClass, className)}>{fallback}</span>
}

// The small corner button that opens a node's detail modal. `nodrag` + a
// stopPropagation click so it never starts a drag or toggles the card.
function DetailButton({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-label={t("flow.nodeDetails")}
      title={t("flow.nodeDetails")}
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      className="nodrag grid size-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Info className="size-3.5" />
    </button>
  )
}

// ── Custom node components ───────────────────────────────────────────────────
const HANDLE_CLS = "!size-2 !rounded-full !border-2 !border-background !bg-muted-foreground/40 !transition-colors"
const HANDLE_PRIMARY = "!size-2.5 !rounded-full !border-2 !border-background !bg-primary"

type RootData = {
  label: string; income: number; expense: number; net: number; tx_count: number; balance: number
  collapsed: boolean; currency: string; logo_src?: string | null; onToggle: () => void; onDetail?: () => void
}
function RootNode({ id, data }: NodeProps<Node<RootData>>) {
  const { t } = useTranslation()
  const focus = useFocus(id)
  const pos = data.net >= 0
  return (
    <div
      className={cn(
        "group relative w-[256px] cursor-pointer overflow-hidden rounded-[1.75rem] border border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.06] p-4 shadow-[0_8px_30px_-12px] shadow-primary/30 backdrop-blur-sm",
        nodeFx(focus),
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-primary/15 blur-2xl" />
      <div className="relative flex items-center gap-2.5">
        <NodeLogo src={data.logo_src} className="size-10" chipClass="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm" fallback={<Sparkles className="size-5" />} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">{data.label}</p>
          <p className="text-[11px] text-muted-foreground">{t("flow.workspaceTotals")}</p>
        </div>
        <DetailButton onClick={data.onDetail} />
      </div>

      <div className="relative mt-3.5 rounded-2xl bg-muted/40 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("flow.net")}</p>
        <p className={cn("text-xl font-bold leading-tight", pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
          <Money value={data.net} sign={pos ? "+" : "−"} currency={data.currency} />
        </p>
        <RatioBar income={data.income} expense={data.expense} className="mt-2.5" />
        <dl className="mt-2 flex items-center justify-between text-[11px]">
          <dt aria-label={t("flow.revenue")} className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><TrendingUp aria-hidden className="size-3" /><Money value={data.income} sign="+" currency={data.currency} className="font-semibold" /></dt>
          <dd aria-label={t("flow.expenses")} className="flex items-center gap-1 text-rose-600 dark:text-rose-400"><Money value={data.expense} sign="−" currency={data.currency} className="font-semibold" /><TrendingDown aria-hidden className="size-3" /></dd>
        </dl>
      </div>

      <div className="relative mt-2.5 flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground">{t("flow.balance")}</span>
        <Money value={data.balance} currency={data.currency} className="font-semibold" />
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); data.onToggle() }}
        aria-expanded={!data.collapsed}
        className="nodrag relative mt-3 flex w-full items-center justify-center gap-1 rounded-xl border bg-background/60 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {data.collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        {data.collapsed ? t("flow.expandAll") : t("flow.collapseAll")}
      </button>
      <Handle type="source" position={Position.Right} className={HANDLE_PRIMARY} />
    </div>
  )
}

const GROUP_ICON = { account: Landmark, client: Users, category: Tag } as const

type GroupData = FlowGroup & { expanded: boolean; currency: string; onToggle: () => void; onDetail?: () => void }
function GroupNode({ id, data }: NodeProps<Node<GroupData>>) {
  const { t } = useTranslation()
  const focus = useFocus(id)
  const Icon = data.kind === "account" ? (data.account_type === "cash" ? Wallet : Landmark) : GROUP_ICON[data.kind]
  const showBalances = data.kind === "account" && data.current_balance != null
  const pos = data.net >= 0
  return (
    <div
      className={cn(
        "group w-[260px] cursor-pointer rounded-3xl border bg-gradient-to-br from-card to-muted/30 p-3.5 shadow-sm transition-shadow hover:shadow-lg hover:shadow-black/5",
        nodeFx(focus),
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE_CLS} />
      <div className="flex items-center gap-2.5">
        <NodeLogo
          src={data.logo_src}
          className="size-9"
          chipClass={cn("bg-gradient-to-br ring-1 ring-inset", pos ? "from-emerald-500/15 to-emerald-500/5 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400" : "from-rose-500/15 to-rose-500/5 text-rose-600 ring-rose-500/20 dark:text-rose-400")}
          fallback={<Icon className="size-[18px]" />}
        />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={data.label}>{data.label}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{data.tx_count}</span>
        <DetailButton onClick={data.onDetail} />
      </div>

      <RatioBar income={data.income} expense={data.expense} className="mt-3" />
      <dl className="mt-2 flex items-center justify-between text-[11px]">
        <dt aria-label={t("flow.in")} className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ArrowUpRight aria-hidden className="size-3" /><Money value={data.income} sign="+" currency={data.currency} className="font-semibold" /></dt>
        <dd aria-label={t("flow.out")} className="flex items-center gap-1 text-rose-600 dark:text-rose-400"><Money value={data.expense} sign="−" currency={data.currency} className="font-semibold" /><ArrowDownRight aria-hidden className="size-3" /></dd>
      </dl>

      {showBalances ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2 rounded-xl bg-muted/40 px-2.5 py-1.5 text-[11px]">
          <div><dt className="text-[9px] uppercase text-muted-foreground">{t("flow.opening")}</dt><dd><Money value={data.opening_balance ?? 0} currency={data.currency} /></dd></div>
          <div className="text-right"><dt className="text-[9px] uppercase text-muted-foreground">{t("flow.current")}</dt><dd><Money value={data.current_balance ?? 0} currency={data.currency} className="font-semibold" /></dd></div>
        </div>
      ) : (
        <div className="mt-2.5 flex items-center justify-between rounded-xl bg-muted/40 px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">{t("flow.net")}</span>
          <Money value={data.net} sign={pos ? "+" : "−"} currency={data.currency} className={cn("font-bold", pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} />
        </div>
      )}

      {data.tx_count > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); data.onToggle() }}
          aria-expanded={data.expanded}
          className="nodrag mt-2.5 flex w-full items-center justify-center gap-1 rounded-xl border bg-background/60 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {data.expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {data.expanded ? t("flow.hideTransactions") : t("flow.showTransactions")}
        </button>
      )}
      <Handle type="source" position={Position.Right} className={HANDLE_CLS} />
    </div>
  )
}

type LeafData = FlowLeaf & { currency: string; formatDate: (d: string) => string; onOpen: () => void; enterIndex?: number }
function LeafNode({ id, data }: NodeProps<Node<LeafData>>) {
  const { t } = useTranslation()
  const focus = useFocus(id)
  const inc = data.type === "incoming"
  return (
    // The leaf is DRAGGABLE (no `nodrag`) yet still opens its transaction. To
    // avoid a drag accidentally opening it, mouse-open goes through React Flow's
    // drag-aware `onNodeClick` (suppressed after a real drag) — so the button's
    // own onClick only handles KEYBOARD activation (Enter/Space → detail === 0).
    // Staggered fade+slide-in so expanded leaves "grow out" of the parent.
    <button
      type="button"
      onClick={(e) => { if (e.detail === 0) data.onOpen() }}
      title={t("flow.openTransaction")}
      style={{ animationDelay: `${Math.min(data.enterIndex ?? 0, 8) * 45}ms` }}
      className={cn(
        "flex w-[236px] cursor-grab items-center gap-2.5 rounded-2xl border bg-card p-2.5 text-left text-xs shadow-sm transition-[colors,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md active:cursor-grabbing motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-3 motion-safe:duration-300 motion-safe:fill-mode-both",
        nodeFx(focus),
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE_CLS} />
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset", inc ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400")}>
        {inc ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 truncate font-medium">
          {data.description || (inc ? t("flow.income") : t("flow.expense"))}
          {data.recurring && <Repeat className="size-3 shrink-0 text-violet-500" />}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">{data.formatDate(data.date)}{data.category ? ` · ${data.category}` : ""}</span>
        {data.account_name && (
          // Which account the money moved through — "to" when it landed in the
          // account (incoming), "from" when it left it (outgoing).
          <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
            <Landmark className="size-2.5 shrink-0" />
            <span className="truncate">{inc ? t("flow.dirTo") : t("flow.dirFrom")} {data.account_name}</span>
          </span>
        )}
      </span>
      <Money value={data.amount} sign={inc ? "+" : "−"} currency={data.currency} className={cn("shrink-0 self-start font-semibold", inc ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} />
    </button>
  )
}

// The "+N more" node offers two ways to see the rest: LOAD MORE pulls the next
// page of transactions in as nodes on the canvas; VIEW IN LIST jumps to the
// filtered list page (the original behaviour). The card body drags; the two
// buttons are `nodrag` so they click cleanly.
type MoreData = { count: number; loading?: boolean; exhausted?: boolean; onLoadMore: () => void; onOpenList: () => void; enterIndex?: number }
function MoreNode({ id, data }: NodeProps<Node<MoreData>>) {
  const { t } = useTranslation()
  const focus = useFocus(id)
  return (
    <div
      style={{ animationDelay: `${Math.min(data.enterIndex ?? 0, 8) * 45}ms` }}
      className={cn(
        "flex w-[236px] cursor-grab flex-col gap-2 rounded-2xl border border-dashed bg-card/70 p-2.5 text-xs text-muted-foreground shadow-sm active:cursor-grabbing motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-3 motion-safe:duration-300 motion-safe:fill-mode-both",
        nodeFx(focus),
      )}
    >
      <Handle type="target" position={Position.Left} className={HANDLE_CLS} />
      <p className="text-center font-medium">{t("flow.viewMore", { count: data.count })}</p>
      <div className="flex gap-1.5">
        {!data.exhausted && (
          <button
            type="button"
            onClick={data.onLoadMore}
            disabled={data.loading}
            className="nodrag flex flex-1 items-center justify-center gap-1 rounded-lg border bg-background/70 py-1.5 font-medium transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-60"
          >
            {data.loading ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {data.loading ? t("flow.loadingMore") : t("flow.loadMore")}
          </button>
        )}
        <button
          type="button"
          onClick={data.onOpenList}
          title={t("flow.viewInList")}
          aria-label={t("flow.viewInList")}
          className={cn(
            "nodrag flex items-center justify-center gap-1 rounded-lg border bg-background/70 py-1.5 font-medium transition-colors hover:bg-muted hover:text-foreground",
            data.exhausted ? "flex-1" : "px-2.5",
          )}
        >
          <ListFilter className="size-3.5" />
          {data.exhausted && t("flow.viewInList")}
        </button>
      </div>
    </div>
  )
}

// ── Timeline nodes: a running-balance chain ──────────────────────────────────
type TimelinePeriodNodeData = TimelinePeriod & { expanded: boolean; currency: string; formatPeriod: (key: string, bucket: string) => string; onToggle: () => void; onDetail?: () => void }
function TimelinePeriodNode({ id, data }: NodeProps<Node<TimelinePeriodNodeData>>) {
  const { t } = useTranslation()
  const focus = useFocus(id)
  const pos = data.net >= 0
  return (
    <div className={cn("group w-[276px] cursor-pointer rounded-3xl border bg-gradient-to-br from-card to-muted/30 p-3.5 shadow-sm transition-shadow hover:shadow-lg hover:shadow-black/5", nodeFx(focus))}>
      <Handle type="target" position={Position.Left} className={HANDLE_CLS} />
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/20"><CalendarClock className="size-[18px]" /></span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{data.formatPeriod(data.key, data.bucket)}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{data.tx_count}</span>
        <DetailButton onClick={data.onDetail} />
      </div>

      {/* before → net → after: the running cumulative chain */}
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-muted/40 px-3 py-2 text-[11px]">
        <span className="text-center"><span className="block text-[9px] uppercase text-muted-foreground">{t("flow.before")}</span><Money value={data.before} currency={data.currency} className="font-medium" /></span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 rtl:rotate-180" />
        <span className="text-center"><span className="block text-[9px] uppercase text-muted-foreground">{t("flow.net")}</span><Money value={data.net} sign={pos ? "+" : "−"} currency={data.currency} className={cn("font-semibold", pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} /></span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 rtl:rotate-180" />
        <span className="text-center"><span className="block text-[9px] uppercase text-muted-foreground">{t("flow.after")}</span><Money value={data.after} currency={data.currency} className="font-bold" /></span>
      </div>

      <RatioBar income={data.income} expense={data.expense} className="mt-2.5" />
      <dl className="mt-2 flex items-center justify-between text-[11px]">
        <dt aria-label={t("flow.in")} className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ArrowUpRight aria-hidden className="size-3" /><Money value={data.income} sign="+" currency={data.currency} className="font-semibold" /></dt>
        <dd aria-label={t("flow.out")} className="flex items-center gap-1 text-rose-600 dark:text-rose-400"><Money value={data.expense} sign="−" currency={data.currency} className="font-semibold" /><ArrowDownRight aria-hidden className="size-3" /></dd>
      </dl>

      {data.tx_count > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); data.onToggle() }}
          aria-expanded={data.expanded}
          className="nodrag mt-2.5 flex w-full items-center justify-center gap-1 rounded-xl border bg-background/60 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {data.expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {data.expanded ? t("flow.hideTransactions") : t("flow.showTransactions")}
        </button>
      )}
      <Handle type="source" position={Position.Right} className={HANDLE_CLS} />
    </div>
  )
}

type TimelineFinalNodeData = TimelineData["final"] & { period_count: number; currency: string; logo_src?: string | null; onDetail?: () => void }
function TimelineFinalNode({ id, data }: NodeProps<Node<TimelineFinalNodeData>>) {
  const { t } = useTranslation()
  const focus = useFocus(id)
  const pos = data.total_net >= 0
  return (
    <div className={cn("group relative w-[256px] cursor-pointer overflow-hidden rounded-[1.75rem] border border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.06] p-4 shadow-[0_8px_30px_-12px] shadow-primary/30 backdrop-blur-sm", nodeFx(focus))}>
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-primary/15 blur-2xl" />
      <Handle type="target" position={Position.Left} className={HANDLE_PRIMARY} />
      <div className="relative flex items-center gap-2.5">
        <NodeLogo src={data.logo_src} className="size-10" chipClass="bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm" fallback={<Sparkles className="size-5" />} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">{data.label}</p>
          <p className="text-[11px] text-muted-foreground">{t("flow.finalEntity")}</p>
        </div>
        <DetailButton onClick={data.onDetail} />
      </div>
      <div className="relative mt-3.5 rounded-2xl bg-muted/40 p-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t("flow.netTotal")}</p>
        <p className={cn("text-xl font-bold leading-tight", pos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
          <Money value={data.total_net} sign={pos ? "+" : "−"} currency={data.currency} />
        </p>
        <RatioBar income={data.total_in} expense={data.total_out} className="mt-2.5" />
        <dl className="mt-2 flex items-center justify-between text-[11px]">
          <dt aria-label={t("flow.revenue")} className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><TrendingUp aria-hidden className="size-3" /><Money value={data.total_in} sign="+" currency={data.currency} className="font-semibold" /></dt>
          <dd aria-label={t("flow.expenses")} className="flex items-center gap-1 text-rose-600 dark:text-rose-400"><Money value={data.total_out} sign="−" currency={data.currency} className="font-semibold" /><TrendingDown aria-hidden className="size-3" /></dd>
        </dl>
      </div>
      <div className="relative mt-2.5 flex items-center justify-between px-1 text-xs">
        <span className="text-muted-foreground">{t("flow.balance")}</span>
        <Money value={data.balance} currency={data.currency} className="font-semibold" />
      </div>
    </div>
  )
}

// ── Custom edge: ONE slim connection with two-way flow ───────────────────────
// A single thin connection line. Money in motion rides on that same line as
// short, thin dashes — GREEN gliding toward the workspace (income) and RED
// gliding outward (expense), phase-offset so the two streams interleave rather
// than stack into two fat parallel lines. Stroke weight nudges subtly with the
// money (hard-capped, never a slab). Dims/saturates with the hover focus.
function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const focus = useFocus(id, true)
  const dim = focus === "dim"
  const boost = focus === "active" ? 0.5 : 0
  const d = data ?? { income: 0, expense: 0, inWidth: 0, outWidth: 0, kind: "more" as const, animated: false }
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })

  const hasIn = d.inWidth > 0
  const hasOut = d.outWidth > 0
  const isMore = d.kind === "more"
  // ONE slim base line (hard-capped); the flow dashes sit a touch thinner on top.
  const baseW = Math.min(3, Math.max(d.inWidth, d.outWidth, isMore ? 1 : 1.2))
  const inW = Math.min(2.4, d.inWidth) + boost
  const outW = Math.min(2.4, d.outWidth) + boost

  return (
    <>
      {/* the single connection line (subtle, neutral) */}
      <path
        d={path}
        fill="none"
        stroke="var(--mf-neutral)"
        strokeWidth={baseW}
        strokeLinecap="round"
        strokeOpacity={dim ? 0.08 : isMore ? 0.3 : 0.24}
        strokeDasharray={isMore ? "1 6" : undefined}
        style={{ transition: "stroke-opacity 200ms" }}
      />
      {/* income — thin green dashes gliding toward the workspace */}
      {hasIn && (
        <path
          d={path}
          fill="none"
          stroke="var(--mf-income)"
          strokeWidth={inW}
          strokeLinecap="round"
          strokeDasharray="6 12"
          strokeOpacity={dim ? 0.12 : 0.9}
          className={cn("ps-flow-edge-in", focus === "active" && "ps-flow-edge--active")}
        />
      )}
      {/* expense — thin red dashes gliding outward, phase-offset so the two
          streams interleave along the single line instead of overlapping */}
      {hasOut && (
        <path
          d={path}
          fill="none"
          stroke="var(--mf-expense)"
          strokeWidth={outW}
          strokeLinecap="round"
          strokeDasharray="6 12"
          strokeOpacity={dim ? 0.12 : 0.9}
          className={cn("ps-flow-edge-out", focus === "active" && "ps-flow-edge--active")}
        />
      )}
    </>
  )
}

// memo() so a node/edge re-renders only when ITS data or focus changes — not on
// every pan/zoom/select/drag of an unrelated node (React Flow re-renders the
// canvas often; the bounded graph still stays smooth).
const NODE_TYPES = { root: memo(RootNode), branch: memo(GroupNode), leaf: memo(LeafNode), more: memo(MoreNode), tlperiod: memo(TimelinePeriodNode), tlfinal: memo(TimelineFinalNode) }
const EDGE_TYPES = { flow: memo(FlowEdge) }

// Minimap node fills are set as SVG `fill` attributes, where CSS var() does NOT
// resolve — so the dot colours must be concrete hex, picked by the theme.
const MINIMAP_COLORS = {
  light: { income: "#10b981", expense: "#f43f5e" },
  dark: { income: "#34d399", expense: "#fb7185" },
} as const
function minimapNodeColor(mode: ColorMode, n: Node): string {
  const c = MINIMAP_COLORS[mode === "dark" ? "dark" : "light"]
  const d = n.data as { type?: string; net?: number; total_net?: number }
  const positive = n.type === "leaf" ? d.type === "incoming" : (d.net ?? d.total_net ?? 0) >= 0
  return positive ? c.income : c.expense
}

// ── Searchable multi-select filter (compact, mobile-safe) ────────────────────
function MultiCheck({ label, options, selected, onChange, searchPlaceholder }: { label: string; options: Option[]; selected: Set<string>; onChange: (s: Set<string>) => void; searchPlaceholder: string }) {
  const { t } = useTranslation()
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
  const showSearch = options.length > 6
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        {selected.size > 0 && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary">{selected.size}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        {showSearch && (
          <div className="relative border-b p-1.5">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} className="h-8 border-0 bg-transparent pl-7 text-sm focus-visible:ring-0" />
          </div>
        )}
        <div className="max-h-44 space-y-0.5 overflow-y-auto p-1.5 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-center text-xs text-muted-foreground">{t("flow.noMatches")}</p>
          ) : (
            filtered.map((o) => {
              const on = selected.has(o.id)
              return (
                <label key={o.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors", on ? "bg-primary/5" : "hover:bg-muted")}>
                  <Checkbox checked={on} onCheckedChange={() => toggle(o.id)} />
                  <span className="truncate">{o.label}</span>
                </label>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ── In-canvas transaction detail popup ───────────────────────────────────────
// Shown when a transaction node is clicked — keeps you on the canvas (no nav)
// and offers a deep-link to the full detail page. Slides up from the bottom on
// mobile, docks bottom-right on desktop.
function TxPopup({ leaf, currency, formatDate, onViewDetails, onClose }: { leaf: FlowLeaf; currency: string; formatDate: (d: string) => string; onViewDetails: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const inc = leaf.type === "incoming"
  // Esc dismisses (matches the X + device-back affordances).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-live="polite"
      aria-label={leaf.description || (inc ? t("flow.income") : t("flow.expense"))}
      className="absolute inset-x-3 bottom-3 z-20 sm:inset-x-0 sm:bottom-4 sm:mx-auto sm:w-72"
    >
      <div className="overflow-hidden rounded-2xl border bg-card/95 shadow-xl shadow-black/25 backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
        <div className="flex items-start gap-2.5 p-3">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-full ring-1 ring-inset", inc ? "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-400")}>
            {inc ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="flex items-center gap-1 truncate text-[13px] font-semibold leading-tight">
              {leaf.description || (inc ? t("flow.income") : t("flow.expense"))}
              {leaf.recurring && <Repeat className="size-3 shrink-0 text-violet-500" />}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{formatDate(leaf.date)}{leaf.category ? ` · ${leaf.category}` : ""}</p>
            {leaf.account_name && (
              <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                <Landmark className="size-2.5 shrink-0" /><span className="truncate">{inc ? t("flow.dirTo") : t("flow.dirFrom")} {leaf.account_name}</span>
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t("flow.close")} className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className={cn("truncate text-base font-bold tabular-nums", inc ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {inc ? "+" : "−"}{formatMoney(Math.abs(leaf.amount), currency)}
          </span>
          <Button size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-xs" onClick={() => onViewDetails(leaf.id)}>
            {t("flow.viewDetails")} <ArrowUpRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Node detail modal ────────────────────────────────────────────────────────
// Opened from a node's corner Info button. Shows that node's figures and a
// "go to its page" action (so the card itself stays an expand/collapse toggle).
type DetailRow = { label: string; value: string; tone?: "income" | "expense" }
type NodeDetail = {
  title: string
  kindLabel: string
  logo_src?: string | null
  variant: "workspace" | "account" | "client" | "category" | "period"
  account_type?: string | null
  rows: DetailRow[]
  goLabel: string
  onGo: () => void
}
function NodeDetailModal({ detail, onClose }: { detail: NodeDetail; onClose: () => void }) {
  const { t } = useTranslation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const Glyph =
    detail.variant === "account" ? (detail.account_type === "cash" ? Wallet : Landmark)
    : detail.variant === "client" ? Users
    : detail.variant === "category" ? Tag
    : detail.variant === "period" ? CalendarClock
    : Sparkles
  return (
    <div role="dialog" aria-modal="true" aria-label={detail.title} onClick={onClose} className="absolute inset-0 z-30 flex items-end justify-center bg-background/50 p-4 backdrop-blur-[2px] sm:items-center">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm overflow-hidden rounded-2xl border bg-card shadow-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200">
        <div className="flex items-start gap-3 border-b p-4">
          <NodeLogo src={detail.logo_src} className="size-11" chipClass="bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/20" fallback={<Glyph className="size-5" />} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{detail.title}</p>
            <p className="text-xs text-muted-foreground">{detail.kindLabel}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("flow.close")} className="-mr-1 -mt-1 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
        </div>
        <dl className="divide-y">
          {detail.rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className={cn("font-semibold tabular-nums", r.tone === "income" && "text-emerald-600 dark:text-emerald-400", r.tone === "expense" && "text-rose-600 dark:text-rose-400")}>{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t p-3">
          <Button className="w-full" onClick={detail.onGo}>{detail.goLabel} <ArrowUpRight className="size-4" /></Button>
        </div>
      </div>
    </div>
  )
}

const GROUP_BYS: GroupBy[] = ["account", "client", "category"]

// ── Session persistence ──────────────────────────────────────────────────────
type SavedFlowState = {
  viewMode?: "grouped" | "timeline"
  bucket?: "day" | "week" | "month" | "year"
  groupBy?: GroupBy
  from?: string
  to?: string
  cats?: string[]
  clients?: string[]
  accounts?: string[]
  rootCollapsed?: boolean
  expanded?: string[]
  positions?: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
  // Inline "load more" pages — so a reload (or a round-trip to the detail page)
  // restores the exact canvas (expanded transactions) you left.
  extra?: Record<string, FlowLeaf[]>
  exhausted?: string[]
}

function readSavedFlow(key: string): SavedFlowState {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as SavedFlowState) : {}
  } catch {
    return {}
  }
}
function writeSavedFlow(key: string, state: SavedFlowState) {
  try {
    sessionStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export function MoneyFlowPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const { revision } = useDataRefresh()
  const { theme } = useTheme()
  const isMobile = useIsMobile()
  const isPersonal = activeOrg?.account_type === "personal"
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")

  // React Flow themes its chrome (controls/minimap/background) from colorMode.
  // Resolve "system" so it always matches the app's actual light/dark state.
  const colorMode: ColorMode = useMemo(() => {
    if (theme === "light" || theme === "dark") return theme
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark"
    return "light"
  }, [theme])

  // ── State preservation across navigation (nav rule: restore on back) ────────
  const storageKey = `ps_flow_${activeOrg?.id ?? "none"}`
  const saved = useMemo<SavedFlowState>(() => readSavedFlow(storageKey), [storageKey])

  const [data, setData] = useState<FlowData | TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<"grouped" | "timeline">(saved.viewMode ?? "grouped")
  const [bucket, setBucket] = useState<"day" | "week" | "month" | "year">(saved.bucket ?? "month")
  const [groupBy, setGroupBy] = useState<GroupBy>(saved.groupBy ?? (isPersonal ? "category" : "client"))
  const [from, setFrom] = useState(saved.from ?? "")
  const [to, setTo] = useState(saved.to ?? "")
  const [selCats, setSelCats] = useState<Set<string>>(new Set(saved.cats ?? []))
  const [selClients, setSelClients] = useState<Set<string>>(new Set(saved.clients ?? []))
  const [selAccounts, setSelAccounts] = useState<Set<string>>(new Set(saved.accounts ?? []))
  const [catOptions, setCatOptions] = useState<Option[]>([])
  const [clientOptions, setClientOptions] = useState<Option[]>([])
  const [accountOptions, setAccountOptions] = useState<Option[]>([])
  const [rootCollapsed, setRootCollapsed] = useState(saved.rootCollapsed ?? false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(saved.expanded ?? []))
  const [dataVersion, setDataVersion] = useState(0)
  // Inline "load more": extra leaf batches fetched on demand, keyed by group/
  // period mkey; `exhausted` marks keys with no further pages to fetch. Both
  // reset whenever a fresh dataset arrives (they belong to the previous query),
  // EXCEPT the very first load after a restore — see skipFirstExtraClear.
  const [extraLeaves, setExtraLeaves] = useState<Record<string, FlowLeaf[]>>(saved.extra ?? {})
  const [exhausted, setExhausted] = useState<Set<string>>(new Set(saved.exhausted ?? []))
  // The transaction shown in the in-canvas detail popup (null = closed). Kept
  // transient (NOT persisted) so a reload never reopens a stale/deleted-tx
  // snapshot — the canvas position/state it sat over is what persists.
  const [selectedTx, setSelectedTx] = useState<FlowLeaf | null>(null)
  // The node whose Info button was tapped → its detail modal (transient).
  const [detailNode, setDetailNode] = useState<NodeDetail | null>(null)

  // Dragged node positions (id → {x,y}); survive rebuilds AND navigation.
  const userPositions = useRef<Record<string, { x: number; y: number }>>(saved.positions ?? {})
  const savedViewport = useRef(saved.viewport ?? null)
  const skipNextFit = useRef(!!saved.viewport)
  // dataVersion mirror so an in-flight "load more" can detect that a fresh
  // dataset (filter/mode change) landed mid-fetch and discard its stale page.
  const dataVersionRef = useRef(0)
  dataVersionRef.current = dataVersion
  // Which "+N more" nodes have a load in flight — read during rebuilds so an
  // unrelated rebuild (expanding another group) doesn't wipe the spinner.
  const loadingKeysRef = useRef<Set<string>>(new Set())

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

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true)
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
      if (!silent) toast.error(t("flow.loadFailed"))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [getToken, viewMode, bucket, groupBy, from, to, selCats, selClients, selAccounts, t])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (revision > 0) void load({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the signal
  }, [revision])

  // Inline-loaded pages belong to ONE query. Drop them only when the query
  // itself changes (filters/mode/groupBy/bucket) — NOT on mount, remount, or a
  // same-query silent refresh — so a restored/expanded canvas survives a reload.
  const querySig = useMemo(
    () => [viewMode, groupBy, bucket, from, to, [...selCats].sort().join(","), [...selClients].sort().join(","), [...selAccounts].sort().join(",")].join("|"),
    [viewMode, groupBy, bucket, from, to, selCats, selClients, selAccounts],
  )
  const prevQuerySig = useRef(querySig)
  useEffect(() => {
    if (prevQuerySig.current === querySig) return
    prevQuerySig.current = querySig
    setExtraLeaves({})
    setExhausted(new Set())
    loadingKeysRef.current.clear()
  }, [querySig])

  const flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)

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

  const openTransactions = useCallback((category?: string) => {
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    if (category) params.set("category", category)
    navigate(`/transactions${params.toString() ? `?${params}` : ""}`)
  }, [navigate, from, to])
  const openMoreForGroup = useCallback((g: FlowGroup) => {
    if (g.kind === "client" && g.key) { navigate(`/clients/${g.key}`); return }
    if (g.kind === "account" && g.key) { navigate(`/wealth/${g.key}`); return }
    // Category groups carry their filter through to the list (Uncategorized has
    // no concrete category value, so it just opens the date-filtered list).
    if (g.kind === "category" && g.key && g.key !== "Uncategorized") { openTransactions(g.key); return }
    openTransactions()
  }, [navigate, openTransactions])
  // Clicking a transaction pops its details up ON the canvas (no navigation) so
  // you keep your place; the popup's "View full details" deep-links to the list.
  const openLeaf = useCallback((leaf: FlowLeaf) => setSelectedTx(leaf), [])
  const closeTx = useCallback(() => setSelectedTx(null), [])
  const viewTxDetails = useCallback((id: string) => navigate(`/transactions?view=${id}`), [navigate])
  // Workspace node → the dashboard (its "entity").
  const openWorkspace = useCallback(() => navigate("/dashboard"), [navigate])
  // Timeline period node → the transactions list scoped to that period's dates.
  const openPeriod = useCallback((p: TimelinePeriod) => {
    const start = new Date(`${p.key}T00:00:00`)
    const end = new Date(start)
    if (p.bucket === "week") end.setDate(start.getDate() + 6)
    else if (p.bucket === "month") { end.setMonth(start.getMonth() + 1); end.setDate(0) }
    else if (p.bucket === "year") { end.setMonth(11); end.setDate(31) }
    const pad = (n: number) => String(n).padStart(2, "0")
    const iso = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
    navigate(`/transactions?from=${p.key}&to=${iso(end)}`)
  }, [navigate])
  // Device/browser Back closes the popup without leaving /flow (and the flow
  // state persists, so a later Back from the detail page restores this exact view).
  useBackClose(!!selectedTx, closeTx)
  const closeDetail = useCallback(() => setDetailNode(null), [])
  useBackClose(!!detailNode, closeDetail)

  // Build the detail-modal content for a node (figures + a "go to its page" action).
  const buildDetail = useCallback((n: { type?: string; data: Record<string, unknown> }): NodeDetail | null => {
    const money = (v: number) => formatMoney(v, currency)
    const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatMoney(Math.abs(v), currency)}`
    const tone = (v: number): "income" | "expense" => (v >= 0 ? "income" : "expense")
    switch (n.type) {
      case "branch": {
        const g = n.data as unknown as FlowGroup
        const acc = g.kind === "account" && g.current_balance != null
        return {
          title: g.label,
          kindLabel: g.kind === "account" ? t("flow.kindAccount") : g.kind === "client" ? t("flow.kindClient") : t("flow.kindCategory"),
          logo_src: g.logo_src,
          variant: g.kind,
          account_type: g.account_type,
          rows: [
            { label: t("flow.revenue"), value: `+${money(g.income)}`, tone: "income" },
            { label: t("flow.expenses"), value: `−${money(g.expense)}`, tone: "expense" },
            { label: t("flow.net"), value: signed(g.net), tone: tone(g.net) },
            { label: t("flow.txCount"), value: String(g.tx_count) },
            ...(acc ? [{ label: t("flow.opening"), value: money(g.opening_balance ?? 0) }, { label: t("flow.current"), value: money(g.current_balance ?? 0) }] : []),
          ],
          goLabel: g.kind === "category" ? t("flow.viewTransactions") : t("flow.openPage"),
          onGo: () => openMoreForGroup(g),
        }
      }
      case "tlperiod": {
        const p = n.data as unknown as TimelinePeriod
        return {
          title: formatPeriod(p.key, p.bucket),
          kindLabel: t("flow.kindPeriod"),
          variant: "period",
          rows: [
            { label: t("flow.before"), value: money(p.before) },
            { label: t("flow.in"), value: `+${money(p.income)}`, tone: "income" },
            { label: t("flow.out"), value: `−${money(p.expense)}`, tone: "expense" },
            { label: t("flow.net"), value: signed(p.net), tone: tone(p.net) },
            { label: t("flow.after"), value: money(p.after) },
            { label: t("flow.txCount"), value: String(p.tx_count) },
          ],
          goLabel: t("flow.viewTransactions"),
          onGo: () => openPeriod(p),
        }
      }
      case "root": {
        const r = n.data as { label: string; income: number; expense: number; net: number; tx_count: number; balance: number }
        return {
          title: r.label, kindLabel: t("flow.kindWorkspace"), variant: "workspace", logo_src: activeOrg?.logo_src ?? null,
          rows: [
            { label: t("flow.revenue"), value: `+${money(r.income)}`, tone: "income" },
            { label: t("flow.expenses"), value: `−${money(r.expense)}`, tone: "expense" },
            { label: t("flow.net"), value: signed(r.net), tone: tone(r.net) },
            { label: t("flow.balance"), value: money(r.balance) },
            { label: t("flow.txCount"), value: String(r.tx_count) },
          ],
          goLabel: t("flow.openDashboard"), onGo: openWorkspace,
        }
      }
      case "tlfinal": {
        const f = n.data as TimelineData["final"]
        return {
          title: f.label, kindLabel: t("flow.kindWorkspace"), variant: "workspace", logo_src: activeOrg?.logo_src ?? null,
          rows: [
            { label: t("flow.revenue"), value: `+${money(f.total_in)}`, tone: "income" },
            { label: t("flow.expenses"), value: `−${money(f.total_out)}`, tone: "expense" },
            { label: t("flow.netTotal"), value: signed(f.total_net), tone: tone(f.total_net) },
            { label: t("flow.balance"), value: money(f.balance) },
          ],
          goLabel: t("flow.openDashboard"), onGo: openWorkspace,
        }
      }
      default:
        return null
    }
  }, [currency, t, formatPeriod, openMoreForGroup, openPeriod, openWorkspace, activeOrg])

  // ── Controlled nodes/edges so user DRAGS persist between structural rebuilds ─
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Flip a single "+N more" node's spinner: update the in-flight set (so
  // rebuilds preserve it) AND patch the live node (so it shows without a rebuild).
  const markLoading = useCallback((mkey: string, isLoading: boolean) => {
    if (isLoading) loadingKeysRef.current.add(mkey)
    else loadingKeysRef.current.delete(mkey)
    setNodes((nds) => nds.map((n) => (n.type === "more" && (n.data as { mkey?: string }).mkey === mkey ? { ...n, data: { ...n.data, loading: isLoading } } : n)))
  }, [setNodes])

  // Fetch the NEXT page of leaves for one group/period and stash it under its
  // mkey; the rebuild this triggers grows the leaf stack inline. No camera move.
  const loadMore = useCallback(async (info: { mkey: string; rawKey: string; offset: number; isTimeline: boolean }) => {
    markLoading(info.mkey, true)
    const rev = dataVersionRef.current // detect a fresh dataset landing mid-fetch
    try {
      const token = await getToken()
      if (!token) { markLoading(info.mkey, false); return }
      const params = new URLSearchParams()
      params.set("leaves", "1")
      if (info.isTimeline) { params.set("mode", "timeline"); params.set("bucket", bucket) }
      else params.set("groupBy", groupBy)
      params.set("key", info.rawKey)
      params.set("offset", String(info.offset))
      params.set("limit", "12")
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      if (selCats.size) params.set("category", [...selCats].join(","))
      if (selClients.size) params.set("clientId", [...selClients].join(","))
      if (selAccounts.size) params.set("accountId", [...selAccounts].join(","))
      const resp = await apiGet<{ leaves: FlowLeaf[]; has_more: boolean }>(`/api/flow?${params}`, token)
      // Filters/mode changed while this was in flight → the page belongs to a
      // stale query; drop it rather than merging mismatched leaves.
      if (rev !== dataVersionRef.current) { markLoading(info.mkey, false); return }
      if (resp.leaves.length === 0) {
        setExhausted((prev) => new Set(prev).add(info.mkey))
        markLoading(info.mkey, false)
        return
      }
      markLoading(info.mkey, false) // clear the spinner; the rebuild below shows the new leaves
      setExtraLeaves((prev) => ({ ...prev, [info.mkey]: [...(prev[info.mkey] ?? []), ...resp.leaves] }))
      if (!resp.has_more) setExhausted((prev) => new Set(prev).add(info.mkey))
    } catch {
      toast.error(t("flow.loadFailed"))
      markLoading(info.mkey, false)
    }
  }, [markLoading, getToken, bucket, groupBy, from, to, selCats, selClients, selAccounts, t])

  // Rebuild + re-fit only when the STRUCTURE changes — NOT on drag/hover. The
  // extra-leaf and exhausted signatures are folded in so inline "load more"
  // rebuilds the graph (but, like expand/collapse, never re-frames the camera).
  const extraSig = useMemo(() => Object.entries(extraLeaves).map(([k, v]) => `${k}:${v.length}`).sort().join(","), [extraLeaves])
  const structuralKey = useMemo(() => {
    if (!data) return "none"
    return [viewMode, groupBy, bucket, dataVersion, rootCollapsed, [...expanded].sort().join(","), extraSig, [...exhausted].sort().join(",")].join("|")
  }, [data, viewMode, groupBy, bucket, dataVersion, rootCollapsed, expanded, extraSig, exhausted])

  useEffect(() => {
    if (!data) { setNodes([]); setEdges([]); return }
    const augmented = applyExtraLeaves(data, extraLeaves)
    const built =
      augmented.mode === "timeline"
        ? buildTimelineGraph(augmented, expanded)
        : buildFlowGraph(augmented, { rootCollapsed, expanded })
    const rf: Node[] = built.nodes.map((n) => {
      const position = userPositions.current[n.id] ?? n.position
      switch (n.type) {
        case "root": {
          const toggle = () => setRootCollapsed((c) => !c)
          // card click toggles collapse-all; the Info button opens the detail modal
          return { ...n, position, data: { ...n.data, currency, logo_src: activeOrg?.logo_src ?? null, onToggle: toggle, onOpen: toggle, onDetail: () => { const d = buildDetail(n); if (d) setDetailNode(d) } } } as Node
        }
        case "branch": {
          const g = n.data as unknown as FlowGroup
          const toggle = () => toggleKey(groupKeyId(g))
          return { ...n, position, data: { ...n.data, currency, onToggle: toggle, onOpen: toggle, onDetail: () => { const d = buildDetail(n); if (d) setDetailNode(d) } } } as Node
        }
        case "tlperiod": {
          const p = n.data as unknown as TimelinePeriod
          const toggle = () => toggleKey(p.key)
          return { ...n, position, data: { ...n.data, currency, formatPeriod, onToggle: toggle, onOpen: toggle, onDetail: () => { const d = buildDetail(n); if (d) setDetailNode(d) } } } as Node
        }
        case "tlfinal": {
          // not expandable → a card click opens its detail modal too
          const openDetail = () => { const d = buildDetail(n); if (d) setDetailNode(d) }
          return { ...n, position, data: { ...n.data, currency, logo_src: activeOrg?.logo_src ?? null, onOpen: openDetail, onDetail: openDetail } } as Node
        }
        case "leaf": {
          const leaf = n.data as unknown as FlowLeaf
          return { ...n, position, data: { ...n.data, currency, formatDate, onOpen: () => openLeaf(leaf) } } as Node
        }
        case "more": {
          const md = n.data as { group?: FlowGroup; period?: TimelinePeriod; mkey: string }
          const g = md.group
          const p = md.period
          // The group/period here is already augmented, so its leaf count IS the
          // number currently on-canvas → the offset for the next page.
          const shown = g ? g.leaves.length : p ? p.leaves.length : 0
          return {
            ...n,
            position,
            data: {
              ...n.data,
              // preserve an in-flight spinner across unrelated rebuilds
              loading: loadingKeysRef.current.has(md.mkey),
              exhausted: exhausted.has(md.mkey),
              onLoadMore: () => loadMore({ mkey: md.mkey, rawKey: g ? (g.key ?? "__none__") : p ? p.key : "", offset: shown, isTimeline: !!p }),
              onOpenList: () => (g ? openMoreForGroup(g) : openTransactions()),
            },
          } as Node
        }
        default:
          return { ...n, position } as Node
      }
    })
    setNodes(rf)
    setEdges(built.edges.map((e) => ({ ...e, type: "flow" })) as Edge[])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- structuralKey is the intentional trigger
  }, [structuralKey])

  // Re-fit ONLY when the data set itself changes — never on expand/collapse.
  useEffect(() => {
    if (dataVersion === 0) return
    if (skipNextFit.current) { skipNextFit.current = false; return }
    const id = requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.2, maxZoom: 1, duration: 400 }))
    return () => cancelAnimationFrame(id)
  }, [dataVersion])

  useEffect(() => {
    writeSavedFlow(storageKey, {
      viewMode, bucket, groupBy, from, to,
      cats: [...selCats], clients: [...selClients], accounts: [...selAccounts],
      rootCollapsed, expanded: [...expanded],
      positions: userPositions.current,
      viewport: savedViewport.current ?? undefined,
      extra: extraLeaves, exhausted: [...exhausted],
    })
  }, [storageKey, viewMode, bucket, groupBy, from, to, selCats, selClients, selAccounts, rootCollapsed, expanded, extraLeaves, exhausted])

  // Timestamp of the last drag end. A dragged node tracks the cursor, so
  // pointerdown and pointerup land on the same card and the browser CAN emit a
  // trailing `click` — which would wrongly open the transaction. We suppress any
  // click that lands within a short window after a drag.
  const lastDragEndRef = useRef(0)
  const onNodeDragStop = useCallback((_e: unknown, node: Node) => {
    lastDragEndRef.current = performance.now()
    userPositions.current[node.id] = node.position
    writeSavedFlow(storageKey, { ...readSavedFlow(storageKey), positions: userPositions.current })
  }, [storageKey])
  const onMoveEnd = useCallback((_e: unknown, vp: { x: number; y: number; zoom: number }) => {
    savedViewport.current = vp
    writeSavedFlow(storageKey, { ...readSavedFlow(storageKey), viewport: vp })
  }, [storageKey])

  // ── Hover focus: light up a node's money path, dim the rest ─────────────────
  const canHover = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(hover: hover)").matches, [])
  const [focus, setFocus] = useState<FocusState>(null)
  // Read the latest edges through a ref so the handler stays stable (deps:
  // [canHover]) yet never closes over a stale edge set after a rebuild.
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  const onNodeMouseEnter = useCallback((_e: unknown, node: Node) => {
    if (!canHover) return
    const active = new Set<string>([node.id])
    const edgeIds = new Set<string>()
    for (const e of edgesRef.current) {
      if (e.source === node.id || e.target === node.id) {
        edgeIds.add(e.id)
        active.add(e.source)
        active.add(e.target)
      }
    }
    setFocus({ active, edges: edgeIds })
  }, [canHover])
  const onNodeMouseLeave = useCallback(() => setFocus(null), [])

  // Clicking ANY node opens its entity (leaf → tx popup; account/client/category
  // → that page; period → its transactions; workspace → dashboard). We act only
  // on a real click that did NOT just conclude a drag. detail === 0 (keyboard)
  // is handled by the leaf's own button; the "+N more" node has its own buttons.
  const onNodeClick = useCallback((e: { detail: number }, node: Node) => {
    if (e.detail === 0) return
    if (node.type === "more") return
    if (performance.now() - lastDragEndRef.current < 250) return
    ;(node.data as { onOpen?: () => void }).onOpen?.()
  }, [])

  const activeFilterCount = selCats.size + selClients.size + selAccounts.size + (from ? 1 : 0) + (to ? 1 : 0)
  const empty = !loading && data && (data.mode === "timeline" ? data.periods.length === 0 : data.root.tx_count === 0)
  const clearFilters = useCallback(() => { setFrom(""); setTo(""); setSelCats(new Set()); setSelClients(new Set()); setSelAccounts(new Set()) }, [])

  // Expand / collapse ALL transaction lists at once (canvas control).
  const expandableKeys = useMemo(() => {
    if (!data) return [] as string[]
    return data.mode === "timeline"
      ? data.periods.filter((p) => p.tx_count > 0).map((p) => p.key)
      : data.groups.filter((g) => g.tx_count > 0).map((g) => groupKeyId(g))
  }, [data])
  const allExpanded = expandableKeys.length > 0 && expandableKeys.every((k) => expanded.has(k))
  const toggleExpandAll = useCallback(() => {
    if (allExpanded) setExpanded(new Set())
    else { setRootCollapsed(false); setExpanded(new Set(expandableKeys)) }
  }, [allExpanded, expandableKeys])

  const filterPanel = (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">{t("flow.dateRange")}</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="flow-from" className="text-[11px] text-muted-foreground">{t("flow.from")}</Label>
            <Input id="flow-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="flow-to" className="text-[11px] text-muted-foreground">{t("flow.to")}</Label>
            <Input id="flow-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9" />
          </div>
        </div>
      </div>
      <MultiCheck label={t("flow.categories")} searchPlaceholder={t("flow.searchCategories")} options={catOptions} selected={selCats} onChange={setSelCats} />
      {hasClients && <MultiCheck label={t("flow.clients")} searchPlaceholder={t("flow.searchClients")} options={clientOptions} selected={selClients} onChange={setSelClients} />}
      <MultiCheck label={t("flow.accounts")} searchPlaceholder={t("flow.searchAccounts")} options={accountOptions} selected={selAccounts} onChange={setSelAccounts} />
      {activeFilterCount > 0 && (
        <Button variant="outline" size="sm" className="w-full" onClick={clearFilters}>
          <X className="size-3.5" /> {t("flow.clearFilters")}
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
            <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm"><Sparkles className="size-4" /></span>
            {t("flow.title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{viewMode === "timeline" ? t("flow.timelineSubtitle") : t("flow.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View-mode toggle: grouped mind-map vs running-balance timeline */}
          <div className="flex rounded-xl border bg-card p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => { setViewMode("grouped"); setExpanded(new Set()); setRootCollapsed(false) }}
              aria-pressed={viewMode === "grouped"}
              className={cn("flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "grouped" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
            >
              <Network className="size-3.5" /> {t("flow.viewGrouped")}
            </button>
            <button
              type="button"
              onClick={() => { setViewMode("timeline"); setExpanded(new Set()) }}
              aria-pressed={viewMode === "timeline"}
              className={cn("flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors", viewMode === "timeline" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
            >
              <CalendarClock className="size-3.5" /> {t("flow.viewTimeline")}
            </button>
          </div>
          {/* Grouped: dimension switch. Timeline: bucket switch. */}
          {viewMode === "grouped" ? (
            <div className="flex rounded-xl border bg-card p-0.5 shadow-sm">
              {GROUP_BYS.filter((g) => g !== "client" || hasClients).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => { setGroupBy(g); setExpanded(new Set()); setRootCollapsed(false) }}
                  aria-pressed={groupBy === g}
                  className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors", groupBy === g ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
                >
                  {t(`flow.by_${g}` as const)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex rounded-xl border bg-card p-0.5 shadow-sm">
              {BUCKETS.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => { setBucket(b); setExpanded(new Set()) }}
                  aria-pressed={bucket === b}
                  className={cn("rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors", bucket === b ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted")}
                >
                  {t(`flow.bucket_${b}` as const)}
                </button>
              ))}
            </div>
          )}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 rounded-xl">
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

      {/* ps-flow scopes the node transform-transition + canvas theming */}
      <div className="ps-flow relative mt-4 min-h-0 flex-1 overflow-hidden rounded-3xl border bg-muted/20 shadow-inner">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <span className="grid size-14 place-items-center rounded-2xl bg-muted/60"><Sparkles className="size-7 opacity-50" /></span>
            <p className="text-sm font-medium">{t("flow.empty")}</p>
            <p className="max-w-xs text-xs">{t("flow.emptyHint")}</p>
          </div>
        ) : !data ? (
          // First load: a light, fast placeholder (not a full-screen skeleton) —
          // the chrome above is already interactive; the graph fades in below.
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-xs">{t("flow.loadingFlow")}</p>
          </div>
        ) : (
          <div className="h-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-[0.99] motion-safe:duration-500">
            <FocusContext.Provider value={focus}>
              <ReactFlow
                onInit={(inst) => { flowRef.current = inst }}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                onMoveEnd={onMoveEnd}
                onNodeMouseEnter={onNodeMouseEnter}
                onNodeMouseLeave={onNodeMouseLeave}
                onNodeClick={onNodeClick}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                colorMode={colorMode}
                {...(savedViewport.current ? { defaultViewport: savedViewport.current } : { fitView: true })}
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                minZoom={0.2}
                maxZoom={1.5}
                nodeDragThreshold={3}
                nodesDraggable
                elementsSelectable
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
                defaultEdgeOptions={{ type: "flow" }}
              >
                <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} />
                <Controls showInteractive={false} className="!rounded-xl !border !shadow-lg" />
                {!isMobile && (
                  <MiniMap
                    pannable
                    zoomable
                    className="!rounded-xl !border !shadow-lg"
                    maskColor="var(--mf-minimap-mask)"
                    nodeColor={(n) => minimapNodeColor(colorMode, n)}
                    nodeStrokeWidth={0}
                    nodeBorderRadius={8}
                  />
                )}
                {/* Expand / collapse every transaction list at once. */}
                {expandableKeys.length > 0 && (
                  <Panel position="top-right" className="!m-3">
                    <button
                      type="button"
                      onClick={toggleExpandAll}
                      className="flex items-center gap-1.5 rounded-xl border bg-card/90 px-3 py-1.5 text-[11px] font-medium shadow-sm backdrop-blur-sm transition-colors hover:bg-muted"
                    >
                      {allExpanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                      {allExpanded ? t("flow.collapseAll") : t("flow.expandAll")}
                    </button>
                  </Panel>
                )}
                {!isMobile && (
                  <Panel position="top-left" className="!m-3">
                    <div className="flex items-center gap-3 rounded-xl border bg-card/80 px-3 py-1.5 text-[11px] shadow-sm backdrop-blur-sm">
                      <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-emerald-500" />{t("flow.in")}</span>
                      <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-rose-500" />{t("flow.out")}</span>
                      <span className="hidden text-muted-foreground sm:inline">·</span>
                      <span className="hidden text-muted-foreground sm:inline">{t("flow.legendThickness")}</span>
                    </div>
                  </Panel>
                )}
              </ReactFlow>
            </FocusContext.Provider>
          </div>
        )}
        {selectedTx && (
          <TxPopup leaf={selectedTx} currency={currency} formatDate={formatDate} onViewDetails={viewTxDetails} onClose={closeTx} />
        )}
        {detailNode && <NodeDetailModal detail={detailNode} onClose={closeDetail} />}
      </div>
    </div>
  )
}
