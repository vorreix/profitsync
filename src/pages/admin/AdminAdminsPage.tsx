import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { ADMIN_CAP_META, GRANTABLE_ADMIN_CAPS, type AdminCapability } from "@/lib/admin-roles"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { Loader as Loader2, Pencil, ShieldCheck, ShieldPlus, Crown, Trash2, UserPlus } from "lucide-react"

type Admin = {
  user_id: string | null
  email: string | null
  full_name: string | null
  // System role key or custom role key — labels come from the roles catalog.
  role: string
  is_root: boolean
  is_self: boolean
  created_at: string | null
}

// The assignable-role catalog from /api/admin/roles. The server already
// applies VISIBILITY: non-super admins never receive the super_admin entry,
// so every picker below is automatically safe.
type RoleInfo = {
  id: string | null
  key: string
  name: string
  description: string
  capabilities: AdminCapability[]
  is_system: boolean
  in_use: number
}

const SYSTEM_ROLE_BADGE: Record<string, string> = {
  super_admin: "border-amber-500/40 text-amber-600 dark:text-amber-300",
  editor: "border-violet-500/40 text-violet-600 dark:text-violet-300",
  viewer: "border-slate-500/40 text-slate-600 dark:text-slate-300",
  blog_writer: "border-sky-500/40 text-sky-600 dark:text-sky-300",
}
const CUSTOM_ROLE_BADGE = "border-emerald-500/40 text-emerald-600 dark:text-emerald-300"

type RoleForm = { name: string; description: string; capabilities: AdminCapability[] }

export function AdminAdminsPage() {
  const { getToken } = useAuth()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [canManageRoles, setCanManageRoles] = useState(false)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("viewer")
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Admin | null>(null)
  const [removing, setRemoving] = useState(false)
  // Roles manager (super admin only)
  const [roleDialog, setRoleDialog] = useState<{ editing: RoleInfo | null } | null>(null)
  const [roleForm, setRoleForm] = useState<RoleForm>({ name: "", description: "", capabilities: ["read"] })
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleDelete, setRoleDelete] = useState<RoleInfo | null>(null)
  const [roleDeleting, setRoleDeleting] = useState(false)

  const roleByKey = new Map(roles.map((r) => [r.key, r]))
  const roleLabel = (key: string) => roleByKey.get(key)?.name ?? key
  const roleBadgeCls = (key: string) => SYSTEM_ROLE_BADGE[key] ?? CUSTOM_ROLE_BADGE

  async function load() {
    try {
      const token = await getToken()
      if (!token) return
      const [adminsData, rolesData] = await Promise.all([
        apiGet<{ admins: Admin[] }>("/api/admin/admins", token),
        apiGet<{ roles: RoleInfo[]; can_manage_roles: boolean }>("/api/admin/roles", token),
      ])
      setAdmins(adminsData.admins)
      setRoles(rolesData.roles)
      setCanManageRoles(rolesData.can_manage_roles)
    } catch {
      toast.error("Failed to load admins")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken])

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/admin/admins", token, { email: email.trim(), role })
      toast.success(`${email.trim()} is now ${roleLabel(role).toLowerCase()}`)
      setEmail("")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add admin")
    } finally {
      setAdding(false)
    }
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    setBusyId(userId)
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch("/api/admin/admins", token, { user_id: userId, role: newRole })
      toast.success("Role updated")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role")
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget?.user_id) return
    setRemoving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete("/api/admin/admins", token, { user_id: removeTarget.user_id })
      toast.success(`Removed ${removeTarget.email ?? "admin"}`)
      setRemoveTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove admin")
    } finally {
      setRemoving(false)
    }
  }

  // ── Roles manager ───────────────────────────────────────────────────────────
  function openCreateRole() {
    setRoleForm({ name: "", description: "", capabilities: ["read"] })
    setRoleDialog({ editing: null })
  }
  function openEditRole(r: RoleInfo) {
    setRoleForm({ name: r.name, description: r.description, capabilities: [...r.capabilities] })
    setRoleDialog({ editing: r })
  }
  function toggleCap(cap: AdminCapability) {
    setRoleForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap) ? f.capabilities.filter((c) => c !== cap) : [...f.capabilities, cap],
    }))
  }
  const handleRoleSave = async () => {
    if (roleForm.name.trim().length < 2) { toast.error("Give the role a name"); return }
    if (roleForm.capabilities.length === 0) { toast.error("Pick at least one permission"); return }
    setRoleSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      if (roleDialog?.editing?.id) {
        await apiPatch(`/api/admin/roles/${roleDialog.editing.id}`, token, roleForm)
        toast.success("Role updated")
      } else {
        await apiPost("/api/admin/roles", token, roleForm)
        toast.success(`Role "${roleForm.name.trim()}" created`)
      }
      setRoleDialog(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save role")
    } finally {
      setRoleSaving(false)
    }
  }
  const handleRoleDelete = async () => {
    if (!roleDelete?.id) return
    setRoleDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/admin/roles/${roleDelete.id}`, token)
      toast.success(`Role "${roleDelete.name}" deleted`)
      setRoleDelete(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete role")
    } finally {
      setRoleDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admins</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Platform admins can access this console. Each admin has a <span className="font-medium">role</span> that
          controls what they can do and see — built-in roles or custom ones defined below. The{" "}
          <span className="font-medium">root admin(s)</span> are set by the{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">ROOT_ADMIN_EMAILS</code> environment variable, are
          always super admin, and can't be changed here.
        </p>
      </div>

      {/* Add an admin */}
      <Card className="p-5 space-y-3 border-dashed">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4" />
          <h2 className="font-semibold">Add an admin</h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            placeholder="person@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }}
            className="sm:flex-1"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Role"
          >
            {roles.map((r) => (
              <option key={r.key} value={r.key}>{r.name}</option>
            ))}
          </select>
          <Button onClick={handleAdd} disabled={adding || !email.trim()}>
            {adding ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <UserPlus className="size-3.5 mr-1.5" />}
            Add admin
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {roleByKey.get(role)?.description || ""} The person must have signed up already.
        </p>
      </Card>

      {/* Admin list */}
      <Card className="divide-y">
        {admins.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No admins yet.</div>
        ) : (
          admins.map((a, i) => (
            <div key={a.user_id ?? a.email ?? i} className="flex items-center gap-3 p-4">
              <div className={`flex size-9 shrink-0 items-center justify-center rounded-full ${a.is_root ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
                {a.is_root ? <Crown className="size-4" /> : <ShieldCheck className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{a.full_name || a.email || "Unknown"}</p>
                  <Badge variant="outline" className={roleBadgeCls(a.role)}>{roleLabel(a.role)}</Badge>
                  {a.is_root && <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-300">Root</Badge>}
                  {a.is_self && <Badge variant="secondary">You</Badge>}
                  {!a.user_id && <Badge variant="outline" className="text-muted-foreground">Not signed in</Badge>}
                </div>
                {a.full_name && a.email && <p className="text-xs text-muted-foreground truncate">{a.email}</p>}
              </div>
              {/* Role picker: only when the caller may assign the target's
                  current role (a non-super editing a super row is already
                  redacted server-side; this guards the self row too). */}
              {!a.is_root && a.user_id && roleByKey.has(a.role) && (
                <select
                  value={a.role}
                  onChange={(e) => handleRoleChange(a.user_id!, e.target.value)}
                  disabled={busyId === a.user_id}
                  className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Change role"
                  title="Change role"
                >
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </select>
              )}
              {!a.is_root && !a.is_self && a.user_id && roleByKey.has(a.role) && (
                <Button
                  variant="outline"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => setRemoveTarget(a)}
                  title="Remove admin"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </Card>

      {/* Roles manager — super admin only (server hides it from everyone else) */}
      {canManageRoles && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Roles</h2>
              <p className="text-sm text-muted-foreground">
                Built-in roles are fixed. Custom roles combine the permissions you pick — super-admin-only powers can
                never be granted to them.
              </p>
            </div>
            <Button onClick={openCreateRole}>
              <ShieldPlus className="size-3.5 mr-1.5" /> New role
            </Button>
          </div>
          <Card className="divide-y">
            {roles.map((r) => (
              <div key={r.key} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-sm font-medium">{r.name}</p>
                    <Badge variant="outline" className={roleBadgeCls(r.key)}>
                      {r.is_system ? "Built-in" : "Custom"}
                    </Badge>
                    {!r.is_system && r.in_use > 0 && (
                      <Badge variant="secondary">{r.in_use} admin{r.in_use === 1 ? "" : "s"}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {r.capabilities.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] py-0 text-muted-foreground">
                        {ADMIN_CAP_META[c]?.label ?? c}
                      </Badge>
                    ))}
                  </div>
                </div>
                {!r.is_system && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="icon" className="size-8" onClick={() => openEditRole(r)} title="Edit role">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setRoleDelete(r)}
                      title="Delete role"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Create / edit role dialog */}
      <Dialog open={!!roleDialog} onOpenChange={(o) => { if (!o) setRoleDialog(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{roleDialog?.editing ? `Edit role: ${roleDialog.editing.name}` : "New role"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input
                id="role-name"
                value={roleForm.name}
                maxLength={40}
                placeholder="e.g. Support"
                onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <Input
                id="role-desc"
                value={roleForm.description}
                maxLength={200}
                placeholder="What is this role for?"
                onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              {GRANTABLE_ADMIN_CAPS.map((cap) => (
                <label key={cap} className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5">
                  <Checkbox
                    checked={roleForm.capabilities.includes(cap)}
                    onCheckedChange={() => toggleCap(cap)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">{ADMIN_CAP_META[cap]?.label ?? cap}</span>
                    <span className="block text-xs text-muted-foreground">{ADMIN_CAP_META[cap]?.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialog(null)} disabled={roleSaving}>Cancel</Button>
            <Button onClick={handleRoleSave} disabled={roleSaving}>
              {roleSaving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
              {roleDialog?.editing ? "Save changes" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete role confirm */}
      <AlertDialog open={!!roleDelete} onOpenChange={(o) => { if (!o) setRoleDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete the "{roleDelete?.name}" role?</AlertDialogTitle>
            <AlertDialogDescription>
              {roleDelete && roleDelete.in_use > 0
                ? `This role is assigned to ${roleDelete.in_use} admin${roleDelete.in_use === 1 ? "" : "s"} — reassign them first.`
                : "Admins can no longer be given this role. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={roleDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleRoleDelete() }}
              disabled={roleDeleting || (roleDelete?.in_use ?? 0) > 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {roleDeleting ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Trash2 className="size-3.5 mr-1.5" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove admin access?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.email ?? "This user"} will lose access to the admin console. Their account and data are not
              affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleRemove() }}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Trash2 className="size-3.5 mr-1.5" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
