import { useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2 } from "lucide-react"
import { apiPost, apiErrorMessage } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol } from "@/lib/wealth"
import type { BudgetView } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * The two questions the migration deliberately refused to answer (spec §13.4,
 * §13.8).
 *
 * Both exist for the same reason: v1 data carried a meaning the migration could
 * not safely infer, so rather than reinterpreting it silently the ambiguity is
 * left visible and the user is asked once. That is why each of these renders as
 * a QUESTION with named options, not a warning — nothing is wrong, something is
 * merely undecided.
 *
 * Renders nothing when there is nothing outstanding, which is the case for every
 * plan created natively in v2.
 */
export function MigrationPrompts({
  view,
  money,
  canWrite,
  onResolved,
}: {
  view: BudgetView
  money: (n: number) => string
  canWrite: boolean
  onResolved: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)

  const [busy, setBusy] = useState<string | null>(null)
  const [target, setTarget] = useState("")

  const prompts = view.prompts
  if (!canWrite || (!prompts?.lifetime_choice && !prompts?.salary_vs_target)) return null

  const answer = async (prompt: string, choice: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${prompt}:${choice}`)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/budgets/v2/prompts", token, { prompt, choice, ...extra }, ["/api/budgets"])
      toast.success(t("budgetV2.promptSaved"))
      onResolved()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("budgetV2.promptFailed")))
    } finally {
      setBusy(null)
    }
  }

  const lifetime = prompts.lifetime_choice
  const salary = prompts.salary_vs_target
  const targetNum = Number(target)
  const targetOk = Number.isFinite(targetNum) && targetNum > 0

  return (
    <>
      {/* ── §13.4 · a lifetime budget has no monthly equivalent ── */}
      {lifetime && (
        <section
          aria-labelledby="mig-lifetime"
          className="rounded-xl border border-primary/30 bg-primary/5 p-3 sm:p-4"
        >
          <h2 id="mig-lifetime" className="text-sm font-semibold">
            {t("budgetV2.lifetimeTitle")}
          </h2>
          {/* States what does not map and why, without implying the user did
              anything wrong — their old budget is intact and still readable. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {t("budgetV2.lifetimeBody", { amount: money(lifetime.amount) })}
          </p>

          <div className="mt-3 space-y-2">
            <div className="space-y-1.5">
              <Label htmlFor="mig-target">{t("budgetV2.lifetimeTargetLabel")}</Label>
              <div className="relative max-w-[220px]">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {symbol}
                </span>
                <Input
                  id="mig-target"
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="0.00"
                  className="h-11 pl-8 text-base"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-9 text-xs"
                disabled={!targetOk || Boolean(busy)}
                onClick={() => answer("lifetime", "set_target", { amount: targetNum })}
              >
                {busy === "lifetime:set_target" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t("budgetV2.lifetimeSetTarget")
                )}
              </Button>
              {/* Keeping it as a record is a legitimate answer, not a refusal —
                  so it is a real option, not a dismissal in the corner. */}
              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-xs"
                disabled={Boolean(busy)}
                onClick={() => answer("lifetime", "keep_record")}
              >
                {busy === "lifetime:keep_record" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  t("budgetV2.lifetimeKeepRecord")
                )}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ── §13.8 · income entered as a spending target ── */}
      {salary && (
        <section aria-labelledby="mig-salary" className="rounded-xl border bg-muted/30 p-3 sm:p-4">
          <h2 id="mig-salary" className="text-sm font-semibold">
            {t("budgetV2.salaryTitle", { amount: money(salary.target) })}
          </h2>
          {/* Explains WHY we are asking — otherwise the question looks like the
              app second-guessing a number the user typed deliberately. */}
          <p className="mt-1 text-xs text-muted-foreground">{t("budgetV2.salaryBody")}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              disabled={Boolean(busy)}
              onClick={() => answer("salary", "income")}
            >
              {busy === "salary:income" ? <Loader2 className="size-3 animate-spin" /> : t("budgetV2.salaryIsIncome")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              disabled={Boolean(busy)}
              onClick={() => answer("salary", "target")}
            >
              {busy === "salary:target" ? <Loader2 className="size-3 animate-spin" /> : t("budgetV2.salaryIsTarget")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-xs"
              disabled={Boolean(busy)}
              onClick={() => answer("salary", "dismiss")}
            >
              {t("budgetV2.salaryDismiss")}
            </Button>
          </div>
          {/* Says what "my income" will DO, because it clears the target and
              that must not be a surprise. */}
          <p className="mt-2 text-[11px] text-muted-foreground">{t("budgetV2.salaryIncomeNote")}</p>
        </section>
      )}
    </>
  )
}
