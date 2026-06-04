import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { useAdmin } from "@/lib/admin-context"
import { isPaidPlanKey } from "@/lib/types"
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
  Crown,
  Loader as Loader2,
  Mail,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
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

type OrgPick = { id: string; name: string }

const ROLE_OPTIONS = ["admin", "editor", "viewer"]
type BannedFilter = "all" | "true" | "false"

export function AdminUsersPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Promoting/demoting admins and deleting accounts is admin-management — gated to
  // roles with that capability (the API enforces it too).
  const { can } = useAdmin()
  const canManageAdmins = can("manage_admins")

  const [data, setData] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const bannedFilter = ((): BannedFilter => {
    const v = searchParams.get("banned")
    if (v === "true" || v === "false") return v
    return "all"
  })()

  const [detail, setDetail] = useState<{ user: AdminUser; orgs: OrgRow[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ organization_id: "", email: "", role: "editor" })
  const [inviting, setInviting] = useState(false)
  const [orgs, setOrgs] = useState<OrgPick[]>([])

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k)
        else next.set(k, v)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

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

  const openInvite = async () => {
    setInviteOpen(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ data: Array<OrgPick & Record<string, unknown>> }>(`/api/admin/organizations?page=1`, token)
      setOrgs(res.data.map((o) => ({ id: o.id, name: o.name })))
    } catch {
      toast.error("Failed to load organizations")
    }
  }

  const handleInvite = async () => {
    if (!inviteForm.organization_id || !inviteForm.email.trim()) {
      toast.error("Pick an organization and enter an email")
      return
    }
    setInviting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/admin/invitations", token, {
        organization_id: inviteForm.organization_id,
        email: inviteForm.email.trim(),
        role: inviteForm.role,
      })
      toast.success("Invitation sent")
      setInviteOpen(false)
      setInviteForm({ organization_id: "", email: "", role: "editor" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setInviting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/users", token, { user_id: deleteTarget.id })
      toast.success("User deleted")
      setDeleteTarget(null)
      setDetail(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">All accounts in the platform.</p>
        </div>
        <Button onClick={openInvite}>
          <UserPlus className="size-3.5 mr-1.5" /> Invite user
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by email, name, or user id"
              className="pl-8"
              value={search}
              onChange={(e) => {
                updateParams({ page: null, search: e.target.value || null })
                setSearch(e.target.value)
              }}
            />
          </div>
          <Tabs
            value={bannedFilter}
            onValueChange={(v) => updateParams({ page: null, banned: v === "all" ? null : v })}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="false">Active</TabsTrigger>
              <TabsTrigger value="true">Banned</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
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
                  <tr key={i}><td colSpan={6} className="py-2"><Skeleton className="h-9 w-full" /></td></tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No users found.</td></tr>
              ) : (
                data.map((u) => (
                  <tr key={u.id} className="border-t border-border hover:bg-muted/40">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <User className="size-3.5" />
                        </div>
                        <div className="leading-tight">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{u.full_name || "—"}</p>
                            {u.is_admin && (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] uppercase tracking-wide">
                                <Crown className="size-2.5 mr-1" /> Admin
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">{u.org_count}</td>
                    <td className="py-3 pr-4">{u.premium_org_count}</td>
                    <td className="py-3 pr-4">
                      {u.banned_at ? (
                        <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30">Banned</Badge>
                      ) : (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">Active</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums">
                      {new Date(u.created_at).toISOString().split("T")[0]}
                    </td>
                    <td className="py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(u)}>
                        Details
                      </Button>
                      {canManageAdmins && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="hover:text-destructive ml-1"
                          onClick={() => setDeleteTarget(u)}
                          aria-label="Delete user"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" disabled={page <= 1} onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" disabled={page >= totalPages} onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>User detail</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p>{detail.user.email}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground">User ID</p>
                  <p className="font-mono break-all text-[11px]">{detail.user.id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Currency</p>
                  <p>{detail.user.currency}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Joined</p>
                  <p>{new Date(detail.user.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Terms accepted</p>
                  <p>{detail.user.terms_accepted_at ? new Date(detail.user.terms_accepted_at).toLocaleString() : "—"}</p>
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Organizations ({detail.orgs.length})</p>
                {detailLoading ? <Skeleton className="h-12 w-full" /> : (
                  <div className="space-y-1">
                    {detail.orgs.map((o) => (
                      <button
                        type="button"
                        key={o.id}
                        onClick={() => { setDetail(null); navigate(`/admin/organizations/${o.id}`) }}
                        className="w-full flex items-center justify-between border border-border rounded-md px-3 py-2 text-left hover:bg-accent/40"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{o.name}</p>
                            {o.is_personal && <Badge variant="outline" className="text-[10px]">Personal</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground capitalize">{o.role}</p>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase ${
                            isPaidPlanKey(o.plan_key)
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                              : ""
                          }`}
                        >
                          {o.plan_key ?? "—"} · {o.plan_status ?? "—"}
                        </Badge>
                      </button>
                    ))}
                    {detail.orgs.length === 0 && (
                      <p className="text-xs text-muted-foreground italic">No organizations.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-3 flex flex-wrap gap-2">
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
                {canManageAdmins && (detail.user.is_admin ? (
                  <Button size="sm" variant="outline" onClick={() => actOn(detail.user, "demote")} disabled={busy === detail.user.id + "demote"}>
                    Demote from admin
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => actOn(detail.user, "promote")} disabled={busy === detail.user.id + "promote"}>
                    <Crown className="size-3.5 mr-1" /> Promote to admin
                  </Button>
                ))}
                {canManageAdmins && (
                  <Button size="sm" variant="destructive" className="ml-auto" onClick={() => setDeleteTarget(detail.user)}>
                    <Trash2 className="size-3.5 mr-1" /> Delete user
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

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite user to organization</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Creates a pending invitation. The recipient signs up (or signs in) to accept it.
          </p>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Organization</Label>
              <select
                value={inviteForm.organization_id}
                onChange={(e) => setInviteForm({ ...inviteForm, organization_id: e.target.value })}
                className="w-full bg-background border border-input rounded-md h-9 px-2 text-sm"
              >
                <option value="">Select an organization…</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
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

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete user permanently?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will delete <span className="text-foreground font-medium">{deleteTarget?.email}</span>, every organization they own, plus all their clients, transactions, quotations, subscriptions, and invoices. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Delete user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
