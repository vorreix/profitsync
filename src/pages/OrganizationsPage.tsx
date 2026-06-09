import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeftRight, Building2, Check, Loader as Loader2, Pencil, Plus, Trash2, Users } from "lucide-react"
import { apiDelete, apiPatch, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { isPaidPlanKey, type Organization } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { CurrencyCombobox } from "@/components/CurrencyCombobox"
import { detectDefaultCurrency } from "@/lib/currencies"
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
  // Uses the default namespace with `organizations.*` keys (a top-level locale key).
  const { t } = useTranslation()
  const { orgs, activeOrg, loading, switchOrg, refresh } = useOrg()

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newCurrency, setNewCurrency] = useState("USD")
  const [creating, setCreating] = useState(false)

  const [editTarget, setEditTarget] = useState<Organization | null>(null)
  const [editName, setEditName] = useState("")
  const [editCurrency, setEditCurrency] = useState("USD")
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [switching, setSwitching] = useState<string | null>(null)

  const openCreate = () => {
    // Default to the active org's currency (most likely pick for an existing user),
    // falling back to a geo-detected default.
    setNewCurrency(activeOrg?.currency || detectDefaultCurrency())
    setNewName("")
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const created = await apiPost<Organization>("/api/organizations", token, { name: newName.trim(), currency: newCurrency })
      toast.success(t("organizations.organizationCreated"))
      setNewName("")
      setCreateOpen(false)
      await switchOrg(created.id)
      await refresh()
      // Run the new company through the setup flow (money + budgets + plan).
      navigate("/organization-setup")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("organizations.failedToCreateOrganization"))
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
      toast.error(t("organizations.nameCannotBeEmpty"))
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
      toast.success(t("organizations.organizationUpdated"))
      setEditTarget(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("organizations.failedToSave"))
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
      toast.success(t("organizations.organizationDeleted"))
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("organizations.failedToDelete"))
    } finally {
      setDeleting(false)
    }
  }

  const handleSwitch = async (id: string) => {
    setSwitching(id)
    try {
      await switchOrg(id)
      await refresh()
      toast.success(t("organizations.switchedOrganization"))
    } catch {
      toast.error(t("organizations.failedToSwitchOrganization"))
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("organizations.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {t("organizations.pageDescription")}
          </p>
        </div>
        <Button onClick={openCreate} className="shrink-0">
          <Plus className="size-4 sm:mr-2" />
          <span className="hidden sm:inline">{t("organizations.newOrganization")}</span>
          <span className="sm:hidden">{t("organizations.new")}</span>
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
            {t("organizations.noOrganizationsYet")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {orgs.map((org) => {
            const isActive = activeOrg?.id === org.id
            const canManage = org.role === "owner" || org.role === "admin"
            const isPaid = isPaidPlanKey(org.plan_key)
            return (
              <Card
                key={org.id}
                className={`flex flex-col overflow-hidden transition-colors ${
                  isActive ? "border-primary ring-1 ring-primary/20" : "hover:border-foreground/20"
                }`}
              >
                <CardContent className="flex flex-1 flex-col p-4">
                  {/* Identity */}
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex size-11 shrink-0 items-center justify-center rounded-xl border ${
                        isActive
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Building2 className="size-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-semibold truncate">{org.name}</p>
                        {isActive && (
                          <Badge className="shrink-0 gap-1 text-[10px] uppercase tracking-wide">
                            <Check className="size-3" /> {t("organizations.active")}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {org.is_personal && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            {t("organizations.personal")}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase tracking-wide ${
                            isPaid ? "border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-300" : ""
                          }`}
                        >
                          {isPaid ? t("organizations.premium") : t("organizations.free")}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {org.role}
                        </Badge>
                        <Badge variant="secondary" className="gap-1 font-mono text-[10px] uppercase">
                          {org.currency}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Actions — pinned to the card bottom so they align across the grid */}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t pt-3">
                    {!isActive && (
                      <Button
                        size="sm"
                        onClick={() => handleSwitch(org.id)}
                        disabled={switching === org.id}
                      >
                        {switching === org.id ? (
                          <Loader2 className="size-3.5 mr-1 animate-spin" />
                        ) : (
                          <ArrowLeftRight className="size-3.5 mr-1" />
                        )}
                        {t("organizations.switch")}
                      </Button>
                    )}
                    {!org.is_personal && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/organizations/${org.id}/members`)}
                      >
                        <Users className="size-3.5 mr-1" /> {t("organizations.members")}
                      </Button>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {canManage && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("organizations.edit")}
                          onClick={() => {
                            setEditTarget(org)
                            setEditName(org.name)
                            setEditCurrency(org.currency || "USD")
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {!org.is_personal && org.role === "owner" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("organizations.delete")}
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(org)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
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
            <DialogTitle>{t("organizations.createOrganization")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-org-name">{t("organizations.name")}</Label>
              <Input
                id="create-org-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("organizations.acmeIncPlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate() }}
                disabled={creating}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("organizations.currency")}</Label>
              <CurrencyCombobox value={newCurrency} onValueChange={setNewCurrency} disabled={creating} />
              <p className="text-[11px] text-muted-foreground">
                {t("organizations.currencyUsedForFormatting")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              {t("organizations.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              {t("organizations.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("organizations.editOrganization")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-org-name">{t("organizations.name")}</Label>
              <Input
                id="edit-org-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={saving || editTarget?.is_personal}
              />
              {editTarget?.is_personal && (
                <p className="text-[11px] text-muted-foreground">{t("organizations.personalOrgCannotBeRenamed")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("organizations.currency")}</Label>
              <CurrencyCombobox value={editCurrency} onValueChange={setEditCurrency} disabled={saving} />
              <p className="text-[11px] text-muted-foreground">
                {t("organizations.currencyUsedForFormatting")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={saving}>
              {t("organizations.cancel")}
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              {t("organizations.saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("organizations.deleteOrganization")}</DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            {t("organizations.deleteOrganizationWarning", { name: deleteTarget?.name })}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t("organizations.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              {t("organizations.deleteForever")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
