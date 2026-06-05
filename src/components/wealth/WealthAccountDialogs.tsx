import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  Banknote,
  BriefcaseBusiness,
  CreditCard,
  Landmark,
  Star,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { apiPatch, clearApiCache } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { currencySymbol } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const WEALTH_ICONS: Array<{ value: string; label: string; Icon: LucideIcon }> = [
  { value: "bank", label: "Bank", Icon: Landmark },
  { value: "card", label: "Card", Icon: CreditCard },
  { value: "cash", label: "Cash", Icon: Banknote },
  { value: "wallet", label: "Wallet", Icon: Wallet },
  { value: "business", label: "Business", Icon: BriefcaseBusiness },
  { value: "custom", label: "Custom", Icon: Star },
]

function IconOption({ icon }: { icon: string }) {
  const option = WEALTH_ICONS.find((item) => item.value === icon) ?? WEALTH_ICONS[0]
  const Icon = option.Icon
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{option.label}</span>
    </span>
  )
}

export function IconSelect({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full justify-between">
        <SelectValue placeholder={<IconOption icon={value} />} />
      </SelectTrigger>
      <SelectContent position="popper" className="z-[100]">
        {WEALTH_ICONS.map(({ value: v, label, Icon }) => (
          <SelectItem key={v} value={v} textValue={label}>
            <span className="flex items-center gap-2"><Icon className="size-4" />{label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type EditForm = { bank_name: string; nickname: string; icon: string }

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
  const [editForm, setEditForm] = useState<EditForm>({ bank_name: "", nickname: "", icon: "bank" })
  const [adjustBalance, setAdjustBalance] = useState("")

  useEffect(() => {
    if (editing) {
      setEditForm({
        bank_name: editing.bank_name,
        nickname: editing.nickname,
        icon: editing.icon || (editing.type === "cash" ? "wallet" : "bank"),
      })
    }
  }, [editing])

  useEffect(() => {
    if (adjusting) setAdjustBalance(String(adjusting.current_balance))
  }, [adjusting])

  async function patchAccount(id: string, body: Record<string, unknown>, success: string, onDone: () => void) {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<WealthAccount>(`/api/wealth/accounts/${id}`, token, body)
      clearApiCache()
      window.dispatchEvent(new Event("wealth:accounts-changed"))
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
    patchAccount(
      editing.id,
      { bankName: editForm.bank_name.trim(), nickname: editForm.nickname.trim(), icon: editForm.icon },
      t("accountUpdated"),
      () => onEditingChange(null),
    )
  }

  return (
    <>
      <Dialog open={!!editing} onOpenChange={(next) => { if (!next) onEditingChange(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("editAccount")}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{editing.type === "cash" ? t("displayName") : t("bankName")}</Label>
                <Input
                  value={editForm.bank_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, bank_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("nickname")}</Label>
                <Input
                  value={editForm.nickname}
                  placeholder={editing.type === "cash" ? t("cashInHand") : "Main Account"}
                  onChange={(e) => setEditForm((f) => ({ ...f, nickname: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("logoIcon")}</Label>
                <IconSelect value={editForm.icon} onChange={(icon) => setEditForm((f) => ({ ...f, icon }))} />
              </div>
            </div>
          )}
          <DialogFooter>
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
              onClick={() => adjusting && patchAccount(adjusting.id, { current_balance: Number(adjustBalance || 0) }, t("balanceAdjusted"), () => onAdjustingChange(null))}
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
