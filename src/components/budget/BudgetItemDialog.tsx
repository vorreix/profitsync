import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2, Plus, Trash2, X } from "lucide-react"
import { apiDelete, apiErrorMessage, apiGet, apiPatch, apiPost } from "@/lib/api"
import { categoryKey, targetForWindow } from "@/lib/budget-math"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol, formatMoney } from "@/lib/wealth"
import type { BudgetGroupView, BudgetItemView, BudgetView } from "@/lib/types"
import { envelopeIcon, suggestEnvelopeIcon } from "@/components/budget/envelope-icons"
import { EnvelopeIconPicker } from "@/components/budget/EnvelopeIconPicker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type CategoryRow = { id: string; name: string }
type PlanCadence = NonNullable<BudgetView["plan"]>["cadence"]

/**
 * Add or edit one line of the budgets list (docs/budget-v2/SIMPLE.md).
 *
 * A BUDGET is: which spending counts here, a name, a limit — in that order,
 * because the categories are the decision and the name follows from them. The
 * icon is suggested from the name and hidden behind one small button; a group
 * to belong to is offered only when groups exist.
 *
 * A GROUP is a name. Its figures are the sum of what is put inside it.
 *
 * One dialog does create and edit so the two cannot drift apart, and Remove
 * lives here too behind a two-tap confirm.
 */
export function BudgetItemDialog({
  open,
  onOpenChange,
  kind,
  item,
  groups,
  claimedKeys,
  planCadence,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  kind: "category" | "group"
  /** Present in EDIT mode. */
  item?: BudgetItemView | BudgetGroupView | null
  groups: BudgetGroupView[]
  /** Category keys other budgets already claim. */
  claimedKeys: string[]
  planCadence: PlanCadence
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)
  const editing = Boolean(item)
  const isGroup = kind === "group"
  const isCatchAll = item?.kind === "category" && item.is_catch_all

  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [limit, setLimit] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [parentId, setParentId] = useState("")
  const [icon, setIcon] = useState("")
  const [iconTouched, setIconTouched] = useState(false)
  const [iconsOpen, setIconsOpen] = useState(false)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [newCategory, setNewCategory] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const needsCategories = !isGroup && !isCatchAll
  const own = new Set(item?.kind === "category" ? item.match_keys : [])
  const claimed = new Set(claimedKeys.filter((k) => !own.has(k)))

  useEffect(() => {
    if (!open) return
    setProblem(null)
    setConfirmDelete(false)
    setIconTouched(false)
    setIconsOpen(false)
    setNewCategory("")
    if (item) {
      setName(item.name)
      setNameTouched(true)
      setIcon(item.icon ?? "")
      if (item.kind === "category") {
        setLimit(item.authored_amount > 0 ? String(item.authored_amount) : "")
        setPicked(item.match_keys ?? [])
        setParentId(item.parent_id ?? "")
      } else {
        setLimit("")
        setPicked([])
        setParentId("")
      }
    } else {
      setName("")
      setNameTouched(false)
      setLimit("")
      setPicked([])
      setParentId("")
      setIcon("")
    }
    if (!needsCategories) return
    let alive = true
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const rows = await apiGet<CategoryRow[]>("/api/categories", token)
        if (alive) setCategories(dedupeByKey(Array.isArray(rows) ? rows : []))
      } catch {
        // A convenience list: the budget can still be saved by typing a new category.
      }
    })()
    return () => {
      alive = false
    }
  }, [open, item, needsCategories, getToken])

  // The name follows the first picked category until the user types one.
  useEffect(() => {
    if (nameTouched || editing || isGroup) return
    const first = picked[0]
    const label = first ? categories.find((c) => categoryKey(c.name) === first)?.name : ""
    setName(label ?? "")
  }, [picked, categories, nameTouched, editing, isGroup])

  // Suggest an icon from what is being typed, until the user picks one.
  useEffect(() => {
    if (iconTouched || editing) return
    setIcon(isGroup ? suggestEnvelopeIcon(name) : suggestEnvelopeIcon(name, picked))
  }, [name, picked, iconTouched, editing, isGroup])

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  const limitNum = Number(limit)
  const limitOk = isGroup || (Number.isFinite(limitNum) && limitNum > 0)
  const categoriesOk = !needsCategories || picked.length > 0
  const canSave = name.trim().length > 0 && limitOk && categoriesOk && !saving && !deleting

  const limitLabel =
    planCadence === "weekly"
      ? t("budgetV2.limitWeekly")
      : planCadence === "custom"
        ? t("budgetV2.limitPeriod")
        : t("budgetV2.limitMonthly")
  const equivalents =
    limitOk && !isGroup
      ? {
          week: formatMoney(targetForWindow(limitNum, "period", planCadence, null, "week"), currency),
          year: formatMoney(targetForWindow(limitNum, "period", planCadence, null, "year"), currency),
        }
      : null

  const createCategory = async () => {
    const value = newCategory.trim()
    if (!value) return
    setCreatingCategory(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      const created = await apiPost<{ name: string }>("/api/categories", token, { name: value, types: ["outgoing"] })
      const label = created?.name ?? value
      const key = categoryKey(label)
      setCategories((prev) => dedupeByKey([...prev, { id: `new-${key}`, name: label }]))
      if (!picked.includes(key)) setPicked((p) => [...p, key])
      setNewCategory("")
    } catch (err) {
      setProblem(apiErrorMessage(err, t("budgetV2.categoryCreateFailed")))
    } finally {
      setCreatingCategory(false)
    }
  }

  const submit = async () => {
    setSaving(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      const base = { name: name.trim(), icon }
      if (editing && item) {
        const payload =
          item.kind === "group"
            ? base
            : {
                ...base,
                target_amount: limitNum,
                target_cadence: "period",
                ...(isCatchAll ? {} : { match_keys: picked, parent_id: parentId || null }),
              }
        await apiPatch(`/api/budgets/v2/envelopes/${item.id}`, token, payload, ["/api/budgets"])
        toast.success(t("budgetV2.envelopeSaved"))
      } else if (isGroup) {
        await apiPost("/api/budgets/v2/envelopes", token, { kind: "group", section: "flexible", ...base }, ["/api/budgets"])
        toast.success(t("budgetV2.groupAdded"))
      } else {
        await apiPost(
          "/api/budgets/v2/envelopes",
          token,
          {
            kind: "category",
            section: "flexible",
            ...base,
            target_amount: limitNum,
            target_cadence: "period",
            match_keys: picked,
            parent_id: parentId || null,
          },
          ["/api/budgets"],
        )
        toast.success(t("budgetV2.budgetAdded"))
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      // The server names which budget already claims a category — keep it on
      // screen rather than in a toast that vanishes before it can be acted on.
      setProblem(apiErrorMessage(err, t("budgetV2.envelopeCreateFailed")))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!item) return
    setDeleting(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/budgets/v2/envelopes/${item.id}`, token, undefined, ["/api/budgets"])
      toast.success(t("budgetV2.envelopeRemoved", { name: item.name }))
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setProblem(apiErrorMessage(err, t("budgetV2.envelopeRemoveFailed")))
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const title = editing
    ? t("budgetV2.editEnvelopeTitle", { name: item?.name ?? "" })
    : isGroup
      ? t("budgetV2.addGroupTitle")
      : t("budgetV2.addBudgetTitle")
  const Glyph = envelopeIcon(icon, "flexible")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{isGroup ? t("budgetV2.addGroupBody") : t("budgetV2.addBudgetBody")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 1 ── which spending counts here. The decision the rest follows from. */}
          {needsCategories && (
            <div className="space-y-1.5">
              <Label>
                {t("budgetV2.budgetCategoriesLabel")} <span aria-hidden className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">{t("budgetV2.budgetCategoriesHint")}</p>
              {categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {categories.map((c) => {
                    const key = categoryKey(c.name)
                    const taken = claimed.has(key)
                    const on = picked.includes(key)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={taken}
                        onClick={() => toggle(key)}
                        aria-pressed={on}
                        // A category another budget owns is shown but disabled,
                        // so the one-category-one-budget rule is visible before
                        // you hit it rather than after.
                        title={taken ? t("budgetV2.categoryTaken") : undefined}
                        className={`pressable inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs transition-colors ${
                          taken
                            ? "cursor-not-allowed border-dashed text-muted-foreground/60"
                            : on
                              ? "border-primary bg-primary/10 font-medium"
                              : "hover:bg-accent"
                        }`}
                      >
                        {c.name}
                        {on && <X className="size-3" aria-hidden />}
                      </button>
                    )
                  })}
                </div>
              )}
              {/* A category that does not exist yet is one field away. */}
              <div className="flex gap-2 pt-1">
                <Input
                  id="env-new-category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void createCategory()
                    }
                  }}
                  maxLength={60}
                  placeholder={t("budgetV2.newCategoryPlaceholder")}
                  aria-label={t("budgetV2.newCategory")}
                  className="h-11 text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 shrink-0"
                  disabled={!newCategory.trim() || creatingCategory}
                  onClick={() => void createCategory()}
                >
                  {creatingCategory ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" aria-hidden />}
                  {t("budgetV2.createCategory")}
                </Button>
              </div>
              {!categoriesOk && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("budgetV2.categoriesRequired")}</p>
              )}
            </div>
          )}

          {/* 2 ── name, with the icon folded beside it. */}
          <div className="space-y-1.5">
            <Label htmlFor="env-name">{t("budgetV2.envelopeName")}</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIconsOpen((v) => !v)}
                aria-expanded={iconsOpen}
                aria-label={t("budgetV2.changeIcon")}
                title={t("budgetV2.changeIcon")}
                className="pressable flex size-11 shrink-0 items-center justify-center rounded-md border transition-colors hover:bg-accent"
              >
                <Glyph className="size-4" aria-hidden />
              </button>
              <Input
                id="env-name"
                value={name}
                onChange={(e) => {
                  setNameTouched(true)
                  setName(e.target.value)
                }}
                maxLength={80}
                autoFocus={isGroup && !editing}
                className="h-11 text-base"
                placeholder={isGroup ? t("budgetV2.groupNamePlaceholder") : t("budgetV2.envelopeNamePlaceholder")}
              />
            </div>
            {iconsOpen && (
              <div className="rounded-lg border p-2">
                <EnvelopeIconPicker
                  value={icon}
                  section="flexible"
                  onChange={(next) => {
                    setIconTouched(true)
                    setIcon(next)
                    setIconsOpen(false)
                  }}
                  label={t("budgetV2.envelopeIcon")}
                  clearLabel={t("budgetV2.iconDefault")}
                />
              </div>
            )}
          </div>

          {/* 3 ── the limit, in the plan's own rhythm, with what it means elsewhere. */}
          {!isGroup && (
            <div className="space-y-1.5">
              <Label htmlFor="env-target">{limitLabel}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  id="env-target"
                  inputMode="decimal"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="0.00"
                  className="h-11 pl-8 text-base"
                />
              </div>
              {equivalents && (
                <p className="text-xs text-muted-foreground">
                  {t("budgetV2.limitEquivalents", { week: equivalents.week, year: equivalents.year })}
                </p>
              )}
            </div>
          )}

          {/* 4 ── a group to belong to, only when there is one to belong to. */}
          {!isGroup && !isCatchAll && groups.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="env-parent">{t("budgetV2.partOf")}</Label>
              <NativeSelect id="env-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className="h-11">
                <NativeSelectOption value="">{t("budgetV2.noGroup")}</NativeSelectOption>
                {groups.map((g) => (
                  <NativeSelectOption key={g.id} value={g.id}>
                    {g.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )}

          {isCatchAll && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t("budgetV2.catchAllNoteSimple")}</p>
          )}

          {problem && (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {/* Remove sits on the LEFT, away from Save, behind a second tap. */}
          <div className="flex items-center gap-2">
            {editing && !isCatchAll ? (
              confirmDelete ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" aria-hidden />}
                  {t("budgetV2.envelopeRemoveConfirm")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 text-destructive hover:text-destructive sm:h-9"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-3.5" aria-hidden /> {t("budgetV2.envelopeRemove")}
                </Button>
              )
            ) : (
              <span />
            )}
            {editing && confirmDelete && item?.kind === "group" && (
              <span className="text-xs text-muted-foreground">{t("budgetV2.removeGroupNote")}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={() => onOpenChange(false)}>
              {t("budgetV2.cancel")}
            </Button>
            <Button type="button" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={!canSave} onClick={() => void submit()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? t("budgetV2.envelopeSave") : t("budgetV2.envelopeCreate")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One chip per category KEY — the org's list has one row per type, so the same name can appear twice. */
function dedupeByKey(rows: CategoryRow[]): CategoryRow[] {
  const seen = new Set<string>()
  const out: CategoryRow[] = []
  for (const r of rows) {
    const key = categoryKey(r.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
