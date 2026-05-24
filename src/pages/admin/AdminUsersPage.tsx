import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiGet, apiPatch } from "@/lib/api"
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
  ChevronLeft,
  ChevronRight,
  Crown,
  Loader as Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
} from "lucide-react"

type AdminUser = {
  id: string
  email: string
  full_name: string | null
  currency: string
  current_organization_id: string | null
  terms_accepted_at: string | null
  banned_at: string | null
  created_at: string
  updated_at: string
  is_admin: boolean
  org_count: number
  premium_org_count: number
}

type OrgRow = {
  id: string
  name: string
  slug: string
  is_personal: boolean
  role: string
  plan_key: string | null
  plan_status: string | null
}

export function AdminUsersPage() {
  const { getToken } = useAuth()
  const [data, setData] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [bannedFilter, setBannedFilter] = useState<"all" | "true" | "false">("all")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [detail, setDetail] = useState<{ user: AdminUser; orgs: OrgRow[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams()
      if (search.trim()) params.set("search", search.trim())
      if (bannedFilter !== "all") params.set("banned", bannedFilter)
      params.set("page", String(page))
      const result = await apiGet<{ data: AdminUser[]; total: number; pageSize: number }>(`/api/admin/users?${params}`, token)
      setData(result.data)
      setTotal(result.total)
      setPageSize(result.pageSize)
    } catch {
      toast.error("Failed to load users")
    } finally {
      setLoading(false)
    }
  }, [getToken, page, search, bannedFilter])

  useEffect(() => {
    load()
  }, [load])

  const openDetail = async (user: AdminUser) => {
    setDetail({ user, orgs: [] })
    setDetailLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ profile: AdminUser; isAdmin: boolean; organizations: OrgRow[] }>(`/api/admin/user-detail?user_id=${user.id}`, token)
      setDetail({ user: { ...user, ...res.profile, is_admin: res.isAdmin }, orgs: res.organizations })
    } catch {
      toast.error("Failed to load user detail")
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const actOn = async (user: AdminUser, action: "ban" | "unban" | "promote" | "demote") => {
    setBusy(user.id + action)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/users", token, { user_id: user.id, action })
      toast.success(`User ${action}ed`)
      await load()
      if (detail?.user.id === user.id) await openDetail(user)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed")
    } finally {
      setBusy(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-slate-400 mt-1">All accounts in the platform.</p>
      </div>

      <Card className="bg-slate-900 border-slate-800 p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
            <Input
              placeholder="Search by email, name, or user id"
              className="pl-8 bg-slate-950 border-slate-800"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
            />
          </div>
          <Tabs value={bannedFilter} onValueChange={(v) => { setPage(1); setBannedFilter(v as typeof bannedFilter) }}>
            <TabsList className="bg-slate-950 border border-slate-800">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="false">Active</TabsTrigger>
              <TabsTrigger value="true">Banned</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-slate-500 ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="py-2 pr-4">User</th>
                <th className="py-2 pr-4">Orgs</th>
                <th className="py-2 pr-4">Premium</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Joined</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="py-2"><Skeleton className="h-9 w-full bg-slate-800" /></td></tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-slate-500">No users found.</td></tr>
              ) : (
                data.map((u) => (
                  <tr key={u.id} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                          <User className="size-3.5" />
                        </div>
                        <div className="leading-tight">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{u.full_name || "—"}</p>
                            {u.is_admin && (
                              <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px] uppercase tracking-wide">
                                <Crown className="size-2.5 mr-1" /> Admin
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{u.org_count}</td>
                    <td className="py-3 pr-4 text-slate-300">{u.premium_org_count}</td>
                    <td className="py-3 pr-4">
                      {u.banned_at ? (
                        <Badge className="bg-red-500/15 text-red-300 border-red-500/30">Banned</Badge>
                      ) : (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Active</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-400 tabular-nums">
                      {new Date(u.created_at).toISOString().split("T")[0]}
                    </td>
                    <td className="py-3 text-right">
                      <Button size="sm" variant="ghost" className="text-slate-300 hover:text-slate-100" onClick={() => openDetail(u)}>
                        Details
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

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl">
          <DialogHeader>
            <DialogTitle>User detail</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-slate-400">Email</p>
                <p>{detail.user.email}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
                <div>
                  <p>User ID</p>
                  <p className="font-mono text-slate-300 break-all text-[11px]">{detail.user.id}</p>
                </div>
                <div>
                  <p>Currency</p>
                  <p className="text-slate-300">{detail.user.currency}</p>
                </div>
                <div>
                  <p>Joined</p>
                  <p className="text-slate-300">{new Date(detail.user.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <p>Terms accepted</p>
                  <p className="text-slate-300">{detail.user.terms_accepted_at ? new Date(detail.user.terms_accepted_at).toLocaleString() : "—"}</p>
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Organizations ({detail.orgs.length})</p>
                {detailLoading ? <Skeleton className="h-12 w-full bg-slate-800" /> : (
                  <div className="space-y-1">
                    {detail.orgs.map((o) => (
                      <div key={o.id} className="flex items-center justify-between border border-slate-800 rounded-md px-3 py-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{o.name}</p>
                            {o.is_personal && <Badge variant="outline" className="text-[10px] border-slate-700 text-slate-400">Personal</Badge>}
                          </div>
                          <p className="text-xs text-slate-400 capitalize">{o.role}</p>
                        </div>
                        <Badge className={`text-[10px] uppercase ${o.plan_key === "premium" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-slate-800 text-slate-300 border-slate-700"}`}>
                          {o.plan_key ?? "—"} · {o.plan_status ?? "—"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 pt-3 flex flex-wrap gap-2">
                {detail.user.banned_at ? (
                  <Button size="sm" onClick={() => actOn(detail.user, "unban")} disabled={busy === detail.user.id + "unban"}>
                    {busy === detail.user.id + "unban" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <ShieldCheck className="size-3.5 mr-1" />}
                    Unban
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => actOn(detail.user, "ban")} disabled={busy === detail.user.id + "ban"}>
                    {busy === detail.user.id + "ban" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <ShieldAlert className="size-3.5 mr-1" />}
                    Ban
                  </Button>
                )}
                {detail.user.is_admin ? (
                  <Button size="sm" variant="outline" onClick={() => actOn(detail.user, "demote")} disabled={busy === detail.user.id + "demote"} className="border-slate-700">
                    Demote from admin
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => actOn(detail.user, "promote")} disabled={busy === detail.user.id + "promote"} className="border-slate-700">
                    <Crown className="size-3.5 mr-1" /> Promote to admin
                  </Button>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
