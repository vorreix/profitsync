import { useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2 } from "lucide-react"
import { apiPost } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { currencySymbol } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * First-budget onboarding — FOUR DECISIONS, one question per screen (spec §6.1).
 *
 * The acceptance criterion is decisions, not taps: period · income-or-varies ·
 * one spending target · confirm. Categories, commitments, savings, funds, debt,
 * rollover, timezone, accounts and priorities are deliberately ABSENT here —
 * they are added later from the plan itself (progressive disclosure, P2).
 */
type Cadence = "monthly" | "weekly" | "payday"

export function BudgetWizard({ onCreated, onSkip }: { onCreated: () => void; onSkip?: () => void }) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)

  const [step, setStep] = useState(1)
  const [cadence, setCadence] = useState<Cadence>("monthly")
  const [anchorDay, setAnchorDay] = useState("27")
  const [income, setIncome] = useState("")
  const [incomeVaries, setIncomeVaries] = useState(false)
  const [target, setTarget] = useState("")
  const [saving, setSaving] = useState(false)

  const TOTAL = 4

  const incomeOk = incomeVaries || (Number.isFinite(Number(income)) && Number(income) > 0)
  const targetOk = Number.isFinite(Number(target)) && Number(target) > 0

  const create = async () => {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost(
        "/api/budgets/v2",
        token,
        {
          cadence,
          ...(cadence === "payday" ? { anchor_day: Number(anchorDay) || 1 } : {}),
          // The browser's zone is the best available default; the server
          // re-validates it with safeTimezone() before storing.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          income_mode: incomeVaries ? "available" : "expected",
          expected_income: incomeVaries ? null : Number(income),
          spending_target: Number(target),
        },
      )
      // The plan exists; sync opens its first period.
      await apiPost("/api/budgets/v2/sync", token, {})
      toast.success(t("budgetV2.created"))
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budgetV2.createFailed"))
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-1">
      {/* Progress dots — position, not a percentage. */}
      <div className="mb-6 flex items-center justify-center gap-1.5" aria-hidden>
        {Array.from({ length: TOTAL }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${i + 1 === step ? "w-6 bg-primary" : i + 1 < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted"}`}
          />
        ))}
      </div>
      <p className="mb-6 text-center text-xs text-muted-foreground">
        {t("budgetV2.wizardStep", { current: step, total: TOTAL })}
      </p>

      {/* 1 ── planning period */}
      {step === 1 && (
        <section aria-labelledby="wz-1">
          <h2 id="wz-1" className="text-center text-xl font-semibold tracking-tight">
            {t("budgetV2.wizardPeriodQuestion")}
          </h2>
          <div className="mt-6 space-y-2">
            {(
              [
                ["monthly", t("budgetV2.wizardPeriodMonthly")],
                ["weekly", t("budgetV2.wizardPeriodWeekly")],
                ["payday", t("budgetV2.wizardPeriodPayday")],
              ] as [Cadence, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCadence(value)}
                aria-pressed={cadence === value}
                className={`pressable flex min-h-11 w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                  cadence === value ? "border-primary bg-primary/5 font-medium" : "hover:bg-accent"
                }`}
              >
                {label}
                {cadence === value && <span className="size-2 rounded-full bg-primary" aria-hidden />}
              </button>
            ))}
          </div>
          {cadence === "payday" && (
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="wz-anchor">{t("budgetV2.wizardPaydayLabel")}</Label>
              <Input
                id="wz-anchor"
                inputMode="numeric"
                value={anchorDay}
                onChange={(e) => setAnchorDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
                className="h-11"
              />
            </div>
          )}
          <p className="mt-3 text-center text-xs text-muted-foreground">{t("budgetV2.wizardPeriodHint")}</p>
        </section>
      )}

      {/* 2 ── expected income, or "my income varies" */}
      {step === 2 && (
        <section aria-labelledby="wz-2">
          <h2 id="wz-2" className="text-center text-xl font-semibold tracking-tight">
            {t("budgetV2.wizardIncomeQuestion")}
          </h2>
          <div className="mt-6 space-y-1.5">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {symbol}
              </span>
              <Input
                inputMode="decimal"
                autoFocus
                value={income}
                disabled={incomeVaries}
                onChange={(e) => setIncome(e.target.value)}
                placeholder="0.00"
                className="h-11 pl-8 text-base"
                aria-label={t("budgetV2.wizardIncomeQuestion")}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("budgetV2.wizardIncomeHint")}</p>
          </div>
          <button
            type="button"
            onClick={() => setIncomeVaries((v) => !v)}
            aria-pressed={incomeVaries}
            className={`pressable mt-4 flex min-h-11 w-full flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors ${
              incomeVaries ? "border-primary bg-primary/5" : "hover:bg-accent"
            }`}
          >
            <span className="text-sm font-medium">{t("budgetV2.wizardIncomeVaries")}</span>
            <span className="text-xs text-muted-foreground">{t("budgetV2.wizardIncomeVariesHint")}</span>
          </button>
        </section>
      )}

      {/* 3 ── one overall spending target */}
      {step === 3 && (
        <section aria-labelledby="wz-3">
          <h2 id="wz-3" className="text-center text-xl font-semibold tracking-tight">
            {t("budgetV2.wizardTargetQuestion")}
          </h2>
          <div className="mt-6 space-y-1.5">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {symbol}
              </span>
              <Input
                inputMode="decimal"
                autoFocus
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0.00"
                className="h-11 pl-8 text-base"
                aria-label={t("budgetV2.wizardTargetQuestion")}
              />
            </div>
          </div>
        </section>
      )}

      {/* 4 ── confirm */}
      {step === 4 && (
        <section aria-labelledby="wz-4" className="text-center">
          <h2 id="wz-4" className="text-xl font-semibold tracking-tight">
            {t("budgetV2.wizardSummaryTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("budgetV2.wizardSummaryBody")}</p>
        </section>
      )}

      {/* Actions — primary in the lower part of the screen for thumb reach. */}
      <div className="mt-8 space-y-2">
        {step < TOTAL ? (
          <Button
            className="h-11 w-full"
            disabled={(step === 2 && !incomeOk) || (step === 3 && !targetOk)}
            onClick={() => setStep((s) => s + 1)}
          >
            {t("budgetV2.wizardContinue")}
          </Button>
        ) : (
          <Button className="h-11 w-full" disabled={saving} onClick={create}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("budgetV2.wizardCreate")}
          </Button>
        )}
        <div className="flex items-center justify-between">
          {step > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)} disabled={saving}>
              {t("budgetV2.wizardBack")}
            </Button>
          ) : (
            <span />
          )}
          {onSkip && (
            <Button variant="ghost" size="sm" onClick={onSkip} disabled={saving}>
              {t("budgetV2.wizardSkip")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
