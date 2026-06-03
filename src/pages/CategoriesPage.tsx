import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Plus, Tag, Pencil, Trash2, ArrowDownLeft, ArrowUpRight } from "lucide-react"
import { apiPost, apiPatch, apiDelete } from "@/lib/api"
import { useCategories } from "@/lib/use-categories"
import { useOrg } from "@/lib/org-context"
import { canWriteRole, canDeleteRole } from "@/lib/roles"
import type { Category } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"

type CatType = "incoming" | "outgoing"

export function CategoriesPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const { categories, loading, refresh } = useCategories()

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | CatType>("all")

  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState("")
  const [addType, setAddType] = useState<CatType>("outgoing")
  const [saving, setSaving] = useState(false)

  const [editCat, setEditCat] = useState<Category | null>(null)
  const [editName, setEditName] = useState("")
  const [deleteCat, setDeleteCat] = useState<Category | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter((c) => (typeFilter === "all" ? true : c.type === typeFilter))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
  }, [categories, search, typeFilter])

  const appliedCount = typeFilter !== "all" ? 1 : 0

  async function handleAdd() {
    const name = addName.trim()
    if (!name) { toast.error(t("categories.nameRequired")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/categories", token, { name, type: addType })
      toast.success(t("categories.created"))
      setAddOpen(false)
      setAddName("")
      await refresh()
    } catch {
      toast.error(t("categories.createFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editCat) return
    const name = editName.trim()
    if (!name) { toast.error(t("categories.nameRequired")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/categories/${editCat.id}`, token, { name })
      toast.success(t("categories.updated"))
      setEditCat(null)
      await refresh()
    } catch {
      toast.error(t("categories.updateFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteCat) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/categories/${deleteCat.id}`, token)
      toast.success(t("categories.deleted"))
      setDeleteCat(null)
      await refresh()
    } catch {
      toast.error(t("categories.deleteFailed"))
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("categories.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {loading ? t("categories.loading") : t("categories.count", { count: categories.length })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ExpandableSearch value={search} onChange={setSearch} placeholder={t("categories.searchPlaceholder")} expandedClassName="w-36 sm:w-64" />
          <FilterSheet count={appliedCount} onClear={() => setTypeFilter("all")}>
            <FilterSection label={t("filters.type")}>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | CatType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.all")}</SelectItem>
                  <SelectItem value="incoming">{t("categories.incoming")}</SelectItem>
                  <SelectItem value="outgoing">{t("categories.outgoing")}</SelectItem>
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterSheet>
          {canWrite && (
            <Button onClick={() => { setAddName(""); setAddType("outgoing"); setAddOpen(true) }} className="shrink-0">
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("categories.addCategory")}</span>
              <span className="sm:hidden">{t("categories.newShort")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : categories.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Tag className="size-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("categories.empty")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("categories.noMatch")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((cat) => (
            <li key={cat.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/40 transition-colors">
              <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${cat.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                {cat.type === "incoming"
                  ? <ArrowDownLeft className="size-4 text-emerald-600 dark:text-emerald-400" />
                  : <ArrowUpRight className="size-4 text-red-600 dark:text-red-400" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{cat.name}</p>
                <Badge variant="outline" className="mt-0.5 text-[10px]">
                  {cat.type === "incoming" ? t("categories.incoming") : t("categories.outgoing")}
                </Badge>
              </div>
              {canWrite && (
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => { setEditCat(cat); setEditName(cat.name) }} aria-label={t("categories.edit")}>
                  <Pencil className="size-4" />
                </Button>
              )}
              {canDelete && (
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteCat(cat)} aria-label={t("categories.delete")}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader><DialogTitle>{t("categories.addCategory")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">{t("categories.name")}</Label>
              <Input id="cat-name" value={addName} maxLength={60} placeholder={t("categories.namePlaceholder")} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAdd() }} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("filters.type")}</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as CatType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming">{t("categories.incoming")}</SelectItem>
                  <SelectItem value="outgoing">{t("categories.outgoing")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? t("common.saving") : t("categories.addCategory")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editCat !== null} onOpenChange={(o) => { if (!o) setEditCat(null) }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader><DialogTitle>{t("categories.editCategory")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-edit-name">{t("categories.name")}</Label>
              <Input id="cat-edit-name" value={editName} maxLength={60} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleEdit() }} />
              <p className="text-[11px] text-muted-foreground">{t("categories.renameHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCat(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteCat !== null} onOpenChange={(o) => { if (!o) setDeleteCat(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("categories.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("categories.deleteBody", { name: deleteCat?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>{t("categories.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
