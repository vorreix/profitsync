import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowRight, CreditCard } from "lucide-react"
import { apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import { isLiabilityType } from "@/lib/credit-card"
import type { CreditCardSummary, WealthAccount } from "@/lib/types"
import { accountDisplayName, currencySymbol, formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const today = () => new Date().toISOString().split("T")[0]

export type PayPreset = "statement" | "full" | "other"

/**
 * "Pay card": pick the account to pay from and how much — the statement
 * remaining, everything owed, or another amount — and ProfitSync records the
 * proper TRANSFER (POST /api/wealth/transfer, bank → card). The user never has
 * to know it is a transfer, and it is never an expense.
 */
export function PayCardSheet({
  open,
  onOpenChange,
  card,
  summary,
  accounts,
  currency,
  initialPreset = "statement",
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  card: WealthAccount
  summary: CreditCardSummary | null
  accounts: WealthAccount[]
  currency: string
  initialPreset?: PayPreset
  onDone?: () => void
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const symbol = currencySymbol(currency)

  // Sources: active, non-card, non-Space accounts (a card is paid from money you hold).
  const sources = useMemo(
    () => accounts.filter((a) => !a.archived_at && a.id !== card.id && !isLiabilityType(a.type) && a.type !== "space"),
    [accounts, card.id],
  )
  const statementRemaining = summary?.statement?.remaining ?? 0
  const debt = summary?.usage.debt ?? 0

  const [fromId, setFromId] = useState("")
  const [preset, setPreset] = useState<PayPreset>("statement")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(today())
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const defaultSource = sources.find((a) => a.is_default) ?? sources.find((a) => a.type === "bank") ?? sources[0]
    setFromId(defaultSource?.id ?? "")
    const startPreset: PayPreset = initialPreset === "statement" && statementRemaining <= 0 ? (debt > 0 ? "full" : "other") : initialPreset
    setPreset(startPreset)
    setAmount(startPreset === "statement" ? String(statementRemaining) : startPreset === "full" ? String(debt) : "")
    setDate(today())
    setNote("")
    setSaving(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function choose(p: PayPreset) {
    setPreset(p)
    if (p === "statement") setAmount(String(statementRemaining))
    else if (p === "full") setAmount(String(debt))
    else setAmount("")
  }

  const amt = parseFloat(amount)
  const amountValid = !!amt && !isNaN(amt) && amt > 0
  const from = sources.find((a) => a.id === fromId)

  async function submit() {
    if (!fromId) { toast.error(t("selectAccount")); return }
    if (!amountValid) { toast.error(t("payAmount")); return }
    if (amountExceedsLimit(amt)) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/wealth/transfer", token, {
        from_account_id: fromId,
        to_account_id: card.id,
        amount: amt,
        date,
        note,
      })
      toast.success(t("cardPaid"))
      onOpenChange(false)
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("payFailed"))
    } finally {
      setSaving(false)
    }
  }

  const options: { key: PayPreset; label: string; value: number | null }[] = [
    { key: "statement", label: t("payStatementOption"), value: statementRemaining > 0 ? statementRemaining : null },
    { key: "full", label: t("payFullOption"), value: debt > 0 ? debt : null },
    { key: "other", label: t("payOtherOption"), value: null },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <WealthAccountIcon account={card} className="size-7" />
            <span className="truncate">{t("payCard")} · {accountDisplayName(card)}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("payFrom")}</Label>
            <AccountCombobox accounts={sources} value={fromId} onChange={setFromId} currency={currency} />
          </div>

          <div className="space-y-2" role="radiogroup" aria-label={t("payAmount")}>
            <Label className="text-xs text-muted-foreground">{t("payAmount")}</Label>
            <div className="grid gap-2">
              {options.map((o) => {
                const disabled = o.key !== "other" && o.value === null
                const selected = preset === o.key
                return (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => choose(o.key)}
                    className={cn(
                      "pressable ios-tap flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                      selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
                      disabled && "opacity-50",
                    )}
                  >
                    <span className="font-medium">{o.label}</span>
                    {o.value !== null && <span className="tabular-nums text-muted-foreground">{formatMoney(o.value, currency)}</span>}
                  </button>
                )
              })}
            </div>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-muted-foreground">{symbol}</span>
              <Label htmlFor="pay-amount" className="sr-only">{t("payAmount")}</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setPreset("other") }}
                placeholder="0.00"
                className="h-16 pl-11 text-center text-3xl font-bold tabular-nums"
              />
            </div>
            {debt <= 0 && <p className="text-center text-xs text-muted-foreground">{t("nothingToPay")}</p>}
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{from ? accountDisplayName(from) : "…"}</span>
            <ArrowRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden />
            <span className="truncate">{accountDisplayName(card)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">{t("payDate")}</Label>
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-note">{t("payNote")}</Label>
              <Textarea id="pay-note" rows={1} className="min-h-9 resize-none" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t("cardPaymentHint")}</p>
        </div>

        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={saving || !amountValid || !fromId}>
            <CreditCard className="size-4" /> {saving ? t("saving") : t("recordPayment")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
