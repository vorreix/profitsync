import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { MultiSelect, type MultiSelectOption } from "@/components/MultiSelect"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { CheckCheck, Filter, Loader as Loader2, Pencil, Plus, Trash2, UsersRound } from "lucide-react"

type Group = { id: string; name: string; member_count: number; created_at: string }
type Member = { user_id: string; email: string | null; name: string | null }
// As returned by /api/admin/users (serialize() → snake_case).
type UserRow = {
  id: string
  email: string
  full_name: string | null
  country: string
  language: string | null
  premium_org_count: number
  banned_at: string | null
  is_admin: boolean
  created_at: string
}

type PlanFilter = "all" | "premium" | "free"
type StatusFilter = "all" | "active" | "banned"
type Filters = {
  search: string
  orgIds: string[]
  plan: PlanFilter
  status: StatusFilter
  adminsOnly: boolean
  joinedFrom: string
  joinedTo: string
  countries: string[]
  languages: string[]
}
const EMPTY_FILTERS: Filters = { search: "", orgIds: [], plan: "all", status: "all", adminsOnly: false, joinedFrom: "", joinedTo: "", countries: [], languages: [] }
const MAX_GROUP_MEMBERS = 5000

export function AdminUserGroupsPage() {
  const { getToken } = useAuth()
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [editing, setEditing] = useState<Group | "new" | null>(null)
  const [deleteGroup, setDeleteGroup] = useState<Group | null>(null)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ groups: Group[] }>("/api/admin/user-groups", token)
      setGroups(res.groups ?? [])
    } catch {
      setGroups([])
    }
  }, [getToken])

  useEffect(() => {
    void load()
  }, [load])

  const confirmDelete = async () => {
    if (!deleteGroup) return
    const g = deleteGroup
    setDeleteGroup(null)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/admin/user-groups/${g.id}`, token)
      toast.success("Group deleted")
      void load()
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't delete the group")
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-semibold tracking-tight">
            <UsersRound className="size-5 text-muted-foreground" /> User groups
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Saved audiences you can target when sending a broadcast.</p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> New group
        </Button>
      </div>

      {groups === null ? (
        <Skeleton className="h-40 w-full" />
      ) : groups.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No groups yet. Create one to reuse as a broadcast audience.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.member_count} member{g.member_count === 1 ? "" : "s"}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">{g.member_count}</Badge>
              </div>
              <div className="mt-auto flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(g)}>
                  <Pencil className="size-3.5" /> Manage
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteGroup(g)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <GroupEditor
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}

      <AlertDialog open={deleteGroup !== null} onOpenChange={(o) => !o && setDeleteGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteGroup?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>This removes the saved group. Broadcasts already sent are unaffected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

const PLAN_TABS: { value: PlanFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "premium", label: "Premium" },
  { value: "free", label: "Free" },
]
const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "banned", label: "Banned" },
]

function buildUserQuery(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.search.trim()) p.set("search", f.search.trim())
  if (f.orgIds.length) p.set("orgIds", f.orgIds.join(","))
  if (f.plan !== "all") p.set("plan", f.plan)
  if (f.status === "banned") p.set("banned", "true")
  if (f.status === "active") p.set("banned", "false")
  if (f.adminsOnly) p.set("admin", "true")
  if (f.joinedFrom) p.set("joinedFrom", f.joinedFrom)
  if (f.joinedTo) p.set("joinedTo", f.joinedTo)
  if (f.countries.length) p.set("countries", f.countries.join(","))
  if (f.languages.length) p.set("languages", f.languages.join(","))
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}

function GroupEditor({
  group,
  onClose,
  onSaved,
}: {
  group: Group | null
  onClose: () => void
  onSaved: () => void
}) {
  const { getToken } = useAuth()
  // Open AFTER mount (false → true) so the shared Dialog's useBackClose sees a real
  // open transition — mounting already-open makes its StrictMode cleanup close it.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setOpen(true)
  }, [])

  const [name, setName] = useState(group?.name ?? "")
  const [saving, setSaving] = useState(false)

  // Selection (the membership) — a Set of userIds, with best-known display labels.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const labels = useRef<Map<string, string>>(new Map())

  // Filters + the options that populate them.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [orgOptions, setOrgOptions] = useState<MultiSelectOption[]>([])
  const [countryOptions, setCountryOptions] = useState<MultiSelectOption[]>([])
  const [languageOptions, setLanguageOptions] = useState<MultiSelectOption[]>([])

  // Results (a page of matches) + the total match count.
  const [results, setResults] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [loadingResults, setLoadingResults] = useState(true)
  const [selectingAll, setSelectingAll] = useState(false)

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }))
  const filtersActive =
    !!filters.search ||
    filters.orgIds.length > 0 ||
    filters.plan !== "all" ||
    filters.status !== "all" ||
    filters.adminsOnly ||
    !!filters.joinedFrom ||
    !!filters.joinedTo ||
    filters.countries.length > 0 ||
    filters.languages.length > 0

  // Load filter options + existing members once.
  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const [orgs, meta] = await Promise.all([
          apiGet<{ options: { id: string; name: string; is_personal: boolean }[] }>("/api/admin/organizations?options=1", token),
          apiGet<{ countries: string[]; languages: string[] }>("/api/admin/users?meta=1", token),
        ])
        setOrgOptions((orgs.options ?? []).map((o) => ({ value: o.id, label: o.is_personal ? `${o.name} (personal)` : o.name })))
        setCountryOptions((meta.countries ?? []).map((c) => ({ value: c, label: c })))
        setLanguageOptions((meta.languages ?? []).map((l) => ({ value: l, label: l.toUpperCase() })))
        if (group) {
          const m = await apiGet<{ members: Member[] }>(`/api/admin/user-groups/${group.id}/members`, token)
          const ids = new Set<string>()
          for (const mem of m.members ?? []) {
            ids.add(mem.user_id)
            labels.current.set(mem.user_id, mem.name || mem.email || mem.user_id)
          }
          setSelected(ids)
        }
      } catch {
        /* options are best-effort */
      }
    })()
  }, [group, getToken])

  // Debounced results fetch whenever the filters change. `filters` is React state,
  // so its identity changes only on a real update — safe as an effect dependency.
  useEffect(() => {
    let cancelled = false
    setLoadingResults(true)
    const id = window.setTimeout(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ data: UserRow[]; total: number }>(`/api/admin/users?${buildUserQuery(filters)}`, token)
        if (cancelled) return
        for (const u of res.data ?? []) labels.current.set(u.id, u.full_name || u.email || u.id)
        setResults(res.data ?? [])
        setTotal(res.total ?? 0)
      } catch {
        if (!cancelled) {
          setResults([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoadingResults(false)
      }
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [filters, getToken])

  const toggleUser = (u: UserRow, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(u.id)
        labels.current.set(u.id, u.full_name || u.email || u.id)
      } else {
        next.delete(u.id)
      }
      return next
    })
  }

  const selectAllMatching = async () => {
    setSelectingAll(true)
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ ids: string[]; total: number; capped: boolean }>(`/api/admin/users?${buildUserQuery(filters, { format: "ids" })}`, token)
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of res.ids ?? []) next.add(id)
        return next
      })
      const added = res.ids?.length ?? 0
      if (res.capped) toast.warning(`Selected the first ${added.toLocaleString()} matching users (cap reached).`)
      else toast.success(`Selected ${added.toLocaleString()} matching user${added === 1 ? "" : "s"}.`)
    } catch {
      toast.error("Couldn't select all matching users.")
    } finally {
      setSelectingAll(false)
    }
  }

  const overCap = selected.size > MAX_GROUP_MEMBERS

  const save = async () => {
    const clean = name.trim()
    if (!clean) return toast.error("A group name is required.")
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      let groupId = group?.id
      if (group) {
        if (clean !== group.name) await apiPatch(`/api/admin/user-groups/${group.id}`, token, { name: clean })
      } else {
        const created = await apiPost<Group>("/api/admin/user-groups", token, { name: clean })
        groupId = created.id
      }
      if (groupId) {
        await apiPut(`/api/admin/user-groups/${groupId}/members`, token, { userIds: [...selected] })
      }
      toast.success("Group saved")
      onSaved()
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't save the group")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{group ? "Manage group" : "New group"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Group name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium customers" maxLength={60} />
          </div>

          {/* Filters */}
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Filter className="size-3.5" /> Find users to add
              </p>
              {filtersActive && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>
                  Reset
                </Button>
              )}
            </div>

            <Input value={filters.search} onChange={(e) => patch({ search: e.target.value })} placeholder="Search name, email or id…" />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Organizations">
                <MultiSelect options={orgOptions} selected={filters.orgIds} onChange={(v) => patch({ orgIds: v })} placeholder="Any organization" searchPlaceholder="Search orgs…" />
              </Field>
              <Field label="Joined between">
                <div className="flex items-center gap-1.5">
                  <Input type="date" value={filters.joinedFrom} max={filters.joinedTo || undefined} onChange={(e) => patch({ joinedFrom: e.target.value })} className="px-2" />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input type="date" value={filters.joinedTo} min={filters.joinedFrom || undefined} onChange={(e) => patch({ joinedTo: e.target.value })} className="px-2" />
                </div>
              </Field>
              <Field label="Plan">
                <Segmented tabs={PLAN_TABS} value={filters.plan} onChange={(v) => patch({ plan: v })} />
              </Field>
              <Field label="Account status">
                <Segmented tabs={STATUS_TABS} value={filters.status} onChange={(v) => patch({ status: v })} />
              </Field>
              {countryOptions.length > 0 && (
                <Field label="Country">
                  <MultiSelect options={countryOptions} selected={filters.countries} onChange={(v) => patch({ countries: v })} placeholder="Any country" searchPlaceholder="Search…" />
                </Field>
              )}
              {languageOptions.length > 0 && (
                <Field label="Language">
                  <MultiSelect options={languageOptions} selected={filters.languages} onChange={(v) => patch({ languages: v })} placeholder="Any language" searchPlaceholder="Search…" />
                </Field>
              )}
            </div>

            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={filters.adminsOnly} onCheckedChange={(v) => patch({ adminsOnly: v === true })} />
              Platform admins only
            </label>
          </div>

          {/* Results */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {loadingResults ? "Searching…" : `${total.toLocaleString()} user${total === 1 ? "" : "s"} match`}
              </p>
              <Button size="sm" variant="outline" disabled={loadingResults || selectingAll || total === 0} onClick={selectAllMatching}>
                {selectingAll ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                Select all{total > 0 ? ` (${total.toLocaleString()})` : ""}
              </Button>
            </div>

            <div className="max-h-[38vh] divide-y overflow-y-auto rounded-md border">
              {loadingResults ? (
                Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-none" />)
              ) : results.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No users match these filters.</p>
              ) : (
                <>
                  {results.map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent">
                      <Checkbox checked={selected.has(u.id)} onCheckedChange={(v) => toggleUser(u, v === true)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.full_name || u.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {u.premium_org_count > 0 && <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-300">Premium</Badge>}
                        {u.is_admin && <Badge variant="secondary" className="bg-violet-500/10 text-violet-600 dark:text-violet-300">Admin</Badge>}
                        {u.banned_at && <Badge variant="secondary" className="bg-rose-500/10 text-rose-600 dark:text-rose-300">Banned</Badge>}
                      </div>
                    </label>
                  ))}
                  {total > results.length && (
                    <p className="px-3 py-2 text-center text-xs text-muted-foreground">
                      Showing {results.length} of {total.toLocaleString()} — use “Select all” or refine the filters to add the rest.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2 border-t px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{selected.size.toLocaleString()} selected</span>
            {selected.size > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            )}
            {overCap && <span className="text-xs text-amber-600 dark:text-amber-400">only the first {MAX_GROUP_MEMBERS.toLocaleString()} are saved</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? "Saving…" : "Save group"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

function Segmented<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md border p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={
            "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors " +
            (value === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
