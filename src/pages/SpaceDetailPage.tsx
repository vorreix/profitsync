import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CalendarClock, Pencil, Repeat, Trash2 } from "lucide-react"
import { apiDelete, apiErrorMessage, apiGet, apiPut } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { isLiabilityType } from "@/lib/credit-card"
import type { Transaction, WealthAccount } from "@/lib/types"
import { accountCurrency, formatMoney } from "@/lib/wealth"
import { getCurrencySymbol } from "@/lib/currencies"
import { autoSavePace, spaceGoalStatus, spaceProgress, suggestedMonthly } from "@/lib/spaces"
import { accountAppearance } from "@/lib/account-color"
import { cn } from "@/lib/utils"
import { spaceIconFor } from "@/components/wealth/space-icons"
import "@/components/wealth/account-color.css"
import { SpaceTransferModal } from "@/components/spaces/SpaceTransferModal"
import { SpaceFormModal } from "@/components/spaces/SpaceFormModal"
import { DeleteSpaceDialog } from "@/components/spaces/DeleteSpaceDialog"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { appLocale } from "@/lib/format-date"

type AutoSave = {
  id: string
  wealth_account_id: string
  amount: number | string
  currency_code?: string | null
  frequency_unit: "day" | "week" | "month" | "year"
  frequency_interval: number
  start_date: string
  end_date: string | null
  next_due_at: string
  active: boolean
  monthly_equivalent: number
}

const todayIso = () => new Date().toISOString().split("T")[0]
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" })

export function SpaceDetailPage() {
  const { id = "" } = useParams()
  const { t } = useTranslation("spaces")
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)

  const [space, setSpace] = useState<WealthAccount | null>(null)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [autoSave, setAutoSave] = useState<AutoSave | null>(null)
  const [history, setHistory] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [transfer, setTransfer] = useState<{ space: WealthAccount; mode: "fund" | "withdraw" } | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const [spaceRow, accountRows, auto, txRows] = await Promise.all([
        apiGet<WealthAccount>(`/api/spaces/${id}`, token),
        apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        apiGet<AutoSave | null>(`/api/spaces/${id}/auto-save`, token).catch(() => null),
        apiGet<Transaction[]>(`/api/transactions?wealthAccountId=${id}`, token).catch(() => [] as Transaction[]),
      ])
      setSpace(spaceRow)
      setAccounts(accountRows.filter((a) => a.type !== "space" && !a.archived_at))
      setAutoSave(auto)
      setHistory(txRows)
    } catch {
      toast.error(t("loadFailed"))
      navigate("/spaces")
    } finally {
      setLoading(false)
    }
  }, [getToken, id, navigate, t])

  useEffect(() => { void load() }, [load])

  const balance = space ? Number(space.current_balance) : 0
  const progress = space ? spaceProgress(balance, space.goal_amount) : null
  const status = space ? spaceGoalStatus(balance, space.goal_amount, space.target_date, todayIso()) : null
  const suggested = space ? suggestedMonthly(balance, space.goal_amount, space.target_date, todayIso()) : null
  const pace = useMemo(() => (autoSave ? autoSavePace(autoSave.monthly_equivalent, suggested) : null), [autoSave, suggested])

  async function stopAutoSave() {
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      await apiDelete(`/api/spaces/${id}/auto-save`, token)
      setAutoSave(null)
      toast.success(t("autoSaveStopped"))
    } catch (err) {
      toast.error(apiErrorMessage(err, t("saveFailed")))
    }
  }

  if (loading || !space) {
    return (
      <div className="space-y-4 p-3 sm:p-6">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    )
  }

  const Icon = spaceIconFor(space.icon)
  // Every figure here — balance, goal, suggestion, auto-save — is in the
  // Space's OWN currency; the workspace's is only the legacy fallback (MC-017).
  const spaceCur = accountCurrency(space, currency)
  const look = accountAppearance(space)
  const ink = look.text === "light" ? "text-white" : "text-slate-900"
  const accountName = (accId: string) => { const a = accounts.find((x) => x.id === accId); return a ? (a.nickname?.trim() || a.bank_name) : "—" }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground" onClick={() => navigate("/spaces")}>
        <ArrowLeft className="size-4" /> {t("wealth.back")}
      </Button>

      {/* Main card — everything for this Space lives here */}
      <div
        style={look.vars as React.CSSProperties}
        className={cn(
          // The Space wears the colour it was given on /spaces (src/lib
          // /account-color.ts) instead of the old fixed emerald.
          "acct-colored relative overflow-hidden rounded-2xl border p-5",
          look.bold ? "acct-bold" : "acct-subtle acct-rail bg-card",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full border",
              look.bold ? (look.text === "light" ? "acct-icon-bold" : "acct-icon-bold-dark") : "acct-icon",
            )}
          >
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className={cn("truncate text-lg font-semibold tracking-tight", look.bold && ink)}>{space.nickname}</h1>
            <p className={cn("mt-0.5 text-3xl font-bold tabular-nums", look.bold && ink)}>{formatMoney(balance, spaceCur)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Special "Set up auto-save" affordance — the standout action on this card. */}
            {canWrite && !autoSave && (
              <button
                type="button"
                onClick={() => setAutoOpen(true)}
                disabled={accounts.length === 0}
                title={t("setupAutoSave")}
                className="group inline-flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-gradient-to-r from-emerald-500/20 to-emerald-500/5 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition-all hover:from-emerald-500/30 hover:to-emerald-500/10 hover:shadow disabled:opacity-50 dark:text-emerald-300"
              >
                <Repeat className="size-3.5 transition-transform group-hover:rotate-180" />
                {t("autoSaveTitle")}
              </button>
            )}
            {canWrite && (
              <Button size="icon" variant="ghost" className="size-9 text-muted-foreground" aria-label={t("edit")} onClick={() => setEditOpen(true)}>
                <Pencil className="size-4" />
              </Button>
            )}
            {canDelete && (
              <Button size="icon" variant="ghost" className="size-9 text-muted-foreground hover:text-destructive" aria-label={t("deleteSpace")} onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        </div>

        {progress && status && (
          <div className="mt-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress.pct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="tabular-nums text-muted-foreground">{progress.pct}% · {formatMoney(balance, spaceCur)} / {formatMoney(Number(space.goal_amount), spaceCur)}</span>
              {status.kind === "reached" && <span className="font-medium text-emerald-600 dark:text-emerald-400">{t("goalReached")}</span>}
              {status.kind === "on_pace" && status.suggestedMonthly > 0 && (
                <span className="tabular-nums text-muted-foreground">{t("suggestLine", { amount: formatMoney(status.suggestedMonthly, spaceCur), date: space.target_date ? fmtDate(space.target_date) : "" })}</span>
              )}
              {status.kind === "overdue" && <span className="font-medium text-amber-600 dark:text-amber-400">{t("pastTarget")}</span>}
            </div>
          </div>
        )}

        {canWrite && (
          <div className="mt-4 flex gap-2">
            <Button className="flex-1" onClick={() => setTransfer({ space, mode: "fund" })}>
              <ArrowDownToLine className="size-4" /> {t("addMoney")}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setTransfer({ space, mode: "withdraw" })} disabled={balance <= 0}>
              <ArrowUpFromLine className="size-4" /> {t("withdraw")}
            </Button>
          </div>
        )}

        {/* Active auto-save status lives at the foot of the main card (the
            set-up affordance for the OFF state is the special pill up top). */}
        {autoSave && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <Repeat className="size-4 text-emerald-600 dark:text-emerald-400" />
                {t("autoSaveOn", { amount: formatMoney(Number(autoSave.amount), autoSave.currency_code ?? spaceCur), freq: freqLabel(t, autoSave.frequency_unit, autoSave.frequency_interval), account: accountName(autoSave.wealth_account_id) })}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5" /> {t("nextOn", { date: fmtDate(autoSave.next_due_at) })}
                {pace && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${pace === "behind" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>{t(`pace_${pace}`)}</span>}
              </p>
            </div>
            {canWrite && (
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" onClick={() => setAutoOpen(true)}>{t("editAutoSave")}</Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={stopAutoSave}>{t("stopAutoSave")}</Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold">{t("activity")}</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("noActivity")}</p>
        ) : (
          <ul className="mt-2 divide-y">
            {history.slice(0, 30).map((tx) => {
              const incoming = tx.type === "incoming"
              return (
                <li key={tx.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${incoming ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {incoming ? <ArrowDownToLine className="size-4" /> : <ArrowUpFromLine className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{incoming ? t("moneyIn") : t("moneyOut")}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(tx.date)}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${incoming ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    {incoming ? "+" : "−"}{formatMoney(Number(tx.amount), tx.currency_code ?? spaceCur)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <SpaceFormModal open={editOpen} space={space} onClose={() => setEditOpen(false)} onSaved={(s) => setSpace((p) => ({ ...(p as WealthAccount), ...s }))} />
      <SpaceTransferModal state={transfer} accounts={accounts} currency={currency} onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); void load({ silent: true }) }} />
      <AutoSaveModal open={autoOpen} spaceId={id} spaceCurrency={spaceCur} accounts={accounts} currency={currency} existing={autoSave} suggested={suggested} onClose={() => setAutoOpen(false)} onSaved={(rule) => { setAutoOpen(false); setAutoSave(rule); void load({ silent: true }) }} />
      <DeleteSpaceDialog space={deleteOpen ? space : null} accounts={accounts} currency={currency} onClose={() => setDeleteOpen(false)} onDeleted={() => navigate("/spaces")} />
    </div>
  )
}

function freqLabel(t: (k: string, o?: Record<string, unknown>) => string, unit: string, interval: number): string {
  const unitLabel = t(`recurring.unit_${unit}`, { ns: "translation" })
  return interval > 1
    ? t("recurring.everyN", { ns: "translation", count: interval, unit: unitLabel })
    : t("recurring.everyOne", { ns: "translation", unit: unitLabel })
}

function AutoSaveModal({
  open, spaceId, spaceCurrency, accounts: allAccounts, currency, existing, suggested, onClose, onSaved,
}: {
  open: boolean
  spaceId: string
  /** The Space's own currency: the rule's amount is in it. */
  spaceCurrency: string
  accounts: WealthAccount[]
  currency: string
  existing: AutoSave | null
  suggested: number | null
  onClose: () => void
  onSaved: (rule: AutoSave) => void
}) {
  const { t } = useTranslation("spaces")
  const { getToken } = useAuth()
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [unit, setUnit] = useState<"day" | "week" | "month" | "year">("month")
  const [interval, setInterval] = useState("1")
  const [start, setStart] = useState(todayIso())
  const [end, setEnd] = useState("")
  const [busy, setBusy] = useState(false)
  // An auto-save moves the same figure out of the source and into the Space, so
  // the server only takes a source in the Space's currency — offering (and
  // pre-selecting) any other led straight to a 409 (MC-070).
  // Money the user HOLDS only: a credit card would set up a monthly cash
  // advance into savings (auto-save funds from a bank or cash account).
  const accounts = useMemo(() => allAccounts.filter((a) => !isLiabilityType(a.type) && accountCurrency(a, currency) === spaceCurrency), [allAccounts, currency, spaceCurrency])

  useEffect(() => {
    if (!open) return
    setBusy(false)
    if (existing) {
      // A rule saved before the currency guard may draw on another currency:
      // offer a valid source instead of a selection the save would refuse.
      setAccountId(accounts.some((a) => a.id === existing.wealth_account_id) ? existing.wealth_account_id : accounts[0]?.id ?? "")
      setAmount(String(existing.amount))
      setUnit(existing.frequency_unit)
      setInterval(String(existing.frequency_interval))
      setStart(existing.start_date)
      setEnd(existing.end_date ?? "")
    } else {
      setAccountId(accounts[0]?.id ?? "")
      setAmount(suggested && suggested > 0 ? String(suggested) : "")
      setUnit("month"); setInterval("1"); setStart(todayIso()); setEnd("")
    }
  }, [open, existing, accounts, suggested])

  async function submit() {
    if (!accountId) { toast.error(t("pickAccount")); return }
    if (!(Number(amount) > 0)) { toast.error(t("enterAmount")); return }
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      const rule = await apiPut<AutoSave>(`/api/spaces/${spaceId}/auto-save`, token, {
        source_account_id: accountId,
        amount: Number(amount),
        frequency_unit: unit,
        frequency_interval: Math.max(1, Math.floor(Number(interval) || 1)),
        start_date: start,
        end_date: end || null,
      })
      toast.success(t("autoSaveStarted"))
      onSaved(rule)
    } catch (err) {
      toast.error(apiErrorMessage(err, t("saveFailed")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader><DialogTitle>{t("autoSaveTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{t("autoSaveExplain")}</p>
          <div className="space-y-1.5">
            <Label>{t("sourceAccount")}</Label>
            <AccountCombobox accounts={accounts} value={accountId} onChange={setAccountId} currency={currency} />
            {accounts.length === 0 && <p className="text-xs text-muted-foreground">{t("autoSaveNoAccount", { currency: spaceCurrency })}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-amount">{t("amount")}</Label>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>{getCurrencySymbol(spaceCurrency)}</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput id="as-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </InputGroup>
            </div>
            <div className="space-y-1.5">
              <Label>{t("frequency")}</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{t("recurring.daily", { ns: "translation" })}</SelectItem>
                  <SelectItem value="week">{t("recurring.weekly", { ns: "translation" })}</SelectItem>
                  <SelectItem value="month">{t("recurring.monthly", { ns: "translation" })}</SelectItem>
                  <SelectItem value="year">{t("recurring.yearly", { ns: "translation" })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-interval">{t("every")}</Label>
              <Input id="as-interval" type="number" inputMode="numeric" min="1" max="365" step="1" value={interval} onChange={(e) => setInterval(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-start">{t("startsOn")}</Label>
              <Input id="as-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-end">{t("endsOn")}</Label>
            <Input id="as-end" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">{t("endsOptional")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button onClick={submit} disabled={busy || accounts.length === 0}>{busy ? t("saving") : t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
