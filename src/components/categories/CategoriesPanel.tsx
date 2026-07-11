import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Plus, Tag, Pencil, Trash2, ArrowDownLeft, ArrowUpRight, FileText, User, Check } from "lucide-react"
import { apiPost, apiPut, apiDelete } from "@/lib/api"
import { useCategories } from "@/lib/use-categories"
import { useOrg } from "@/lib/org-context"
import { useUrlModal } from "@/hooks/use-url-modal"
import { canWriteRole, canDeleteRole } from "@/lib/roles"
import { combineCategories, CATEGORY_TYPES, categoryTypeLabelKey } from "@/lib/categories"
import type { Category, CategoryType, CombinedCategory } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import { EntityDrilldown } from "@/components/entity-drilldown/EntityDrilldown"

const PRESET_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"]

type FormValues = { name: string; types: CategoryType[]; color: string }

function TypeIcon({ type, className }: { type: CategoryType; className?: string }) {
  if (type === "incoming") return <ArrowDownLeft className={className ?? "size-4 text-emerald-600 dark:text-emerald-400"} />
  if (type === "outgoing") return <ArrowUpRight className={className ?? "size-4 text-red-600 dark:text-red-400"} />
  if (type === "client") return <User className={className ?? "size-4 text-blue-600 dark:text-blue-400"} />
  return <FileText className={className ?? "size-4 text-amber-600 dark:text-amber-400"} />
}

/** Category management inside the Category & Tags shell — combined multi-type
 *  logical categories, a shared add/edit dialog, and a click-through drilldown. */
export function CategoriesPanel() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const { categories, loading, refresh, mutateLocal } = useCategories()

  const combined = useMemo(() => combineCategories(categories), [categories])

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | CategoryType>("all")
  const [sort, setSort] = useState<"name_asc" | "name_desc">("name_asc")

  // A single always-mounted add/edit dialog driven by this state (open = non-null).
  // Conditionally mounting a back-close Dialog + hardcoded `open` double-fires the
  // StrictMode mount effect, whose cleanup history.back() slams it shut instantly.
  const [catForm, setCatForm] = useState<{ mode: "add" | "edit"; initial: FormValues } | null>(null)
  const [deleteCat, setDeleteCat] = useState<CombinedCategory | null>(null)
  const [saving, setSaving] = useState(false)

  const drill = useUrlModal("category")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = combined
      .filter((c) => (typeFilter === "all" ? true : c.types.includes(typeFilter)))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
    return sort === "name_desc" ? [...list].reverse() : list // `combined` is already name_asc
  }, [combined, search, typeFilter, sort])

  const appliedCount = typeFilter !== "all" ? 1 : 0

  function syntheticRows(name: string, types: CategoryType[], color: string): Category[] {
    const now = new Date().toISOString()
    return types.map((type) => ({
      id: `tmp-${name}-${type}`,
      organization_id: activeOrg?.id ?? "",
      name,
      type,
      color,
      created_at: now,
      updated_at: now,
    }))
  }

  function handleSubmit(values: FormValues) {
    if (catForm?.mode === "edit") handleEdit(catForm.initial.name, values)
    else handleAdd(values)
  }

  async function handleAdd(values: FormValues) {
    setSaving(true)
    // Optimistic: show the new logical category instantly; refresh reconciles ids.
    mutateLocal((prev) => [...prev, ...syntheticRows(values.name, values.types, values.color)])
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/categories", token, values, ["/api/categories"])
      toast.success(t("categories.created"))
      setCatForm(null)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error && /exists/i.test(err.message) ? t("categories.nameExists") : t("categories.createFailed"))
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(oldName: string, values: FormValues) {
    setSaving(true)
    mutateLocal((prev) => [
      ...prev.filter((r) => r.name.toLowerCase() !== oldName.toLowerCase()),
      ...syntheticRows(values.name, values.types, values.color),
    ])
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPut(
        "/api/categories/combined",
        token,
        { oldName, newName: values.name, types: values.types, color: values.color },
        ["/api/categories", "/api/transactions", "/api/clients", "/api/quotations"],
      )
      toast.success(t("categories.updated"))
      setCatForm(null)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error && /exists/i.test(err.message) ? t("categories.nameExists") : t("categories.updateFailed"))
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteCat) return
    const cat = deleteCat
    setDeleteCat(null)
    mutateLocal((prev) => prev.filter((r) => r.name.toLowerCase() !== cat.name.toLowerCase()))
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/categories/combined?name=${encodeURIComponent(cat.name)}`, token, undefined, ["/api/categories"])
      toast.success(t("categories.deleted"))
    } catch {
      toast.error(t("categories.deleteFailed"))
      await refresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground min-w-0 truncate">
          {loading ? t("categories.loading") : t("categories.count", { count: combined.length })}
        </p>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ExpandableSearch value={search} onChange={setSearch} placeholder={t("categories.searchPlaceholder")} expandedClassName="w-36 sm:w-64" />
          <FilterSheet count={appliedCount} onClear={() => { setTypeFilter("all"); setSort("name_asc") }}>
            <FilterSection label={t("filters.type")}>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | CategoryType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.all")}</SelectItem>
                  {CATEGORY_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>{t(categoryTypeLabelKey(ct))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterSection>
            <FilterSection label={t("filters.sortBy")}>
              <Select value={sort} onValueChange={(v) => setSort(v as "name_asc" | "name_desc")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name_asc">{t("categories.sortNameAsc")}</SelectItem>
                  <SelectItem value="name_desc">{t("categories.sortNameDesc")}</SelectItem>
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterSheet>
          {canWrite && (
            <Button onClick={() => setCatForm({ mode: "add", initial: { name: "", types: ["outgoing"], color: "" } })} className="shrink-0">
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("categories.addCategory")}</span>
              <span className="sm:hidden">{t("categories.newShort")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : combined.length === 0 ? (
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
            <li key={cat.name} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/40 transition-colors">
              <button
                type="button"
                onClick={() => drill.open(cat.name)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                aria-label={t("categories.viewEntities", { name: cat.name })}
              >
                <span
                  className="size-9 rounded-lg flex items-center justify-center shrink-0 border"
                  style={cat.color ? { backgroundColor: `${cat.color}22`, borderColor: `${cat.color}55` } : undefined}
                >
                  <Tag className="size-4" style={cat.color ? { color: cat.color } : undefined} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{cat.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {cat.types.map((ty) => (
                      <Badge key={ty} variant="outline" className="gap-1 px-1.5 text-[10px] font-normal">
                        <TypeIcon type={ty} className="size-3" />
                        {t(categoryTypeLabelKey(ty))}
                      </Badge>
                    ))}
                  </div>
                </div>
              </button>
              {canWrite && (
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setCatForm({ mode: "edit", initial: { name: cat.name, types: cat.types, color: cat.color } })} aria-label={t("categories.edit")}>
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

      {/* Add / edit dialog — always mounted, driven by `catForm` (see note above). */}
      <CategoryDialog
        state={catForm}
        saving={saving}
        onSubmit={handleSubmit}
        onClose={() => setCatForm(null)}
      />

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

      {/* Entity drilldown */}
      <EntityDrilldown
        open={drill.value !== null}
        onClose={() => drill.close()}
        title={drill.value ?? ""}
        endpoint="/api/categories/entities"
        query={{ name: drill.value ?? "" }}
        typeOptions={CATEGORY_TYPES.map((ty) => ({ value: ty, label: t(categoryTypeLabelKey(ty)) }))}
      />
    </div>
  )
}

/** Shared create/edit form: name + multi-type selection + optional color.
 *  Always mounted; `state` (non-null = open) drives it, so the back-close Dialog
 *  isn't conditionally remounted (which StrictMode double-fires shut). */
function CategoryDialog({
  state, saving, onSubmit, onClose,
}: {
  state: { mode: "add" | "edit"; initial: FormValues } | null
  saving: boolean
  onSubmit: (values: FormValues) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [types, setTypes] = useState<CategoryType[]>([])
  const [color, setColor] = useState("")
  // Mirror the last non-null state so the content stays rendered through the close animation.
  const [shown, setShown] = useState(state)

  useEffect(() => {
    if (state) {
      setShown(state)
      setName(state.initial.name)
      setTypes(state.initial.types)
      setColor(state.initial.color)
    }
  }, [state])

  const mode = shown?.mode ?? "add"

  const toggleType = (ty: CategoryType) =>
    setTypes((prev) => (prev.includes(ty) ? prev.filter((x) => x !== ty) : [...prev, ty]))

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) { toast.error(t("categories.nameRequired")); return }
    if (types.length === 0) { toast.error(t("categories.selectTypeRequired")); return }
    onSubmit({ name: trimmed, types, color })
  }

  return (
    <Dialog open={state !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? t("categories.addCategory") : t("categories.editCategory")}</DialogTitle>
          <DialogDescription>{t("categories.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t("categories.name")}</Label>
            <Input id="cat-name" value={name} maxLength={60} autoFocus placeholder={t("categories.namePlaceholder")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit() }} />
          </div>

          <div className="space-y-1.5">
            <Label>{t("categories.appliesTo")}</Label>
            <p className="text-[11px] text-muted-foreground">{t("categories.appliesToHint")}</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {CATEGORY_TYPES.map((ty) => {
                const on = types.includes(ty)
                return (
                  <button
                    key={ty}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleType(ty)}
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-colors ${on ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  >
                    {/* Visual-only checkbox — a real <Checkbox> renders a nested <button>, which is invalid inside this toggle button. */}
                    <span
                      aria-hidden
                      className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <TypeIcon type={ty} className="size-4" />
                    <span className="text-sm">{t(categoryTypeLabelKey(ty))}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("categories.color")}</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c || "none"}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c || t("categories.colorNone")}
                  className={`size-7 rounded-full border flex items-center justify-center transition ${color === c ? "ring-2 ring-offset-2 ring-ring" : ""}`}
                  style={c ? { backgroundColor: c, borderColor: c } : undefined}
                >
                  {!c && <span className="text-[10px] text-muted-foreground">✕</span>}
                  {c && color === c && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("common.saving") : mode === "add" ? t("categories.addCategory") : t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
