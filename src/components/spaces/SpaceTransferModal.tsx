import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { availableCredit, isLiabilityType } from "@/lib/credit-card"
import { toast } from "sonner"
import { TriangleAlert } from "lucide-react"
import { apiErrorMessage, apiPost } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { accountCurrency, accountDisplayName, formatMoney, formatRate } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type TransferState = { space: WealthAccount; mode: "fund" | "withdraw" }

/**
 * Fund or withdraw a Space — both are account↔Space transfers (kind='transfer')
 * via /api/wealth/transfer; `accounts` is the spendable (bank/cash) list. The
 * Dialog stays mounted and is toggled via `open` (mounting a Radix Dialog
 * already-open races the triggering click and closes instantly). `shown` keeps
 * the last state so the content still renders during the close animation.
 */
export function SpaceTransferModal({
  state, accounts, currency, onClose, onDone,
}: {
  state: TransferState | null
  accounts: WealthAccount[]
  currency: string
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation("spaces")
  const { getToken } = useAuth()
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  // Cross-currency only: what the OTHER side receives, in its own currency.
  const [otherAmount, setOtherAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<TransferState | null>(state)

  useEffect(() => {
    if (state) { setShown(state); setAccountId(accounts[0]?.id ?? ""); setAmount(""); setOtherAmount(""); setError(null) }
  }, [state, accounts])

  const active = shown
  const isFund = active?.mode === "fund"
  const balance = active ? Number(active.space.current_balance) : 0
  const amt = Number(amount)
  const source = accounts.find((a) => a.id === accountId)
  // What the source can actually put in: a bank's balance, a credit card's
  // REMAINING CREDIT. Subtracting from a liability's signed balance produced a
  // meaningless "-€1,050.00 after this" and flagged an overdraw on every card.
  // A card with no limit set has no honest figure to project, so it shows none.
  const spendable = source
    ? isLiabilityType(source.type)
      ? availableCredit(source.credit_limit, source.current_balance)
      : Number(source.current_balance)
    : null
  // Each side in its OWN currency: the Space's, and the bank's. When they differ
  // the amount typed is the Space's side and the other input names the bank's.
  const spaceCurrency = accountCurrency(active?.space, currency)
  const sourceCurrency = accountCurrency(source, currency)
  const crossCurrency = !!source && spaceCurrency !== sourceCurrency
  const other = Number(otherAmount)
  const otherValid = !crossCurrency || other > 0
  // Funding: the amount typed is what the Space receives; what leaves the bank
  // is `other` when cross-currency, else the same figure.
  const leavingBank = isFund ? (crossCurrency ? other : amt) : 0
  const projected = isFund && source && amt > 0 && spendable != null && (!crossCurrency || other > 0) ? spendable - leavingBank : null
  const overdraw = projected != null && projected < 0

  async function submit() {
    if (!active) return
    setError(null)
    if (!accountId) { setError(t("pickAccount")); return }
    if (!(amt > 0)) { setError(t("enterAmount")); return }
    if (!isFund && amt > balance) { setError(t("withdrawTooMuch")); return }
    if (!otherValid) { setError(t("enterAmount")); return }
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      // Same currency keeps the historical body (`amount`). Across currencies the
      // Space's side is always `amt` (typed in the Space's currency) and the
      // bank's side is `other`, so the server records the real rate.
      const body = isFund
        ? crossCurrency
          ? { from_account_id: accountId, to_account_id: active.space.id, source_amount: other, destination_amount: amt, source_currency: sourceCurrency, destination_currency: spaceCurrency }
          : { from_account_id: accountId, to_account_id: active.space.id, amount: amt }
        : crossCurrency
          ? { from_account_id: active.space.id, to_account_id: accountId, source_amount: amt, destination_amount: other, source_currency: spaceCurrency, destination_currency: sourceCurrency }
          : { from_account_id: active.space.id, to_account_id: accountId, amount: amt }
      await apiPost("/api/wealth/transfer", token, body)
      toast.success(isFund ? t("fundDone") : t("withdrawDone"))
      onDone()
    } catch (err) {
      setError(apiErrorMessage(err, t("transferFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle>{active && (isFund ? t("fundTitle", { name: active.space.nickname }) : t("withdrawTitle", { name: active.space.nickname }))}</DialogTitle>
          <DialogDescription className="sr-only">{isFund ? t("addMoney") : t("withdraw")}</DialogDescription>
        </DialogHeader>
        {active && (accounts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("noSpendable")}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isFund ? t("fromAccount") : t("toAccount")}</Label>
              <AccountCombobox accounts={accounts} value={accountId} onChange={(v) => { setAccountId(v); setError(null) }} currency={currency} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-amount">{crossCurrency ? `${t("amount")} (${spaceCurrency})` : t("amount")}</Label>
              <Input id="tr-amount" type="number" inputMode="decimal" min="0" step="0.01" max={isFund ? undefined : balance} placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null) }} autoFocus />
              {!isFund && <p className="text-[11px] text-muted-foreground">{t("available", { amount: formatMoney(balance, spaceCurrency) })}</p>}
              {isFund && projected != null && (
                <p className={`text-[11px] ${overdraw ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {t("afterFund", { account: source?.nickname?.trim() || source?.bank_name, amount: formatMoney(projected, sourceCurrency) })}
                </p>
              )}
            </div>
            {crossCurrency && source && (
              <div className="space-y-1.5">
                <Label htmlFor="tr-other-amount">
                  {isFund ? t("amountLeaving", { account: accountDisplayName(source), currency: sourceCurrency }) : t("amountReceived", { account: accountDisplayName(source), currency: sourceCurrency })}
                </Label>
                <Input id="tr-other-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={otherAmount} onChange={(e) => { setOtherAmount(e.target.value); setError(null) }} />
                {amt > 0 && other > 0 && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {isFund ? formatRate(sourceCurrency, spaceCurrency, amt / other) : formatRate(spaceCurrency, sourceCurrency, other / amt)}
                  </p>
                )}
              </div>
            )}
            {error && (
              <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="mt-px size-3.5 shrink-0" /> <span>{error}</span>
              </p>
            )}
          </div>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={busy || accounts.length === 0}>{busy ? t("saving") : isFund ? t("addMoney") : t("withdraw")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
