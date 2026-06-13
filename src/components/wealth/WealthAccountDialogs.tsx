import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { apiPatch, clearApiCache } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import type { WealthAccount } from "@/lib/types"
import { currencySymbol } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { IconSelect } from "@/components/wealth/icon-select"
import { BankAccountFormFields } from "@/components/wealth/BankAccountFormFields"
import { type BankFormState, bankDetailsPayload, bankFormFromAccount, emptyBankForm } from "@/lib/bank-form"

// Re-exported for back-compat (was defined here originally).
export { IconSelect } from "@/components/wealth/icon-select"

const SHEET_CLASS = "inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl"

type EditForm = BankFormState

/**
 * Edit-account and Adjust-balance dialogs, shared by the wealth list and the
 * account-detail page. `editing`/`adjusting` are controlled by the parent;
 * `onChanged` fires after a successful save so the parent can refresh.
 */
export function WealthAccountDialogs({
  editing,
  onEditingChange,
  adjusting,
  onAdjustingChange,
  currency,
  onChanged,
}: {
  editing: WealthAccount | null
  onEditingChange: (account: WealthAccount | null) => void
  adjusting: WealthAccount | null
  onAdjustingChange: (account: WealthAccount | null) => void
  currency: string
  onChanged: () => void
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>(emptyBankForm)
  const [adjustBalance, setAdjustBalance] = useState("")

  useEffect(() => {
    if (editing) {
      setEditForm(bankFormFromAccount({
        ...editing,
        icon: editing.icon || (editing.type === "cash" ? "wallet" : "bank"),
      }))
      // Re-arm: the dialogs stay mounted between opens, so a request left in
      // flight when the user closed one must not freeze the button on reopen.
      setSaving(false)
    }
  }, [editing])

  useEffect(() => {
    if (adjusting) {
      setAdjustBalance(String(adjusting.current_balance))
      setSaving(false)
    }
  }, [adjusting])

  async function patchAccount(id: string, body: Record<string, unknown>, success: string, onDone: () => void) {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<WealthAccount>(`/api/wealth/accounts/${id}`, token, body)
      clearApiCache()
      toast.success(success)
      onDone()
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotUpdate"))
    } finally {
      setSaving(false)
    }
  }

  function handleEdit() {
    if (!editing) return
    if (editing.type === "bank" && !editForm.bank_name.trim()) {
      toast.error(t("bankNameRequired"))
      return
    }
    if (!editForm.icon.trim()) {
      toast.error(t("iconRequired"))
      return
    }
    const body: Record<string, unknown> = {
      bankName: editForm.bank_name.trim(),
      nickname: editForm.nickname.trim(),
      icon: editForm.icon,
    }
    // Banking details only apply to bank accounts.
    if (editing.type === "bank") Object.assign(body, bankDetailsPayload(editForm))
    patchAccount(editing.id, body, t("accountUpdated"), () => onEditingChange(null))
  }

  return (
    <>
      <Dialog open={!!editing} onOpenChange={(next) => { if (!next) onEditingChange(null) }}>
        <DialogContent className={SHEET_CLASS}>
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>{t("editAccount")}</DialogTitle></DialogHeader>
          {editing && (
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
              {editing.type === "cash" ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>{t("displayName")}</Label>
                    <Input value={editForm.bank_name} onChange={(e) => setEditForm((f) => ({ ...f, bank_name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("nickname")}</Label>
                    <Input value={editForm.nickname} placeholder={t("cashInHand")} onChange={(e) => setEditForm((f) => ({ ...f, nickname: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("logoIcon")}</Label>
                    <IconSelect value={editForm.icon} onChange={(icon) => setEditForm((f) => ({ ...f, icon }))} />
                  </div>
                </div>
              ) : (
                <BankAccountFormFields form={editForm} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />
              )}
            </div>
          )}
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => onEditingChange(null)}>{t("cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? t("saving") : t("saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjusting} onOpenChange={(next) => { if (!next) onAdjustingChange(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("adjustBalance")}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>{t("newBalance")} ({currencySymbol(currency)})</Label>
            <Input type="number" step="0.01" value={adjustBalance} onChange={(e) => setAdjustBalance(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("adjustHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onAdjustingChange(null)}>{t("cancel")}</Button>
            <Button
              onClick={() => {
                if (!adjusting) return
                if (amountExceedsLimit(adjustBalance)) { toast.error(t("common.amountTooLarge")); return }
                patchAccount(adjusting.id, { current_balance: Number(adjustBalance || 0) }, t("balanceAdjusted"), () => onAdjustingChange(null))
              }}
              disabled={saving}
            >
              {saving ? t("saving") : t("adjustBalance")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
