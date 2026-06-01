import { useTranslation } from "react-i18next"
import { Area, AreaChart, ResponsiveContainer } from "recharts"
import { ArrowDownLeft, ArrowUpRight, TrendingUp } from "lucide-react"
import { cn } from "../lib/cn"

const TREND = [
  { v: 22 }, { v: 28 }, { v: 25 }, { v: 34 }, { v: 31 }, { v: 42 },
  { v: 38 }, { v: 49 }, { v: 46 }, { v: 58 }, { v: 63 }, { v: 72 },
]

// Emerald — the exact accent the app already uses for positive money (e.g.
// text-emerald-500, paid invoice badges). Not the logo green.
const EMERALD = "#10b981"

function Row({
  kind,
  label,
  client,
  amount,
}: {
  kind: "in" | "out"
  label: string
  client: string
  amount: string
}) {
  const incoming = kind === "in"
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          incoming
            ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {incoming ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{client}</p>
      </div>
      <span
        className={cn(
          "ps-tnum shrink-0 text-[13px] font-semibold",
          incoming ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/70",
        )}
      >
        {amount}
      </span>
    </div>
  )
}

export function DashboardMockup() {
  const { t } = useTranslation()
  const m = (k: string) => t(`hero.mockup.${k}`)

  return (
    <div className="relative">
      {/* Floating accent chip for depth */}
      <div className="ps-animate-float absolute -start-4 top-16 z-20 hidden rounded-2xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur sm:block">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="size-5" />
          </span>
          <div>
            <p className="ps-tnum text-sm font-bold text-foreground">+24%</p>
            <p className="text-[11px] text-muted-foreground">{m("thisMonth")}</p>
          </div>
        </div>
      </div>

      {/* App window */}
      <div className="relative overflow-hidden rounded-[1.4rem] border border-border bg-card shadow-2xl ring-1 ring-black/5 dark:ring-white/5">
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
          </span>
          <div className="mx-auto flex items-center gap-1.5 rounded-md bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground ring-1 ring-border">
            app.profitsync.net/dashboard
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <p className="ps-display text-sm font-semibold text-foreground">{m("appLabel")}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{m("thisMonth")}</span>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <p className="text-[11px] text-muted-foreground">{m("revenue")}</p>
              <p className="ps-tnum mt-1 text-xl font-bold text-foreground">$48,210</p>
              <p className="ps-tnum mt-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                ▲ 18.2%
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <p className="text-[11px] text-muted-foreground">{m("netProfit")}</p>
              <p className="ps-tnum mt-1 text-xl font-bold text-foreground">$21,540</p>
              <p className="ps-tnum mt-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                ▲ 24.0%
              </p>
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-xl border border-border bg-background/60 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">{m("revenue")}</span>
              <span className="ps-tnum text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {m("up")} 24%
              </span>
            </div>
            <div className="h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={TREND} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="ps-hero-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={EMERALD} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={EMERALD}
                    strokeWidth={2.25}
                    fill="url(#ps-hero-grad)"
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent transactions */}
          <div className="rounded-xl border border-border bg-background/60 px-3 py-1.5">
            <p className="py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {m("recent")}
            </p>
            <div className="divide-y divide-border">
              <Row kind="in" label={m("designRetainer")} client={`${m("client")} · Northwind`} amount="+ $4,500" />
              <Row kind="out" label={m("softwareLicense")} client={m("expense")} amount="− $89" />
              <Row kind="in" label={m("consulting")} client={`${m("client")} · Lumen`} amount="+ $2,200" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
