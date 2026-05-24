import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
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
  Loader as Loader2,
  Plus,
  Receipt,
  Search,
} from "lucide-react"

type AdminInvoice = {
  id: string
  organization_id: string
  organization_name: string
  owner_email: string | null
  subscription_id: string | null
  amount: string
  currency: string
  status: string
  provider: string | null
  provider_invoice_id: string | null
  pdf_url: string | null
  issued_at: string | null
  paid_at: string | null
  created_at: string
}

type OrgRef = { id: string; name: string }

const STATUS_OPTIONS = ["draft", "open", "paid", "uncollectible", "void", "refunded"]

export function AdminInvoicesPage() {
  const { getToken } = useAuth()
  const [data, setData] = useState<AdminInvoice[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<"all" | (typeof STATUS_OPTIONS)[number]>("all")
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState<AdminInvoice | null>(null)
  const [editStatus, setEditStatus] = useState("draft")
  const [saving, setSaving] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ organization_id: "", amount: "", currency: "USD", status: "draft" })
  const [creating, setCreating] = useState(false)
  const [orgs, setOrgs] = useState<OrgRef[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams()
      if (search.trim()) params.set("search", search.trim())
      if (status !== "all") params.set("status", status)
      params.set("page", String(page))
      const result = await apiGet<{ data: AdminInvoice[]; total: number; pageSize: number }>(`/api/admin/invoices?${params}`, token)
      setData(result.data)
      setTotal(result.total)
      setPageSize(result.pageSize)
    } catch {
      toast.error("Failed to load invoices")
    } finally {
      setLoading(false)
    }
  }, [getToken, page, search, status])

  useEffect(() => { load() }, [load])

  const openCreate = async () => {
    setCreateOpen(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ data: Array<OrgRef & Record<string, unknown>> }>(`/api/admin/organizations?page=1`, token)
      setOrgs(res.data.map((o) => ({ id: o.id, name: o.name })))
    } catch {
      toast.error("Failed to load orgs")
    }
  }

  const handleCreate = async () => {
    if (!createForm.organization_id || !createForm.amount) {
      toast.error("Pick an organization and amount")
      return
    }
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/admin/invoices", token, {
        organization_id: createForm.organization_id,
        amount: createForm.amount,
        currency: createForm.currency,
        status: createForm.status,
      })
      toast.success("Invoice created")
      setCreateOpen(false)
      setCreateForm({ organization_id: "", amount: "", currency: "USD", status: "draft" })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setCreating(false)
    }
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/invoices", token, { invoice_id: editing.id, status: editStatus })
      toast.success("Invoice updated")
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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">Billing receipts.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-3.5 mr-1.5" /> Create invoice
        </Button>
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
          <Tabs value={status} onValueChange={(v) => { setPage(1); setStatus(v as typeof status) }}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {STATUS_OPTIONS.map((s) => (
                <TabsTrigger key={s} value={s}>{s}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Organization</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Issued</th>
                <th className="py-2 pr-4">Paid</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={7} className="py-2"><Skeleton className="h-9 w-full" /></td></tr>
              )) : data.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">
                  No invoices yet. Create one to test the flow.
                </td></tr>
              ) : data.map((inv) => (
                <tr key={inv.id} className="border-t border-border hover:bg-muted/40">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <Receipt className="size-3.5 text-muted-foreground" />
                      <span className="font-mono text-xs">{inv.id.slice(0, 8)}…</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <p>{inv.organization_name}</p>
                    <p className="text-xs text-muted-foreground">{inv.owner_email ?? "—"}</p>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{inv.amount} {inv.currency}</td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase ${
                        inv.status === "paid"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : inv.status === "open"
                            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                            : inv.status === "refunded"
                              ? "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30"
                              : ""
                      }`}
                    >
                      {inv.status}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums">{inv.issued_at?.split("T")[0] ?? "—"}</td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums">{inv.paid_at?.split("T")[0] ?? "—"}</td>
                  <td className="py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(inv); setEditStatus(inv.status) }}>Edit</Button>
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
            <DialogTitle>Edit invoice</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">Org: <span className="text-foreground">{editing.organization_name}</span></p>
              <p className="text-xs text-muted-foreground">Amount: <span className="text-foreground">{editing.amount} {editing.currency}</span></p>
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {STATUS_OPTIONS.map((s) => (
                    <Button key={s} type="button" size="sm" variant={editStatus === s ? "default" : "outline"} onClick={() => setEditStatus(s)}>{s}</Button>
                  ))}
                </div>
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create invoice</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Organization</Label>
              <select
                value={createForm.organization_id}
                onChange={(e) => setCreateForm({ ...createForm, organization_id: e.target.value })}
                className="w-full bg-background border border-input rounded-md h-9 px-2 text-sm"
              >
                <option value="">Select an organization…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Amount</Label>
                <Input value={createForm.amount} onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })} placeholder="29.00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Currency</Label>
                <Input value={createForm.currency} onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <div className="flex gap-1.5 flex-wrap">
                {STATUS_OPTIONS.map((s) => (
                  <Button key={s} type="button" size="sm" variant={createForm.status === s ? "default" : "outline"} onClick={() => setCreateForm({ ...createForm, status: s })}>{s}</Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
