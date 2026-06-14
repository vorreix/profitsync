import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
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
import { Loader as Loader2, Pencil, Plus, Trash2, UsersRound, X } from "lucide-react"

type Group = { id: string; name: string; member_count: number; created_at: string }
type Member = { user_id: string; email: string | null; name: string | null }
type UserRow = { id: string; email: string; fullName: string | null }

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
  const [members, setMembers] = useState<Member[]>([])
  const [loadingMembers, setLoadingMembers] = useState(!!group)
  const [saving, setSaving] = useState(false)

  // User search
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<UserRow[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!group) return
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ members: Member[] }>(`/api/admin/user-groups/${group.id}/members`, token)
        setMembers(res.members ?? [])
      } catch {
        setMembers([])
      } finally {
        setLoadingMembers(false)
      }
    })()
  }, [group, getToken])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!search.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ data: UserRow[] }>(`/api/admin/users?search=${encodeURIComponent(search.trim())}`, token)
        setResults(res.data ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search, getToken])

  const addMember = (u: UserRow) => {
    if (members.some((m) => m.user_id === u.id)) return
    setMembers((ms) => [...ms, { user_id: u.id, email: u.email, name: u.fullName }])
  }
  const removeMember = (userId: string) => setMembers((ms) => ms.filter((m) => m.user_id !== userId))

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
        await apiPut(`/api/admin/user-groups/${groupId}/members`, token, { userIds: members.map((m) => m.user_id) })
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Manage group" : "New group"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Premium customers" maxLength={60} />
          </div>

          <div className="space-y-1.5">
            <Label>Members ({members.length})</Label>
            {loadingMembers ? (
              <Skeleton className="h-10 w-full" />
            ) : members.length === 0 ? (
              <p className="text-xs text-muted-foreground">No members yet. Search below to add people.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 rounded-md border p-2">
                {members.map((m) => (
                  <Badge key={m.user_id} variant="secondary" className="gap-1 pr-1">
                    <span className="max-w-[12rem] truncate">{m.name || m.email || m.user_id}</span>
                    <button type="button" onClick={() => removeMember(m.user_id)} className="rounded hover:bg-muted" aria-label="Remove">
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="group-search">Add members</Label>
            <Input id="group-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email…" />
            {searching ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">Searching…</p>
            ) : results.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {results.map((u) => {
                  const added = members.some((m) => m.user_id === u.id)
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => addMember(u)}
                      disabled={added}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{u.fullName || u.email}</span>
                        <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                      </span>
                      {added ? <span className="text-xs text-muted-foreground">Added</span> : <Plus className="size-4 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? "Saving…" : "Save group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
