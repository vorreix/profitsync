import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useAdmin } from "@/lib/admin-context"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { isPaidPlanKey } from "@/lib/types"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ArrowDownCircle,
  ArrowLeft,
  ArrowUpCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  GaugeCircle,
  Loader as Loader2,
  Mail,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"

type OrgDetail = {
  organization: {
    id: string
    owner_user_id: string
    name: string
    slug: string
    is_personal: boolean
    account_type: string | null
    currency: string
    created_at: string
    updated_at: string
  }
  owner: { id: string; email: string; full_name: string | null } | null
  subscription: {
    id: string
    plan_key: string
    status: string
    billing_cycle: string | null
    provider: string | null
    current_period_end: string | null
  } | null
  members: Array<{
    id: string
    user_id: string
    role: string
    email: string | null
    full_name: string | null
    created_at: string
  }>
  counts: {
    client_count: number
    transaction_count: number
    quotation_count: number
    incoming_total: string
    outgoing_total: string
  } | null
}

type AdminClient = {
  id: string
  name: string
  company: string
  email: string
  phone: string
  status: string
  notes: string
  onboard_date: string | null
  total_incoming: string
  total_outgoing: string
  transaction_count: number
  created_at: string
}

type AdminTx = {
  id: string
  client_id: string
  client_name: string
  type: "incoming" | "outgoing"
  amount: string
  description: string
  category: string
  date: string
  created_at: string
}

type Invite = {
  id: string
  email: string
  role: string
  created_at: string
  expires_at: string | null
}

const PLAN_OPTIONS = ["free", "personal", "business"]
const STATUS_OPTIONS = ["active", "past_due", "cancelled", "trialing"]
const CYCLE_OPTIONS = ["", "monthly", "yearly"]
const CLIENT_STATUSES = ["active", "inactive", "archived"]
const TX_TYPES = ["incoming", "outgoing"]
const ROLE_OPTIONS = ["admin", "editor", "viewer"]

export function AdminOrgDetailPage() {
  const { id: orgId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // The Transactions tab is a SUPER-ADMIN-ONLY surface — for everyone else it
  // must not even appear to exist (no trigger, no content, and a forced
  // ?tab=transactions URL falls back to Overview; the API enforces too).
  const { can } = useAdmin()
  const canSeeTransactions = can("org_transactions")
  const rawTab = searchParams.get("tab") ?? "overview"
  const tab = rawTab === "transactions" && !canSeeTransactions ? "overview" : rawTab

  const [detail, setDetail] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [planBusy, setPlanBusy] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<OrgDetail>(`/api/admin/org-detail?organization_id=${orgId}`, token)
      setDetail(res)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load organization")
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId])

  useEffect(() => {
    load()
  }, [load])

  const togglePlan = async () => {
    if (!detail) return
    setPlanBusy(true)
    try {
      const token = await getToken()
      if (!token) return
      const nextPlan = isPaidPlanKey(detail.subscription?.plan_key)
        ? "free"
        : detail.organization.account_type === "personal" ? "personal" : "business"
      await apiPatch("/api/admin/organizations", token, {
        organization_id: detail.organization.id,
        plan_key: nextPlan,
        plan_status: "active",
      })
      toast.success(`Switched to ${nextPlan}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setPlanBusy(false)
    }
  }

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set("tab", next)
    setSearchParams(params, { replace: true })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/admin/organizations")}>
          <ArrowLeft className="size-3.5 mr-1.5" /> Back to organizations
        </Button>
        <p className="text-sm text-muted-foreground">Organization not found.</p>
      </div>
    )
  }

  const org = detail.organization
  const plan = detail.subscription?.plan_key ?? "free"
  const planStatus = detail.subscription?.status ?? "active"

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/organizations")} className="-ml-2 h-7">
            <ArrowLeft className="size-3.5 mr-1.5" /> Organizations
          </Button>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="size-4" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{org.slug}</span>
                {org.is_personal && <Badge variant="outline" className="text-[10px]">Personal</Badge>}
                <span>·</span>
                <span>{org.currency}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`uppercase text-[10px] ${
              isPaidPlanKey(plan)
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                : ""
            }`}
          >
            {plan} · {planStatus}
          </Badge>
          <Button onClick={togglePlan} variant="outline" size="sm" disabled={planBusy}>
            {planBusy ? (
              <Loader2 className="size-3.5 animate-spin mr-1.5" />
            ) : isPaidPlanKey(plan) ? (
              <ArrowDownCircle className="size-3.5 mr-1.5" />
            ) : (
              <ArrowUpCircle className="size-3.5 mr-1.5" />
            )}
            {isPaidPlanKey(plan) ? "Downgrade to free" : "Upgrade to paid"}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <GaugeCircle className="size-3.5 mr-1" /> Overview
          </TabsTrigger>
          <TabsTrigger value="clients">
            <Users className="size-3.5 mr-1" /> Clients
          </TabsTrigger>
          {canSeeTransactions && (
            <TabsTrigger value="transactions">
              <CreditCard className="size-3.5 mr-1" /> Transactions
            </TabsTrigger>
          )}
          <TabsTrigger value="subscription">
            <CreditCard className="size-3.5 mr-1" /> Subscription
          </TabsTrigger>
          <TabsTrigger value="members">
            <UserPlus className="size-3.5 mr-1" /> Members
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab detail={detail} />
        </TabsContent>

        <TabsContent value="clients">
          <ClientsTab orgId={orgId!} currency={org.currency} />
        </TabsContent>

        {canSeeTransactions && (
          <TabsContent value="transactions">
            <TransactionsTab orgId={orgId!} currency={org.currency} />
          </TabsContent>
        )}

        <TabsContent value="subscription">
          <SubscriptionTab detail={detail} onChanged={load} />
        </TabsContent>

        <TabsContent value="members">
          <MembersTab orgId={orgId!} members={detail.members} onChanged={load} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-1 ${accent ?? ""}`}>{value}</p>
    </Card>
  )
}

function OverviewTab({ detail }: { detail: OrgDetail }) {
  const counts = detail.counts
  return (
    <div className="space-y-4 pt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Clients" value={counts?.client_count ?? 0} />
        <StatTile label="Transactions" value={counts?.transaction_count ?? 0} />
        <StatTile label="Quotations" value={counts?.quotation_count ?? 0} />
        <StatTile
          label="Net flow"
          value={`${Number(counts?.incoming_total ?? 0) - Number(counts?.outgoing_total ?? 0)}`}
        />
      </div>
      <Card className="p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Owner</p>
        {detail.owner ? (
          <Link to={`/admin/users?search=${encodeURIComponent(detail.owner.email)}`} className="block hover:bg-accent/40 rounded-md -m-1 p-1">
            <p className="text-sm font-medium">{detail.owner.full_name || "—"}</p>
            <p className="text-xs text-muted-foreground">{detail.owner.email}</p>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">Unknown owner</p>
        )}
      </Card>
    </div>
  )
}

// ---------------- Clients tab ----------------

function ClientsTab({ orgId, currency }: { orgId: string; currency: string }) {
  const { getToken } = useAuth()
  const [data, setData] = useState<AdminClient[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "archived">("all")
  const [loading, setLoading] = useState(true)

  const emptyForm = useMemo(
    () => ({ name: "", company: "", email: "", phone: "", status: "active", notes: "", onboard_date: "" }),
    [],
  )
  const [editing, setEditing] = useState<AdminClient | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminClient | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ organization_id: orgId, page: String(page) })
      if (search.trim()) params.set("search", search.trim())
      if (status !== "all") params.set("status", status)
      const res = await apiGet<{ data: AdminClient[]; total: number; pageSize: number }>(`/api/admin/clients?${params}`, token)
      setData(res.data)
      setTotal(res.total)
      setPageSize(res.pageSize)
    } catch {
      toast.error("Failed to load clients")
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId, page, search, status])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setCreateOpen(true)
  }

  const openEdit = (client: AdminClient) => {
    setEditing(client)
    setForm({
      name: client.name,
      company: client.company,
      email: client.email,
      phone: client.phone,
      status: client.status,
      notes: client.notes,
      onboard_date: client.onboard_date ?? "",
    })
    setCreateOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      if (editing) {
        await apiPatch("/api/admin/clients", token, {
          client_id: editing.id,
          ...form,
          onboard_date: form.onboard_date || null,
        })
        toast.success("Client updated")
      } else {
        await apiPost("/api/admin/clients", token, {
          organization_id: orgId,
          ...form,
          onboard_date: form.onboard_date || null,
        })
        toast.success("Client added")
      }
      setCreateOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/clients", token, { client_id: deleteTarget.id })
      toast.success("Client moved to trash")
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">All clients in this organization. {currency} is the org currency.</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-3.5 mr-1.5" /> Add client
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name, company, or email"
              className="pl-8"
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value) }}
            />
          </div>
          <Tabs value={status} onValueChange={(v) => { setPage(1); setStatus(v as typeof status) }}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="inactive">Inactive</TabsTrigger>
              <TabsTrigger value="archived">Archived</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Txns</th>
                <th className="py-2 pr-4">Incoming</th>
                <th className="py-2 pr-4">Outgoing</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="py-2"><Skeleton className="h-9 w-full" /></td></tr>
              )) : data.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No clients.</td></tr>
              ) : data.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/40">
                  <td className="py-3 pr-4">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.company || "—"} {c.email ? `· ${c.email}` : ""}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      className={`uppercase text-[10px] ${
                        c.status === "active"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : c.status === "archived"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                            : ""
                      }`}
                    >
                      {c.status}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{c.transaction_count}</td>
                  <td className="py-3 pr-4 tabular-nums text-emerald-600 dark:text-emerald-400">{c.total_incoming}</td>
                  <td className="py-3 pr-4 tabular-nums text-red-600 dark:text-red-400">{c.total_outgoing}</td>
                  <td className="py-3 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Edit">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="hover:text-destructive" onClick={() => setDeleteTarget(c)} aria-label="Delete">
                      <Trash2 className="size-3.5" />
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit client" : "Add client"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Company</Label>
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Onboard date</Label>
                <Input type="date" value={form.onboard_date} onChange={(e) => setForm({ ...form, onboard_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <div className="flex gap-1.5 flex-wrap">
                {CLIENT_STATUSES.map((s) => (
                  <Button key={s} type="button" size="sm" variant={form.status === s ? "default" : "outline"} onClick={() => setForm({ ...form, status: s })}>{s}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full bg-background border border-input rounded-md px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              {editing ? "Save changes" : "Add client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move client to trash?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{deleteTarget?.name}</span> will be marked deleted. Their transactions stay in the database but won't appear in the org.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Move to trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------- Transactions tab ----------------

function TransactionsTab({ orgId, currency }: { orgId: string; currency: string }) {
  const { getToken } = useAuth()
  const [data, setData] = useState<AdminTx[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [type, setType] = useState<"all" | "incoming" | "outgoing">("all")
  const [loading, setLoading] = useState(true)

  const [clientsList, setClientsList] = useState<Array<{ id: string; name: string }>>([])

  const today = useMemo(() => new Date().toISOString().split("T")[0], [])
  const emptyForm = useMemo(
    () => ({ client_id: "", type: "incoming", amount: "", description: "", category: "", date: today }),
    [today],
  )
  const [editing, setEditing] = useState<AdminTx | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminTx | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ organization_id: orgId, page: String(page) })
      if (search.trim()) params.set("search", search.trim())
      if (type !== "all") params.set("type", type)
      const res = await apiGet<{ data: AdminTx[]; total: number; pageSize: number }>(`/api/admin/transactions?${params}`, token)
      setData(res.data)
      setTotal(res.total)
      setPageSize(res.pageSize)
    } catch {
      toast.error("Failed to load transactions")
    } finally {
      setLoading(false)
    }
  }, [getToken, orgId, page, search, type])

  useEffect(() => {
    load()
  }, [load])

  const loadClients = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ data: AdminClient[] }>(`/api/admin/clients?organization_id=${orgId}&page=1`, token)
      setClientsList(res.data.map((c) => ({ id: c.id, name: c.name })))
    } catch {
      // Silent: form will show empty picker
    }
  }, [getToken, orgId])

  const openCreate = async () => {
    setEditing(null)
    setForm(emptyForm)
    await loadClients()
    setCreateOpen(true)
  }

  const openEdit = async (tx: AdminTx) => {
    setEditing(tx)
    setForm({
      client_id: tx.client_id,
      type: tx.type,
      amount: tx.amount,
      description: tx.description,
      category: tx.category,
      date: tx.date,
    })
    await loadClients()
    setCreateOpen(true)
  }

  const handleSave = async () => {
    if (!form.client_id) {
      toast.error("Pick a client")
      return
    }
    if (!form.amount || isNaN(Number(form.amount))) {
      toast.error("Amount is required")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      if (editing) {
        await apiPatch("/api/admin/transactions", token, {
          transaction_id: editing.id,
          type: form.type,
          amount: form.amount,
          description: form.description,
          category: form.category,
          date: form.date,
        })
        toast.success("Transaction updated")
      } else {
        await apiPost("/api/admin/transactions", token, {
          client_id: form.client_id,
          type: form.type,
          amount: form.amount,
          description: form.description,
          category: form.category,
          date: form.date,
        })
        toast.success("Transaction added")
      }
      setCreateOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/transactions", token, { transaction_id: deleteTarget.id })
      toast.success("Transaction deleted")
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">All transactions across every client. Amounts are in {currency}.</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-3.5 mr-1.5" /> Add transaction
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search description, category, or client"
              className="pl-8"
              value={search}
              onChange={(e) => { setPage(1); setSearch(e.target.value) }}
            />
          </div>
          <Tabs value={type} onValueChange={(v) => { setPage(1); setType(v as typeof type) }}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="incoming">Incoming</TabsTrigger>
              <TabsTrigger value="outgoing">Outgoing</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Client</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Description</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="py-2"><Skeleton className="h-9 w-full" /></td></tr>
              )) : data.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No transactions.</td></tr>
              ) : data.map((tx) => (
                <tr key={tx.id} className="border-t border-border hover:bg-muted/40">
                  <td className="py-3 pr-4 tabular-nums text-xs">{tx.date}</td>
                  <td className="py-3 pr-4">{tx.client_name}</td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      className={`uppercase text-[10px] ${
                        tx.type === "incoming"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
                      }`}
                    >
                      {tx.type}
                    </Badge>
                  </td>
                  <td className={`py-3 pr-4 tabular-nums ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {tx.amount}
                  </td>
                  <td className="py-3 pr-4 text-xs">{tx.description || "—"} {tx.category ? <span className="text-muted-foreground">· {tx.category}</span> : null}</td>
                  <td className="py-3 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(tx)} aria-label="Edit">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="hover:text-destructive" onClick={() => setDeleteTarget(tx)} aria-label="Delete">
                      <Trash2 className="size-3.5" />
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit transaction" : "Add transaction"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Client</Label>
              <select
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                disabled={!!editing}
                className="w-full bg-background border border-input rounded-md h-9 px-2 text-sm disabled:opacity-60"
              >
                <option value="">Select a client…</option>
                {clientsList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {editing && <p className="text-[11px] text-muted-foreground">Client cannot be changed after creation.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <div className="flex gap-1.5">
                  {TX_TYPES.map((t) => (
                    <Button key={t} type="button" size="sm" variant={form.type === t ? "default" : "outline"} onClick={() => setForm({ ...form, type: t })}>{t}</Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              {editing ? "Save changes" : "Add transaction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete transaction?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the {deleteTarget?.type} transaction of <span className="text-foreground font-medium">{deleteTarget?.amount}</span> for <span className="text-foreground font-medium">{deleteTarget?.client_name}</span>.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------- Subscription tab ----------------

function SubscriptionTab({ detail, onChanged }: { detail: OrgDetail; onChanged: () => void | Promise<void> }) {
  const { getToken } = useAuth()
  const sub = detail.subscription
  const [form, setForm] = useState({
    plan_key: sub?.plan_key ?? "free",
    status: sub?.status ?? "active",
    billing_cycle: sub?.billing_cycle ?? "",
    current_period_end: sub?.current_period_end ? sub.current_period_end.split("T")[0] : "",
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm({
      plan_key: sub?.plan_key ?? "free",
      status: sub?.status ?? "active",
      billing_cycle: sub?.billing_cycle ?? "",
      current_period_end: sub?.current_period_end ? sub.current_period_end.split("T")[0] : "",
    })
  }, [sub])

  const handleSave = async () => {
    if (!sub) {
      // Fall back to updating the org (which creates a sub if missing).
      setSaving(true)
      try {
        const token = await getToken()
        if (!token) return
        await apiPatch("/api/admin/organizations", token, {
          organization_id: detail.organization.id,
          plan_key: form.plan_key,
          plan_status: form.status,
        })
        toast.success("Subscription created")
        await onChanged()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed")
      } finally {
        setSaving(false)
      }
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/subscriptions", token, {
        subscription_id: sub.id,
        plan_key: form.plan_key,
        status: form.status,
        billing_cycle: form.billing_cycle,
        current_period_end: form.current_period_end || null,
      })
      toast.success("Subscription updated")
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 pt-3">
      <Card className="p-4 space-y-4">
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
        <div className="space-y-1.5 max-w-xs">
          <Label className="text-xs">Current period end</Label>
          <Input type="date" value={form.current_period_end} onChange={(e) => setForm({ ...form, current_period_end: e.target.value })} />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
            Save subscription
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------- Members tab ----------------

function MembersTab({ orgId, members, onChanged }: { orgId: string; members: OrgDetail["members"]; onChanged: () => void | Promise<void> }) {
  const { getToken } = useAuth()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: "", role: "editor" })
  const [inviting, setInviting] = useState(false)

  const loadInvites = useCallback(async () => {
    setLoadingInvites(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ data: Invite[] }>(`/api/admin/invitations?organization_id=${orgId}`, token)
      setInvites(res.data)
    } catch {
      toast.error("Failed to load invitations")
    } finally {
      setLoadingInvites(false)
    }
  }, [getToken, orgId])

  useEffect(() => {
    loadInvites()
  }, [loadInvites])

  const handleInvite = async () => {
    if (!inviteForm.email.trim()) {
      toast.error("Enter an email")
      return
    }
    setInviting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/admin/invitations", token, {
        organization_id: orgId,
        email: inviteForm.email.trim(),
        role: inviteForm.role,
      })
      toast.success("Invitation sent")
      setInviteOpen(false)
      setInviteForm({ email: "", role: "editor" })
      await loadInvites()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setInviting(false)
    }
  }

  const handleRevoke = async (id: string) => {
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/invitations", token, { invitation_id: id })
      toast.success("Invitation revoked")
      await loadInvites()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">Members + pending invitations.</p>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          <UserPlus className="size-3.5 mr-1.5" /> Invite member
        </Button>
      </div>

      <Card className="p-4 space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Members ({members.length})</p>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No members.</p>
        ) : (
          <div className="divide-y divide-border">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">{m.full_name || "—"}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                <Badge variant="outline" className="uppercase text-[10px]">{m.role}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Pending invitations ({invites.length})</p>
        {loadingInvites ? (
          <Skeleton className="h-12 w-full" />
        ) : invites.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No pending invitations.</p>
        ) : (
          <div className="divide-y divide-border">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between py-2 gap-3">
                <div>
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Role: {inv.role}
                    {inv.expires_at ? ` · Expires ${inv.expires_at.split("T")[0]}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="hover:text-destructive" onClick={() => handleRevoke(inv.id)}>
                  <Trash2 className="size-3.5 mr-1" /> Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <div className="relative">
                <Mail className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  type="email"
                  className="pl-8"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  placeholder="person@example.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <div className="flex gap-1.5 flex-wrap">
                {ROLE_OPTIONS.map((r) => (
                  <Button
                    key={r}
                    type="button"
                    size="sm"
                    variant={inviteForm.role === r ? "default" : "outline"}
                    onClick={() => setInviteForm({ ...inviteForm, role: r })}
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteOpen(false)} disabled={inviting}>Cancel</Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChanged()}>
        Refresh
      </Button>
    </div>
  )
}
