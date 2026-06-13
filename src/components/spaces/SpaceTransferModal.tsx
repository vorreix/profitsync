import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { apiPost } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Fund or withdraw a Space. Both are account↔Space transfers (kind='transfer')
 * via /api/wealth/transfer; `accounts` is the spendable (bank/cash) list. Shared
 * by the Spaces list cards and the Space detail page.
 */
export function SpaceTransferModal({
  state, accounts, currency, onClose, onDone,
}: {
  state: { space: WealthAccount; mode: "fund" | "withdraw" } | null
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

  useEffect(() => {
    if (state) { setAccountId(accounts[0]?.id ?? ""); setAmount("") }
  }, [state, accounts])

  if (!state) return null
  const isFund = state.mode === "fund"
  const balance = Number(state.space.current_balance)

  async function submit() {
    const amt = Number(amount)
    if (!accountId) { toast.error(t("pickAccount")); return }
    if (!(amt > 0)) { toast.error(t("enterAmount")); return }
    if (!isFund && amt > balance) { toast.error(t("withdrawTooMuch")); return }
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      const body = isFund
        ? { from_account_id: accountId, to_account_id: state!.space.id, amount: amt }
        : { from_account_id: state!.space.id, to_account_id: accountId, amount: amt }
      await apiPost("/api/wealth/transfer", token, body, ["/api/spaces", "/api/wealth"])
      toast.success(isFund ? t("fundDone") : t("withdrawDone"))
      onDone()
    } catch (err) {
      toast.error(err instanceof Error && err.message && err.message !== "auth" ? err.message : t("transferFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle>{isFund ? t("fundTitle", { name: state.space.nickname }) : t("withdrawTitle", { name: state.space.nickname })}</DialogTitle>
        </DialogHeader>
        {accounts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{t("noSpendable")}</p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{isFund ? t("fromAccount") : t("toAccount")}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
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
              <Input id="tr-amount" type="number" inputMode="decimal" min="0" step="0.01" max={isFund ? undefined : balance} placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              {!isFund && <p className="text-[11px] text-muted-foreground">{t("available", { amount: formatMoney(balance, currency) })}</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={busy || accounts.length === 0}>{busy ? t("saving") : isFund ? t("addMoney") : t("withdraw")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
