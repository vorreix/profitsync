import { useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowRightLeft, Check, Loader as Loader2, Plus, SkipForward, Undo2 } from "lucide-react"
import { apiPost } from "@/lib/api"
import type { BudgetEnvelopeView, BudgetView } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

/**
 * Savings funds (spec §8.9, §8.9.1).
 *
 * The distinction this component exists to hold: a planned contribution is
 * RESERVED but not yet set aside, and only a CONFIRMED one may be called
 * "set aside". Nobody did anything for a merely planned contribution, and a
 * fund balance is a money-like figure the user will trust — so the two states
 * are worded and coloured differently, and the confirm action is always the
 * user's own decision.
 *
 * Confirming is reserved-neutral by design: the amount moves from
 * "reserved, not yet confirmed" into the fund balance and safe-to-spend does
 * not move. The copy says so, because a figure that jumps for no visible
 * reason is exactly what makes people distrust a budget.
 */
export function SavingsSection({
  view,
  money,
  canWrite,
  onAdd,
  onOpenDetail,
  onChanged,
}: {
  view: BudgetView
  money: (n: number) => string
  canWrite: boolean
  onAdd: () => void
  onOpenDetail: (env: BudgetEnvelopeView) => void
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)

  const s = view.sections?.savings
  if (!s) return null

  const funds = s.envelopes
  // Hidden entirely when there are no funds — except for the single affordance
  // that lets a user create the first one (progressive disclosure, P2).
  if (!funds.length) {
    if (!canWrite) return null
    return (
      <Card className="py-0">
        <CardContent className="p-4">
          <p className="text-sm font-semibold">{t("budgetV2.sectionSavings")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("budgetV2.savingsEmpty")}</p>
          <Button size="sm" variant="outline" className="mt-3 h-9 gap-1 text-xs" onClick={onAdd}>
            <Plus className="size-3" aria-hidden /> {t("budgetV2.addFund")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const act = async (env: BudgetEnvelopeView, action: "confirm" | "skip" | "unskip") => {
    setBusy(`${env.id}:${action}`)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/budgets/v2/contributions", token, { envelope_id: env.id, action }, ["/api/budgets"])
      toast.success(
        action === "confirm"
          ? t("budgetV2.fundConfirmed", { name: env.name })
          : action === "skip"
            ? t("budgetV2.fundSkipped", { name: env.name })
            : t("budgetV2.fundUnskipped", { name: env.name }),
      )
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budgetV2.fundActionFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t("budgetV2.sectionSavings")}</p>
          {canWrite && (
            <Button size="sm" variant="outline" className="h-9 gap-1 px-2 text-xs" onClick={onAdd}>
              <Plus className="size-3" aria-hidden /> {t("budgetV2.addFund")}
            </Button>
          )}
        </div>

        {/* THREE different facts, deliberately not merged into one "savings"
            number:
              · what was set aside IN THIS PERIOD (confirmed contributions)
              · what is reserved this period but NOT yet confirmed
              · the cumulative balance across all funds
            The first two must never read alike, and the first must not be
            confused with the third — "set aside" for both a period figure and a
            running total is what made the earlier version unreadable.
            Labels are used bare here, so they must be placeholder-free keys. */}
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{t("budgetV2.setAsideThisPeriod")}</dt>
            <dd className="text-sm font-semibold tabular-nums">{money(s.funded)}</dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{t("budgetV2.awaitingConfirmation")}</dt>
            <dd className="text-sm font-semibold tabular-nums">{money(s.reserved)}</dd>
          </div>
          {s.balance > 0 && (
            <div className="col-span-2 rounded-lg bg-muted/50 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{t("budgetV2.fundTotal")}</dt>
              <dd className="text-sm font-semibold tabular-nums">{money(s.balance)}</dd>
            </div>
          )}
        </dl>

        <ul className="mt-3 space-y-3 border-t pt-3">
          {funds.map((env) => {
            const state = env.contribution_status ?? "planned"
            const spaceBacked = env.funding_mode === "space_backed"
            const confirming = busy === `${env.id}:confirm`
            const skipping = busy === `${env.id}:skip`
            const unskipping = busy === `${env.id}:unskip`

            return (
              <li key={env.id}>
                <button
                  type="button"
                  onClick={() => onOpenDetail(env)}
                  className="flex min-h-11 w-full items-start justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("budgetV2.openEnvelope", { name: env.name })}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                      {env.name}
                      {spaceBacked && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">
                          <ArrowRightLeft className="size-2.5" aria-hidden /> {t("budgetV2.spaceBacked")}
                        </span>
                      )}
                    </p>

                    {/* Where the money is, keyed off the FUNDING MODE rather
                        than off `balance` being null. A plain protected-savings
                        line (no funding mode) also has a null balance, so
                        testing the balance alone told the user it was "held in
                        a Space" when there was no Space at all. */}
                    <p className="text-[11px] text-muted-foreground tabular-nums">
                      {env.funding_mode === "virtual"
                        ? t("budgetV2.fundBalance", { amount: money(env.balance ?? 0) })
                        : spaceBacked
                          ? t("budgetV2.fundInSpace")
                          : t("budgetV2.fundHeldBack")}
                      {env.goal_amount != null && ` / ${money(env.goal_amount)}`}
                    </p>

                    {/* The state, worded so 'set aside' and 'reserved but not
                        yet confirmed' can never be mistaken for each other. */}
                    <p
                      className={`text-[11px] ${
                        state === "confirmed"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : state === "missed"
                            ? "text-amber-700 dark:text-amber-400"
                            : "text-muted-foreground"
                      }`}
                    >
                      {state === "confirmed"
                        ? t("budgetV2.contributionConfirmed", { amount: money(env.planned) })
                        : state === "missed"
                          ? t("budgetV2.savingsMissed")
                          : state === "skipped"
                            ? t("budgetV2.contributionSkipped")
                            : t("budgetV2.contributionPlanned", { amount: money(env.planned) })}
                    </p>

                    {env.goal_progress && (
                      <div className="mt-1.5">
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={Math.round(env.goal_progress.pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={t("budgetV2.goalProgress", { name: env.name })}
                        >
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${
                              env.goal_progress.reached ? "bg-emerald-500" : "bg-primary"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, env.goal_progress.pct))}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                          {env.goal_progress.reached
                            ? t("budgetV2.goalReached")
                            : t("budgetV2.goalRemaining", { amount: money(env.goal_progress.remaining) })}
                          {/* A missed contribution is not silently forgiven:
                              the suggested pace rises and says so. */}
                          {env.suggested_monthly != null &&
                            env.suggested_monthly > 0 &&
                            ` · ${t("budgetV2.suggestedMonthly", { amount: money(env.suggested_monthly) })}`}
                        </p>
                      </div>
                    )}
                  </div>
                </button>

                {canWrite && (state === "planned" || state === "skipped") && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 px-1">
                    {state === "planned" && !spaceBacked && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1 px-2 text-[11px]"
                        disabled={Boolean(busy) || env.planned <= 0}
                        onClick={() => act(env, "confirm")}
                      >
                        {confirming ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        {t("budgetV2.confirmContribution")}
                      </Button>
                    )}
                    {/* A Space-backed contribution is confirmed BY the transfer.
                        Offering a Confirm button here would let the app claim
                        money moved when it did not. */}
                    {state === "planned" && spaceBacked && (
                      <p className="text-[11px] text-muted-foreground">{t("budgetV2.spaceTransferRequired")}</p>
                    )}
                    {state === "planned" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1 px-2 text-[11px]"
                        disabled={Boolean(busy)}
                        onClick={() => act(env, "skip")}
                      >
                        {skipping ? <Loader2 className="size-3 animate-spin" /> : <SkipForward className="size-3" />}
                        {t("budgetV2.skipThisPeriod")}
                      </Button>
                    )}
                    {state === "skipped" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1 px-2 text-[11px]"
                        disabled={Boolean(busy)}
                        onClick={() => act(env, "unskip")}
                      >
                        {unskipping ? <Loader2 className="size-3 animate-spin" /> : <Undo2 className="size-3" />}
                        {t("budgetV2.undoSkip")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {s.awaiting_confirmation > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {t("budgetV2.confirmIsNeutral")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
