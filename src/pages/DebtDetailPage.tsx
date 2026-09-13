import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, Archive, ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, CircleDollarSign, Link2, MoreVertical, PauseCircle, Pencil, PlayCircle, Plus, Repeat, Scale, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react"
import { apiDelete, apiErrorMessage, apiGet, apiPatch } from "@/lib/api"
import { WEALTH_CHANGED_EVENT } from "@/lib/data-events"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import type { Debt, DebtActivityRow, DebtDetailResponse, DebtPayment } from "@/lib/types"
import { useBalancePrivacy } from "@/lib/wealth"
import { debtKindLabel, debtMoney, formatLongDate, formatMonthYear } from "@/lib/debt-format"
import { fromCents } from "@/lib/debt-math"
import { cn } from "@/lib/utils"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { DebtStatusBadge } from "@/components/debts/DebtStatusBadge"
import { DebtFormSheet } from "@/components/debts/DebtFormSheet"
import { LinkRepaymentDialog } from "@/components/debts/LinkRepaymentDialog"
import { RecordPaymentSheet } from "@/components/debts/RecordPaymentSheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/** One debt: where it stands, what comes next, its history and its schedule. */
export function DebtDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation("debts")
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const { balancesVisible } = useBalancePrivacy()

  const [data, setData] = useState<DebtDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reconcile, setReconcile] = useState<string | null>(null)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [deletingPayment, setDeletingPayment] = useState<DebtPayment | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [linking, setLinking] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!id) return
    const token = await getToken()
    if (!token) return
    if (!silent) setLoading(true)
    try {
      setData(await apiGet<DebtDetailResponse>(`/api/debts/${id}`, token))
    } catch {
      toast.error(t("couldNotLoad"))
      navigate("/debts")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id, getToken, navigate, t])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = () => void load({ silent: true })
    window.addEventListener(WEALTH_CHANGED_EVENT, h)
    return () => window.removeEventListener(WEALTH_CHANGED_EVENT, h)
  }, [load])

  async function patch(body: Record<string, unknown>, success: string) {
    if (!id) return
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Debt>(`/api/debts/${id}`, token, body)
      toast.success(success)
      await load({ silent: true })
    } catch (err) {
      toast.error(apiErrorMessage(err, t("couldNotSave")))
    } finally {
      setBusy(false)
    }
  }

  async function closeDebt() {
    if (!id) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/debts/${id}`, token)
      toast.success(t("closed"))
      navigate("/debts")
    } catch (err) {
      toast.error(apiErrorMessage(err, t("couldNotSave")))
    }
  }

  async function deletePayment(p: DebtPayment) {
    if (!id) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/debts/${id}/payments/${p.id}`, token)
      toast.success(t("paymentDeleted"))
      await load({ silent: true })
    } catch (err) {
      toast.error(apiErrorMessage(err, t("couldNotSave")))
    } finally {
      setDeletingPayment(null)
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-6 p-3 sm:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  const { debt, activity, repayment, schedule } = data
  const money = (n: number) => debtMoney(n, debt, balancesVisible)
  const isOpen = debt.lifecycle === "active" || debt.lifecycle === "paused"
  const receivable = debt.direction === "receivable"
  const freq = debt.payment_frequency && debt.payment_frequency !== "irregular" ? t(`frequency.${debt.payment_frequency}`) : null
  const scheduleRows = schedule ? (scheduleOpen ? schedule.rows : schedule.rows.slice(0, 6)) : []

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/debts")} className="-ml-2 mt-0.5 shrink-0" aria-label={t("back")}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <WealthAccountIcon account={{ type: receivable ? "bank" : "loan", icon: debt.icon, logo_src: debt.logo_src }} className="size-11" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{debt.name}</h1>
              <DebtStatusBadge status={debt.status} />
              {receivable && <Badge variant="secondary">{t("owedToMe")}</Badge>}
            </div>
            <p className="truncate text-sm text-muted-foreground">{debtKindLabel(debt.kind, t)}{debt.counterparty && debt.counterparty !== debt.name ? ` · ${debt.counterparty}` : ""}</p>
          </div>
        </div>
        {canWrite && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={t("edit")}><MoreVertical className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil className="size-4" /> {t("edit")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setReconcile(String(debt.balance))}><SlidersHorizontal className="size-4" /> {t("reconcile")}</DropdownMenuItem>
              <DropdownMenuSeparator />
              {debt.lifecycle === "active" && <DropdownMenuItem onSelect={() => void patch({ lifecycle: "paused" }, t("updated"))}><PauseCircle className="size-4" /> {t("pause")}</DropdownMenuItem>}
              {debt.lifecycle === "paused" && <DropdownMenuItem onSelect={() => void patch({ lifecycle: "active" }, t("updated"))}><PlayCircle className="size-4" /> {t("resume")}</DropdownMenuItem>}
              {isOpen && <DropdownMenuItem onSelect={() => void patch({ lifecycle: "paid_off" }, t("updated"))}><CheckCircle2 className="size-4" /> {t("markPaidOff")}</DropdownMenuItem>}
              {isOpen && <DropdownMenuItem onSelect={() => void patch({ lifecycle: "written_off" }, t("updated"))}>{t("writeOff")}</DropdownMenuItem>}
              {!isOpen && <DropdownMenuItem onSelect={() => void patch({ lifecycle: "active" }, t("updated"))}><PlayCircle className="size-4" /> {t("reopen")}</DropdownMenuItem>}
              {canDelete && !debt.archived_at && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setCloseConfirm(true)} className="text-destructive focus:text-destructive"><Archive className="size-4" /> {t("closeDebt")}</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Hero */}
      <section className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("remaining")}{debt.balance_is_estimate && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px]">{t("estimated")}</span>}
        </p>
        <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">{money(debt.balance)}</p>
        {debt.progress_pct !== null && (
          <div className="mt-3 space-y-1">
            <Progress value={debt.progress_pct} aria-label={t("repaid", { pct: debt.progress_pct })} className={cn("h-2", debt.status === "paid_off" && "[&>div]:bg-emerald-500")} />
            <p className="text-xs text-muted-foreground tabular-nums">{t("repaid", { pct: Math.round(debt.progress_pct) })}{debt.original_amount != null && ` · ${t("ofOriginal", { amount: money(debt.original_amount) })}`}</p>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("payment")} value={debt.payment_amount && freq ? t("paymentEvery", { amount: money(debt.payment_amount), frequency: freq }) : t("noScheduledPayment")} />
          <Stat label={t("nextDue")} value={debt.next_due_date && isOpen ? formatLongDate(debt.next_due_date) : "—"} />
          <Stat label={t("rate")} value={debt.annual_rate_pct != null ? `${debt.annual_rate_pct}%${debt.rate_type ? ` · ${t(`rateType.${debt.rate_type}`)}` : ""}` : t("noRate")} />
          <Stat
            label={t("debtFreeDate")}
            value={isOpen ? (debt.estimate.kind === "date" ? `${formatMonthYear(debt.estimate.date)}${debt.estimate.assumedZeroRate ? " *" : ""}` : t("debtFreeUnknown")) : t(`status.${debt.lifecycle}`)}
          />
        </div>
        {debt.estimate.kind === "date" && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("remainingInterest")}: <span className="font-medium text-foreground tabular-nums">{money(fromCents(debt.estimate.remainingInterest))}</span>
            {debt.remaining_installments != null && <> · {t("installmentsLeft", { count: debt.remaining_installments })}</>}
            {debt.estimate.assumedZeroRate && <> · * {t("assumedZeroRate")}</>}
          </p>
        )}
        {canWrite && isOpen && !debt.archived_at && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setPaying(true)} className="pressable"><Plus className="size-4" /> {receivable ? t("recordReceipt") : t("recordPayment")}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="pressable"><Pencil className="size-4" /> {t("edit")}</Button>
          </div>
        )}
        {debt.refinanced_into_account_id && (
          <Button variant="link" className="mt-2 h-auto p-0 text-xs" onClick={() => navigate(`/debts/${debt.refinanced_into_account_id}`)}>{t("refinanced")} →</Button>
        )}
      </section>

      {/* The recurring repayment that services this debt */}
      <section aria-labelledby="dr" className="space-y-2">
        <h2 id="dr" className="text-sm font-semibold">{t("repaymentSection")}</h2>
        {repayment ? (
          <div className="space-y-3 rounded-2xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", repayment.active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <Repeat className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {t("repaymentEvery", {
                    amount: money(repayment.amount),
                    frequency: repayment.frequency ? t(`frequency.${repayment.frequency}`) : t("frequencyCustom", { interval: repayment.frequency_interval, unit: t(`unit.${repayment.frequency_unit}`) }),
                  })}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {repayment.from_account_name
                    ? receivable ? t("repaymentIntoAccount", { account: repayment.from_account_name }) : t("repaymentFromAccount", { account: repayment.from_account_name })
                    : t("repaymentNoAccount")}
                  {repayment.active ? ` · ${t("repaymentNext", { date: formatLongDate(repayment.next_due_at) })}` : ` · ${t("repaymentPaused")}`}
                </p>
              </div>
            </div>
            {repayment.last_error && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{repayment.last_error}</span>
              </p>
            )}
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="pressable"
                  disabled={busy}
                  onClick={() => void patch({ repayment: { enabled: !repayment.active } }, t("updated"))}
                >
                  {repayment.active ? <><PauseCircle className="size-4" /> {t("pauseRepayment")}</> : <><PlayCircle className="size-4" /> {t("resumeRepayment")}</>}
                </Button>
                <Button size="sm" variant="ghost" className="pressable" onClick={() => navigate(`/recurring/${repayment.id}`)}>
                  {t("openRepayment")} <ChevronRight className="size-4 rtl:rotate-180" />
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-4">
            <p className="text-sm text-muted-foreground">{t("noRepayment")}</p>
            {canWrite && isOpen && !debt.archived_at && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="pressable" onClick={() => setEditing(true)}><Repeat className="size-4" /> {t("setUpRepayment")}</Button>
                {/* The standing order usually exists BEFORE the debt does. */}
                <Button size="sm" variant="ghost" className="pressable" onClick={() => setLinking(true)}><Link2 className="size-4" /> {t("linkExistingRepayment")}</Button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Everything that ever moved on this debt */}
      <section aria-labelledby="dh" className="space-y-2">
        <h2 id="dh" className="text-sm font-semibold">{t("activityTitle")} {activity.length > 0 && <span className="text-muted-foreground">({activity.length})</span>}</h2>
        {activity.length === 0 ? (
          <div className="rounded-2xl border py-10 text-center text-sm text-muted-foreground">{t("noActivityYet")}</div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {activity.map((a) => (
              <ActivityRow
                key={a.id}
                row={a}
                receivable={receivable}
                money={money}
                t={t}
                canDelete={canDelete && a.kind === "payment" && !!a.payment_id}
                onDelete={() => setDeletingPayment({ id: a.payment_id! } as DebtPayment)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Schedule */}
      {schedule && schedule.rows.length > 0 && (
        <section aria-labelledby="ds" className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="ds" className="text-sm font-semibold">{t("schedule")}</h2>
            <p className="text-xs text-muted-foreground">{t("scheduleHint")}{schedule.assumed_zero_rate && ` ${t("assumedZeroRate")}`}</p>
          </div>
          {!schedule.converges && <p className="text-xs text-amber-700 dark:text-amber-300">{t("scheduleDoesNotConverge")}</p>}
          <div className="overflow-x-auto rounded-2xl border bg-card">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("columns.date")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("columns.payment")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("columns.interest")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("columns.principal")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("columns.balance")}</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular-nums">
                {scheduleRows.map((r) => (
                  <tr key={r.period}>
                    <td className="px-3 py-1.5">{formatLongDate(r.date)}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.payment)}</td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{money(r.interest)}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.principal)}</td>
                    <td className="px-3 py-1.5 text-right">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {schedule.rows.length > 6 && (
            <Button variant="ghost" size="sm" onClick={() => setScheduleOpen((v) => !v)} aria-expanded={scheduleOpen}>
              <ChevronDown className={cn("size-4 transition-transform", scheduleOpen && "rotate-180")} /> {scheduleOpen ? t("hideSchedule") : t("showFullSchedule")}
            </Button>
          )}
        </section>
      )}

      {debt.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{debt.notes}</p>}

      <LinkRepaymentDialog
        open={linking}
        onOpenChange={setLinking}
        debt={debt}
        // Paused counts: a debt with a paused rule must not take a second.
        linkedRuleIds={repayment ? [repayment.id] : []}
        onLinked={() => void load({ silent: true })}
      />
      <RecordPaymentSheet open={paying} onOpenChange={setPaying} debt={debt} repayment={repayment} onSaved={() => void load({ silent: true })} />
      <DebtFormSheet open={editing} onOpenChange={setEditing} direction={debt.direction} editing={debt} repayment={repayment} orgCurrency={debt.currency} onSaved={() => void load({ silent: true })} />

      {/* Reconcile */}
      <Dialog open={reconcile !== null} onOpenChange={(o) => { if (!o) setReconcile(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("reconcileTitle")}</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="rec-bal">{t("remaining")} ({debt.currency})</Label>
            <Input id="rec-bal" type="number" inputMode="decimal" min="0" step="0.01" value={reconcile ?? ""} onChange={(e) => setReconcile(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t("reconcileHint")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReconcile(null)}>{t("cancel")}</Button>
            <Button disabled={busy} onClick={async () => { await patch({ current_balance: Number(reconcile || 0) }, t("updated")); setReconcile(null) }}>{t("saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("closeDebtTitle")}</AlertDialogTitle><AlertDialogDescription>{t("closeDebtDesc")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={closeDebt} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("closeDebt")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingPayment} onOpenChange={(o) => { if (!o) setDeletingPayment(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("deletePaymentTitle")}</AlertDialogTitle><AlertDialogDescription>{t("deletePaymentDesc")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingPayment && deletePayment(deletingPayment)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{t("deletePaymentTitle")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card/60 p-2.5 sm:p-3">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
      <p className="mt-1 text-sm font-semibold sm:text-base">{value}</p>
    </div>
  )
}

/**
 * One money event on the debt. The icon and the sign say what happened to what
 * is owed: money that reduced it, money that grew it, and the two system rows
 * that define or correct the figure without anyone having paid anything.
 */
function ActivityRow({
  row,
  receivable,
  money,
  t,
  canDelete,
  onDelete,
}: {
  row: DebtActivityRow
  receivable: boolean
  money: (n: number) => string
  t: (key: string, opts?: Record<string, unknown>) => string
  canDelete: boolean
  onDelete: () => void
}) {
  const reduces = row.principal > 0
  const extras = row.interest + row.fees + row.other
  const Icon = row.kind === "payment" ? (receivable ? ArrowDownLeft : ArrowUpRight)
    : row.kind === "borrow" ? (receivable ? ArrowUpRight : ArrowDownLeft)
    : row.kind === "adjustment" ? Scale
    : CircleDollarSign

  const title = row.kind === "payment" ? (receivable ? t("activity.received") : t("activity.paid"))
    : row.kind === "borrow" ? (receivable ? t("activity.lent") : t("activity.borrowed"))
    : row.kind === "adjustment" ? t("activity.adjusted")
    : row.kind === "opening" ? t("activity.opening")
    : row.description

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          row.kind === "payment" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : row.kind === "borrow" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {title}
          {row.recurring_rule_id && <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{t("activity.automatic")}</Badge>}
        </p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {formatLongDate(row.date)}
          {row.counter_account_name && ` · ${row.counter_account_name}`}
          {extras > 0 && ` · ${t("interest")} ${money(extras)}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={cn("text-sm font-semibold tabular-nums", reduces ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
          {reduces ? "−" : "+"}{money(Math.abs(row.principal))}
        </p>
        {/* What it actually cost, when that differs from what came off the debt. */}
        {extras > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">{t("activity.outOfPocket", { amount: money(row.total) })}</p>}
      </div>
      {canDelete && (
        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={t("deletePaymentTitle")} onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      )}
    </li>
  )
}
