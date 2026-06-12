import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, Loader as Loader2, Search, XCircle } from "lucide-react"
import { apiGet, apiPatch } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Attempt = {
  id: string
  organization_id: string
  organization_name: string
  owner_email: string
  plan_key: string
  billing_cycle: string | null
  currency: string | null
  provider: string
  status: string
  effective_status: string
  dodo_subscription_id: string | null
  dodo_payment_id: string | null
  provider_error_message: string
  webhook_error_details: unknown
  follow_up_status: string
  follow_up_notes: string
  completed_at: string | null
  created_at: string
}

type AttemptsResponse = {
  data: Attempt[]
  total: number
  page: number
  page_size: number
  counts: Record<string, number>
}

const STATUS_META: Record<string, { label: string; icon: typeof Activity; className: string }> = {
  created: { label: "Created", icon: Clock, className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  redirected: { label: "Redirected", icon: ExternalLink, className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  completed: { label: "Completed", icon: CheckCircle2, className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Failed", icon: XCircle, className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  abandoned: { label: "Abandoned", icon: AlertTriangle, className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
}

const FOLLOW_UP_OPTIONS = [
  { value: "none", label: "No follow-up" },
  { value: "contacted", label: "Contacted" },
  { value: "resolved", label: "Resolved" },
  { value: "paid_later", label: "Paid later" },
]

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.created
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
      <Icon className="size-3" /> {meta.label}
    </Badge>
  )
}

export function AdminBillingAttemptsPage() {
  const { getToken } = useAuth()
  const [data, setData] = useState<AttemptsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [planFilter, setPlanFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<Attempt | null>(null)
  const [notes, setNotes] = useState("")
  const [followUp, setFollowUp] = useState("none")
  const [saving, setSaving] = useState(false)

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true)
      try {
        const token = await getToken()
        if (!token) return
        const params = new URLSearchParams()
        if (statusFilter !== "all") params.set("status", statusFilter)
        if (planFilter !== "all") params.set("plan", planFilter)
        if (search.trim()) params.set("search", search.trim())
        params.set("page", String(page))
        setData(await apiGet<AttemptsResponse>(`/api/admin/billing-attempts?${params}`, token))
      } catch {
        toast.error("Failed to load billing attempts")
      } finally {
        setLoading(false)
      }
    },
    [getToken, statusFilter, planFilter, search, page],
  )

  useEffect(() => {
    load()
  }, [load])

  function openDetail(a: Attempt) {
    setDetail(a)
    setNotes(a.follow_up_notes)
    setFollowUp(a.follow_up_status)
  }

  async function saveFollowUp() {
    if (!detail) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("no token")
      const updated = await apiPatch<Attempt>(
        `/api/admin/billing-attempts/${detail.id}`,
        token,
        { follow_up_status: followUp, follow_up_notes: notes },
        ["/api/admin/billing-attempts"],
      )
      // In-place row update — no list flash.
      setData((prev) =>
        prev ? { ...prev, data: prev.data.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)) } : prev,
      )
      setDetail(null)
      toast.success("Follow-up saved")
    } catch {
      toast.error("Failed to save follow-up")
    } finally {
      setSaving(false)
    }
  }

  const counts = data?.counts ?? {}
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Billing attempts</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every checkout attempt: who clicked subscribe, what happened, and your follow-up notes.
        </p>
      </div>

      {/* Funnel chips — clicking one filters by that (effective) status */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => { setStatusFilter("all"); setPage(1) }}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === "all" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
        >
          All {data ? Object.values(counts).reduce((a, b) => a + b, 0) : ""}
        </button>
        {Object.entries(STATUS_META).map(([key, meta]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setStatusFilter(key); setPage(1) }}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${statusFilter === key ? meta.className : "text-muted-foreground hover:bg-muted"}`}
          >
            {meta.label} {counts[key] ?? 0}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search org or email…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="h-9 w-56 pl-8"
          />
        </div>
        <Select value={planFilter} onValueChange={(v) => { setPlanFilter(v); setPage(1) }}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Plan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="personal">Personal</SelectItem>
            <SelectItem value="business">Business</SelectItem>
            <SelectItem value="premium">Premium (legacy)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {loading && !data ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
          No billing attempts match.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Organization</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Error</th>
                <th className="px-3 py-2.5 font-medium">Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((a) => (
                <tr
                  key={a.id}
                  className="cursor-pointer border-t transition-colors hover:bg-muted/40"
                  onClick={() => openDetail(a)}
                >
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{a.organization_name || "—"}</p>
                    <p className="text-xs text-muted-foreground">{a.owner_email}</p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="capitalize">{a.plan_key}</span>
                    <span className="text-xs text-muted-foreground"> · {a.billing_cycle ?? "—"}{a.currency ? ` · ${a.currency}` : ""}</span>
                  </td>
                  <td className="px-3 py-2.5"><StatusBadge status={a.effective_status} /></td>
                  <td className="max-w-[260px] truncate px-3 py-2.5 text-xs text-muted-foreground" title={a.provider_error_message}>
                    {a.provider_error_message || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {a.follow_up_status === "none" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge variant="secondary" className="capitalize">{a.follow_up_status.replace("_", " ")}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > data.page_size && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {data.page} of {totalPages} · {data.total} attempts
          </span>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="icon-sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail + follow-up dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="max-h-[88svh] w-[94vw] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Attempt detail</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Organization</p>
                  <p className="font-medium">{detail.organization_name || "—"}</p>
                  <p className="text-xs text-muted-foreground">{detail.owner_email}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge status={detail.effective_status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="capitalize">{detail.plan_key} · {detail.billing_cycle ?? "—"}{detail.currency ? ` · ${detail.currency}` : ""}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Provider</p>
                  <p className="capitalize">{detail.provider}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Dodo subscription / payment</p>
                  <p className="break-all font-mono text-xs">{detail.dodo_subscription_id ?? "—"}{detail.dodo_payment_id ? ` · ${detail.dodo_payment_id}` : ""}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Created · Finished</p>
                  <p className="text-xs">{new Date(detail.created_at).toLocaleString()} · {detail.completed_at ? new Date(detail.completed_at).toLocaleString() : "—"}</p>
                </div>
              </div>

              {detail.provider_error_message && (
                <div>
                  <p className="text-xs text-muted-foreground">Provider error</p>
                  <p className="mt-1 rounded-md bg-red-500/5 p-2 font-mono text-xs text-red-700 dark:text-red-300">{detail.provider_error_message}</p>
                </div>
              )}
              {detail.webhook_error_details != null && (
                <div>
                  <p className="text-xs text-muted-foreground">Webhook payload (payment.failed)</p>
                  <pre className="mt-1 max-h-44 overflow-auto rounded-md bg-muted p-2 text-[11px]">{JSON.stringify(detail.webhook_error_details, null, 2)}</pre>
                </div>
              )}

              <div className="space-y-2 border-t pt-3">
                <Label>Follow-up status</Label>
                <Select value={followUp} onValueChange={setFollowUp}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FOLLOW_UP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="follow-up-notes">Notes</Label>
                <Textarea
                  id="follow-up-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Customer emailed — card was blocked by their bank; retrying next week."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)} disabled={saving}>Cancel</Button>
            <Button onClick={saveFollowUp} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save follow-up
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
