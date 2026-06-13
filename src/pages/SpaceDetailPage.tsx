import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CalendarClock, Pencil, Repeat, Trash2 } from "lucide-react"
import { apiDelete, apiGet, apiPut } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import type { Transaction, WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { autoSavePace, spaceGoalStatus, spaceProgress, suggestedMonthly } from "@/lib/spaces"
import { spaceIconFor } from "@/components/wealth/space-icons"
import { SpaceTransferModal } from "@/components/spaces/SpaceTransferModal"
import { SpaceFormModal } from "@/components/spaces/SpaceFormModal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type AutoSave = {
  id: string
  wealth_account_id: string
  amount: number | string
  frequency_unit: "day" | "week" | "month" | "year"
  frequency_interval: number
  start_date: string
  end_date: string | null
  next_due_at: string
  active: boolean
  monthly_equivalent: number
}

const todayIso = () => new Date().toISOString().split("T")[0]
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

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
  const [deleting, setDeleting] = useState(false)

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

  async function handleDelete() {
    if (!space) return
    setDeleting(false)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      await apiDelete(`/api/spaces/${space.id}`, token, undefined, ["/api/spaces", "/api/wealth"])
      toast.success(t("deleted"))
      navigate("/spaces")
    } catch (err) {
      toast.error(err instanceof Error && err.message && err.message !== "auth" ? err.message : t("deleteFailed"))
    }
  }

  async function stopAutoSave() {
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      await apiDelete(`/api/spaces/${id}/auto-save`, token, undefined, ["/api/spaces"])
      setAutoSave(null)
      toast.success(t("autoSaveStopped"))
    } catch {
      toast.error(t("saveFailed"))
    }
  }

  if (loading || !space) {
    return (
      <div className="space-y-4 p-3 sm:p-6">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    )
  }

  const Icon = spaceIconFor(space.icon)
  const accountName = (accId: string) => { const a = accounts.find((x) => x.id === accId); return a ? (a.nickname?.trim() || a.bank_name) : "—" }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-3 sm:space-y-5 sm:p-6">
      <Button variant="ghost" size="sm" className="-ml-2 h-8 gap-1.5 text-muted-foreground" onClick={() => navigate("/spaces")}>
        <ArrowLeft className="size-4" /> {t("back")}
      </Button>

      {/* Hero */}
      <div className="rounded-2xl border bg-gradient-to-br from-emerald-500/10 to-transparent p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{space.nickname}</h1>
            <p className="mt-0.5 text-3xl font-bold tabular-nums">{formatMoney(balance, currency)}</p>
          </div>
          {canWrite && (
            <Button size="icon" variant="ghost" className="size-9 shrink-0 text-muted-foreground" aria-label={t("edit")} onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
            </Button>
          )}
        </div>

        {progress && status && (
          <div className="mt-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress.pct}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="tabular-nums text-muted-foreground">{progress.pct}% · {formatMoney(balance, currency)} / {formatMoney(Number(space.goal_amount), currency)}</span>
              {status.kind === "reached" && <span className="font-medium text-emerald-600 dark:text-emerald-400">{t("goalReached")}</span>}
              {status.kind === "on_pace" && status.suggestedMonthly > 0 && (
                <span className="tabular-nums text-muted-foreground">{t("suggestLine", { amount: formatMoney(status.suggestedMonthly, currency), date: space.target_date ? fmtDate(space.target_date) : "" })}</span>
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
      </div>

      {/* Auto-save */}
      <div className="rounded-2xl border bg-card p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Repeat className="size-4 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-semibold">{t("autoSaveTitle")}</h2>
        </div>
        {autoSave ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{formatMoney(Number(autoSave.amount), currency)}</span>{" "}
              {freqLabel(t, autoSave.frequency_unit, autoSave.frequency_interval)} · {t("fromShort")} {accountName(autoSave.wealth_account_id)}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5" /> {t("nextOn", { date: fmtDate(autoSave.next_due_at) })}
              {pace && <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${pace === "behind" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>{t(`pace_${pace}`)}</span>}
            </p>
            {canWrite && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setAutoOpen(true)}>{t("editAutoSave")}</Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={stopAutoSave}>{t("stopAutoSave")}</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground">{t("autoSaveOffHint")}</p>
            {canWrite && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAutoOpen(true)} disabled={accounts.length === 0}>
                <Repeat className="size-4" /> {t("setupAutoSave")}
              </Button>
            )}
            {accounts.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t("noSpendable")}</p>}
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
                    {incoming ? "+" : "−"}{formatMoney(Number(tx.amount), currency)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {canDelete && (
        <Button variant="ghost" className="w-full text-muted-foreground hover:text-destructive" onClick={() => setDeleting(true)}>
          <Trash2 className="size-4" /> {t("deleteSpace")}
        </Button>
      )}

      <SpaceFormModal open={editOpen} space={space} onClose={() => setEditOpen(false)} onSaved={(s) => setSpace((p) => ({ ...(p as WealthAccount), ...s }))} />
      <SpaceTransferModal state={transfer} accounts={accounts} currency={currency} onClose={() => setTransfer(null)} onDone={() => { setTransfer(null); void load({ silent: true }) }} />
      <AutoSaveModal open={autoOpen} spaceId={id} accounts={accounts} currency={currency} existing={autoSave} suggested={suggested} onClose={() => setAutoOpen(false)} onSaved={(rule) => { setAutoOpen(false); setAutoSave(rule); void load({ silent: true }) }} />

      <AlertDialog open={deleting} onOpenChange={(o) => { if (!o) setDeleting(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody", { name: space.nickname })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  open, spaceId, accounts, currency, existing, suggested, onClose, onSaved,
}: {
  open: boolean
  spaceId: string
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

  useEffect(() => {
    if (!open) return
    setBusy(false)
    if (existing) {
      setAccountId(existing.wealth_account_id)
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
      }, ["/api/spaces"])
      toast.success(t("autoSaveStarted"))
      onSaved(rule)
    } catch (err) {
      toast.error(err instanceof Error && err.message && err.message !== "auth" ? err.message : t("saveFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader><DialogTitle>{t("autoSaveTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="as-account">{t("sourceAccount")}</Label>
            <select id="as-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname?.trim() || a.bank_name} — {formatMoney(Number(a.current_balance), currency)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-amount">{t("amount")}</Label>
              <Input id="as-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-unit">{t("frequency")}</Label>
              <select id="as-unit" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                <option value="day">{t("recurring.daily", { ns: "translation" })}</option>
                <option value="week">{t("recurring.weekly", { ns: "translation" })}</option>
                <option value="month">{t("recurring.monthly", { ns: "translation" })}</option>
                <option value="year">{t("recurring.yearly", { ns: "translation" })}</option>
              </select>
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
