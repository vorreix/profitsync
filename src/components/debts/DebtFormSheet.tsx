import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiErrorMessage, apiGet, apiPatch, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import type { Debt, DebtDirection, DebtKind, PaymentFrequency, WealthAccount } from "@/lib/types"
import { getCurrencySymbol } from "@/lib/currencies"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CurrencyCombobox } from "@/components/CurrencyCombobox"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"

const SHEET = "inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl"
const KINDS: DebtKind[] = ["personal", "mortgage", "car", "student", "business", "bnpl", "overdraft", "informal", "other"]
const FREQS: PaymentFrequency[] = ["monthly", "weekly", "biweekly", "quarterly", "yearly", "irregular"]

type Form = {
  counterparty: string
  name: string
  kind: DebtKind
  currency: string
  balance: string
  balanceIsEstimate: boolean
  payment: string
  frequency: PaymentFrequency
  nextDue: string
  rate: string
  rateType: "" | "fixed" | "variable"
  original: string
  startDate: string
  maturity: string
  installments: string
  notes: string
  moveMoneyNow: boolean
  moveAccountId: string
}

const empty = (currency: string, direction: DebtDirection): Form => ({
  counterparty: "", name: "", kind: direction === "receivable" ? "informal" : "personal", currency, balance: "", balanceIsEstimate: false,
  payment: "", frequency: "monthly", nextDue: "", rate: "", rateType: "", original: "", startDate: "", maturity: "", installments: "", notes: "",
  moveMoneyNow: false, moveAccountId: "",
})

const fromDebt = (d: Debt): Form => ({
  counterparty: d.counterparty, name: d.name === d.counterparty ? "" : d.name, kind: d.kind, currency: d.currency, balance: String(d.balance), balanceIsEstimate: d.balance_is_estimate,
  payment: d.payment_amount == null ? "" : String(d.payment_amount), frequency: d.payment_frequency ?? "monthly", nextDue: d.next_due_date ?? "",
  rate: d.annual_rate_pct == null ? "" : String(d.annual_rate_pct), rateType: d.rate_type ?? "", original: d.original_amount == null ? "" : String(d.original_amount),
  startDate: d.start_date ?? "", maturity: d.maturity_date ?? "", installments: d.remaining_installments == null ? "" : String(d.remaining_installments), notes: d.notes,
  moveMoneyNow: false, moveAccountId: "",
})

/**
 * Add / edit a debt. QUICK asks only what a normal person knows (who, how much
 * is left, what you pay, when next); DETAILED adds the loan-document fields.
 * Nothing is required beyond a name and an amount, and an estimate is fine.
 */
export function DebtFormSheet({
  open,
  onOpenChange,
  direction: initialDirection,
  editing = null,
  orgCurrency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starting direction; while adding, the user can flip it inside the sheet. */
  direction: DebtDirection
  editing?: Debt | null
  orgCurrency: string
  onSaved: (debt: Debt) => void
}) {
  const { t } = useTranslation("debts")
  const { getToken } = useAuth()
  const [mode, setMode] = useState<"quick" | "detailed">("quick")
  const [direction, setDirection] = useState<DebtDirection>(initialDirection)
  const [form, setForm] = useState<Form>(() => empty(orgCurrency, direction))
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!editing
  const receivable = direction === "receivable"
  const symbol = getCurrencySymbol(form.currency)
  const patch = (p: Partial<Form>) => { setForm((f) => ({ ...f, ...p })); setError(null) }

  useEffect(() => {
    if (!open) return
    setSaving(false)
    setError(null)
    setDirection(editing?.direction ?? initialDirection)
    setForm(editing ? fromDebt(editing) : empty(orgCurrency, initialDirection))
    setMode(editing && (editing.original_amount != null || editing.maturity_date || editing.remaining_installments != null) ? "detailed" : "quick")
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const accs = await apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[])
      if (!cancelled) setAccounts(accs.filter((a) => !a.archived_at && (a.type === "bank" || a.type === "cash")))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const sources = useMemo(() => accounts, [accounts])

  async function submit() {
    const balance = Number(form.balance)
    if (!form.counterparty.trim() && !form.name.trim()) { setError(t("nameOrCounterpartyRequired")); return }
    if (form.balance.trim() === "" || !Number.isFinite(balance) || balance < 0) { setError(t("balanceRequired")); return }
    if (amountExceedsLimit(balance)) { setError(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const body = {
        direction,
        name: form.name.trim() || form.counterparty.trim(),
        counterparty: form.counterparty.trim(),
        kind: form.kind,
        currency: form.currency,
        current_balance: balance,
        balance_is_estimate: form.balanceIsEstimate,
        payment_amount: form.payment.trim() === "" ? null : Number(form.payment),
        payment_frequency: form.payment.trim() === "" && form.frequency === "monthly" && mode === "quick" ? (form.nextDue ? "monthly" : null) : form.frequency,
        next_due_date: form.nextDue || null,
        annual_rate_pct: form.rate.trim() === "" ? null : Number(form.rate),
        rate_type: form.rateType || null,
        original_amount: form.original.trim() === "" ? null : Number(form.original),
        start_date: form.startDate || null,
        maturity_date: form.maturity || null,
        remaining_installments: form.installments.trim() === "" ? null : Number(form.installments),
        notes: form.notes,
        ...(!isEdit && form.moveMoneyNow && form.moveAccountId ? { disbursement_account_id: form.moveAccountId } : {}),
      }
      const saved = isEdit
        ? await apiPatch<Debt>(`/api/debts/${editing!.id}`, token, { ...body, current_balance: undefined })
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

  const money = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder = `${symbol} 0.00`) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className={SHEET}>
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{isEdit ? t("editDebt") : receivable ? t("addReceivable") : t("addDebt")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          {/* I owe / Owed to me (adding only) */}
          {!isEdit && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label={t("addDebt")}>
              {(["owed", "receivable"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={direction === d}
                  onClick={() => { setDirection(d); patch({ kind: d === "receivable" ? "informal" : form.kind === "informal" ? "personal" : form.kind }) }}
                  className={cn("min-h-10 rounded-md text-sm font-medium transition-colors", direction === d ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {d === "owed" ? t("iOwe") : t("owedToMe")}
                </button>
              ))}
            </div>
          )}

          {/* Quick / Detailed */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={t("kind")}>
            {(["quick", "detailed"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn("min-h-9 rounded-md text-sm font-medium transition-colors", mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {m === "quick" ? t("quickSetup") : t("detailedSetup")}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="debt-cp">{receivable ? t("whoOwesYou") : t("whoDoYouOwe")}</Label>
            <Input id="debt-cp" value={form.counterparty} placeholder={t("counterpartyPlaceholder")} onChange={(e) => patch({ counterparty: e.target.value })} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="debt-name">{t("debtName")}</Label>
              <Input id="debt-name" value={form.name} placeholder={t("debtNamePlaceholder")} onChange={(e) => patch({ name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("kind")}</Label>
              <Select value={form.kind} onValueChange={(v) => patch({ kind: v as DebtKind })}>
                <SelectTrigger className="w-full" aria-label={t("kind")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => <SelectItem key={k} value={k}>{t(`kinds.${k}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isEdit && (
            <div className="grid grid-cols-[1fr_auto] gap-3">
              {money("debt-balance", receivable ? t("howMuchOwed") : t("howMuchLeft"), form.balance, (v) => patch({ balance: v }))}
              <div className="space-y-1.5">
                <Label>{t("currency")}</Label>
                <div className="w-28"><CurrencyCombobox value={form.currency} onValueChange={(c) => patch({ currency: c })} /></div>
              </div>
            </div>
          )}
          {!isEdit && (
            <label className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 px-3 py-2 text-sm">
              <span>{t("balanceIsEstimate")}</span>
              <Switch checked={form.balanceIsEstimate} onCheckedChange={(v) => patch({ balanceIsEstimate: v })} aria-label={t("balanceIsEstimate")} />
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            {money("debt-payment", receivable ? t("whatDoTheyPay") : t("whatDoYouPay"), form.payment, (v) => patch({ payment: v }))}
            <div className="space-y-1.5">
              <Label>{t("perFrequency")}</Label>
              <Select value={form.frequency} onValueChange={(v) => patch({ frequency: v as PaymentFrequency })}>
                <SelectTrigger className="w-full" aria-label={t("perFrequency")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQS.map((f) => <SelectItem key={f} value={f}>{t(`frequencyLabel.${f}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.frequency !== "irregular" && (
            <div className="space-y-1.5">
              <Label htmlFor="debt-next">{t("nextPaymentDate")}</Label>
              <Input id="debt-next" type="date" value={form.nextDue} onChange={(e) => patch({ nextDue: e.target.value })} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="debt-rate">{mode === "quick" ? t("interestRateOptional") : t("interestRate")}</Label>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Input id="debt-rate" type="number" inputMode="decimal" min="0" step="0.01" value={form.rate} placeholder="0.00" onChange={(e) => patch({ rate: e.target.value })} />
              {mode === "detailed" && (
                <Select value={form.rateType || "none"} onValueChange={(v) => patch({ rateType: v === "none" ? "" : (v as "fixed" | "variable") })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="fixed">{t("rateType.fixed")}</SelectItem>
                    <SelectItem value="variable">{t("rateType.variable")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {mode === "detailed" && (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-3">
                {money("debt-original", t("originalAmount"), form.original, (v) => patch({ original: v }))}
                <div className="space-y-1.5">
                  <Label htmlFor="debt-inst">{t("remainingInstallments")}</Label>
                  <Input id="debt-inst" type="number" inputMode="numeric" min="0" step="1" value={form.installments} onChange={(e) => patch({ installments: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="debt-start">{t("startDate")}</Label>
                  <Input id="debt-start" type="date" value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="debt-maturity">{t("maturityDate")}</Label>
                  <Input id="debt-maturity" type="date" value={form.maturity} onChange={(e) => patch({ maturity: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="debt-notes">{t("notes")}</Label>
                <Textarea id="debt-notes" rows={2} className="resize-none" value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
              </div>
            </div>
          )}

          {!isEdit && Number(form.balance) > 0 && sources.length > 0 && (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <label className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">{receivable ? t("lendMoneyNow") : t("receiveMoneyNow")}</span>
                  {!receivable && <span className="block text-xs text-muted-foreground">{t("receiveMoneyHint")}</span>}
                </span>
                <Switch checked={form.moveMoneyNow} onCheckedChange={(v) => patch({ moveMoneyNow: v, moveAccountId: v ? (form.moveAccountId || sources.find((a) => a.is_default)?.id || sources[0].id) : "" })} aria-label={receivable ? t("lendMoneyNow") : t("receiveMoneyNow")} />
              </label>
              {form.moveMoneyNow && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">{receivable ? t("lendMoneyFrom") : t("receiveMoneyInto")}</Label>
                  <AccountCombobox accounts={sources} value={form.moveAccountId} onChange={(id) => patch({ moveAccountId: id })} currency={orgCurrency} />
                </div>
              )}
            </div>
          )}

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
