import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  Archive,
  Banknote,
  BriefcaseBusiness,
  CreditCard,
  Eye,
  EyeOff,
  Landmark,
  Plus,
  RotateCcw,
  Star,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { apiDelete, apiGet, apiPatch, clearApiCache, getActiveOrgId } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { accountDisplayName, currencySymbol, formatMoney, useBalancePrivacy, useWealthSummary } from "@/lib/wealth"

type AccountForm = {
  type: "bank" | "cash"
  bank_name: string
  nickname: string
  opening_balance: string
  icon: string
}

const emptyForm: AccountForm = {
  type: "bank",
  bank_name: "",
  nickname: "",
  opening_balance: "",
  icon: "bank",
}

const MAX_BANK_ACCOUNTS = 5
const BANK_LIMIT_HELPER = "Maximum 5 bank accounts allowed."
const CASH_LIMIT_HELPER = "Only one Cash in Hand account is allowed."

const iconOptions: Array<{ value: string; label: string; Icon: LucideIcon }> = [
  { value: "bank", label: "Bank", Icon: Landmark },
  { value: "card", label: "Card", Icon: CreditCard },
  { value: "cash", label: "Cash", Icon: Banknote },
  { value: "wallet", label: "Wallet", Icon: Wallet },
  { value: "business", label: "Business", Icon: BriefcaseBusiness },
  { value: "custom", label: "Custom", Icon: Star },
]

function IconOption({ icon }: { icon: string }) {
  const option = iconOptions.find((item) => item.value === icon) ?? iconOptions[0]
  const Icon = option.Icon
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{option.label}</span>
    </span>
  )
}

export function WealthPage() {
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)
  const { balancesVisible, setBalancesVisible } = useBalancePrivacy()
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<AccountForm>(emptyForm)
  const [editing, setEditing] = useState<WealthAccount | null>(null)
  const [editForm, setEditForm] = useState<AccountForm>(emptyForm)
  const [adjusting, setAdjusting] = useState<WealthAccount | null>(null)
  const [adjustBalance, setAdjustBalance] = useState("")

  const { active, total } = useWealthSummary(accounts)
  const bankCount = active.filter((a) => a.type === "bank").length
  const hasCash = active.some((a) => a.type === "cash")
  const bankLimitReached = bankCount >= MAX_BANK_ACCOUNTS
  const cashLimitReached = hasCash
  const archived = useMemo(() => accounts.filter((a) => a.archived_at), [accounts])

  async function load() {
    const token = await getToken()
    if (!token) return
    setLoading(true)
    try {
      setAccounts(await apiGet<WealthAccount[]>("/api/wealth/accounts", token))
    } catch {
      toast.error("Failed to load wealth accounts")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate(type: "bank" | "cash") {
    if (type === "bank" && bankLimitReached) {
      toast.error(BANK_LIMIT_HELPER)
      return
    }
    if (type === "cash" && cashLimitReached) {
      toast.error(CASH_LIMIT_HELPER)
      return
    }
    setForm({
      ...emptyForm,
      type,
      bank_name: type === "cash" ? "Cash in Hand" : "",
      icon: type === "cash" ? "wallet" : "bank",
    })
    setOpen(true)
  }

  function openEdit(account: WealthAccount) {
    setEditing(account)
    setEditForm({
      type: account.type,
      bank_name: account.bank_name,
      nickname: account.nickname,
      opening_balance: "",
      icon: account.icon || (account.type === "cash" ? "wallet" : "bank"),
    })
  }

  async function handleCreate() {
    if (form.type === "bank" && bankLimitReached) {
      toast.error(BANK_LIMIT_HELPER)
      setOpen(false)
      return
    }
    if (form.type === "cash" && cashLimitReached) {
      toast.error(CASH_LIMIT_HELPER)
      setOpen(false)
      return
    }
    if (form.type === "bank" && !form.bank_name.trim()) {
      toast.error("Bank name is required")
      return
    }
    setSaving(true)
    const url = "/api/wealth/accounts"
    const method = "POST"
    const payload = {
      type: form.type,
      bankName: form.bank_name,
      nickname: form.nickname,
      icon: form.icon,
      openingBalance: Number(form.opening_balance || 0),
    }
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      console.log("[wealth:add-account] request", { url, method, payload })
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(getActiveOrgId() ? { "x-org-id": getActiveOrgId() as string } : {}),
        },
        body: JSON.stringify(payload),
      })
      const responseText = await response.text()
      console.log("[wealth:add-account] response", {
        url,
        method,
        status: response.status,
        ok: response.ok,
        body: responseText,
      })
      if (!response.ok) {
        let message = responseText
        try {
          const parsed = JSON.parse(responseText) as { error?: unknown }
          if (typeof parsed.error === "string") message = parsed.error
        } catch {
          // Fall back to the raw response text.
        }
        throw new Error(message || `HTTP ${response.status}`)
      }
      clearApiCache()
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success("Account added")
      setOpen(false)
      await load()
    } catch (err) {
      console.error("Could not add account:", err)
      toast.error(err instanceof Error ? err.message : "Could not add account. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  async function patchAccount(id: string, body: Record<string, unknown>, success: string) {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<WealthAccount>(`/api/wealth/accounts/${id}`, token, body)
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success(success)
      setAdjusting(null)
      setEditing(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update account")
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editing) return
    if (editing.type === "bank" && !editForm.bank_name.trim()) {
      toast.error("Bank name is required")
      return
    }
    if (!editForm.icon.trim()) {
      toast.error("Logo/icon is required")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<WealthAccount>(`/api/wealth/accounts/${editing.id}`, token, {
        bankName: editForm.bank_name.trim(),
        nickname: editForm.nickname.trim(),
        icon: editForm.icon,
      })
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success("Account updated")
      setEditing(null)
      await load()
    } catch (err) {
      console.error("Could not update account:", err)
      toast.error("Could not update account. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  async function deleteOrArchive(account: WealthAccount) {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/wealth/accounts/${account.id}`, token)
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success((account.transaction_count ?? 0) > 0 ? "Account archived" : "Account removed")
      await load()
    } catch {
      toast.error("Failed to archive account")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Wealth</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manual tracking only. ProfitSync does not connect to your bank.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label={balancesVisible ? "Hide balances" : "Show balances"}
          onClick={() => setBalancesVisible((v) => !v)}
        >
          {balancesVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Banks & Cash</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Total available: {formatMoney(total, currency, balancesVisible)}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openCreate("cash")} disabled={cashLimitReached || loading}>
                <Plus className="size-4" /> Cash
              </Button>
              <Button size="sm" onClick={() => openCreate("bank")} disabled={bankLimitReached || loading}>
                <Plus className="size-4" /> Bank
              </Button>
            </div>
            {(cashLimitReached || bankLimitReached) && (
              <div className="text-right text-xs text-muted-foreground">
                {cashLimitReached && <p>{CASH_LIMIT_HELPER}</p>}
                {bankLimitReached && <p>{BANK_LIMIT_HELPER}</p>}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm font-medium">No bank or cash account yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Add an account before recording transactions.</p>
              <Button className="mt-4" onClick={() => openCreate("bank")}>
                <Plus className="size-4" /> Add Account
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accounts.map((account) => (
                <div key={account.id} className={`rounded-xl border bg-card p-4 ${account.archived_at ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <WealthAccountIcon account={account} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{accountDisplayName(account)}</p>
                        {account.nickname && <p className="truncate text-xs text-muted-foreground">{account.bank_name}</p>}
                      </div>
                    </div>
                    {account.archived_at && <Badge variant="outline">Archived</Badge>}
                  </div>
                  <p className="mt-4 text-2xl font-bold tabular-nums">{formatMoney(Number(account.current_balance), currency, balancesVisible)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!account.archived_at ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => { setAdjusting(account); setAdjustBalance(String(account.current_balance)) }}>
                          Adjust
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(account)}>
                          Edit Account
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteOrArchive(account)} disabled={saving}>
                          <Archive className="size-4" /> Archive Account
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => patchAccount(account.id, { restore: true }, "Account restored")} disabled={saving}>
                        <RotateCcw className="size-4" /> Restore
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {archived.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">Archived accounts stay linked to old transaction history.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{form.type === "cash" ? "Add Cash in Hand" : "Add Bank Account"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{form.type === "cash" ? "Name" : "Bank name"}</Label>
              <Input value={form.bank_name} disabled={form.type === "cash"} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} />
            </div>
            {form.type === "bank" && (
              <>
                <div className="space-y-1.5">
                  <Label>Nickname</Label>
                  <Input value={form.nickname} placeholder="Main Account" onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Logo/icon</Label>
                  <Select value={form.icon} onValueChange={(icon) => setForm((f) => ({ ...f, icon }))}>
                    <SelectTrigger className="w-full justify-between">
                      <SelectValue placeholder={<IconOption icon={form.icon} />} />
                    </SelectTrigger>
                    <SelectContent position="popper" className="z-[100]">
                      {iconOptions.map(({ value, label, Icon }) => (
                        <SelectItem key={value} value={value} textValue={label}>
                          <span className="flex items-center gap-2">
                            <Icon className="size-4" />
                            {label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Opening balance ({symbol})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.opening_balance}
                placeholder={`${symbol} 0.00`}
                onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || (form.type === "bank" && bankLimitReached) || (form.type === "cash" && cashLimitReached)}>
              {saving ? "Saving..." : "Add Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(next) => { if (!next) setEditing(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Account</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>{editing.type === "cash" ? "Display name" : "Bank name"}</Label>
                <Input
                  value={editForm.bank_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, bank_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nickname</Label>
                <Input
                  value={editForm.nickname}
                  placeholder={editing.type === "cash" ? "Cash wallet" : "Main Account"}
                  onChange={(e) => setEditForm((f) => ({ ...f, nickname: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Logo/icon</Label>
                <Select value={editForm.icon} onValueChange={(icon) => setEditForm((f) => ({ ...f, icon }))}>
                  <SelectTrigger className="w-full justify-between">
                    <SelectValue placeholder={<IconOption icon={editForm.icon} />} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[100]">
                    {iconOptions.map(({ value, label, Icon }) => (
                      <SelectItem key={value} value={value} textValue={label}>
                        <span className="flex items-center gap-2">
                          <Icon className="size-4" />
                          {label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjusting} onOpenChange={(next) => { if (!next) setAdjusting(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Adjust Balance</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>New balance</Label>
            <Input type="number" step="0.01" value={adjustBalance} onChange={(e) => setAdjustBalance(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              ProfitSync will create a Balance Adjustment transaction for the difference.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjusting(null)}>Cancel</Button>
            <Button
              onClick={() => adjusting && patchAccount(adjusting.id, { current_balance: Number(adjustBalance || 0) }, "Balance adjusted")}
              disabled={saving}
            >
              {saving ? "Saving..." : "Adjust Balance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
