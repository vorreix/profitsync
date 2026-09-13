import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react"
import { apiErrorMessage, apiGet, apiPatch, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import { toCents } from "@/lib/debt-math"
import { previewDebt } from "@/lib/debt-preview"
import { frequencyToRecurring, repaymentCursor } from "@/lib/debt-recurring"
import type { Debt, DebtDirection, DebtRepayment, PaymentFrequency, WealthAccount } from "@/lib/types"
import { getCurrencySymbol } from "@/lib/currencies"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { DebtKindCombobox } from "@/components/debts/DebtKindCombobox"
import { DebtPreviewCard } from "@/components/debts/DebtPreviewCard"

const SHEET = "inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl"
/** The rhythms a repayment can run on — "irregular" has no schedule to run. */
const FREQS: Exclude<PaymentFrequency, "irregular">[] = ["monthly", "weekly", "biweekly", "quarterly", "yearly"]
const today = () => new Date().toISOString().split("T")[0]

type Form = {
  name: string
  kind: string
  original: string
  balance: string
  // How it is being repaid.
  repay: boolean
  repayFrom: string
  repayAmount: string
  repayFrequency: Exclude<PaymentFrequency, "irregular">
  repayStart: string
  // Everything optional, behind one disclosure.
  counterparty: string
  rate: string
  rateType: "" | "fixed" | "variable"
  notes: string
  balanceIsEstimate: boolean
  moveMoneyNow: boolean
  moveAccountId: string
  /** How much of it actually lands in that account; the rest was already owed. */
  moveAmount: string
}

const empty = (direction: DebtDirection): Form => ({
  name: "", kind: direction === "receivable" ? "informal" : "personal", original: "", balance: "",
  repay: false, repayFrom: "", repayAmount: "", repayFrequency: "monthly", repayStart: today(),
  counterparty: "", rate: "", rateType: "", notes: "", balanceIsEstimate: false, moveMoneyNow: false, moveAccountId: "", moveAmount: "",
})

const fromDebt = (d: Debt, r: DebtRepayment | null): Form => ({
  name: d.name,
  kind: d.kind,
  original: d.original_amount == null ? "" : String(d.original_amount),
  balance: String(d.balance),
  repay: !!r?.active,
  repayFrom: r?.from_account_id ?? "",
  repayAmount: r ? String(r.amount) : d.payment_amount == null ? "" : String(d.payment_amount),
  repayFrequency: (r?.frequency && r.frequency !== "irregular" ? r.frequency : d.payment_frequency && d.payment_frequency !== "irregular" ? d.payment_frequency : "monthly"),
  // The rule's ANCHOR, not its next due date. Sending the next due date back
  // would read as "the schedule changed", re-anchor the cursor to today, and
  // skip an instalment that was due but had not posted yet — just because
  // somebody edited the debt's name.
  repayStart: r?.start_date ?? d.next_due_date ?? today(),
  counterparty: d.counterparty,
  rate: d.annual_rate_pct == null ? "" : String(d.annual_rate_pct),
  rateType: d.rate_type ?? "",
  notes: d.notes,
  balanceIsEstimate: d.balance_is_estimate,
  moveMoneyNow: false,
  moveAccountId: "",
  moveAmount: "",
})

/**
 * Add or edit a debt.
 *
 * Four fields carry the whole thing — who it is with, what kind, what it
 * started at, what is left — followed by the one question that decides whether
 * this stays a number the user maintains by hand or becomes something the app
 * services: is a repayment being made on a schedule?
 *
 * Saying yes builds the recurring repayment HERE, and the debt and the rule are
 * written in ONE atomic batch on the server. A debt whose repayment silently
 * failed to be created is money that silently never moves, so there is no
 * second step in which that can happen.
 *
 * Everything a loan document has and a person rarely remembers — the rate, the
 * lender's formal name, notes, whether the money is arriving right now — is one
 * disclosure away and closed by default. It is not a second MODE: the form
 * never rearranges itself, it only gets longer if you ask it to.
 */
export function DebtFormSheet({
  open,
  onOpenChange,
  direction: initialDirection,
  editing = null,
  repayment = null,
  orgCurrency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starting direction; while adding, the user can flip it inside the sheet. */
  direction: DebtDirection
  editing?: Debt | null
  /** The debt's live repayment rule, when editing one that has one. */
  repayment?: DebtRepayment | null
  orgCurrency: string
  onSaved: (debt: Debt) => void
}) {
  const { t } = useTranslation("debts")
  const { getToken } = useAuth()
  const [direction, setDirection] = useState<DebtDirection>(initialDirection)
  const [form, setForm] = useState<Form>(() => empty(initialDirection))
  const [more, setMore] = useState(false)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!editing
  const receivable = direction === "receivable"
  // The workspace currency, always. A debt in another currency is a real thing
  // and PATCH still accepts one, but asking everybody to pick a currency to
  // record the money they owe their brother is noise on the common path.
  const currency = isEdit ? editing.currency : orgCurrency
  const symbol = getCurrencySymbol(currency)
  const patch = (p: Partial<Form>) => { setForm((f) => ({ ...f, ...p })); setError(null) }

  useEffect(() => {
    if (!open) return
    setSaving(false)
    setError(null)
    setMore(false)
    setDirection(editing?.direction ?? initialDirection)
    setForm(editing ? fromDebt(editing, repayment) : empty(initialDirection))
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const accs = await apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[])
      if (!cancelled) setAccounts(accs.filter((a) => !a.archived_at && (a.type === "bank" || a.type === "cash")))
    })()
    return () => { cancelled = true }
    // Keyed on IDENTITY, not on the objects: the detail page reloads on every
    // background revalidation and hands back fresh instances, which would wipe
    // whatever the user had typed halfway through editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, repayment?.id])

  // A repayment needs somewhere to come from; default to the account the user
  // actually uses rather than making them choose before they can say yes.
  const defaultSource = useMemo(() => accounts.find((a) => a.is_default)?.id ?? accounts.find((a) => a.type === "bank")?.id ?? accounts[0]?.id ?? "", [accounts])

  // A repayment edited on its own page can run on a rhythm this form has no
  // word for (every 10 days, every 6 months). Offering it a five-option picker
  // would silently rewrite it to monthly on the next save, so the rhythm is
  // shown as it is and left out of what this form sends.
  const customRhythm = !!repayment && repayment.frequency === null
  const balanceNum = Number(form.balance) || 0
  // The money landing in an account defaults to ALL of it; a partial amount is
  // the normal case when a lender pays someone else directly on your behalf.
  const arrivingNum = form.moveAmount.trim() === "" ? balanceNum : Number(form.moveAmount) || 0
  const arrivingValid = form.moveMoneyNow && arrivingNum > 0 && arrivingNum <= balanceNum + 0.005
  const arrivingAccount = accounts.find((a) => a.id === form.moveAccountId)
  const arrivingAccountName = arrivingAccount ? arrivingAccount.nickname.trim() || arrivingAccount.bank_name : ""

  // Editing an existing rule, `repayStart` is its ANCHOR — often months in the
  // past — while the next instalment lands on the cursor. Previewing from the
  // anchor dated the payoff in the past and contradicted the debt-free date on
  // the same screen, so the preview asks the same pure rule the server uses.
  const previewFirstPayment = useMemo(() => {
    const freq = customRhythm && repayment
      ? { unit: repayment.frequency_unit, interval: repayment.frequency_interval }
      : frequencyToRecurring(form.repayFrequency)
    if (!freq || !form.repayStart) return form.repayStart
    return repaymentCursor({
      current: repayment
        ? {
            startDate: repayment.start_date,
            frequencyUnit: repayment.frequency_unit,
            frequencyInterval: repayment.frequency_interval,
            nextDueAt: repayment.next_due_at,
            active: repayment.active,
          }
        : null,
      startDate: form.repayStart,
      freq,
      wantActive: form.repay,
      today: today(),
    })
  }, [repayment, customRhythm, form.repayStart, form.repayFrequency, form.repay])

  const preview = useMemo(
    () =>
      previewDebt({
        owed: toCents(Number(form.balance) || 0),
        original: form.original.trim() === "" ? null : toCents(Number(form.original) || 0),
        // A half-typed rate ("1.", "-", "e") must read as NO rate rather than
        // NaN: the engine guards against NaN arithmetic, but the preview would
        // then quietly stop flagging its own 0 % assumption.
        annualRatePct: Number.isFinite(Number(form.rate)) && form.rate.trim() !== "" ? Number(form.rate) : null,
        repayment:
          form.repay && Number(form.repayAmount) > 0 && form.repayStart
            ? { amount: toCents(Number(form.repayAmount)), frequency: form.repayFrequency, firstPayment: previewFirstPayment }
            : null,
      }),
    [form.balance, form.original, form.rate, form.repay, form.repayAmount, form.repayFrequency, form.repayStart, previewFirstPayment],
  )
  useEffect(() => {
    if (form.repay && !form.repayFrom && defaultSource) patch({ repayFrom: defaultSource })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.repay, defaultSource])

  // The account a repayment was funded from may since have been archived. The
  // picker can no longer show it, so the field LOOKS empty — clear it too, or
  // saving silently resubmits an id the server will reject with a message about
  // a field the user cannot see.
  useEffect(() => {
    if (!form.repayFrom || accounts.length === 0) return
    if (!accounts.some((a) => a.id === form.repayFrom)) patch({ repayFrom: "" })
  }, [accounts, form.repayFrom])

  async function submit() {
    const balance = Number(form.balance)
    if (!form.name.trim() && !form.counterparty.trim()) { setError(t("nameOrCounterpartyRequired")); return }
    if (form.balance.trim() === "" || !Number.isFinite(balance) || balance < 0) { setError(t("balanceRequired")); return }
    if (amountExceedsLimit(balance)) { setError(t("common.amountTooLarge")); return }
    if (form.original.trim() !== "" && !(Number(form.original) >= 0)) { setError(t("originalInvalid")); return }
    if (form.moveMoneyNow) {
      if (!form.moveAccountId) { setError(t("arrivingAccountRequired")); return }
      if (!(arrivingNum > 0)) { setError(t("arrivingRequired")); return }
      if (arrivingNum > balanceNum + 0.005) { setError(t("arrivingTooMuch")); return }
    }
    if (form.repay) {
      if (!form.repayFrom) { setError(t("repayFromRequired")); return }
      if (!(Number(form.repayAmount) > 0)) { setError(t("repayAmountRequired")); return }
      if (amountExceedsLimit(Number(form.repayAmount))) { setError(t("common.amountTooLarge")); return }
      if (!form.repayStart) { setError(t("repayStartRequired")); return }
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const repaymentBody = form.repay
        ? {
            enabled: true,
            from_account_id: form.repayFrom,
            amount: Number(form.repayAmount),
            // Omitted for a rhythm this form cannot express — the server then
            // keeps the rule's own (unit, interval) untouched.
            ...(customRhythm ? {} : { frequency: form.repayFrequency }),
            start_date: form.repayStart,
            name: receivable ? t("repaymentNameIn", { name: form.name.trim() || form.counterparty.trim() }) : t("repaymentNameOut", { name: form.name.trim() || form.counterparty.trim() }),
          }
        : { enabled: false }
      const body = {
        direction,
        name: form.name.trim() || form.counterparty.trim(),
        counterparty: form.counterparty.trim(),
        kind: form.kind,
        currency,
        current_balance: balance,
        balance_is_estimate: form.balanceIsEstimate,
        original_amount: form.original.trim() === "" ? null : Number(form.original),
        annual_rate_pct: form.rate.trim() === "" ? null : Number(form.rate),
        rate_type: form.rateType || null,
        notes: form.notes,
        repayment: repaymentBody,
        ...(!isEdit && form.moveMoneyNow && form.moveAccountId
          ? { disbursement_account_id: form.moveAccountId, disbursement_amount: arrivingNum }
          : {}),
      }
      const saved = isEdit
        ? await apiPatch<Debt>(`/api/debts/${editing.id}`, token, { ...body, current_balance: undefined })
        : await apiPost<Debt>("/api/debts", token, body)
      toast.success(isEdit ? t("updated") : t("created"))
      onOpenChange(false)
      onSaved(saved)
    } catch (err) {
      toast.error(apiErrorMessage(err, t("couldNotSave")))
    } finally {
      setSaving(false)
    }
  }

  const money = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">{symbol}</span>
        <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value} placeholder="0.00" className="pl-7 tabular-nums" onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className={SHEET}>
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{isEdit ? t("editDebt") : receivable ? t("addReceivable") : t("addDebt")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          {/* I owe / Owed to me (adding only). Same colour language as the
              add-transaction form: money leaving is red, money arriving is
              green. A debt you owe is the red one — it is a liability, and the
              colour should say so before the label is read. */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("addDebt")}>
              {([
                { d: "owed", label: t("iOwe"), Icon: ArrowDownRight, on: "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600" },
                { d: "receivable", label: t("owedToMe"), Icon: ArrowUpRight, on: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600" },
              ] as const).map((o) => (
                <button
                  key={o.d}
                  type="button"
                  role="radio"
                  aria-checked={direction === o.d}
                  onClick={() => { setDirection(o.d); patch({ kind: o.d === "receivable" ? "informal" : form.kind === "informal" ? "personal" : form.kind }) }}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 py-2.5 text-sm font-medium transition-colors",
                    direction === o.d ? o.on : "border-border hover:bg-muted",
                  )}
                >
                  <o.Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{o.label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="debt-name">{receivable ? t("whoOwesYou") : t("whoDoYouOwe")}</Label>
            <Input id="debt-name" value={form.name} placeholder={t("counterpartyPlaceholder")} onChange={(e) => patch({ name: e.target.value })} autoFocus />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-kind">{t("kind")}</Label>
            <DebtKindCombobox id="debt-kind" value={form.kind} onChange={(k) => patch({ kind: k })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {money("debt-original", t("originalAmount"), form.original, (v) => patch({ original: v }))}
            {money("debt-balance", receivable ? t("howMuchOwed") : t("howMuchLeft"), form.balance, (v) => patch({ balance: v }))}
          </div>

          {/* Did any of it actually land in an account? PARTIAL is normal: you
              borrow 10,000 for a car, 6,000 reaches your account and the dealer
              is paid the rest directly. Without this the money is invisible and
              the loan looks like debt that bought nothing. */}
          {!isEdit && balanceNum > 0 && accounts.length > 0 && (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <label className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{receivable ? t("givingMoneyNow") : t("moneyArrivedTitle")}</span>
                  <span className="block text-xs text-muted-foreground">{receivable ? t("lendMoneyHint") : t("receiveMoneyHint")}</span>
                </span>
                <Switch
                  checked={form.moveMoneyNow}
                  onCheckedChange={(v) => patch({ moveMoneyNow: v, moveAccountId: v ? form.moveAccountId || defaultSource : "", moveAmount: v ? form.moveAmount || form.balance : "" })}
                  aria-label={receivable ? t("givingMoneyNow") : t("moneyArrivedTitle")}
                />
              </label>
              <Collapse open={form.moveMoneyNow}>
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{receivable ? t("lendMoneyFrom") : t("receiveMoneyInto")}</Label>
                    <AccountCombobox accounts={accounts} value={form.moveAccountId} onChange={(id) => patch({ moveAccountId: id })} currency={currency} />
                  </div>
                  {money("debt-arriving", receivable ? t("amountGiving") : t("amountArriving"), form.moveAmount, (v) => patch({ moveAmount: v }))}
                  <p className="text-xs text-muted-foreground">
                    {arrivingNum > 0 && arrivingNum < balanceNum - 0.005
                      ? t("arrivingPartial", { amount: formatMoney(Math.round((balanceNum - arrivingNum) * 100) / 100, currency, true) })
                      : t("arrivingHint")}
                  </p>
                </div>
              </Collapse>
            </div>
          )}

          {/* How is it being repaid? */}
          <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
            <p className="text-sm font-medium">{receivable ? t("howRepaidIn") : t("howRepaidOut")}</p>
            <div className="grid gap-1" role="radiogroup" aria-label={receivable ? t("howRepaidIn") : t("howRepaidOut")}>
              {([false, true] as const).map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  role="radio"
                  aria-checked={form.repay === on}
                  onClick={() => patch({ repay: on, repayFrom: on ? form.repayFrom || defaultSource : form.repayFrom })}
                  className={cn(
                    "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors",
                    form.repay === on ? "border-primary bg-background shadow-sm" : "border-transparent hover:bg-background/60",
                  )}
                >
                  <span className={cn("size-4 shrink-0 rounded-full border-[5px] transition-colors", form.repay === on ? "border-primary" : "border-muted-foreground/40")} />
                  <span>{on ? (receivable ? t("repayAutoIn") : t("repayAutoOut")) : t("repayManually")}</span>
                </button>
              ))}
            </div>

            <Collapse open={form.repay}>
              <div className="space-y-3 pt-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{receivable ? t("repayInto") : t("repayFrom")}</Label>
                  <AccountCombobox accounts={accounts} value={form.repayFrom} onChange={(id) => patch({ repayFrom: id })} currency={currency} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {money("debt-repay-amount", t("repayAmount"), form.repayAmount, (v) => patch({ repayAmount: v }))}
                  <div className="space-y-1.5">
                    <Label>{t("perFrequency")}</Label>
                    {customRhythm && repayment ? (
                      <div className="flex min-h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                        <span className="truncate">
                          {t("frequencyCustom", { interval: repayment.frequency_interval, unit: t(`unit.${repayment.frequency_unit}`) })}
                        </span>
                      </div>
                    ) : (
                      <Select value={form.repayFrequency} onValueChange={(v) => patch({ repayFrequency: v as Exclude<PaymentFrequency, "irregular"> })}>
                        <SelectTrigger className="w-full" aria-label={t("perFrequency")}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FREQS.map((f) => <SelectItem key={f} value={f}>{t(`frequencyLabel.${f}`)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="debt-repay-start">{isEdit ? t("paymentDay") : t("firstPayment")}</Label>
                  <Input id="debt-repay-start" type="date" value={form.repayStart} onChange={(e) => patch({ repayStart: e.target.value })} />
                  <p className="text-xs text-muted-foreground">
                    {customRhythm ? t("customRhythmHint") : isEdit ? t("paymentDayHint") : form.repayStart && form.repayStart <= today() ? t("firstPaymentNow") : t("firstPaymentHint")}
                  </p>
                </div>
              </div>
            </Collapse>
          </div>

          {/* What all of that adds up to, live. */}
          <DebtPreviewCard
            preview={preview}
            currency={currency}
            receivable={receivable}
            frequencyWord={t(`frequency.${form.repayFrequency}`)}
            arriving={arrivingValid && arrivingAccountName ? { amount: arrivingNum, accountName: arrivingAccountName } : null}
          />

          {/* Everything else, closed by default. */}
          <div className="rounded-xl border">
            <button
              type="button"
              onClick={() => setMore((v) => !v)}
              aria-expanded={more}
              className="flex min-h-11 w-full items-center justify-between px-3 text-sm font-medium"
            >
              {t("moreDetails")}
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", more && "rotate-180")} />
            </button>
            <Collapse open={more}>
              <div className="space-y-3 border-t px-3 py-3">
                <div className="space-y-1.5">
                  <Label htmlFor="debt-cp">{t("formalName")}</Label>
                  <Input id="debt-cp" value={form.counterparty} placeholder={t("formalNamePlaceholder")} onChange={(e) => patch({ counterparty: e.target.value })} />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div className="space-y-1.5">
                    {/* The short label: the sentence under the row already says
                        what an empty rate means, and the long one wrapped into
                        two lines that collided with the picker beside it. */}
                    <Label htmlFor="debt-rate">{t("interestRate")}</Label>
                    <Input id="debt-rate" type="number" inputMode="decimal" min="0" step="0.01" value={form.rate} placeholder="0.00" onChange={(e) => patch({ rate: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("rateTypeLabel")}</Label>
                    <Select value={form.rateType || "none"} onValueChange={(v) => patch({ rateType: v === "none" ? "" : (v as "fixed" | "variable") })}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        <SelectItem value="fixed">{t("rateType.fixed")}</SelectItem>
                        <SelectItem value="variable">{t("rateType.variable")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t("rateNoneHelp")} {t("rateHelp")}</p>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("balanceIsEstimate")}</span>
                  <Switch checked={form.balanceIsEstimate} onCheckedChange={(v) => patch({ balanceIsEstimate: v })} aria-label={t("balanceIsEstimate")} />
                </label>
                <div className="space-y-1.5">
                  <Label htmlFor="debt-notes">{t("notes")}</Label>
                  <Textarea id="debt-notes" rows={2} className="resize-none" value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
                </div>
              </div>
            </Collapse>
          </div>

          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("saving") : isEdit ? t("saveChanges") : t("create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Expand to auto height via the grid `0fr → 1fr` trick: the track size is
 * interpolable (unlike `height: auto`) so the fold stays on the compositor, and
 * the inner `overflow-hidden` clips content instead of letting it spill.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={open ? undefined : true}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}
