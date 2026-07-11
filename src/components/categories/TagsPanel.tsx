import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Plus, Hash, Pencil, Trash2, Check, Receipt, User, FileText, AlertTriangle } from "lucide-react"
import { apiPost, apiPatch, apiDelete } from "@/lib/api"
import { useTags } from "@/lib/use-tags"
import { useOrg } from "@/lib/org-context"
import { useUrlModal } from "@/hooks/use-url-modal"
import { canWriteRole, canDeleteRole } from "@/lib/roles"
import { normalizeTagName } from "@/lib/tags"
import type { Tag, TagUsage } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { EntityDrilldown } from "@/components/entity-drilldown/EntityDrilldown"

const PRESET_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"]

type SortKey = "total_desc" | "total_asc" | "name_asc" | "name_desc"
type FormValues = { name: string; color: string }
type EditTarget = { id: string | null; name: string; color: string }

/** Tags management inside the Category & Tags shell — a merged registry+usage
 *  list (inline tags have no id until materialized), a shared add/edit dialog,
 *  a delete-with-choice flow, and a click-through drilldown. */
export function TagsPanel() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const { tags, loading, refresh, mutateLocal } = useTags()

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("total_desc")

  // Always-mounted, state-driven dialogs (open = non-null). Conditionally
  // mounting a back-close Dialog double-fires the StrictMode mount effect, whose
  // cleanup history.back() slams it shut instantly — so we never do that.
  const [tagForm, setTagForm] = useState<{ mode: "add" | "edit"; initial: EditTarget } | null>(null)
  const [deleteTag, setDeleteTag] = useState<TagUsage | null>(null)
  const [saving, setSaving] = useState(false)

  const drill = useUrlModal("tag")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = tags.filter((tg) => (q ? tg.name.toLowerCase().includes(q) : true))
    const byName = (a: TagUsage, b: TagUsage) => a.name.localeCompare(b.name)
    switch (sort) {
      case "total_asc": return [...list].sort((a, b) => a.total - b.total || byName(a, b))
      case "name_asc": return [...list].sort(byName)
      case "name_desc": return [...list].sort((a, b) => byName(b, a))
      default: return [...list].sort((a, b) => b.total - a.total || byName(a, b)) // total_desc
    }
  }, [tags, search, sort])

  const appliedCount = sort !== "total_desc" ? 1 : 0

  function handleSubmit(values: FormValues) {
    if (tagForm?.mode === "edit") handleEdit(tagForm.initial, values)
    else handleAdd(values)
  }

  async function handleAdd(values: FormValues) {
    setSaving(true)
    const normalized = normalizeTagName(values.name)
    // Optimistic: surface the new tag instantly (unless it already exists — the
    // server dedups case-insensitively and returns the existing row).
    if (!tags.some((tg) => tg.name.toLowerCase() === normalized.toLowerCase())) {
      mutateLocal((prev) => [
        { id: `tmp-${normalized}`, name: normalized, color: values.color, transactions: 0, clients: 0, quotations: 0, total: 0 },
        ...prev,
      ])
    }
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Tag>("/api/tags", token, { name: values.name, color: values.color })
      toast.success(t("tags.created"))
      setTagForm(null)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error && /exist/i.test(err.message) ? t("tags.nameExists") : t("tags.createFailed"))
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit(initial: EditTarget, values: FormValues) {
    setSaving(true)
    const normalized = normalizeTagName(values.name)
    mutateLocal((prev) =>
      prev.map((tg) => (tg.name.toLowerCase() === initial.name.toLowerCase() ? { ...tg, name: normalized, color: values.color } : tg)),
    )
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      // An inline tag (no registry row) must be materialized before it can be
      // renamed/recolored; the POST is a case-insensitive upsert.
      let id = initial.id
      if (!id) {
        const created = await apiPost<Tag>("/api/tags", token, { name: initial.name, color: values.color })
        id = created.id
      }
      await apiPatch<Tag>(`/api/tags/${id}`, token, { name: values.name, color: values.color })
      toast.success(t("tags.updated"))
      setTagForm(null)
      void refresh()
    } catch (err) {
      toast.error(err instanceof Error && /exist/i.test(err.message) ? t("tags.nameExists") : t("tags.updateFailed"))
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(mode: "tag_only" | "with_records") {
    if (!deleteTag) return
    const tag = deleteTag
    setDeleteTag(null)
    mutateLocal((prev) => prev.filter((tg) => tg.name.toLowerCase() !== tag.name.toLowerCase()))
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      // Inline tags need a registry row to delete against; DELETE strips the tag
      // from every entity (tag_only) or soft-deletes the tagged records
      // (with_records, reversing wealth balances) and removes the row either way.
      let id = tag.id
      if (!id) {
        const created = await apiPost<Tag>("/api/tags", token, { name: tag.name, color: tag.color })
        id = created.id
      }
      const result = await apiDelete<{ deleted?: { transactions: number; clients: number; quotations: number } }>(
        `/api/tags/${id}?mode=${mode}`,
        token,
      )
      if (mode === "with_records") {
        const d = result?.deleted
        const n = (d?.transactions ?? 0) + (d?.clients ?? 0) + (d?.quotations ?? 0)
        toast.success(t("tags.deletedWithRecords", { count: n }))
      } else {
        toast.success(t("tags.deleted"))
      }
      void refresh()
    } catch {
      toast.error(t("tags.deleteFailed"))
      await refresh()
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground min-w-0 truncate">
          {loading ? t("tags.loading") : t("tags.count", { count: tags.length })}
        </p>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ExpandableSearch value={search} onChange={setSearch} placeholder={t("tags.searchPlaceholder")} expandedClassName="w-36 sm:w-64" />
          <FilterSheet count={appliedCount} onClear={() => setSort("total_desc")}>
            <FilterSection label={t("filters.sortBy")}>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="total_desc">{t("tags.sortMostUsed")}</SelectItem>
                  <SelectItem value="total_asc">{t("tags.sortLeastUsed")}</SelectItem>
                  <SelectItem value="name_asc">{t("tags.sortNameAsc")}</SelectItem>
                  <SelectItem value="name_desc">{t("tags.sortNameDesc")}</SelectItem>
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterSheet>
          {canWrite && (
            <Button onClick={() => setTagForm({ mode: "add", initial: { id: null, name: "", color: "" } })} className="shrink-0">
              <Plus className="size-4" />
              <span className="hidden sm:inline">{t("tags.addTag")}</span>
              <span className="sm:hidden">{t("tags.newShort")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Hash className="size-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("tags.empty")}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("tags.noMatch")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((tag) => (
            <li key={tag.name.toLowerCase()} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/40 transition-colors">
              <button
                type="button"
                onClick={() => drill.open(tag.name)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                aria-label={t("tags.viewEntities", { name: tag.name })}
              >
                <span
                  className="size-9 rounded-lg flex items-center justify-center shrink-0 border"
                  style={tag.color ? { backgroundColor: `${tag.color}22`, borderColor: `${tag.color}55` } : undefined}
                >
                  <Hash className="size-4" style={tag.color ? { color: tag.color } : undefined} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{tag.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {tag.transactions > 0 && (
                      <Badge variant="outline" className="gap-1 px-1.5 text-[10px] font-normal">
                        <Receipt className="size-3" />{tag.transactions} {t("tags.transactions")}
                      </Badge>
                    )}
                    {tag.clients > 0 && (
                      <Badge variant="outline" className="gap-1 px-1.5 text-[10px] font-normal">
                        <User className="size-3" />{tag.clients} {t("tags.clients")}
                      </Badge>
                    )}
                    {tag.quotations > 0 && (
                      <Badge variant="outline" className="gap-1 px-1.5 text-[10px] font-normal">
                        <FileText className="size-3" />{tag.quotations} {t("tags.quotations")}
                      </Badge>
                    )}
                    {tag.total === 0 && (
                      <Badge variant="secondary" className="px-1.5 text-[10px] font-normal">{t("tags.unused")}</Badge>
                    )}
                  </div>
                </div>
              </button>
              {canWrite && (
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setTagForm({ mode: "edit", initial: { id: tag.id, name: tag.name, color: tag.color } })} aria-label={t("tags.edit")}>
                  <Pencil className="size-4" />
                </Button>
              )}
              {canDelete && (
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteTag(tag)} aria-label={t("tags.delete")}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add / edit dialog — always mounted, driven by `tagForm`. */}
      <TagDialog state={tagForm} saving={saving} onSubmit={handleSubmit} onClose={() => setTagForm(null)} />

      {/* Delete-with-choice dialog — always mounted, driven by `deleteTag`. */}
      <DeleteTagDialog tag={deleteTag} onChoose={handleDelete} onClose={() => setDeleteTag(null)} />

      {/* Entity drilldown */}
      <EntityDrilldown
        open={drill.value !== null}
        onClose={() => drill.close()}
        title={drill.value ?? ""}
        endpoint="/api/tags/entities"
        query={{ tag: drill.value ?? "" }}
        typeOptions={[
          { value: "transaction", label: t("tags.transactions") },
          { value: "client", label: t("tags.clients") },
          { value: "quotation", label: t("tags.quotations") },
        ]}
      />
    </div>
  )
}

/** Shared create/edit form: name (normalized to #hashtag) + optional color. */
function TagDialog({
  state, saving, onSubmit, onClose,
}: {
  state: { mode: "add" | "edit"; initial: EditTarget } | null
  saving: boolean
  onSubmit: (values: FormValues) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  // Mirror the last non-null state so content stays rendered through the close animation.
  const [shown, setShown] = useState(state)

  useEffect(() => {
    if (state) {
      setShown(state)
      // Show the name without the leading '#' — it's re-added on normalize.
      setName(state.initial.name.replace(/^#/, ""))
      setColor(state.initial.color)
    }
  }, [state])

  const mode = shown?.mode ?? "add"

  const submit = () => {
    const normalized = normalizeTagName(name)
    if (!normalized) { toast.error(t("tags.nameRequired")); return }
    onSubmit({ name: normalized, color })
  }

  return (
    <Dialog open={state !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? t("tags.addTag") : t("tags.editTag")}</DialogTitle>
          <DialogDescription>{t("tags.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">{t("tags.name")}</Label>
            <div className="relative">
              <Hash className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="tag-name" value={name} maxLength={40} autoFocus placeholder={t("tags.namePlaceholder")} className="pl-9" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit() }} />
            </div>
            <p className="text-[11px] text-muted-foreground">{t("tags.nameHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("tags.color")}</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c || "none"}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={c || t("tags.colorNone")}
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
          <Button onClick={submit} disabled={saving}>{saving ? t("common.saving") : mode === "add" ? t("tags.addTag") : t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Delete-with-choice: remove the tag only (records survive) OR delete the
 *  tagged records too (soft-delete to Trash). Always mounted; `tag` drives it. */
function DeleteTagDialog({
  tag, onChoose, onClose,
}: {
  tag: TagUsage | null
  onChoose: (mode: "tag_only" | "with_records") => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(tag)
  useEffect(() => { if (tag) setShown(tag) }, [tag])
  const target = shown

  return (
    <Dialog open={tag !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{t("tags.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("tags.deleteChoosePrompt", { name: target?.name ?? "" })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <button
            type="button"
            onClick={() => onChoose("tag_only")}
            className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
          >
            <p className="text-sm font-medium">{t("tags.deleteTagOnly")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("tags.deleteTagOnlyHint")}</p>
          </button>
          {(target?.total ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => onChoose("with_records")}
              className="w-full rounded-lg border border-destructive/40 p-3 text-left transition-colors hover:bg-destructive/10"
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />{t("tags.deleteWithRecords")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("tags.deleteWithRecordsHint", { count: target?.total ?? 0 })}</p>
            </button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
