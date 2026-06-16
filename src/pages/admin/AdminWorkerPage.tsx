import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import { useAdmin } from "@/lib/admin-context"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { RefreshCw, RotateCcw, X, ServerCog, AlertTriangle, CalendarClock, Wrench, CheckCircle2 } from "lucide-react"

type JobView = {
  id: string
  type: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string
  run_at: string
  updated_at: string
}
type ScheduleView = {
  id: string
  name: string
  type: string
  cron: string
  timezone: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
  updated_at: string
}
type WorkerData = {
  configured: boolean
  reachable: boolean
  counts: Record<string, number>
  jobs: JobView[]
  schedules: ScheduleView[]
  schedulesSupported: boolean
}

// The schedule that drives reminders + scheduled/recurring broadcasts. If it's
// missing, timed notifications never fire (the worker is a clock with no alarm).
const DISPATCH_SCHEDULE = "notifications-dispatch"

const STATUS_ORDER = ["queued", "running", "done", "failed", "dead", "cancelled"]
const STATUS_STYLE: Record<string, string> = {
  queued: "bg-blue-500/10 text-blue-600 dark:text-blue-300",
  running: "bg-amber-500/10 text-amber-600 dark:text-amber-300",
  done: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  failed: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  dead: "bg-rose-600/15 text-rose-700 dark:text-rose-300",
  cancelled: "bg-muted text-muted-foreground",
}

export function AdminWorkerPage() {
  const { getToken } = useAuth()
  const { can } = useAdmin()
  const canManage = can("settings")
  const [data, setData] = useState<WorkerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<WorkerData>(`/api/admin/worker${filter ? `?status=${filter}` : ""}`, token)
      setData(res)
    } catch {
      setData({ configured: true, reachable: false, counts: {}, jobs: [], schedules: [], schedulesSupported: false })
    } finally {
      setLoading(false)
    }
  }, [getToken, filter])

  useEffect(() => {
    void load()
  }, [load])

  const act = useCallback(
    async (id: string, action: "retry" | "cancel") => {
      setBusy(id)
      try {
        const token = await getToken()
        if (!token) return
        await apiPost("/api/admin/worker", token, { action, id })
        toast.success(action === "retry" ? "Job re-queued" : "Job cancelled")
        await load()
      } catch {
        toast.error("Action failed")
      } finally {
        setBusy(null)
      }
    },
    [getToken, load],
  )

  const repairSchedule = useCallback(async () => {
    setBusy("register")
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/admin/worker", token, { action: "register-notifications" })
      toast.success("Notification schedule registered — reminders & scheduled broadcasts will now fire.")
      await load()
    } catch {
      toast.error("Couldn't register the schedule — is the worker reachable?")
    } finally {
      setBusy(null)
    }
  }, [getToken, load])

  const dispatchMissing =
    !!data?.schedulesSupported && !data.schedules.some((s) => s.name === DISPATCH_SCHEDULE && s.enabled)

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-semibold tracking-tight">
            <ServerCog className="size-5 text-muted-foreground" /> Background worker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Queue status and recent jobs from the worker service.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading && !data ? (
        <Skeleton className="h-40 w-full" />
      ) : !data?.configured ? (
        <Card className="p-6 space-y-2">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-amber-500" /> Worker not configured</p>
          <p className="text-sm text-muted-foreground">
            Set <code className="rounded bg-muted px-1">WORKER_BASE_URL</code> and{" "}
            <code className="rounded bg-muted px-1">WORKER_API_TOKEN</code> in the app environment (Vercel) to connect
            the deployed worker. See <code className="rounded bg-muted px-1">docs/worker/ARCHITECTURE_DECISION.md</code>.
          </p>
        </Card>
      ) : !data.reachable ? (
        <Card className="p-6 space-y-1">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-rose-500" /> Worker unreachable</p>
          <p className="text-sm text-muted-foreground">The worker is configured but didn't respond. Check that the service is up and the URL/token are correct.</p>
        </Card>
      ) : (
        <>
          {/* Status counts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STATUS_ORDER.map((s) => (
              <Card key={s} className="p-4">
                <p className="text-2xl font-semibold tabular-nums">{data.counts[s] ?? 0}</p>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground">{s}</p>
              </Card>
            ))}
          </div>

          {/* Scheduler — the cron that fires reminders + scheduled broadcasts */}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 font-medium">
                <CalendarClock className="size-4 text-muted-foreground" /> Scheduler
              </p>
              {canManage && (
                <Button size="sm" variant={dispatchMissing ? "default" : "outline"} disabled={busy === "register"} onClick={repairSchedule}>
                  <Wrench className={`size-3.5 ${busy === "register" ? "animate-pulse" : ""}`} />
                  {dispatchMissing ? "Register notification schedule" : "Re-register"}
                </Button>
              )}
            </div>

            {!data.schedulesSupported ? (
              <p className="text-sm text-muted-foreground">
                This worker build can’t list schedules yet. Rebuild it (<code className="rounded bg-muted px-1">docker compose up -d --build</code>)
                to see them here. You can still use the button above to (re)register the notification schedule.
              </p>
            ) : dispatchMissing ? (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                The <code className="rounded bg-amber-500/15 px-1">{DISPATCH_SCHEDULE}</code> schedule isn’t registered — timed
                reminders and scheduled/recurring broadcasts will NOT fire. Click “Register notification schedule”.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" /> Notification dispatch is active.
              </p>
            )}

            {data.schedulesSupported && data.schedules.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Cron</th>
                      <th className="px-3 py-2 font-medium">Enabled</th>
                      <th className="px-3 py-2 font-medium">Next run</th>
                      <th className="px-3 py-2 font-medium">Last run</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.schedules.map((s) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{s.cron} <span className="opacity-60">{s.timezone}</span></td>
                        <td className="px-3 py-2">
                          <Badge variant="secondary" className={s.enabled ? STATUS_STYLE.done : STATUS_STYLE.cancelled}>
                            {s.enabled ? "yes" : "no"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{s.next_run_at ? new Date(s.next_run_at).toLocaleString() : "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "never"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Filter */}
          <div className="flex flex-wrap gap-1.5">
            {["", ...STATUS_ORDER].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setFilter(s)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === s ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
              >
                {s || "All"}
              </button>
            ))}
          </div>

          {/* Jobs */}
          {data.jobs.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No jobs{filter ? ` with status “${filter}”` : ""}.</Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Attempts</th>
                    <th className="px-3 py-2 font-medium">Error</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                    {canManage && <th className="px-3 py-2 font-medium text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.jobs.map((j) => (
                    <tr key={j.id} className="align-top">
                      <td className="px-3 py-2 font-medium">{j.type}</td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className={STATUS_STYLE[j.status] ?? ""}>{j.status}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{j.attempts}/{j.max_attempts}</td>
                      <td className="px-3 py-2 max-w-xs truncate text-rose-600 dark:text-rose-400" title={j.last_error}>{j.last_error}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(j.updated_at).toLocaleString()}</td>
                      {canManage && (
                        <td className="px-3 py-2 text-right">
                          {(j.status === "failed" || j.status === "dead" || j.status === "cancelled") && (
                            <Button size="sm" variant="ghost" disabled={busy === j.id} onClick={() => act(j.id, "retry")}>
                              <RotateCcw className="size-3.5" /> Retry
                            </Button>
                          )}
                          {j.status === "queued" && (
                            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy === j.id} onClick={() => act(j.id, "cancel")}>
                              <X className="size-3.5" /> Cancel
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
