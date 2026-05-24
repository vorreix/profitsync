import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPatch } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader as Loader2,
  Pencil,
  Search,
} from "lucide-react"

type AdminSub = {
  id: string
  organization_id: string
  organization_name: string
  owner_email: string | null
  plan_key: string
  status: string
  billing_cycle: string | null
  provider: string | null
  provider_subscription_id: string | null
  current_period_end: string | null
  cancel_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

const PLAN_OPTIONS = ["free", "premium"]
const STATUS_OPTIONS = ["active", "past_due", "cancelled", "trialing"]
const CYCLE_OPTIONS = ["", "monthly", "yearly"]

export function AdminSubscriptionsPage() {
  const { getToken } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<AdminSub[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1))
  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  const initialPlan = searchParams.get("plan")
  const [plan, setPlan] = useState<"all" | "free" | "premium">(
    initialPlan === "free" || initialPlan === "premium" ? initialPlan : "all",
  )
  const initialStatus = searchParams.get("status")
  const [status, setStatus] = useState<"all" | "active" | "past_due" | "cancelled" | "trialing">(
    initialStatus === "active" || initialStatus === "past_due" || initialStatus === "cancelled" || initialStatus === "trialing"
      ? initialStatus
      : "all",
  )

  useEffect(() => {
    const next = new URLSearchParams()
    if (search.trim()) next.set("search", search.trim())
    if (plan !== "all") next.set("plan", plan)
    if (status !== "all") next.set("status", status)
    if (page > 1) next.set("page", String(page))
    setSearchParams(next, { replace: true })
  }, [search, plan, status, page, setSearchParams])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<AdminSub | null>(null)
  const [form, setForm] = useState<{ plan_key: string; status: string; billing_cycle: string; current_period_end: string }>({ plan_key: "", status: "", billing_cycle: "", current_period_end: "" })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams()
      if (search.trim()) params.set("search", search.trim())
      if (plan !== "all") params.set("plan", plan)
      if (status !== "all") params.set("status", status)
      params.set("page", String(page))
      const result = await apiGet<{ data: AdminSub[]; total: number; pageSize: number }>(`/api/admin/subscriptions?${params}`, token)
      setData(result.data)
      setTotal(result.total)
      setPageSize(result.pageSize)
    } catch {
      toast.error("Failed to load subscriptions")
    } finally {
      setLoading(false)
    }
  }, [getToken, page, search, plan, status])

  useEffect(() => { load() }, [load])

  const openEdit = (sub: AdminSub) => {
    setEditing(sub)
    setForm({
      plan_key: sub.plan_key,
      status: sub.status,
      billing_cycle: sub.billing_cycle ?? "",
      current_period_end: sub.current_period_end ? sub.current_period_end.split("T")[0] : "",
    })
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/subscriptions", token, {
        subscription_id: editing.id,
        plan_key: form.plan_key,
        status: form.status,
        billing_cycle: form.billing_cycle,
        current_period_end: form.current_period_end || null,
      })
      toast.success("Subscription updated")
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
        <p className="text-sm text-muted-foreground mt-1">All subscription rows. One per organization.</p>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by organization name"
              className="pl-8"
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value) }}
            />
          </div>
          <Tabs value={plan} onValueChange={(v) => { setPage(1); setPlan(v as typeof plan) }}>
            <TabsList>
              <TabsTrigger value="all">All plans</TabsTrigger>
              <TabsTrigger value="free">Free</TabsTrigger>
              <TabsTrigger value="premium">Premium</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={status} onValueChange={(v) => { setPage(1); setStatus(v as typeof status) }}>
            <TabsList>
              <TabsTrigger value="all">Any</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="past_due">Past due</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Organization</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Cycle</th>
                <th className="py-2 pr-4">Provider</th>
                <th className="py-2 pr-4">Renews</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="py-2"><Skeleton className="h-9 w-full" /></td></tr>
              )) : data.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No subscriptions.</td></tr>
              ) : data.map((s) => (
                <tr key={s.id} className="border-t border-border hover:bg-muted/40">
                  <td className="py-3 pr-4">
                    <p className="text-sm font-medium">{s.organization_name}</p>
                    <p className="text-xs text-muted-foreground">{s.owner_email ?? "—"}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${
                        s.plan_key === "premium"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : ""
                      }`}
                    >
                      {s.plan_key}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${
                        s.status === "active"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : s.status === "past_due"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                            : s.status === "cancelled"
                              ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
                              : ""
                      }`}
                    >
                      {s.status}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{s.billing_cycle ?? "—"}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">{s.provider ?? "—"}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums">{s.current_period_end ? s.current_period_end.split("T")[0] : "—"}</td>
                  <td className="py-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit subscription</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CreditCard className="size-3.5" />
                {editing.organization_name}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Plan</Label>
                <div className="flex gap-1.5">
                  {PLAN_OPTIONS.map((p) => (
                    <Button key={p} type="button" size="sm" variant={form.plan_key === p ? "default" : "outline"} onClick={() => setForm({ ...form, plan_key: p })}>{p}</Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {STATUS_OPTIONS.map((s) => (
                    <Button key={s} type="button" size="sm" variant={form.status === s ? "default" : "outline"} onClick={() => setForm({ ...form, status: s })}>{s}</Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Billing cycle</Label>
                <div className="flex gap-1.5">
                  {CYCLE_OPTIONS.map((c) => (
                    <Button key={c || "none"} type="button" size="sm" variant={form.billing_cycle === c ? "default" : "outline"} onClick={() => setForm({ ...form, billing_cycle: c })}>{c || "none"}</Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Current period end</Label>
                <Input type="date" value={form.current_period_end} onChange={(e) => setForm({ ...form, current_period_end: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
