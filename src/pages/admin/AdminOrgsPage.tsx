import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Loader as Loader2,
  Pencil,
  Search,
  Trash2,
} from "lucide-react"

type AdminOrg = {
  id: string
  owner_user_id: string
  name: string
  slug: string
  is_personal: boolean
  created_at: string
  updated_at: string
  owner_email: string | null
  owner_name: string | null
  member_count: number
  client_count: number
  quotation_count: number
  plan_key: string | null
  plan_status: string | null
}

export function AdminOrgsPage() {
  const { getToken } = useAuth()
  const [data, setData] = useState<AdminOrg[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [type, setType] = useState<"all" | "personal" | "team">("all")
  const [loading, setLoading] = useState(true)

  const [editTarget, setEditTarget] = useState<AdminOrg | null>(null)
  const [editName, setEditName] = useState("")
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminOrg | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams()
      if (search.trim()) params.set("search", search.trim())
      if (type !== "all") params.set("type", type)
      params.set("page", String(page))
      const result = await apiGet<{ data: AdminOrg[]; total: number; pageSize: number }>(`/api/admin/organizations?${params}`, token)
      setData(result.data)
      setTotal(result.total)
      setPageSize(result.pageSize)
    } catch {
      toast.error("Failed to load organizations")
    } finally {
      setLoading(false)
    }
  }, [getToken, page, search, type])

  useEffect(() => {
    load()
  }, [load])

  const handleRename = async () => {
    if (!editTarget) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/organizations", token, { organization_id: editTarget.id, name: editName.trim() })
      toast.success("Organization renamed")
      setEditTarget(null)
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
      const res = await fetch("/api/admin/organizations", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: deleteTarget.id }),
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success("Organization deleted")
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setDeleting(false)
    }
    // The apiDelete helper is body-less so we used fetch directly above.
    void apiDelete
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        <p className="text-sm text-slate-400 mt-1">All organizations across the platform.</p>
      </div>

      <Card className="bg-slate-900 border-slate-800 p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
            <Input
              placeholder="Search by name"
              className="pl-8 bg-slate-950 border-slate-800"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
            />
          </div>
          <Tabs value={type} onValueChange={(v) => { setPage(1); setType(v as typeof type) }}>
            <TabsList className="bg-slate-950 border border-slate-800">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="personal">Personal</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-slate-500 ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="py-2 pr-4">Organization</th>
                <th className="py-2 pr-4">Owner</th>
                <th className="py-2 pr-4">Members</th>
                <th className="py-2 pr-4">Clients</th>
                <th className="py-2 pr-4">Quotes</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="py-2"><Skeleton className="h-9 w-full bg-slate-800" /></td></tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="py-6 text-center text-slate-500">No organizations found.</td></tr>
              ) : (
                data.map((o) => (
                  <tr key={o.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-md bg-slate-800 text-slate-400">
                          <Building2 className="size-3.5" />
                        </div>
                        <div className="leading-tight">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{o.name}</p>
                            {o.is_personal && <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400">Personal</Badge>}
                          </div>
                          <p className="text-xs text-slate-500">{o.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-sm">{o.owner_name || "—"}</p>
                      <p className="text-xs text-slate-400">{o.owner_email}</p>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{o.member_count}</td>
                    <td className="py-3 pr-4 text-slate-300">{o.client_count}</td>
                    <td className="py-3 pr-4 text-slate-300">{o.quotation_count}</td>
                    <td className="py-3 pr-4">
                      <Badge className={`text-[10px] uppercase ${o.plan_key === "premium" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-slate-800 text-slate-300 border-slate-700"}`}>
                        {o.plan_key ?? "—"}
                      </Badge>
                    </td>
                    <td className="py-3 text-right">
                      <Button size="icon" variant="ghost" aria-label="Rename" className="text-slate-300 hover:text-slate-100" onClick={() => { setEditTarget(o); setEditName(o.name) }}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Delete" className="text-slate-300 hover:text-red-300" onClick={() => setDeleteTarget(o)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="text-slate-300">
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="text-slate-300">
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null) }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Rename organization</DialogTitle>
          </DialogHeader>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="bg-slate-950 border-slate-800" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={saving}>Cancel</Button>
            <Button onClick={handleRename} disabled={!editName.trim() || saving}>
              {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Delete organization permanently?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-400">
            This will delete <span className="text-slate-100 font-medium">{deleteTarget?.name}</span> along with its clients, transactions, and quotations.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
