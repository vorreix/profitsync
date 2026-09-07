import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ChevronDown, Loader as Loader2, Plus, Trash2, X } from "lucide-react"
import { apiDelete, apiPatch, apiPost } from "@/lib/api"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol, formatMoney } from "@/lib/wealth"
import { SPENDING_PERIODS, categoryKey, isIsoDate, type SpendingPeriod } from "@/lib/budget"
import type { Category, SpendingBudget } from "@/lib/types"
import { budgetIcon, suggestBudgetIcon } from "@/components/budget/budget-icons"
import { BudgetIconPicker } from "@/components/budget/BudgetIconPicker"
import { budgetErrorMessage, budgetName, periodLabel } from "@/components/budget/budget-format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type SpendingBudgetDialogMode =
  | { kind: "create" }
  | { kind: "createSub"; parent: SpendingBudget }
  | { kind: "edit"; budget: SpendingBudget }

/**
 * Create or edit a budget — one dialog for both so they cannot drift apart.
 *
 * A MAIN budget asks for the essentials first (name, limit, how often) and
 * keeps the category scope folded away, because "all spending" is a fine
 * answer and most first budgets are exactly that. A SUB-BUDGET is the other
 * way round: the categories ARE the decision, so they come first and are
 * required; its name follows the first pick until typed; its window is its
 * parent's, so there is nothing to choose. Remove lives here too, behind a
 * two-tap confirm, on the far side of the footer from Save.
 */
export function SpendingBudgetDialog({
  open,
  onOpenChange,
  mode,
  all,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: SpendingBudgetDialogMode
  /** Every budget of the workspace — siblings for the claim check, the parent for scope. */
  all: SpendingBudget[]
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)
  const money = (n: number) => formatMoney(n, currency)

  const editing = mode.kind === "edit" ? mode.budget : null
  const parent = mode.kind === "createSub" ? mode.parent : editing?.parent_id ? all.find((b) => b.id === editing.parent_id) ?? null : null
  const isSub = !!parent
  const children = editing ? all.filter((b) => b.parent_id === editing.id) : []

  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [amount, setAmount] = useState("")
  const [period, setPeriod] = useState<SpendingPeriod>("monthly")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [scopeOpen, setScopeOpen] = useState(false)
  const [icon, setIcon] = useState("")
  const [iconTouched, setIconTouched] = useState(false)
  const [iconsOpen, setIconsOpen] = useState(false)
  const [newCategory, setNewCategory] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const cats = useApiQuery<Category[]>(open ? "/api/categories?type=outgoing" : null)

  // Seed from the budget being edited, or a clean slate.
  useEffect(() => {
    if (!open) return
    setProblem(null)
    setConfirmDelete(false)
    setIconTouched(false)
    setIconsOpen(false)
    setNewCategory("")
    if (editing) {
      setName(editing.name)
      setNameTouched(true)
      setAmount(editing.amount > 0 ? String(editing.amount) : "")
      setPeriod(editing.period)
      setStartDate(editing.start_date ?? "")
      setEndDate(editing.end_date ?? "")
      setPicked(editing.categories)
      setScopeOpen(editing.categories.length > 0)
      setIcon(editing.icon)
    } else {
      setName("")
      setNameTouched(false)
      setAmount("")
      setPeriod("monthly")
      setStartDate("")
      setEndDate("")
      setPicked([])
      setScopeOpen(false)
      setIcon("")
    }
  }, [open, editing])

  // The name follows the first picked category until the user types one, and
  // the icon follows the name until the user picks one.
  useEffect(() => {
    if (!open || nameTouched) return
    if (isSub && picked.length) setName(picked[0])
  }, [open, isSub, picked, nameTouched])
  useEffect(() => {
    if (!open || iconTouched) return
    setIcon(suggestBudgetIcon(name, picked))
  }, [open, name, picked, iconTouched])

  // Which chips to offer: the org's expense categories, restricted to the
  // parent's scope for a sub-budget, plus anything this budget already names
  // that no longer exists (so an old scope stays visible and removable).
  const options = useMemo(() => {
    const names = (cats.data ?? []).map((c) => c.name)
    const base = parent && parent.categories.length ? parent.categories : names
    const keys = new Set(base.map(categoryKey))
    const extra = picked.filter((c) => !keys.has(categoryKey(c)))
    return [...base, ...extra]
  }, [cats.data, parent, picked])

  // A sibling's claim on a category, by key.
  const claimedBy = useMemo(() => {
    const m = new Map<string, string>()
    if (!parent) return m
    for (const s of all) {
      if (s.parent_id !== parent.id || s.id === editing?.id) continue
      for (const c of s.categories) m.set(categoryKey(c), budgetName(t, s))
    }
    return m
  }, [all, parent, editing, t])

  const pickedKeys = new Set(picked.map(categoryKey))
  const toggle = (c: string) => {
    const k = categoryKey(c)
    setPicked((list) => (list.some((x) => categoryKey(x) === k) ? list.filter((x) => categoryKey(x) !== k) : [...list, c]))
  }

  const amt = Number(amount)
  const childrenTotal = children.reduce((s, c) => s + c.amount, 0)
  const nameOk = name.trim().length > 0 || (!isSub && picked.length === 0)
  const datesOk = period !== "once" || ((!startDate || isIsoDate(startDate)) && (!endDate || isIsoDate(endDate)) && (!startDate || !endDate || endDate >= startDate))
  const canSave = !saving && !deleting && Number.isFinite(amt) && amt > 0 && nameOk && datesOk && (!isSub || picked.length > 0)

  const createCategory = async () => {
    const value = newCategory.trim()
    if (!value || creatingCategory) return
    setCreatingCategory(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/categories", token, { name: value, type: "outgoing" })
      setPicked((list) => (list.some((x) => categoryKey(x) === categoryKey(value)) ? list : [...list, value]))
      setNewCategory("")
      cats.refetch()
    } catch (err) {
      setProblem(readError(err))
    } finally {
      setCreatingCategory(false)
    }
  }

  const readError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err)
    try {
      const j = JSON.parse(raw) as { error?: string } & Record<string, unknown>
      return budgetErrorMessage(t, j.error ?? "", j)
    } catch {
      return budgetErrorMessage(t, raw)
    }
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      const body: Record<string, unknown> = {
        name: name.trim(),
        amount: amt,
        categories: picked,
        icon,
      }
      if (!isSub) {
        body.period = period
        body.start_date = period === "once" && startDate ? startDate : null
        body.end_date = period === "once" && endDate ? endDate : null
      }
      if (editing) {
        await apiPatch(`/api/spending-budgets/${editing.id}`, token, body)
      } else {
        if (parent) body.parent_id = parent.id
        await apiPost("/api/spending-budgets", token, body)
      }
      toast.success(t("budgets.saved"))
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setProblem(readError(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!editing) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/spending-budgets/${editing.id}`, token)
      toast.success(t("budgets.removed"))
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setProblem(readError(err))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const title = editing
    ? isSub ? t("budgets.dialog.editSubTitle") : t("budgets.dialog.editTitle")
    : isSub ? t("budgets.dialog.createSubTitle") : t("budgets.dialog.createTitle")
  const Icon = budgetIcon(icon)

  const categoryChips = (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {isSub
          ? parent && parent.categories.length
            ? t("budgets.dialog.categoriesHintParent", { parent: budgetName(t, parent) })
            : t("budgets.dialog.categoriesHintSub")
          : t("budgets.dialog.categoriesHint")}
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("budgets.dialog.categoriesLabel")}>
        {options.map((c) => {
          const k = categoryKey(c)
          const on = pickedKeys.has(k)
          const taken = !on && claimedBy.has(k)
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              disabled={taken}
              onClick={() => toggle(c)}
              className={`pressable inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm transition-colors sm:min-h-9 ${
                on ? "border-primary bg-primary/10 text-foreground" : taken ? "cursor-not-allowed border-dashed text-muted-foreground/60" : "hover:bg-accent"
              }`}
            >
              {c}
              {on && <X className="size-3.5" aria-hidden />}
            </button>
          )
        })}
        {cats.loading && options.length === 0 && <span className="text-xs text-muted-foreground">…</span>}
      </div>
      {[...claimedBy.entries()].filter(([k]) => !pickedKeys.has(k)).slice(0, 3).map(([k, who]) => (
        <p key={k} className="text-[11px] text-muted-foreground">
          {t("budgets.dialog.claimedBy", { category: options.find((o) => categoryKey(o) === k) ?? k, name: who })}
        </p>
      ))}
      {(!parent || parent.categories.length === 0) && (
        <div className="flex gap-2">
          <Input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createCategory() } }}
            placeholder={t("budgets.dialog.newCategoryPlaceholder")}
            aria-label={t("budgets.dialog.newCategoryPlaceholder")}
            className="h-11 text-base sm:text-sm"
          />
          <Button type="button" variant="outline" className="h-11 shrink-0" disabled={!newCategory.trim() || creatingCategory} onClick={() => void createCategory()}>
            {creatingCategory ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} {t("budgets.dialog.createCategory")}
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving && !deleting) onOpenChange(v) }}>
      <DialogContent className="max-h-[92dvh] w-[94vw] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {parent ? t("budgets.dialog.subOf", { parent: budgetName(t, parent) }) : t("budgets.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isSub && (
            <div className="space-y-1.5">
              <Label>{t("budgets.dialog.categoriesLabel")} <span className="text-destructive">*</span></Label>
              {categoryChips}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="sb-name">{t("budgets.dialog.nameLabel")}</Label>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={t("budgets.dialog.chooseIcon")}
                aria-expanded={iconsOpen}
                onClick={() => setIconsOpen((v) => !v)}
                className="pressable flex size-11 shrink-0 items-center justify-center rounded-md border hover:bg-accent"
              >
                <Icon className="size-4" aria-hidden />
              </button>
              <Input
                id="sb-name"
                value={name}
                autoFocus={!isSub}
                onChange={(e) => { setName(e.target.value); setNameTouched(true) }}
                placeholder={isSub ? t("budgets.dialog.namePlaceholder") : t("budgets.personal")}
                className="h-11 text-base sm:text-sm"
              />
            </div>
            {iconsOpen && (
              <div className="pt-1">
                <BudgetIconPicker value={icon} onChange={(k) => { setIcon(k); setIconTouched(true) }} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sb-amount">{t("budgets.dialog.limitLabel")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
              <Input
                id="sb-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="h-11 ps-8 text-base sm:text-sm"
              />
            </div>
            {editing && !isSub && children.length > 0 && (
              <p className={`flex flex-wrap items-center gap-x-2 text-xs ${childrenTotal > amt && amt > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {childrenTotal > amt && amt > 0
                  ? t("budgets.dialog.subBudgetsOver", { amount: money(childrenTotal) })
                  : t("budgets.dialog.subBudgetsTotal", { amount: money(childrenTotal) })}
                {childrenTotal > 0 && childrenTotal !== amt && (
                  <button type="button" className="pressable font-medium text-primary underline-offset-2 hover:underline" onClick={() => setAmount(String(childrenTotal))}>
                    {t("budgets.dialog.useTotal")}
                  </button>
                )}
              </p>
            )}
          </div>

          {isSub ? (
            parent && (
              <p className="text-xs text-muted-foreground">
                {t("budgets.dialog.subInherits", { parent: budgetName(t, parent), period: parent.period === "once" ? t("budget.once") : periodLabel(t, parent.period) })}
              </p>
            )
          ) : (
            <div className="space-y-1.5">
              <Label>{t("budgets.dialog.periodLabel")}</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("budgets.dialog.periodLabel")}>
                {SPENDING_PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={period === p}
                    onClick={() => setPeriod(p)}
                    className={`pressable inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors sm:min-h-9 ${period === p ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
                  >
                    {t(`budget.${p}`)}
                  </button>
                ))}
              </div>
              {period === "once" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="space-y-1">
                    <Label htmlFor="sb-from" className="text-xs">{t("budgets.dialog.fromLabel")}</Label>
                    <Input id="sb-from" type="date" lang={i18n.language} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-11 text-base sm:text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sb-until" className="text-xs">{t("budgets.dialog.untilLabel")}</Label>
                    <Input id="sb-until" type="date" lang={i18n.language} value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className="h-11 text-base sm:text-sm" />
                  </div>
                  <p className="col-span-2 text-[11px] text-muted-foreground">{t("budgets.dialog.datesHint")}</p>
                </div>
              )}
            </div>
          )}

          {!isSub && (
            <div className="rounded-lg border">
              <button
                type="button"
                aria-expanded={scopeOpen}
                onClick={() => setScopeOpen((v) => !v)}
                className="pressable flex min-h-11 w-full items-center justify-between gap-2 px-3 text-start text-sm"
              >
                <span>
                  {t("budgets.dialog.categoriesToggle")}
                  <span className="ms-2 text-xs text-muted-foreground">
                    {picked.length ? t("budgets.categoriesCount", { count: picked.length }) : t("budgets.allSpending")}
                  </span>
                </span>
                <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${scopeOpen ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {scopeOpen && <div className="border-t p-3">{categoryChips}</div>}
            </div>
          )}

          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:items-center">
          {editing && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={saving || deleting}
                onClick={() => void remove()}
                className="h-11 w-full justify-center text-destructive hover:bg-destructive/10 hover:text-destructive sm:me-auto sm:h-9 sm:w-auto"
              >
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {confirmDelete ? t("budgets.dialog.confirmRemove") : t("budgets.dialog.remove")}
              </Button>
              <div className="h-px bg-border sm:hidden" aria-hidden />
            </>
          )}
          <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
            {t("common.cancel")}
          </Button>
          <Button className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => void save()} disabled={!canSave} data-testid="budget-save">
            {saving ? <Loader2 className="size-4 animate-spin" /> : editing ? t("budgets.dialog.save") : t("budgets.dialog.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
