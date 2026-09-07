import { useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { CalendarClock, Check, Loader as Loader2, SkipForward } from "lucide-react"
import { apiPost } from "@/lib/api"
import type { BudgetOccurrenceView } from "@/lib/types"
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

/**
 * Overdue obligations, each actionable in one tap (spec §6.8).
 *
 * The copy states the fact and the options and never scolds (principle P7): an
 * overdue bill is still owed and still reserved, so it is neither hidden nor
 * dramatised. Every row names WHAT is due — an amount and a date alone cannot
 * be acted on.
 *
 * The actions offered come from the SERVER (`occurrence.actions`), so the UI can
 * never present an action the engine would refuse.
 */
export function OverdueList({
  occurrences,
  money,
  canWrite,
  onChanged,
}: {
  occurrences: BudgetOccurrenceView[]
  money: (n: number) => string
  canWrite: boolean
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<BudgetOccurrenceView | null>(null)

  if (!occurrences.length) return null

  const key = (o: BudgetOccurrenceView) => `${o.commitment_id}:${o.due_date}`

  const act = async (o: BudgetOccurrenceView, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(key(o))
    try {
      const token = await getToken()
      if (!token) return
      await apiPost(
        "/api/budgets/v2/occurrences",
        token,
        { commitment_id: o.commitment_id, due_date: o.due_date, action, ...extra },
      )
      toast.success(
        action === "settle"
          ? t("budgetV2.markedPaid", { name: o.name })
          : action === "skip"
            ? t("budgetV2.markedSkipped", { name: o.name })
            : t("budgetV2.occurrenceUpdated"),
      )
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budgetV2.occurrenceFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section aria-labelledby="overdue-h" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 sm:p-4">
        <h2 id="overdue-h" className="text-sm font-semibold">
          {t("budgetV2.overdueTitle", {
            count: occurrences.length,
            amount: money(occurrences.reduce((a, o) => a + o.amount, 0)),
          })}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("budgetV2.overdueBody")}</p>

        <ul className="mt-3 space-y-2">
          {occurrences.map((o) => {
            const working = busy === key(o)
            return (
              <li
                key={key(o)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/70 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{o.name || t("budgetV2.untitledBill")}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {money(o.amount)} ·{" "}
                    {t("budgetV2.overdueSince", { date: o.due_date })} ·{" "}
                    {t("budgetV2.daysOverdue", { count: o.days_overdue ?? 0 })}
                    {o.from_previous_period && ` · ${t("budgetV2.carriedOver")}`}
                  </p>
                  {o.needs_attention && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("budgetV2.needsAttentionShort")}</p>
                  )}
                </div>

                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    {o.actions.includes("settle") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 gap-1 px-2 text-xs"
                        disabled={working}
                        onClick={() => act(o, "settle")}
                      >
                        {working ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        {t("budgetV2.markPaid")}
                      </Button>
                    )}
                    {o.actions.includes("reschedule") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1 px-2 text-xs"
                        disabled={working}
                        onClick={() => setRescheduling(o)}
                      >
                        <CalendarClock className="size-3" />
                        <span className="sr-only sm:not-sr-only">{t("budgetV2.reschedule")}</span>
                      </Button>
                    )}
                    {o.actions.includes("skip") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1 px-2 text-xs"
                        disabled={working}
                        onClick={() => act(o, "skip")}
                      >
                        <SkipForward className="size-3" />
                        <span className="sr-only sm:not-sr-only">{t("budgetV2.skip")}</span>
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <RescheduleDialog
        occurrence={rescheduling}
        onOpenChange={(v) => !v && setRescheduling(null)}
        onConfirm={async (date) => {
          if (!rescheduling) return
          await act(rescheduling, "reschedule", { to_date: date })
          setRescheduling(null)
        }}
      />
    </>
  )
}

function RescheduleDialog({
  occurrence,
  onOpenChange,
  onConfirm,
}: {
  occurrence: BudgetOccurrenceView | null
  onOpenChange: (v: boolean) => void
  onConfirm: (date: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [date, setDate] = useState("")
  const [saving, setSaving] = useState(false)

  return (
    <Dialog
      open={Boolean(occurrence)}
      onOpenChange={(v) => {
        if (!v) setDate("")
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("budgetV2.rescheduleTitle")}</DialogTitle>
          <DialogDescription>
            {t("budgetV2.rescheduleBody", { name: occurrence?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="resch-date">{t("budgetV2.newDueDate")}</Label>
          <Input
            id="resch-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 text-base"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            className="min-h-11"
            disabled={!date || saving}
            onClick={async () => {
              setSaving(true)
              try {
                await onConfirm(date)
                setDate("")
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : t("budgetV2.reschedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
