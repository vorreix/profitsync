import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { spaceProgress } from "@/lib/spaces"
import { formatMoney, useBalancePrivacy } from "@/lib/wealth"
import type { WealthAccount } from "@/lib/types"
import { spaceIconFor } from "@/components/wealth/space-icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { SummaryCard } from "@/components/dashboard/SummaryCard"
import { Skeleton } from "@/components/ui/skeleton"

/** How many Spaces the card lists before deferring to the page. */
const SHOWN = 3

/** The Spaces glyph, used for the card itself as well as goalless rows. */
const PiggyIcon = spaceIconFor("piggy")

/**
 * The dashboard's Spaces card (registry id `spaces`, PERSONAL workspaces only).
 *
 * The registry entry is `isPersonal ? <SpacesCard /> : null`, and that is a
 * correctness requirement rather than a preference: GET /api/spaces answers 403
 * for any non-personal workspace, so a card rendered there would be a
 * guaranteed failed request on every dashboard load.
 *
 * GET /api/spaces returns raw rows and no aggregate, so the total and each
 * bar are derived here — from the same three lines and the same pure helper
 * the hub uses, so the two can never drift. Next auto-save is deliberately
 * absent: it is per-Space and not in the list payload, and fetching it would
 * cost one materialising request per Space.
 */
export function SpacesCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const { balancesVisible } = useBalancePrivacy()
  const { data, loading } = useApiQuery<WealthAccount[]>("/api/spaces")
  const money = (n: number) => formatMoney(n, currency, balancesVisible)

  if (loading) {
    return (
      <Card className={`h-full min-w-0 ${className}`}>
        <CardContent className="space-y-2.5 p-3 sm:p-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-12 rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  const active = (data ?? []).filter((s) => !s.archived_at)
  const totalSaved = active.reduce((sum, s) => sum + Number(s.current_balance), 0)

  if (active.length === 0) {
    if (!canWrite) return null
    const go = () => navigate("/spaces")
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } }}
        className={`group min-w-0 cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <PiggyIcon className="size-4 text-muted-foreground" aria-hidden />
            {t("spaces.title")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("spaces.emptyHint")}</p>
          <Button variant="outline" size="sm" className="mt-3 h-9 text-xs" onClick={(e) => { e.stopPropagation(); go() }}>
            <Plus className="size-3" /> {t("spaces.addSpace")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Closest to its goal first; a Space with no goal has no progress to compare,
  // so those sort last and show no bar rather than an invented one.
  const rows = [...active]
    .map((s) => ({ s, p: spaceProgress(Number(s.current_balance), s.goal_amount == null ? null : Number(s.goal_amount)) }))
    .sort((a, b) => (b.p?.pct ?? -1) - (a.p?.pct ?? -1))
    .slice(0, SHOWN)

  return (
    <SummaryCard
      className={className}
      icon={<PiggyIcon className="size-4" aria-hidden />}
      title={t("spaces.title")}
      count={active.length}
      headline={money(totalSaved)}
      subline={t("spaces.savedAcross", { count: active.length })}
      storageKey={`ps_dash_spaces_open_${activeOrg?.id ?? ""}`}
      onOpen={() => navigate("/spaces")}
    >
      <ul className="space-y-2">
        {rows.map(({ s, p }) => {
          const Icon = spaceIconFor(s.icon)
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => navigate(`/spaces/${s.id}`)}
                className="pressable flex min-h-11 w-full flex-col gap-1.5 rounded-xl border bg-muted/20 px-3 py-2 text-left transition-colors hover:border-primary/40"
              >
                <span className="flex w-full items-center gap-2">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.nickname}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(Number(s.current_balance))}</span>
                </span>
                {p ? (
                  <span className="flex w-full items-center gap-2">
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${Math.min(100, p.pct)}%` }} />
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{Math.round(p.pct)}%</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{t("spaces.noGoalHint")}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </SummaryCard>
  )
}
