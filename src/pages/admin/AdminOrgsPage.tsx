import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { isPaidPlanKey } from "@/lib/types"
import { useMultiSelect } from "@/lib/use-multi-select"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
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
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  ChevronRight as ChevronRightIcon,
  Loader as Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"

type AdminOrg = {
  id: string
  owner_user_id: string
  name: string
  slug: string
  is_personal: boolean
  account_type: string | null
  currency: string
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

type UserPick = { id: string; email: string; full_name: string | null }

type TypeFilter = "all" | "personal" | "team"

export function AdminOrgsPage() {
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [data, setData] = useState<AdminOrg[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(30)
  const [search, setSearch] = useState(searchParams.get("search") ?? "")
  const [loading, setLoading] = useState(true)

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const type = ((): TypeFilter => {
    const v = searchParams.get("type")
    if (v === "personal" || v === "team") return v
    return "all"
  })()

  const [busy, setBusy] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<AdminOrg | null>(null)
  const [editName, setEditName] = useState("")
  const [editCurrency, setEditCurrency] = useState("USD")
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminOrg | null>(null)
  const [deleting, setDeleting] = useState(false)

  const sel = useMultiSelect()
  const { clear: clearSel } = sel
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ owner_user_id: "", name: "", currency: "USD" })
  const [creating, setCreating] = useState(false)
  const [userSearch, setUserSearch] = useState("")
  const [userResults, setUserResults] = useState<UserPick[]>([])
  const [userSearching, setUserSearching] = useState(false)

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

  // Clear the selection whenever the visible row set changes (page / filters).
  // Depends on `clearSel` (stable) — NOT the whole `sel` — so toggling a row
  // doesn't wipe the selection.
  useEffect(() => {
    clearSel()
  }, [page, search, type, clearSel])

  // Debounced user search for the "Create organization" picker.
  useEffect(() => {
    if (!createOpen) return
    const term = userSearch.trim()
    if (!term) {
      setUserResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setUserSearching(true)
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ data: Array<{ id: string; email: string; full_name: string | null }> }>(
          `/api/admin/users?search=${encodeURIComponent(term)}&page=1`,
          token,
        )
        if (!cancelled) setUserResults(res.data.slice(0, 8))
      } catch {
        if (!cancelled) setUserResults([])
      } finally {
        if (!cancelled) setUserSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [userSearch, createOpen, getToken])

  const handleRename = async () => {
    if (!editTarget) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/organizations", token, {
        organization_id: editTarget.id,
        name: editName.trim(),
        currency: editCurrency.trim().toUpperCase(),
      })
      toast.success("Organization updated")
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
      await apiDelete("/api/admin/organizations", token, { organization_id: deleteTarget.id })
      toast.success("Organization deleted")
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkDelete = async () => {
    const ids = sel.selectedIds
    if (ids.length === 0) return
    setBulkDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiPost<{
        deleted: string[]
        deleted_count: number
        not_deleted: string[]
        dodo_cancelled: number
        dodo_failed: Array<{ id: string; error: string }>
      }>("/api/admin/organizations/bulk-delete", token, { organization_ids: ids })

      // Optimistic in-place removal of the deleted rows (no full reload).
      const deletedSet = new Set(res.deleted)
      setData((prev) => prev.filter((o) => !deletedSet.has(o.id)))
      setTotal((t) => Math.max(0, t - res.deleted_count))

      let msg = `Deleted ${res.deleted_count} organization${res.deleted_count === 1 ? "" : "s"}`
      if (res.dodo_cancelled > 0) {
        msg += ` · ${res.dodo_cancelled} Dodo subscription${res.dodo_cancelled === 1 ? "" : "s"} cancelled`
      }
      toast.success(msg)
      if (res.dodo_failed.length > 0) {
        toast.error(`${res.dodo_failed.length} Dodo cancellation${res.dodo_failed.length === 1 ? "" : "s"} failed — check the Dodo dashboard`)
      }
      sel.clear()
      setBulkDeleteOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed")
      await load()
    } finally {
      setBulkDeleting(false)
    }
  }

  const togglePlan = async (org: AdminOrg) => {
    setBusy(org.id + "plan")
    try {
      const token = await getToken()
      if (!token) return
      // Toggle paid ↔ free. Granting paid picks the plan matching the org's
      // account type (personal vs business) so quota + features line up.
      const nextPlan = isPaidPlanKey(org.plan_key)
        ? "free"
        : org.account_type === "personal" ? "personal" : "business"
      await apiPatch("/api/admin/organizations", token, {
        organization_id: org.id,
        plan_key: nextPlan,
        plan_status: "active",
      })
      toast.success(`Switched to ${nextPlan}`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setBusy(null)
    }
  }

  const openCreate = () => {
    setCreateForm({ owner_user_id: "", name: "", currency: "USD" })
    setUserSearch("")
    setUserResults([])
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!createForm.owner_user_id || !createForm.name.trim()) {
      toast.error("Pick an owner and enter a name")
      return
    }
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) return
      const created = await apiPost<{ id: string }>("/api/admin/organizations", token, {
        owner_user_id: createForm.owner_user_id,
        name: createForm.name.trim(),
        currency: createForm.currency.trim().toUpperCase() || "USD",
      })
      toast.success("Organization created")
      setCreateOpen(false)
      navigate(`/admin/organizations/${created.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setCreating(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageIds = data.map((o) => o.id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => sel.isSelected(id))
  const someSelected = pageIds.some((id) => sel.isSelected(id))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-1">All organizations across the platform. Click a row to manage its clients, transactions, and subscription.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-3.5 mr-1.5" /> Create organization
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name"
              className="pl-8"
              value={search}
              onChange={(e) => {
                updateParams({ page: null, search: e.target.value || null })
                setSearch(e.target.value)
              }}
            />
          </div>
          <Tabs
            value={type}
            onValueChange={(v) => updateParams({ page: null, type: v === "all" ? null : v })}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
              <TabsTrigger value="personal">Personal</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted-foreground ml-auto">{total} total</span>
        </div>

        {sel.count > 0 && (
          <div className="flex items-center gap-3 flex-wrap rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="text-sm font-medium">{sel.count} selected</span>
            <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 className="size-3.5 mr-1.5" /> Delete selected
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => sel.clear()}>
              <X className="size-3.5 mr-1.5" /> Clear
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 w-8">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={() => (allSelected ? sel.clear() : sel.selectAll(pageIds))}
                    aria-label="Select all on this page"
                  />
                </th>
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
                  <tr key={i}><td colSpan={8} className="py-2"><Skeleton className="h-9 w-full" /></td></tr>
                ))
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No organizations found.</td></tr>
              ) : (
                data.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-border hover:bg-muted/40 cursor-pointer"
                    onClick={(e) => {
                      // Ignore clicks coming from inline action buttons
                      if ((e.target as HTMLElement).closest("[data-row-action]")) return
                      navigate(`/admin/organizations/${o.id}`)
                    }}
                  >
                    <td className="py-3 pr-3 w-8" data-row-action onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={sel.isSelected(o.id)}
                        onCheckedChange={() => sel.toggle(o.id)}
                        aria-label={`Select ${o.name}`}
                      />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Building2 className="size-3.5" />
                        </div>
                        <div className="leading-tight">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium">{o.name}</p>
                            {o.is_personal && <Badge variant="outline" className="text-[10px]">Personal</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{o.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <p className="text-sm">{o.owner_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{o.owner_email}</p>
                    </td>
                    <td className="py-3 pr-4">{o.member_count}</td>
                    <td className="py-3 pr-4">{o.client_count}</td>
                    <td className="py-3 pr-4">{o.quotation_count}</td>
                    <td className="py-3 pr-4">
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase ${
                          isPaidPlanKey(o.plan_key)
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            : ""
                        }`}
                      >
                        {o.plan_key ?? "—"}
                      </Badge>
                    </td>
                    <td className="py-3 text-right whitespace-nowrap" data-row-action>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mr-1"
                        disabled={busy === o.id + "plan"}
                        onClick={() => togglePlan(o)}
                        title={isPaidPlanKey(o.plan_key) ? "Downgrade to free" : "Upgrade to paid"}
                      >
                        {busy === o.id + "plan" ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : isPaidPlanKey(o.plan_key) ? (
                          <><ArrowDownCircle className="size-3.5 mr-1" /> Free</>
                        ) : (
                          <><ArrowUpCircle className="size-3.5 mr-1" /> Upgrade</>
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Rename"
                        onClick={() => { setEditTarget(o); setEditName(o.name); setEditCurrency(o.currency || "USD") }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete"
                        className="hover:text-destructive"
                        onClick={() => setDeleteTarget(o)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Open detail"
                        onClick={() => navigate(`/admin/organizations/${o.id}`)}
                      >
                        <ChevronRightIcon className="size-3.5" />
                      </Button>
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

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Default currency</Label>
              <Input
                value={editCurrency}
                onChange={(e) => setEditCurrency(e.target.value.toUpperCase())}
                maxLength={6}
              />
            </div>
          </div>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete organization permanently?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will delete <span className="text-foreground font-medium">{deleteTarget?.name}</span> along with its clients, transactions, and quotations. Any active Dodo subscription is cancelled so billing stops.
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

      <Dialog open={bulkDeleteOpen} onOpenChange={(o) => { if (!o) setBulkDeleteOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {sel.count} organization{sel.count === 1 ? "" : "s"}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes the selected organizations along with their clients, transactions, and quotations. Any active Dodo subscription is cancelled so billing stops. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Delete {sel.count} forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs">Owner</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={userSearch}
                  onChange={(e) => {
                    setUserSearch(e.target.value)
                    setCreateForm((f) => ({ ...f, owner_user_id: "" }))
                  }}
                  placeholder="Search a user by email or name…"
                />
              </div>
              {userSearching && <p className="text-[11px] text-muted-foreground">Searching…</p>}
              {userResults.length > 0 && !createForm.owner_user_id && (
                <div className="border border-border rounded-md max-h-44 overflow-y-auto">
                  {userResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setCreateForm((f) => ({ ...f, owner_user_id: u.id }))
                        setUserSearch(`${u.full_name || u.email} (${u.email})`)
                        setUserResults([])
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-accent/40 text-xs border-b border-border last:border-b-0"
                    >
                      <p className="font-medium text-sm">{u.full_name || "—"}</p>
                      <p className="text-muted-foreground">{u.email}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Organization name</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Input
                value={createForm.currency}
                onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value.toUpperCase() })}
                maxLength={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !createForm.owner_user_id || !createForm.name.trim()}>
              {creating ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
