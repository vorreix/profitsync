import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2, Trash2, X } from "lucide-react"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol } from "@/lib/wealth"
import { categoryKey } from "@/lib/budget-math"
import type { BudgetEnvelopeView, BudgetSectionName } from "@/lib/types"
import { suggestEnvelopeIcon } from "@/components/budget/envelope-icons"
import { EnvelopeIconPicker } from "@/components/budget/EnvelopeIconPicker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type CategoryRow = { id: string; name: string }

/**
 * Categories are stored per TYPE — `(organization_id, type, name)` is the unique
 * key — so "Rent" can exist once as outgoing and once as incoming. Matching, by
 * contrast, is type-blind: an envelope claims a `categoryKey`, and both of those
 * rows collapse to the same one. Rendering the rows as-is therefore showed the
 * same claimable thing twice, and clicking either chip toggled the same key.
 *
 * Collapse to one chip per key, and sort by name — the raw order is grouped by
 * type, which is why the list read as two interleaved alphabets.
 */
function dedupeByKey(rows: CategoryRow[]): CategoryRow[] {
  const seen = new Map<string, CategoryRow>()
  for (const r of rows) {
    const k = categoryKey(r.name)
    if (k && !seen.has(k)) seen.set(k, r)
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Create or edit one envelope — a spending category, a bills group, a fund or a
 * debt.
 *
 * One component for both modes on purpose: the fields are identical, and a
 * separate edit dialog is how the two drift apart until "add" validates
 * something "edit" does not.
 *
 * Still one decision per section (spec §6.4): a category needs a name, a target
 * and which transaction categories feed it. Carry policy, priority and
 * reimbursable stay off this form — they are defaults with sensible values, and
 * asking about them is what made v1's budget dialog feel like paperwork.
 */
export function EnvelopeDialog({
  open,
  onOpenChange,
  section,
  envelope,
  claimedKeys,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** The section to create in. Ignored when editing (an envelope cannot move section). */
  section: BudgetSectionName
  /** Present ⇒ EDIT mode. */
  envelope?: BudgetEnvelopeView | null
  /** Normalised keys already claimed elsewhere — shown as unavailable. */
  claimedKeys: string[]
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)

  const editing = Boolean(envelope)
  const activeSection: BudgetSectionName = envelope?.section ?? section

  const [name, setName] = useState("")
  const [target, setTarget] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [icon, setIcon] = useState("")
  const [iconTouched, setIconTouched] = useState(false)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Savings only. `virtual` is the default because it needs no Space, is
  // unlimited on every plan and moves no money.
  const [fundingMode, setFundingMode] = useState<"virtual" | "space_backed">("virtual")
  const [goal, setGoal] = useState("")
  const [targetDate, setTargetDate] = useState("")

  const needsCategories = activeSection === "flexible"
  const isSavings = activeSection === "savings"
  // The catch-all claims "everything not claimed", so it has no explicit list
  // and cannot be removed — it is what gives the plan a ceiling at all.
  const isCatchAll = Boolean(envelope?.is_catch_all)
  const claimed = new Set(claimedKeys.filter((k) => !(envelope?.match_keys ?? []).includes(k)))

  useEffect(() => {
    if (!open) return
    setProblem(null)
    setConfirmDelete(false)
    setIconTouched(false)
    if (envelope) {
      setName(envelope.name)
      setTarget(envelope.authored_amount > 0 ? String(envelope.authored_amount) : "")
      setPicked(envelope.match_keys ?? [])
      setIcon(envelope.icon ?? "")
      setFundingMode(envelope.funding_mode === "space_backed" ? "space_backed" : "virtual")
      setGoal(envelope.goal_amount != null ? String(envelope.goal_amount) : "")
      setTargetDate(envelope.target_date ?? "")
    } else {
      setName("")
      setTarget("")
      setPicked([])
      setIcon("")
      setFundingMode("virtual")
      setGoal("")
      setTargetDate("")
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
        // A convenience list: the envelope can still be saved without it.
      }
    })()
    return () => {
      alive = false
    }
  }, [open, envelope, needsCategories, getToken])

  // Suggest an icon from what the user is typing, until they pick one
  // themselves — then never fight them for it.
  useEffect(() => {
    if (iconTouched || editing) return
    setIcon(suggestEnvelopeIcon(name, picked))
  }, [name, picked, iconTouched, editing])

  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  const targetNum = Number(target)
  const targetOk =
    activeSection === "commitment" || activeSection === "debt" || (Number.isFinite(targetNum) && targetNum > 0)
  // A spending category with no categories tracks nothing, so the button says
  // so rather than letting the server refuse it after a round trip.
  const categoriesOk = !needsCategories || isCatchAll || picked.length > 0
  const canSave = name.trim().length > 0 && targetOk && categoriesOk && !saving && !deleting

  const submit = async () => {
    setSaving(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      const payload = {
        name: name.trim(),
        target_amount: Number.isFinite(targetNum) ? targetNum : 0,
        target_cadence: "period",
        icon,
        ...(needsCategories && !isCatchAll ? { match_keys: picked } : {}),
        ...(isSavings
          ? {
              funding_mode: fundingMode,
              goal_amount: Number(goal) > 0 ? Number(goal) : null,
              target_date: targetDate || null,
            }
          : {}),
      }
      if (editing && envelope) {
        await apiPatch(`/api/budgets/v2/envelopes/${envelope.id}`, token, payload)
        toast.success(t("budgetV2.envelopeSaved"))
      } else {
        await apiPost("/api/budgets/v2/envelopes", token, { section: activeSection, ...payload })
        toast.success(t("budgetV2.envelopeCreated"))
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      // The server names which envelope already claims a category, and that is
      // the useful part — keep it on screen instead of in a toast that vanishes
      // before it can be acted on.
      setProblem(err instanceof Error ? err.message : t("budgetV2.envelopeCreateFailed"))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!envelope) return
    setDeleting(true)
    setProblem(null)
    try {
      const token = await getToken()
      if (!token) return
      await apiDelete(`/api/budgets/v2/envelopes/${envelope.id}`, token)
      toast.success(t("budgetV2.envelopeRemoved", { name: envelope.name }))
      onOpenChange(false)
      onSaved()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t("budgetV2.envelopeRemoveFailed"))
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const title = editing
    ? t("budgetV2.editEnvelopeTitle", { name: envelope?.name ?? "" })
    : activeSection === "flexible"
      ? t("budgetV2.addCategoryTitle")
      : activeSection === "commitment"
        ? t("budgetV2.addBillsTitle")
        : activeSection === "debt"
          ? t("budgetV2.addDebtTitle")
          : t("budgetV2.addFundTitle")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {activeSection === "flexible" && !editing
              ? t("budgetV2.addCategoryBody")
              : t("budgetV2.addEnvelopeBody")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="env-name">{t("budgetV2.envelopeName")}</Label>
            <Input
              id="env-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus={!editing}
              className="h-11 text-base"
              placeholder={activeSection === "flexible" ? t("budgetV2.envelopeNamePlaceholder") : undefined}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("budgetV2.envelopeIcon")}</Label>
            <EnvelopeIconPicker
              value={icon}
              section={activeSection}
              onChange={(next) => {
                setIconTouched(true)
                setIcon(next)
              }}
              label={t("budgetV2.envelopeIcon")}
              clearLabel={t("budgetV2.iconDefault")}
            />
          </div>

          {activeSection !== "commitment" && activeSection !== "debt" && (
            <div className="space-y-1.5">
              <Label htmlFor="env-target">{t("budgetV2.envelopeTarget")}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  id="env-target"
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="0.00"
                  className="h-11 pl-8 text-base"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("budgetV2.envelopeTargetHint")}</p>
            </div>
          )}

          {isSavings && (
            <>
              <div className="space-y-1.5">
                <Label>{t("budgetV2.fundMode")}</Label>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("budgetV2.fundMode")}>
                  {(
                    [
                      ["virtual", t("budgetV2.fundVirtual"), t("budgetV2.fundVirtualHint")],
                      ["space_backed", t("budgetV2.fundSpace"), t("budgetV2.fundSpaceHint")],
                    ] as ["virtual" | "space_backed", string, string][]
                  ).map(([value, label, hint]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={fundingMode === value}
                      onClick={() => setFundingMode(value)}
                      className={`pressable flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                        fundingMode === value ? "border-primary bg-primary/5" : "hover:bg-accent"
                      }`}
                    >
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-[11px] text-muted-foreground">{hint}</span>
                    </button>
                  ))}
                </div>
                {fundingMode === "space_backed" && (
                  <p className="text-xs text-muted-foreground">{t("budgetV2.fundSpaceNote")}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="env-goal">{t("budgetV2.fundGoal")}</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {symbol}
                    </span>
                    <Input
                      id="env-goal"
                      inputMode="decimal"
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      placeholder={t("budgetV2.optional")}
                      className="h-11 pl-8 text-base"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="env-target-date">{t("budgetV2.fundBy")}</Label>
                  <Input
                    id="env-target-date"
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="h-11 text-base"
                  />
                </div>
              </div>
            </>
          )}

          {needsCategories && !isCatchAll && (
            <div className="space-y-1.5">
              <Label>
                {t("budgetV2.envelopeCategories")} <span aria-hidden className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">{t("budgetV2.envelopeCategoriesHint")}</p>
              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("budgetV2.noCategories")}</p>
              ) : (
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
                        // A category another envelope owns is shown but disabled,
                        // so the one-category-one-envelope rule is visible before
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
              {/* Says WHY it is required, rather than just marking it invalid. */}
              {!categoriesOk && categories.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("budgetV2.categoriesRequired")}</p>
              )}
            </div>
          )}

          {isCatchAll && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {t("budgetV2.catchAllNote")}
            </p>
          )}

          {problem && (
            <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {problem}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {/* Delete lives on the LEFT, away from Save, and takes two taps. The
              catch-all has none because removing it would leave the plan with no
              ceiling at all. */}
          {editing && !isCatchAll ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-9 gap-1 text-xs"
                  disabled={deleting}
                  onClick={remove}
                >
                  {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                  {t("budgetV2.envelopeRemoveConfirm")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1 text-xs text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3" /> {t("budgetV2.envelopeRemove")}
              </Button>
            )
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={!canSave} className="min-h-11">
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : editing ? (
                t("budgetV2.envelopeSave")
              ) : (
                t("budgetV2.envelopeCreate")
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
