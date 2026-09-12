import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiErrorMessage, apiGet, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import { fromCents, splitPayment, toCents } from "@/lib/debt-math"
import { advancesScheduleByDefault, payoffCappedAmount } from "@/lib/debt-recurring"
import type { Debt, DebtPayment, DebtRepayment, WealthAccount } from "@/lib/types"
import { debtMoney, formatLongDate } from "@/lib/debt-format"
import { getCurrencySymbol } from "@/lib/currencies"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"

const SHEET = "inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl"
const today = () => new Date().toISOString().split("T")[0]

/**
 * Record a repayment. The split is optional: with a rate ProfitSync splits one
 * period's interest off the top; without one everything is principal; and the
 * user can type the exact split from the statement. The server turns it into
 * a transfer (principal) plus expenses (interest / fees) — never a plain expense.
 */
export function RecordPaymentSheet({
  open,
  onOpenChange,
  debt,
  repayment = null,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  debt: Debt
  /** The recurring repayment servicing this debt, when there is one. */
  repayment?: DebtRepayment | null
  onSaved: (payment: DebtPayment, debt: Debt) => void
}) {
  const { t } = useTranslation("debts")
  const { getToken } = useAuth()
  const receivable = debt.direction === "receivable"
  const symbol = getCurrencySymbol(debt.currency)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [accountId, setAccountId] = useState("")
  const [date, setDate] = useState(today())
  const [total, setTotal] = useState("")
  const [manual, setManual] = useState(false)
  const [principal, setPrincipal] = useState("")
  const [interest, setInterest] = useState("")
  const [fees, setFees] = useState("")
  const [other, setOther] = useState("")
  const [note, setNote] = useState("")
  const [advance, setAdvance] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scheduled = !!repayment?.active

  useEffect(() => {
    if (!open) return
    setSaving(false); setError(null); setManual(false)
    setDate(today()); setTotal(debt.payment_amount ? String(debt.payment_amount) : ""); setPrincipal(""); setInterest(""); setFees(""); setOther(""); setNote("")
    // With a live recurring repayment the RULE owns the schedule, so a payment
    // recorded by hand is an EXTRA one: moving the due date would silently
    // cancel the next instalment the user is still expecting to be taken.
    setAdvance(advancesScheduleByDefault(scheduled))
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const accs = (await apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]))
        .filter((a) => !a.archived_at && a.type !== "space")
      if (cancelled) return
      setAccounts(accs)
      setAccountId(accs.find((a) => a.is_default)?.id ?? accs.find((a) => a.type === "bank")?.id ?? accs[0]?.id ?? "")
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debt.id])

  const totalNum = Number(total)
  const preview = useMemo(() => {
    if (!(totalNum > 0)) return null
    const s = splitPayment({ total: toCents(totalNum), balance: toCents(debt.balance), annualRatePct: debt.annual_rate_pct, frequency: debt.payment_frequency })
    // splitPayment CLAMPS principal at the balance; the server does not — it
    // takes one period's interest off the top and the whole remainder is
    // principal, so an overpayment lands as credit rather than vanishing. Show
    // what will actually be recorded, or the preview quietly contradicts the
    // warning right above it.
    return { ...s, principal: toCents(totalNum) - s.interest }
  }, [totalNum, debt.balance, debt.annual_rate_pct, debt.payment_frequency])

  const manualSum = [principal, interest, fees, other].reduce((s, v) => s + (Number(v) || 0), 0)
  const manualOk = !manual || Math.abs(manualSum - totalNum) < 0.005

  // What it would take to close the debt today: the balance plus this period's
  // interest. Paying MORE than this is not an error — the user may be settling a
  // figure the lender quoted — but it is worth saying out loud, because the
  // excess lands as principal and pushes the balance into credit, where every
  // screen reports "nothing owed" and the extra money stops being visible.
  const payoff = fromCents(payoffCappedAmount({
    scheduled: Number.MAX_SAFE_INTEGER,
    outstanding: toCents(debt.balance),
    annualRatePct: debt.annual_rate_pct,
    frequency: debt.payment_frequency,
  }))
  const overpaying = payoff > 0 && totalNum > payoff + 0.005

  async function submit() {
    if (!accountId) { setError(t("payFrom")); return }
    if (!(totalNum > 0)) { setError(t("amountRequired")); return }
    if (amountExceedsLimit(totalNum)) { setError(t("common.amountTooLarge")); return }
    if (!manualOk) { setError(t("splitMismatch")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await apiPost<{ payment: DebtPayment; debt: Debt }>(`/api/debts/${debt.id}/payments`, token, {
        from_account_id: accountId,
        date,
        amount: totalNum,
        ...(manual ? { principal: Number(principal) || 0, interest: Number(interest) || 0, fees: Number(fees) || 0, other: Number(other) || 0 } : {}),
        note,
        advance_schedule: advance,
      })
      toast.success(t("paymentRecorded"))
      onOpenChange(false)
      onSaved(res.payment, res.debt)
    } catch (err) {
      toast.error(apiErrorMessage(err, t("couldNotSave")))
    } finally {
      setSaving(false)
    }
  }

  const part = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value} placeholder="0.00" onChange={(e) => { set(e.target.value); setError(null) }} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className={SHEET}>
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle className="truncate">{receivable ? t("recordReceipt") : t("recordPayment")} · {debt.name}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{receivable ? t("receiveInto") : t("payFrom")}</Label>
            <AccountCombobox accounts={accounts} value={accountId} onChange={setAccountId} currency={debt.currency} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dp-total">{receivable ? t("totalReceived") : t("totalPaid")}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">{symbol}</span>
                <Input id="dp-total" type="number" inputMode="decimal" min="0" step="0.01" value={total} placeholder="0.00" className="h-12 pl-9 text-lg font-semibold tabular-nums" onChange={(e) => { setTotal(e.target.value); setError(null) }} autoFocus />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dp-date">{t("paymentDate")}</Label>
              <Input id="dp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-12" />
            </div>
          </div>

          {(debt.payment_amount || payoff > 0) && (
            <div className="flex flex-wrap gap-2">
              {debt.payment_amount ? (
                <QuickAmount label={t("useScheduled", { amount: debtMoney(debt.payment_amount, debt) })} onClick={() => { setTotal(String(debt.payment_amount)); setError(null) }} />
              ) : null}
              {payoff > 0 && (
                <QuickAmount label={t("payItOff", { amount: debtMoney(payoff, debt) })} onClick={() => { setTotal(String(payoff)); setError(null) }} />
              )}
            </div>
          )}

          {overpaying && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t("overpayWarning", { amount: debtMoney(payoff, debt) })}
            </p>
          )}

          <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t("splitTitle")}</p>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label={t("splitTitle")}>
                {([false, true] as const).map((m) => (
                  <button key={String(m)} type="button" role="radio" aria-checked={manual === m} onClick={() => { setManual(m); setError(null) }}
                    className={cn("min-h-8 rounded-md px-2 text-xs font-medium", manual === m ? "bg-background shadow-sm" : "text-muted-foreground")}>
                    {m ? t("enterSplit") : t("autoSplit")}
                  </button>
                ))}
              </div>
            </div>
            {!manual ? (
              <p className="text-xs text-muted-foreground">
                {preview
                  ? preview.source === "calculated"
                    ? t("splitPreview", { principal: debtMoney(fromCents(preview.principal), debt), interest: debtMoney(fromCents(preview.interest), debt) })
                    : t("principalOnly")
                  : t("splitHint")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {part("dp-principal", t("principal"), principal, setPrincipal)}
                  {part("dp-interest", t("interest"), interest, setInterest)}
                  {part("dp-fees", t("fees"), fees, setFees)}
                  {part("dp-other", t("other"), other, setOther)}
                </div>
                <p className={cn("text-xs", manualOk ? "text-muted-foreground" : "text-destructive")}>
                  {debtMoney(manualSum, debt)} / {debtMoney(totalNum || 0, debt)}
                </p>
              </>
            )}
          </div>

          {debt.next_due_date && debt.payment_frequency && debt.payment_frequency !== "irregular" && (
            <label className="flex items-start justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t("countsAsScheduled")}</span>
                <span className="block text-xs text-muted-foreground">
                  {advance ? t("countsAsScheduledOn", { date: formatLongDate(debt.next_due_date) }) : scheduled ? t("extraPaymentWithRule") : t("extraPayment")}
                </span>
              </span>
              <Switch checked={advance} onCheckedChange={setAdvance} aria-label={t("countsAsScheduled")} />
            </label>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dp-note">{t("notes")}</Label>
            <Textarea id="dp-note" rows={1} className="min-h-9 resize-none" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={saving || !(totalNum > 0) || !accountId}>{saving ? t("saving") : receivable ? t("recordReceipt") : t("recordPayment")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A one-tap amount: the instalment, or what it would take to close it today. */
function QuickAmount({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable min-h-8 rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {label}
    </button>
  )
}
