import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Building2, Check, Loader as Loader2, Pencil, Plus, Trash2, Users } from "lucide-react"
import { apiDelete, apiPatch, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import type { Organization } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { CurrencyCombobox } from "@/components/CurrencyCombobox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function OrganizationsPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { orgs, activeOrg, loading, switchOrg, refresh } = useOrg()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<Organization | null>(null)
  const [editName, setEditName] = useState("")
  const [editCurrency, setEditCurrency] = useState("USD")
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [switching, setSwitching] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Organization>("/api/organizations", token, { name: newName.trim() })
      toast.success("Organization created")
      setNewName("")
      setCreateOpen(false)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create organization")
    } finally {
      setCreating(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!editTarget) return
    const trimmedName = editName.trim()
    const nameChanged = !editTarget.is_personal && trimmedName !== editTarget.name
    const currencyChanged = editCurrency !== editTarget.currency
    if (!nameChanged && !currencyChanged) {
      setEditTarget(null)
      return
    }
    if (!editTarget.is_personal && !trimmedName) {
      toast.error("Name cannot be empty")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const body: Record<string, string> = {}
      if (nameChanged) body.name = trimmedName
      if (currencyChanged) body.currency = editCurrency
      await apiPatch<Organization>(`/api/organizations/${editTarget.id}`, token, body)
      toast.success("Organization updated")
      setEditTarget(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/organizations/${deleteTarget.id}`, token)
      toast.success("Organization deleted")
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete")
    } finally {
      setDeleting(false)
    }
  }

  const handleSwitch = async (id: string) => {
    setSwitching(id)
    try {
      await switchOrg(id)
      await refresh()
      toast.success("Switched organization")
    } catch {
      toast.error("Failed to switch organization")
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="text-sm text-muted-foreground mt-1">
            You must have at least one organization. Each organization has its own data.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4 mr-2" /> New organization
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You don't have any organizations yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {orgs.map((org) => {
            const isActive = activeOrg?.id === org.id
            return (
              <Card key={org.id} className={isActive ? "border-primary" : ""}>
                <CardContent className="flex items-center gap-3 py-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                    <Building2 className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{org.name}</p>
                      {org.is_personal && (
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          Personal
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase tracking-wide ${
                          org.plan_key === "premium"
                            ? "border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-300"
                            : ""
                        }`}
                      >
                        {org.plan_key === "premium" ? "Premium" : "Free"}
                      </Badge>
                      {isActive && (
                        <Badge className="text-[10px] uppercase tracking-wide">
                          <Check className="size-3 mr-1" /> Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">
                      Role: {org.role} · Currency: <span className="font-mono uppercase">{org.currency}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {!isActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSwitch(org.id)}
                        disabled={switching === org.id}
                      >
                        {switching === org.id ? <Loader2 className="size-3 mr-1 animate-spin" /> : null}
                        Switch
                      </Button>
                    )}
                    {!org.is_personal && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/organizations/${org.id}/members`)}
                      >
                        <Users className="size-3.5 mr-1" /> Members
                      </Button>
                    )}
                    {(org.role === "owner" || org.role === "admin") && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit"
                        onClick={() => {
                          setEditTarget(org)
                          setEditName(org.name)
                          setEditCurrency(org.currency || "USD")
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    {!org.is_personal && org.role === "owner" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(org)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="create-org-name">Name</Label>
            <Input
              id="create-org-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Acme Inc."
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-name">Name</Label>
              <Input
                id="edit-org-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={saving || editTarget?.is_personal}
              />
              {editTarget?.is_personal && (
                <p className="text-[11px] text-muted-foreground">Personal organizations cannot be renamed.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <CurrencyCombobox value={editCurrency} onValueChange={setEditCurrency} disabled={saving} />
              <p className="text-[11px] text-muted-foreground">
                Used to format every amount displayed inside this organization.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete organization?</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            This will permanently delete <span className="font-medium text-foreground">{deleteTarget?.name}</span> and all of its
            clients, transactions, and quotations. This cannot be undone.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
