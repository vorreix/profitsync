import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2, X } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol } from "@/lib/wealth"
import type { BudgetSectionName } from "@/lib/types"
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
 * Add one envelope — a spending category, a bills group, a fund or a debt.
 *
 * Deliberately ONE decision per section (spec §6.4): a category needs a name, a
 * target and which transaction categories feed it; nothing else is asked for.
 * Carry policy, priority and reimbursable are defaults the user can change later
 * from the envelope itself, because asking about them here is what made v1's
 * budget dialog feel like a form rather than a decision.
 */
export function AddEnvelopeDialog({
  open,
  onOpenChange,
  section,
  claimedKeys,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  section: BudgetSectionName
  /** Normalised keys already claimed by another envelope — offered as disabled. */
  claimedKeys: string[]
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)

  const [name, setName] = useState("")
  const [target, setTarget] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  // Savings only. `virtual` is the default because it needs no Space, is
  // unlimited on every plan and moves no money — which is what makes a second
  // and third fund possible for a free user at all (spec §8.9).
  const [fundingMode, setFundingMode] = useState<"virtual" | "space_backed">("virtual")
  const [goal, setGoal] = useState("")
  const [targetDate, setTargetDate] = useState("")

  const needsCategories = section === "flexible"
  const isSavings = section === "savings"
  const claimed = new Set(claimedKeys)

  useEffect(() => {
    if (!open) return
    setName("")
    setTarget("")
    setPicked([])
    setConflict(null)
    setFundingMode("virtual")
    setGoal("")
    setTargetDate("")
    if (!needsCategories) return
    let alive = true
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const rows = await apiGet<CategoryRow[]>("/api/categories", token)
        if (alive) setCategories(Array.isArray(rows) ? rows : [])
      } catch {
        // A category list is a convenience: the envelope can still be created
        // and categories attached later, so this failure is not surfaced.
      }
    })()
    return () => {
      alive = false
    }
  }, [open, needsCategories, getToken])

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]))

  const targetNum = Number(target)
  const targetOk = section === "commitment" || section === "debt" || (Number.isFinite(targetNum) && targetNum > 0)
  const canSave = name.trim().length > 0 && targetOk && !saving

  const submit = async () => {
    setSaving(true)
    setConflict(null)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost(
        "/api/budgets/v2/envelopes",
        token,
        {
          section,
          name: name.trim(),
          target_amount: Number.isFinite(targetNum) ? targetNum : 0,
          target_cadence: "period",
          ...(needsCategories ? { match_keys: picked } : {}),
          ...(isSavings
            ? {
                funding_mode: fundingMode,
                goal_amount: Number(goal) > 0 ? Number(goal) : null,
                target_date: targetDate || null,
              }
            : {}),
        },
        ["/api/budgets"],
      )
      toast.success(t("budgetV2.envelopeCreated"))
      onOpenChange(false)
      onCreated()
    } catch (err) {
      // The server names the envelopes that already claim a category, and that
      // message is the useful part — show it in place rather than as a toast
      // that disappears before the user can act on it.
      const msg = err instanceof Error ? err.message : ""
      setConflict(msg || t("budgetV2.envelopeCreateFailed"))
    } finally {
      setSaving(false)
    }
  }

  const title =
    section === "flexible"
      ? t("budgetV2.addCategoryTitle")
      : section === "commitment"
        ? t("budgetV2.addBillsTitle")
        : section === "debt"
          ? t("budgetV2.addDebtTitle")
          : t("budgetV2.addFundTitle")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {section === "flexible" ? t("budgetV2.addCategoryBody") : t("budgetV2.addEnvelopeBody")}
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
              autoFocus
              className="h-11 text-base"
              placeholder={section === "flexible" ? t("budgetV2.envelopeNamePlaceholder") : undefined}
            />
          </div>

          {section !== "commitment" && section !== "debt" && (
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
              {/* Where the money actually sits. The consequence of each choice
                  is stated, because it is the difference between money being
                  held back and money physically leaving the account. */}
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

              {/* A goal is optional: a fund can simply hold money back with no
                  target, and requiring one would make the simple case harder. */}
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

          {needsCategories && (
            <div className="space-y-1.5">
              <Label>{t("budgetV2.envelopeCategories")}</Label>
              <p className="text-xs text-muted-foreground">{t("budgetV2.envelopeCategoriesHint")}</p>
              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("budgetV2.noCategories")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {categories.map((c) => {
                    const key = c.name.trim().toLowerCase()
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
                        // the user hits it rather than after.
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
            </div>
          )}

          {conflict && (
            <p role="alert" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {conflict}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSave} className="min-h-11">
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("budgetV2.envelopeCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
