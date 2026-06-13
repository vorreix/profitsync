import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { TriangleAlert } from "lucide-react"
import { apiErrorMessage, apiPost } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<TransferState | null>(state)

  useEffect(() => {
    if (state) { setShown(state); setAccountId(accounts[0]?.id ?? ""); setAmount(""); setError(null) }
  }, [state, accounts])

  const active = shown
  const isFund = active?.mode === "fund"
  const balance = active ? Number(active.space.current_balance) : 0
  const amt = Number(amount)
  const source = accounts.find((a) => a.id === accountId)
  const projected = isFund && source && amt > 0 ? Number(source.current_balance) - amt : null
  const overdraw = projected != null && projected < 0

  async function submit() {
    if (!active) return
    setError(null)
    if (!accountId) { setError(t("pickAccount")); return }
    if (!(amt > 0)) { setError(t("enterAmount")); return }
    if (!isFund && amt > balance) { setError(t("withdrawTooMuch")); return }
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      const body = isFund
        ? { from_account_id: accountId, to_account_id: active.space.id, amount: amt }
        : { from_account_id: active.space.id, to_account_id: accountId, amount: amt }
      await apiPost("/api/wealth/transfer", token, body, ["/api/spaces", "/api/wealth"])
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
              <Select value={accountId} onValueChange={(v) => { setAccountId(v); setError(null) }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nickname?.trim() || a.bank_name} — {formatMoney(Number(a.current_balance), currency)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tr-amount">{t("amount")}</Label>
              <Input id="tr-amount" type="number" inputMode="decimal" min="0" step="0.01" max={isFund ? undefined : balance} placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null) }} autoFocus />
              {!isFund && <p className="text-[11px] text-muted-foreground">{t("available", { amount: formatMoney(balance, currency) })}</p>}
              {isFund && projected != null && (
                <p className={`text-[11px] ${overdraw ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                  {t("afterFund", { account: source?.nickname?.trim() || source?.bank_name, amount: formatMoney(projected, currency) })}
                </p>
              )}
            </div>
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
