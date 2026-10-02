import { useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { apiDelete, apiErrorMessage, apiPost } from "@/lib/api"
import { getCurrencySymbol } from "@/lib/currencies"
import { ledgerAmountProblem } from "@/lib/money"
import type { WealthAccount } from "@/lib/types"
import { accountCurrency, accountDisplayName, formatMoney, formatRate } from "@/lib/wealth"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { defaultSpaceDestination, needsReceivedAmount } from "@/components/spaces/delete-space"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Delete a Space. An empty one simply goes; one still holding money first moves
 * it out (a transfer to the chosen account), because the server refuses to
 * delete a Space that isn't empty.
 *
 * The money moves in the Space's OWN currency. An account in another currency
 * is still a valid destination, but the transfer then needs what actually
 * arrives there — asked for here, exactly as the fund/withdraw modal does — or
 * the server refuses it (MC-069: "Move & close" into an INR wallet failed for a
 * EUR Space, and the dialog showed the euros as rupees). The default pick is
 * an account in the Space's currency, so the common case asks nothing more.
 *
 * `space=null` → closed. The Dialog stays mounted and keeps the last Space so
 * the content still renders through the close animation.
 */
export function DeleteSpaceDialog({
  space, accounts, currency, onClose, onDeleted,
}: {
  space: WealthAccount | null
  /** Spendable (bank/cash) accounts the money can move to. */
  accounts: WealthAccount[]
  /** Workspace currency — the fallback for a legacy row with no stored currency. */
  currency: string
  onClose: () => void
  onDeleted: (space: WealthAccount) => void
}) {
  const { t } = useTranslation("spaces")
  const { getToken } = useAuth()
  const [shown, setShown] = useState<WealthAccount | null>(space)
  const [destId, setDestId] = useState("")
  const [received, setReceived] = useState("")
  const [busy, setBusy] = useState(false)
  // The money already moved out, but the DELETE after it failed. A retry must
  // only re-send the DELETE — re-sending the transfer would move the balance a
  // second time and overdraw the Space. Kept across closes: /spaces holds the
  // pre-transfer row, so reopening it would show the old balance again.
  const moved = useRef<{ id: string; balance: number } | null>(null)

  const spaceCur = accountCurrency(shown, currency)
  const balance = shown ? Number(shown.current_balance) : 0
  const hasMoney = balance > 0
  const dest = accounts.find((a) => a.id === destId)
  const destCur = accountCurrency(dest, currency)
  const crossCurrency = needsReceivedAmount(balance, spaceCur, dest ? destCur : null)

  useEffect(() => {
    if (!space) return
    // A stale copy of a Space we already emptied (same id, same old balance)
    // is shown as the empty Space it now is.
    const m = moved.current
    setShown(m && m.id === space.id && m.balance === Number(space.current_balance) ? { ...space, current_balance: 0 } : space)
    setBusy(false)
    setReceived("")
    setDestId(defaultSpaceDestination(accounts, accountCurrency(space, currency), currency))
  }, [space, accounts, currency])

  async function confirm() {
    if (!shown) return
    if (hasMoney && !dest) { toast.error(t("noSpendable")); return }
    const problem = crossCurrency ? ledgerAmountProblem(received) : null
    if (problem) { toast.error(t(`apiErrors.${problem}`, { ns: "translation" })); return }
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      if (hasMoney && dest) {
        // Move the balance out first; the empty Space can then be deleted.
        await apiPost("/api/wealth/transfer", token, crossCurrency
          ? { from_account_id: shown.id, to_account_id: dest.id, source_amount: balance, destination_amount: received, source_currency: spaceCur, destination_currency: destCur }
          : { from_account_id: shown.id, to_account_id: dest.id, amount: balance })
        moved.current = { id: shown.id, balance }
        setShown({ ...shown, current_balance: 0 })
      }
      await apiDelete(`/api/spaces/${shown.id}`, token)
      toast.success(t("deleted"))
      onDeleted(shown)
    } catch (err) {
      toast.error(apiErrorMessage(err, t("deleteFailed")))
    } finally {
      setBusy(false)
    }
  }

  const receivedNum = Number(received)
  return (
    <Dialog open={space !== null} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("deleteTitle")}</DialogTitle>
          <DialogDescription className="sr-only">{t("deleteSpace")}</DialogDescription>
        </DialogHeader>
        {shown && (hasMoney ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("deleteWithMoney", { amount: formatMoney(balance, spaceCur) })}</p>
            <div className="space-y-1.5">
              <Label>{t("moveTo")}</Label>
              <AccountCombobox accounts={accounts} value={destId} onChange={(id) => { setDestId(id); setReceived("") }} currency={currency} />
            </div>
            {crossCurrency && dest && (
              <div className="space-y-1.5">
                <Label htmlFor="del-space-received">{t("amountReceived", { account: accountDisplayName(dest), currency: destCur })}</Label>
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>{getCurrencySymbol(destCur)}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput id="del-space-received" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={received} onChange={(e) => setReceived(e.target.value)} />
                </InputGroup>
                {receivedNum > 0 && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">{formatRate(spaceCur, destCur, receivedNum / balance)}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("deleteBody", { name: shown.nickname })}</p>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || (hasMoney && (accounts.length === 0 || (crossCurrency && !(receivedNum > 0))))}>
            {busy ? t("saving") : hasMoney ? t("moveAndClose") : t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
