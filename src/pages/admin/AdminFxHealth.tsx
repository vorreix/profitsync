import { useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { AlertTriangle, CheckCircle2, Coins, RefreshCw } from "lucide-react"
import { apiErrorMessage, apiPost } from "@/lib/api"
import { useApiQuery } from "@/hooks/use-api-query"
import { useAdmin } from "@/lib/admin-context"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type FxHealth = {
  refresh: { last_at: string; pairs: number; incomplete: number } | null
  instance_since: string
  providers: Array<{ provider: string; last_fetch_at: string | null; latest_rate_date: string | null; ok: number; refused: number; failed: number; last_error: string | null }>
  pairs_total: number
  pairs: Array<{ base: string; quote: string; latest_real_date: string | null; last_fetch_at: string | null; missing_days: number }>
  orgs_with_excluded: number
  excluded: Array<{ organization_id: string; name: string; reporting: string; excluded: number }>
}

/** The refresh runs daily (worker + GitHub fallback); a gap past this means both are down. */
const REFRESH_STALE_HOURS = 26

const th = "px-3 py-2 font-medium"
const td = "px-3 py-2"

/**
 * FX health on the Worker page (MC-127): the daily refresh, the providers, the
 * pairs in use that lack a rate, and the workspaces whose reports leave rows
 * out for want of one. Read from our own db, so it renders with the worker down.
 */
export function AdminFxHealth() {
  const { t, i18n } = useTranslation()
  const { getToken } = useAuth()
  const { can } = useAdmin()
  const { data, loading, refetch } = useApiQuery<FxHealth>("/api/admin/fx")
  const [running, setRunning] = useState(false)
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : t("adminFx.never"))

  const run = async () => {
    setRunning(true)
    try {
      const token = await getToken()
      if (!token) return
      const r = await apiPost<{ processed: { pairs: number; remaining: number } }>("/api/admin/fx", token, { action: "refresh" })
      toast.success(t("adminFx.ran", { pairs: r.processed.pairs, remaining: r.processed.remaining }))
      // Explicitly: the write drops the cached copy, but /admin has no
      // DataRefreshProvider to bump `revision`, so nothing would re-read it.
      refetch()
    } catch (e) {
      toast.error(apiErrorMessage(e, t("adminFx.runFailed")))
    } finally {
      setRunning(false)
    }
  }

  const stale = data?.refresh ? Date.now() - Date.parse(data.refresh.last_at) > REFRESH_STALE_HOURS * 3_600_000 : false
  const gaps = data?.pairs.filter((p) => p.missing_days > 0) ?? []

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <Coins className="size-4 text-muted-foreground" /> {t("adminFx.title")}
        </p>
        {can("settings") && (
          <Button size="sm" variant="outline" disabled={running} onClick={run}>
            <RefreshCw className={`size-3.5 ${running ? "animate-spin" : ""}`} /> {t("adminFx.runNow")}
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{t("adminFx.loadFailed")}</p>
      ) : (
        <>
          {!data.refresh ? (
            <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t("adminFx.neverRefreshed")}
            </p>
          ) : stale ? (
            <p className="flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t("adminFx.refreshStale", { when: when(data.refresh.last_at) })}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {t("adminFx.lastRefresh", { when: when(data.refresh.last_at), pairs: data.refresh.pairs, incomplete: data.refresh.incomplete })}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className={th}>{t("adminFx.colProvider")}</th>
                  <th className={th}>{t("adminFx.colLastFetch")}</th>
                  <th className={th}>{t("adminFx.colLatestRate")}</th>
                  <th className={th}>{t("adminFx.colCalls")}</th>
                  <th className={th}>{t("adminFx.colLastError")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.providers.map((p) => (
                  <tr key={p.provider}>
                    <td className={`${td} font-mono text-xs`}>{p.provider}</td>
                    <td className={`${td} whitespace-nowrap text-muted-foreground`}>{when(p.last_fetch_at)}</td>
                    <td className={`${td} whitespace-nowrap text-muted-foreground`}>{p.latest_rate_date ?? "—"}</td>
                    <td className={`${td} tabular-nums text-muted-foreground`}>{p.ok} / {p.refused} / <span className={p.failed ? "text-rose-600 dark:text-rose-400" : ""}>{p.failed}</span></td>
                    <td className={`${td} max-w-[16rem] truncate font-mono text-xs text-muted-foreground`} title={p.last_error ?? undefined}>{p.last_error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("adminFx.callsNote", { since: when(data.instance_since) })}</p>

          {gaps.length === 0 ? (
            <p className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {t("adminFx.pairsOk", { n: data.pairs_total })}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className={th}>{t("adminFx.colPair")}</th>
                    <th className={th}>{t("adminFx.colMissing")}</th>
                    <th className={th}>{t("adminFx.colLatestRate")}</th>
                    <th className={th}>{t("adminFx.colLastFetch")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {gaps.map((p) => (
                    <tr key={`${p.base}/${p.quote}`}>
                      <td className={`${td} font-mono text-xs`}>{p.base}/{p.quote}</td>
                      <td className={`${td} tabular-nums text-rose-600 dark:text-rose-400`}>{p.missing_days}</td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{p.latest_real_date ?? "—"}</td>
                      <td className={`${td} whitespace-nowrap text-muted-foreground`}>{when(p.last_fetch_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.excluded.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("adminFx.noExcluded")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className={th}>{t("adminFx.excluded", { n: data.orgs_with_excluded })}</th>
                    <th className={th}>{t("adminFx.colRows")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.excluded.map((o) => (
                    <tr key={o.organization_id}>
                      <td className={td}>
                        <Link to={`/admin/organizations/${o.organization_id}`} className="hover:underline">{o.name}</Link>{" "}
                        <span className="font-mono text-xs text-muted-foreground">{o.reporting}</span>
                      </td>
                      <td className={`${td} tabular-nums`}>{o.excluded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
