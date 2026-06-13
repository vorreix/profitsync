import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowDownRight, ArrowLeft, ArrowUpRight, CalendarClock, Pause, Pencil, Play, Plus, Repeat, Trash2, TriangleAlert } from "lucide-react"
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { accountTypeAllows } from "@/lib/types"
import type { Client, RecurringRule, WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { occurrenceAt, type Frequency } from "@/lib/recurring"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CategoryPicker } from "@/components/CategoryPicker"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"

type RuleForm = {
  name: string
  type: "incoming" | "outgoing"
  amount: string
  category: string
  client_id: string // "" = own company / personal
  wealth_account_id: string // "" = none
  frequency_unit: "day" | "week" | "month" | "year"
  frequency_interval: string
  start_date: string
  end_date: string
}

const emptyForm = (): RuleForm => ({
  name: "",
  type: "outgoing",
  amount: "",
  category: "",
  client_id: "",
  wealth_account_id: "",
  frequency_unit: "month",
  frequency_interval: "1",
  start_date: new Date().toISOString().split("T")[0],
  end_date: "",
})

export function RecurringPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")

  const [rules, setRules] = useState<RecurringRule[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringRule | null>(null)
  const [deleting, setDeleting] = useState<RecurringRule | null>(null)
  const [form, setForm] = useState<RuleForm>(emptyForm())

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const [ruleRows, accountRows, clientRows] = await Promise.all([
        apiGet<RecurringRule[]>("/api/recurring", token),
        apiGet<WealthAccount[]>("/api/wealth/accounts", token),
        hasClients ? apiGet<{ data?: Client[] } | Client[]>("/api/clients", token).catch(() => []) : Promise.resolve([]),
      ])
      setRules(ruleRows)
      setAccounts(accountRows.filter((a) => !a.archived_at))
      const list = Array.isArray(clientRows) ? clientRows : (clientRows.data ?? [])
      setClients(list.filter((c) => !c.is_own))
    } catch {
      toast.error(t("recurring.loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [getToken, hasClients, t])

  useEffect(() => { load() }, [load])

  // Deep link from a transaction's recurring badge: /recurring?view=<ruleId>.
  // Once the rules are loaded, scroll the matching rule into view and pulse a
  // highlight ring, then strip the param so back-nav / re-renders don't re-fire.
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewRuleId = searchParams.get("view")
  const [highlightId, setHighlightId] = useState<string | null>(null)
  // Arrived here from a transaction's recurring badge? Remember it for the whole
  // visit (the ?view param gets stripped after the highlight) so the Back button
  // stays available to return to exactly where the user was.
  const [cameFromTxn, setCameFromTxn] = useState(false)
  useEffect(() => {
    if (searchParams.get("view")) setCameFromTxn(true)
    // mount-only: capture the entry param before the highlight effect strips it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (loading || !viewRuleId || !rules.some((r) => r.id === viewRuleId)) return
    document.getElementById(`rule-${viewRuleId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    setHighlightId(viewRuleId)
    const timer = setTimeout(() => {
      setHighlightId(null)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete("view")
        return next
      }, { replace: true })
    }, 2200)
    return () => clearTimeout(timer)
  }, [loading, viewRuleId, rules, setSearchParams])

  // Real browser back lands on the exact prior entry (reopens the transaction
  // modal / restores the list scroll). Fall back to the list if opened cold.
  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate("/transactions")
  }

  const upcoming = useMemo(() => rules.filter((r) => r.active), [rules])
  const paused = useMemo(() => rules.filter((r) => !r.active), [rules])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    // Re-arm: the dialog stays mounted between opens, so a request left in flight
    // when the user closed it must not freeze the save button on reopen.
    setSaving(false)
    setFormOpen(true)
  }

  function openEdit(rule: RecurringRule) {
    setEditing(rule)
    setSaving(false)
    setForm({
      name: rule.name,
      type: rule.type,
      amount: String(rule.amount),
      category: rule.category,
      client_id: rule.client_id ?? "",
      wealth_account_id: rule.wealth_account_id ?? "",
      frequency_unit: rule.frequency_unit,
      frequency_interval: String(rule.frequency_interval),
      start_date: rule.start_date,
      end_date: rule.end_date ?? "",
    })
    setFormOpen(true)
  }

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
        wealth_account_id: form.wealth_account_id || null,
        frequency_unit: form.frequency_unit,
        frequency_interval: Math.max(1, Math.floor(Number(form.frequency_interval) || 1)),
        start_date: form.start_date,
        end_date: form.end_date || null,
      }
      if (editing) {
        const updated = await apiPatch<RecurringRule>(`/api/recurring/${editing.id}`, token, body, ["/api/recurring", "/api/transactions", "/api/wealth"])
        setRules((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)))
        toast.success(t("recurring.updated"))
      } else {
        const created = await apiPost<RecurringRule & { created_now?: number }>("/api/recurring", token, body, ["/api/recurring", "/api/transactions", "/api/wealth"])
        toast.success(
          created.created_now
            ? t("recurring.createdWithTx", { count: created.created_now })
            : t("recurring.created"),
        )
        await load({ silent: true })
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("recurring.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rule: RecurringRule) {
    const next = !rule.active
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: next } : r)))
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/recurring/${rule.id}`, token, { active: next }, ["/api/recurring", "/api/transactions", "/api/wealth"])
      if (next) await load({ silent: true }) // resuming may have materialized
    } catch {
      toast.error(t("recurring.saveFailed"))
      await load({ silent: true })
    }
  }

  async function handleDelete() {
    if (!deleting) return
    const rule = deleting
    setDeleting(null)
    setRules((prev) => prev.filter((r) => r.id !== rule.id))
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/recurring/${rule.id}`, token, undefined, ["/api/recurring"])
      toast.success(t("recurring.deleted"))
    } catch {
      toast.error(t("recurring.deleteFailed"))
      await load({ silent: true })
    }
  }

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

  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

  const freqLabel = (rule: RecurringRule) => {
    const unit = t(`recurring.unit_${rule.frequency_unit}` as const)
    return rule.frequency_interval > 1
      ? t("recurring.everyN", { count: rule.frequency_interval, unit })
      : t("recurring.everyOne", { unit })
  }

  const renderRule = (rule: RecurringRule) => (
    <li
      key={rule.id}
      id={`rule-${rule.id}`}
      className={`flex items-center gap-3 rounded-xl border bg-card p-3 transition-shadow sm:p-4 ${
        highlightId === rule.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
    >
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
        rule.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
      }`}>
        {rule.type === "incoming"
          ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
          : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{rule.name}</p>
          {rule.last_error && (
            <span title={rule.last_error}>
              <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {freqLabel(rule)}
          {hasClients && <> · {rule.client_id ? rule.client_name : t("recurring.ownCompany")}</>}
          {rule.account_name ? <> · {rule.account_name}</> : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {rule.active
            ? t("recurring.nextOn", { date: fmtDate(rule.next_due_at) })
            : t("recurring.paused")}
          {rule.end_date ? <> · {t("recurring.until", { date: fmtDate(rule.end_date) })}</> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <p className={`text-sm font-bold tabular-nums ${rule.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {rule.type === "incoming" ? "+" : "−"}{formatMoney(Number(rule.amount), currency)}
        </p>
        <div className="flex items-center">
          {canWrite && (
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={rule.active ? t("recurring.pause") : t("recurring.resume")} onClick={() => toggleActive(rule)}>
              {rule.active ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          )}
          {canWrite && (
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label={t("recurring.edit")} onClick={() => openEdit(rule)}>
              <Pencil className="size-4" />
            </Button>
          )}
          {canDelete && (
            <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label={t("recurring.delete")} onClick={() => setDeleting(rule)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </li>
  )

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {cameFromTxn && (
        <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground" onClick={goBack}>
          <ArrowLeft className="size-4" /> {t("recurring.back")}
        </Button>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("recurring.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground sm:mt-1">{t("recurring.subtitle")}</p>
        </div>
        {canWrite && (
          <Button onClick={openCreate} className="shrink-0">
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("recurring.add")}</span>
            <span className="sm:hidden">{t("recurring.addShort")}</span>
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : rules.length === 0 ? (
        <button
          type="button"
          onClick={canWrite ? openCreate : undefined}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-center text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <Repeat className="size-8 text-muted-foreground/50" />
          <span className="text-sm font-medium">{t("recurring.empty")}</span>
          <span className="max-w-sm text-xs">{t("recurring.emptyHint")}</span>
        </button>
      ) : (
        <>
          <ul className="space-y-2">{upcoming.map(renderRule)}</ul>
          {paused.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t("recurring.pausedSection")}</p>
              <ul className="space-y-2 opacity-70">{paused.map(renderRule)}</ul>
            </div>
          )}
        </>
      )}

      {/* Create / edit dialog (bottom sheet on mobile) */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
            <DialogTitle>{editing ? t("recurring.editTitle") : t("recurring.addTitle")}</DialogTitle>
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
              <Label>{t("recurring.account")}</Label>
              <Select value={form.wealth_account_id || "none"} onValueChange={(v) => setForm((f) => ({ ...f, wealth_account_id: v === "none" ? "" : v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("recurring.noAccount")}</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <WealthAccountIcon account={a} className="size-5" />
                        {a.nickname || a.bank_name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{t("recurring.accountHint")}</p>
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
                {!editing && form.start_date < new Date().toISOString().split("T")[0] && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{t("recurring.backdatedHint")}</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? t("common.saving") : editing ? t("common.save") : t("recurring.add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recurring.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("recurring.deleteBody", { name: deleting?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>{t("recurring.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
