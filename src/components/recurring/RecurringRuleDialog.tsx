import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { CalendarClock } from "lucide-react"
import { apiPatch, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { accountTypeAllows } from "@/lib/types"
import type { Card, Client, RecurringRule, WealthAccount } from "@/lib/types"
import { occurrenceAt, type Frequency } from "@/lib/recurring"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CategoryPicker } from "@/components/CategoryPicker"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"

export type RuleForm = {
  name: string
  type: "incoming" | "outgoing"
  amount: string
  category: string
  client_id: string // "" = own company / personal
  wealth_account_id: string // "" = none
  card_id: string // "" = paid straight from the account
  frequency_unit: "day" | "week" | "month" | "year"
  frequency_interval: string
  start_date: string
  end_date: string
}

const emptyRuleForm = (): RuleForm => ({
  name: "",
  type: "outgoing",
  amount: "",
  category: "",
  client_id: "",
  wealth_account_id: "",
  card_id: "",
  frequency_unit: "month",
  frequency_interval: "1",
  start_date: new Date().toISOString().split("T")[0],
  end_date: "",
})

const formFromRule = (rule: RecurringRule): RuleForm => ({
  name: rule.name,
  type: rule.type,
  amount: String(rule.amount),
  category: rule.category,
  client_id: rule.client_id ?? "",
  wealth_account_id: rule.wealth_account_id ?? "",
  card_id: rule.card_id ?? "",
  frequency_unit: rule.frequency_unit,
  frequency_interval: String(rule.frequency_interval),
  start_date: rule.start_date,
  end_date: rule.end_date ?? "",
})

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

/**
 * THE create/edit form for a recurring payment — shared by the list (/recurring)
 * and one rule's own page (/recurring/:id), so editing behaves identically
 * wherever it is opened from. The parent owns `open` and the rule being edited;
 * this owns the form, the schedule preview and the save.
 */
export function RecurringRuleDialog({
  open,
  onOpenChange,
  rule,
  preset,
  accounts,
  clients,
  cards,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create a new rule. */
  rule: RecurringRule | null
  /** Seed values for a create (e.g. a card page's "Add recurring"). */
  preset?: Partial<RuleForm>
  accounts: WealthAccount[]
  clients: Client[]
  /** Cards that can pay right now (`usableCards`). */
  cards: Card[]
  onSaved: (rule: RecurringRule, info: { created: boolean; createdNow?: number }) => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")

  const [form, setForm] = useState<RuleForm>(emptyRuleForm)
  const [saving, setSaving] = useState(false)
  // Read at open time only — a fresh object identity each render must not
  // re-seed the form while the user is typing in it.
  const presetRef = useRef(preset)
  presetRef.current = preset

  // Seed on each OPEN (the dialog stays mounted between opens): the rule's own
  // values when editing, the preset when creating. Re-arming `saving` matters
  // too — a request still in flight when the user closed it would otherwise
  // leave the save button dead on reopen.
  useEffect(() => {
    if (!open) return
    setForm(rule ? formFromRule(rule) : { ...emptyRuleForm(), ...presetRef.current })
    setSaving(false)
  }, [open, rule])

  // Live preview of the next three occurrences for the form's schedule.
  const preview = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.start_date)) return []
    const freq: Frequency = {
      unit: form.frequency_unit,
      interval: Math.max(1, Math.floor(Number(form.frequency_interval) || 1)),
    }
    const out: string[] = []
    for (let n = 0; n < 3; n++) {
      const d = occurrenceAt(form.start_date, freq, n)
      if (form.end_date && d > form.end_date) break
      out.push(d)
    }
    return out
  }, [form.start_date, form.frequency_unit, form.frequency_interval, form.end_date])

  async function handleSave() {
    if (!form.name.trim()) { toast.error(t("recurring.nameRequired")); return }
    if (!(Number(form.amount) > 0)) { toast.error(t("recurring.amountRequired")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const body = {
        name: form.name.trim(),
        type: form.type,
        amount: Number(form.amount),
        category: form.category,
        client_id: form.client_id || null,
        // The card decides the account server-side (it is always the card's own).
        wealth_account_id: form.wealth_account_id || null,
        card_id: form.card_id || null,
        frequency_unit: form.frequency_unit,
        frequency_interval: Math.max(1, Math.floor(Number(form.frequency_interval) || 1)),
        start_date: form.start_date,
        end_date: form.end_date || null,
      }
      if (rule) {
        const updated = await apiPatch<RecurringRule>(`/api/recurring/${rule.id}`, token, body)
        toast.success(t("recurring.updated"))
        onSaved(updated, { created: false })
      } else {
        const created = await apiPost<RecurringRule & { created_now?: number }>("/api/recurring", token, body)
        toast.success(
          created.created_now
            ? t("recurring.createdWithTx", { count: created.created_now })
            : t("recurring.created"),
        )
        onSaved(created, { created: true, createdNow: created.created_now })
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("recurring.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{rule ? t("recurring.editTitle") : t("recurring.addTitle")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="rec-name">{t("recurring.name")}</Label>
            <Input id="rec-name" value={form.name} maxLength={120} placeholder={t("recurring.namePlaceholder")} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("recurring.direction")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as RuleForm["type"] }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="outgoing">{t("recurring.outgoing")}</SelectItem>
                  <SelectItem value="incoming">{t("recurring.incoming")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-amount">{t("recurring.amount")}</Label>
              <Input id="rec-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>

          {hasClients && (
            <div className="space-y-1.5">
              <Label>{t("recurring.client")}</Label>
              <Select value={form.client_id || "own"} onValueChange={(v) => setForm((f) => ({ ...f, client_id: v === "own" ? "" : v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="own">{t("recurring.ownCompany")}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("recurring.cardPayWith")}</Label>
            {/* Accounts AND cards: picking a card also sets its account (the
                server enforces the pair — a card only ever pays from its own). */}
            <AccountCombobox
              accounts={accounts}
              cards={cards}
              value={form.card_id || form.wealth_account_id}
              onChange={(id, picked) => setForm((f) => ({ ...f, wealth_account_id: picked ? picked.account_id : id, card_id: picked?.card_id ?? "" }))}
              currency={currency}
              allowNone
              noneLabel={t("recurring.noAccount")}
            />
            <p className="text-[11px] text-muted-foreground">{t("recurring.cardPayWithHint")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("recurring.category")}</Label>
            <CategoryPicker type={form.type} value={form.category} onChange={(name) => setForm((f) => ({ ...f, category: name }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("recurring.repeats")}</Label>
              <Select value={form.frequency_unit} onValueChange={(v) => setForm((f) => ({ ...f, frequency_unit: v as RuleForm["frequency_unit"] }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t("recurring.daily")}</SelectItem>
                  <SelectItem value="week">{t("recurring.weekly")}</SelectItem>
                  <SelectItem value="month">{t("recurring.monthly")}</SelectItem>
                  <SelectItem value="year">{t("recurring.yearly")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-interval">{t("recurring.every")}</Label>
              <Input id="rec-interval" type="number" inputMode="numeric" min="1" max="365" step="1" value={form.frequency_interval} onChange={(e) => setForm((f) => ({ ...f, frequency_interval: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-start">{t("recurring.startsOn")}</Label>
              <Input id="rec-start" type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-end">{t("recurring.endsOn")}</Label>
              <Input id="rec-end" type="date" value={form.end_date} min={form.start_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground">{t("recurring.endsOnHint")}</p>
            </div>
          </div>

          {preview.length > 0 && (
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarClock className="size-3.5" /> {t("recurring.previewTitle")}
              </p>
              <p className="mt-1 text-sm">{preview.map(fmtDate).join(" · ")}{preview.length === 3 ? " …" : ""}</p>
              {!rule && form.start_date < new Date().toISOString().split("T")[0] && (
                <p className="mt-1 text-[11px] text-muted-foreground">{t("recurring.backdatedHint")}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? t("common.saving") : rule ? t("common.save") : t("recurring.add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Delete confirmation for one rule. Deleting stops the schedule; the payments it
 * already created are kept (see the DELETE handler) — the copy says so.
 */
export function DeleteRecurringDialog({
  rule,
  onOpenChange,
  onConfirm,
}: {
  /** The rule pending deletion, or null when nothing is. */
  rule: RecurringRule | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={rule !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("recurring.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("recurring.deleteBody", { name: rule?.name ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>{t("recurring.delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
