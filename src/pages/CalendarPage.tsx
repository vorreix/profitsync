import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, ExternalLink, Repeat } from "lucide-react"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import type { Transaction } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type DayAgg = { date: string; incoming: number; outgoing: number; count: number }
type CalendarResponse = { days: DayAgg[]; summary: { incoming: number; outgoing: number; count: number } }
type Granularity = "month" | "week" | "day"

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const parseIso = (s: string) => new Date(`${s}T00:00:00`)

/** The Monday of the week containing `d` (ISO weeks). */
function startOfWeek(d: Date): Date {
  const out = new Date(d)
  out.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(d.getDate() + n)
  return out
}

export function CalendarPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()

  const [granularity, setGranularity] = useState<Granularity>("month")
  // The anchor date the current view is centered on.
  const [anchor, setAnchor] = useState(() => new Date())
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  // Drill-down modal: the [from, to] range being inspected.
  const [inspect, setInspect] = useState<{ from: string; to: string; label: string } | null>(null)
  const [inspectTx, setInspectTx] = useState<Transaction[] | null>(null)

  const todayIso = iso(new Date())

  // The fetched range always covers the visible grid (incl. leading/trailing
  // days of adjacent months so the month grid's edge cells have data).
  const range = useMemo(() => {
    if (granularity === "month") {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      return { from: iso(startOfWeek(first)), to: iso(addDays(startOfWeek(last), 6)) }
    }
    if (granularity === "week") {
      const start = startOfWeek(anchor)
      return { from: iso(start), to: iso(addDays(start, 6)) }
    }
    return { from: iso(anchor), to: iso(anchor) }
  }, [granularity, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      setData(await apiGet<CalendarResponse>(`/api/calendar?from=${range.from}&to=${range.to}`, token))
    } catch {
      toast.error(t("calendar.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [getToken, range.from, range.to, t])

  useEffect(() => { load() }, [load])

  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data])
  const maxDayTotal = useMemo(
    () => Math.max(1, ...(data?.days ?? []).map((d) => d.incoming + d.outgoing)),
    [data],
  )

  // Sum the visible period (month view excludes adjacent-month edge cells).
  const periodSummary = useMemo(() => {
    const inMonth = (date: string) => {
      if (granularity !== "month") return date >= range.from && date <= range.to
      const d = parseIso(date)
      return d.getMonth() === anchor.getMonth() && d.getFullYear() === anchor.getFullYear()
    }
    let incoming = 0, outgoing = 0, count = 0
    for (const d of data?.days ?? []) {
      if (!inMonth(d.date)) continue
      incoming += d.incoming; outgoing += d.outgoing; count += d.count
    }
    return { incoming, outgoing, count }
  }, [data, granularity, anchor, range])

  function step(direction: 1 | -1) {
    setAnchor((prev) => {
      if (granularity === "month") return new Date(prev.getFullYear(), prev.getMonth() + direction, 1)
      return addDays(prev, (granularity === "week" ? 7 : 1) * direction)
    })
  }

  async function openInspect(from: string, to: string, label: string) {
    setInspect({ from, to, label })
    setInspectTx(null)
    try {
      const token = await getToken()
      if (!token) return
      // `?limit=` without `?page=` returns a bare array (the dashboard shape).
      const resp = await apiGet<Transaction[] | { data: Transaction[] }>(
        `/api/transactions?from=${from}&to=${to}&limit=50`,
        token,
      )
      setInspectTx(Array.isArray(resp) ? resp : (resp.data ?? []))
    } catch {
      setInspectTx([])
    }
  }

  const fmtDay = (s: string) => parseIso(s).toLocaleDateString(i18n.language, { weekday: "short", day: "numeric", month: "short" })
  const monthTitle = anchor.toLocaleDateString(i18n.language, { month: "long", year: "numeric" })
  const weekTitle = `${parseIso(range.from).toLocaleDateString(i18n.language, { day: "numeric", month: "short" })} – ${parseIso(range.to).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })}`
  const dayTitle = anchor.toLocaleDateString(i18n.language, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const title = granularity === "month" ? monthTitle : granularity === "week" ? weekTitle : dayTitle

  // Localized Mon–Sun headers derived from a known Monday.
  const weekdayLabels = useMemo(() => {
    const monday = startOfWeek(new Date(2024, 0, 8))
    return Array.from({ length: 7 }, (_, i) =>
      addDays(monday, i).toLocaleDateString(i18n.language, { weekday: "narrow" }),
    )
  }, [i18n.language])

  const monthDays = useMemo(() => {
    if (granularity !== "month") return []
    const out: { date: string; inMonth: boolean }[] = []
    let cur = parseIso(range.from)
    const end = parseIso(range.to)
    while (cur <= end) {
      out.push({ date: iso(cur), inMonth: cur.getMonth() === anchor.getMonth() })
      cur = addDays(cur, 1)
    }
    return out
  }, [granularity, range, anchor])

  const weekDays = useMemo(() => {
    if (granularity !== "week") return []
    return Array.from({ length: 7 }, (_, i) => iso(addDays(parseIso(range.from), i)))
  }, [granularity, range])

  const summaryBar = (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: t("calendar.incoming"), value: periodSummary.incoming, cls: "text-emerald-600 dark:text-emerald-400" },
        { label: t("calendar.outgoing"), value: periodSummary.outgoing, cls: "text-red-600 dark:text-red-400" },
        { label: t("calendar.transactions"), value: periodSummary.count, cls: "", isCount: true },
      ].map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => openInspect(granularity === "month" ? iso(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : range.from, granularity === "month" ? iso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)) : range.to, title)}
          className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-20" />
          ) : (
            <p className={cn("mt-0.5 truncate text-base font-bold tabular-nums sm:text-lg", s.cls)}>
              {"isCount" in s && s.isCount ? s.value : formatMoney(s.value, currency)}
            </p>
          )}
        </button>
      ))}
    </div>
  )

  const intensity = (d: DayAgg | undefined) => {
    if (!d || d.count === 0) return 0
    return Math.min(1, (d.incoming + d.outgoing) / maxDayTotal)
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("calendar.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("calendar.subtitle")}</p>
        </div>
        {/* Granularity switch */}
        <div className="flex rounded-lg border p-0.5">
          {(["month", "week", "day"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              aria-pressed={granularity === g}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                granularity === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(`calendar.${g}` as const)}
            </button>
          ))}
        </div>
      </div>

      {/* Period nav */}
      <div className="flex items-center justify-between gap-2">
        <Button size="icon" variant="outline" aria-label={t("calendar.previous")} onClick={() => step(-1)}>
          <ChevronLeft className="size-4 rtl:rotate-180" />
        </Button>
        <button
          type="button"
          className="min-w-0 truncate text-sm font-semibold hover:underline"
          onClick={() => setAnchor(new Date())}
          title={t("calendar.backToToday")}
        >
          {title}
        </button>
        <Button size="icon" variant="outline" aria-label={t("calendar.next")} onClick={() => step(1)}>
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>

      {summaryBar}

      {/* ── MONTH GRID ──────────────────────────────────────────────────── */}
      {granularity === "month" && (
        <div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {weekdayLabels.map((w, i) => <div key={i} className="py-1">{w}</div>)}
          </div>
          {loading && !data ? (
            <Skeleton className="mt-1 h-80 w-full rounded-xl" />
          ) : (
            <div className="mt-1 grid grid-cols-7 gap-1">
              {monthDays.map(({ date, inMonth }) => {
                const d = byDate.get(date)
                const heat = intensity(d)
                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => openInspect(date, date, fmtDay(date))}
                    className={cn(
                      "flex min-h-12 flex-col items-center justify-start rounded-lg border p-1 transition-colors hover:border-primary/50 sm:min-h-16",
                      !inMonth && "opacity-35",
                      date === todayIso && "border-primary ring-1 ring-primary/30",
                    )}
                  >
                    <span className="text-xs font-medium">{parseIso(date).getDate()}</span>
                    {d && d.count > 0 && (
                      <>
                        <span
                          aria-hidden
                          className="mt-1 size-1.5 rounded-full bg-primary"
                          style={{ opacity: 0.35 + heat * 0.65, transform: `scale(${1 + heat})` }}
                        />
                        <span className="mt-1 hidden text-[10px] tabular-nums text-muted-foreground sm:block">
                          {d.count}
                        </span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── WEEK STRIP ──────────────────────────────────────────────────── */}
      {granularity === "week" && (
        <ul className="space-y-2">
          {weekDays.map((date) => {
            const d = byDate.get(date)
            return (
              <li key={date}>
                <button
                  type="button"
                  onClick={() => openInspect(date, date, fmtDay(date))}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40",
                    date === todayIso && "border-primary ring-1 ring-primary/30",
                  )}
                >
                  <span className="text-sm font-medium">{fmtDay(date)}</span>
                  {d && d.count > 0 ? (
                    <span className="flex items-center gap-3 text-sm tabular-nums">
                      {d.incoming > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatMoney(d.incoming, currency)}</span>}
                      {d.outgoing > 0 && <span className="text-red-600 dark:text-red-400">−{formatMoney(d.outgoing, currency)}</span>}
                      <Badge variant="secondary" className="tabular-nums">{d.count}</Badge>
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("calendar.noActivity")}</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── DAY VIEW ────────────────────────────────────────────────────── */}
      {granularity === "day" && (
        <div className="rounded-2xl border bg-card p-4 text-center">
          {periodSummary.count === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">{t("calendar.noActivity")}</p>
          ) : (
            <Button variant="outline" onClick={() => openInspect(range.from, range.to, dayTitle)}>
              {t("calendar.viewDayTransactions", { count: periodSummary.count })}
            </Button>
          )}
        </div>
      )}

      {/* Drill-down modal */}
      <Dialog open={!!inspect} onOpenChange={(o) => { if (!o) setInspect(null) }}>
        <DialogContent className="flex max-h-[85svh] w-[94vw] max-w-md flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-5">
            <DialogTitle className="text-base">{inspect?.label}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-3">
            {inspectTx === null ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}</div>
            ) : inspectTx.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("calendar.noActivity")}</p>
            ) : (
              <ul className="space-y-1.5">
                {inspectTx.map((tx) => (
                  <li key={tx.id} className="flex items-center gap-2.5 rounded-lg border p-2.5">
                    <span className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      tx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30",
                    )}>
                      {tx.type === "incoming"
                        ? <ArrowUpRight className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        : <ArrowDownRight className="size-3.5 text-red-600 dark:text-red-400" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {tx.description || (tx.type === "incoming" ? t("transactions.income") : t("transactions.expense"))}
                        </span>
                        {tx.recurring_rule_id && <Repeat className="size-3 shrink-0 text-violet-500" />}
                      </span>
                      {tx.category && <span className="block truncate text-xs text-muted-foreground">{tx.category}</span>}
                    </span>
                    <span className={cn("shrink-0 text-sm font-semibold tabular-nums", tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                      {tx.type === "incoming" ? "+" : "−"}{formatMoney(Number(tx.amount), currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t p-3">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                if (!inspect) return
                navigate(`/transactions?from=${inspect.from}&to=${inspect.to}`)
              }}
            >
              <ExternalLink className="size-4" /> {t("calendar.openInTransactions")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
