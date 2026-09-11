import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  ArrowDownRight, ArrowLeft, ArrowLeftRight, ArrowUpRight, CalendarClock,
  Pause, Pencil, Play, Repeat, Trash2, TriangleAlert,
} from "lucide-react"
import { apiDelete, apiErrorMessage, apiGet, apiPatch } from "@/lib/api"
import { useApiQuery } from "@/hooks/use-api-query"
import { useDataRefresh } from "@/lib/data-refresh-context"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { accountTypeAllows } from "@/lib/types"
import type { Client, RecurringRule, RecurringRuleDetail, Transaction, WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { usableCards, useCardMap } from "@/lib/use-cards"
import { firstIndexAtOrAfter, occurrenceAt, ruleExhausted, todayIso, type Frequency } from "@/lib/recurring"
import { useUrlModal } from "@/hooks/use-url-modal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CardChip } from "@/components/cards/CardChip"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { TxKindBadge } from "@/components/transactions/TxKindBadge"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { TransactionDetailModal } from "@/components/TransactionDetailModal"
import { AccountQuickAddSheet } from "@/components/wealth/AccountQuickAddSheet"
import { RecurringRuleDialog, DeleteRecurringDialog } from "@/components/recurring/RecurringRuleDialog"

type TxPage = { data: Transaction[]; total: number; summary: { incoming: number; outgoing: number } }

const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

/** Whole days from today (UTC, like every other date in the recurring engine). */
function daysFromToday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number)
  const [ty, tm, td] = todayIso().split("-").map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000)
}

/**
 * /recurring/:id — ONE recurring rule: what it pays, when it pays it next, and
 * every transaction it has actually created (`?recurringRuleId=`, which is
 * scoped exactly like the count the rule reports, so the two can't disagree).
 * Pause, edit and delete live here too, through the same dialogs the list uses.
 */
export function RecurringDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const { revision } = useDataRefresh()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")
  const isPersonal = activeOrg?.account_type === "personal"

  const { data: rule, error, refetch } = useApiQuery<RecurringRuleDetail>(id ? `/api/recurring/${id}` : null)

  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState<RecurringRule | null>(null)
  const [pausing, setPausing] = useState(false)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const cardMap = useCardMap()
  const payableCards = useMemo(() => usableCards(cardMap.cards), [cardMap.cards])
  const ruleCard = rule ? cardMap.forTx({ card_id: rule.card_id, wealth_account_id: rule.wealth_account_id }) : undefined

  // Leaving on purpose (deleted, or a Space auto-save that belongs on /spaces):
  // the refetch that follows must not also fire a "no longer exists" toast.
  const leaving = useRef(false)

  // Gone, or never ours: a rule id from a stale link, another workspace, or one
  // just deleted in another tab. Nothing to show → back to the list, once.
  useEffect(() => {
    if (leaving.current || !error || rule) return
    leaving.current = true
    toast.error(t("recurring.notFound"))
    navigate("/recurring", { replace: true })
  }, [error, rule, navigate, t])

  // A Space auto-save is a recurring TRANSFER: it is managed on the Space, not
  // here (the list hides those too), so a transaction badge that lands on one
  // goes where it can actually be edited.
  useEffect(() => {
    if (leaving.current || !rule || rule.kind !== "transfer") return
    leaving.current = true
    navigate(rule.to_account_id ? `/spaces/${rule.to_account_id}` : "/spaces", { replace: true })
  }, [rule, navigate])

  // ── The rule's transactions (paged) ────────────────────────────────────────
  const [txs, setTxs] = useState<Transaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txPage, setTxPage] = useState(1)
  const [txLoading, setTxLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Switching to another rule (same route, new param — no remount) must not
  // show the previous rule's payments under this one's name.
  useEffect(() => {
    setTxs([])
    setTxTotal(0)
    setTxPage(1)
    setTxLoading(true)
  }, [id])

  useEffect(() => {
    if (!id) return
    let alive = true
    void (async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<TxPage>(`/api/transactions?recurringRuleId=${id}&page=1`, token)
        if (!alive) return
        setTxs(res.data)
        setTxTotal(res.total)
        setTxPage(1)
      } catch {
        // The rule read above owns the error surface; an empty list here just
        // stays empty rather than throwing a second toast at the user.
      } finally {
        if (alive) setTxLoading(false)
      }
    })()
    return () => { alive = false }
  }, [id, getToken, revision])

  async function loadMore() {
    if (!id) return
    setLoadingMore(true)
    try {
      const token = await getToken()
      if (!token) return
      const next = txPage + 1
      const res = await apiGet<TxPage>(`/api/transactions?recurringRuleId=${id}&page=${next}`, token)
      // A newly materialized row shifts the pages under us — drop anything the
      // list already holds instead of rendering the same id twice.
      setTxs((prev) => {
        const seen = new Set(prev.map((x) => x.id))
        return [...prev, ...res.data.filter((x) => !seen.has(x.id))]
      })
      setTxTotal(res.total)
      setTxPage(next)
    } catch {
      toast.error(t("recurring.loadFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  // Accounts + clients back the edit dialog and the payment-edit sheet. Fetched
  // once behind the first paint — the page itself never waits on them.
  useEffect(() => {
    if (!canWrite) return
    let alive = true
    void (async () => {
      const token = await getToken()
      if (!token) return
      const [accountRows, clientRows] = await Promise.all([
        apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        hasClients
          ? apiGet<{ data?: Client[] } | Client[]>("/api/clients", token).catch(() => [] as Client[])
          : Promise.resolve([] as Client[]),
      ])
      if (!alive) return
      setAccounts(accountRows.filter((a) => !a.archived_at))
      const list = Array.isArray(clientRows) ? clientRows : (clientRows.data ?? [])
      setClients(list.filter((c) => !c.is_own))
    })()
    return () => { alive = false }
  }, [canWrite, hasClients, getToken])

  // ── The payment modal (?view=<txId>, deep-linkable) ────────────────────────
  const view = useUrlModal("view")
  const [viewTx, setViewTx] = useState<Transaction | null>(null)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [editTxOpen, setEditTxOpen] = useState(false)

  useEffect(() => {
    const v = view.value
    if (!v) { setViewTx(null); return }
    if (viewTx?.id === v) return
    const found = txs.find((tx) => tx.id === v)
    if (found) { setViewTx(found); return }
    let cancelled = false
    void (async () => {
      const token = await getToken()
      if (!token) return
      try {
        const tx = await apiGet<Transaction>(`/api/transactions/${v}`, token)
        if (!cancelled) setViewTx(tx)
      } catch {
        view.close()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.value, txs])

  // Editing a payment happens on ITS OWN account (an older occurrence can
  // predate a change of account on the rule), so the sheet is only offered when
  // that account is actually in hand.
  const editAccount = useMemo(
    () => accounts.find((a) => a.id === (editTx ?? viewTx)?.wealth_account_id) ?? null,
    [accounts, editTx, viewTx],
  )

  const goBack = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate("/recurring")
  }, [navigate])

  async function togglePause() {
    if (!rule) return
    setPausing(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/recurring/${rule.id}`, token, { active: !rule.active })
      refetch()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("recurring.saveFailed")))
    } finally {
      setPausing(false)
    }
  }

  async function handleDelete() {
    if (!rule) return
    setDeleting(null)
    leaving.current = true
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/recurring/${rule.id}`, token)
      toast.success(t("recurring.deleted"))
      navigate("/recurring", { replace: true })
    } catch {
      leaving.current = false
      toast.error(t("recurring.deleteFailed"))
    }
  }

  // The next few occurrences, walked forward from the rule's own cursor.
  const upcoming = useMemo(() => {
    if (!rule || !rule.active) return []
    const freq: Frequency = { unit: rule.frequency_unit, interval: rule.frequency_interval }
    const start = firstIndexAtOrAfter(rule.start_date, freq, rule.next_due_at)
    const out: string[] = []
    for (let n = 0; n < 3; n++) {
      const date = occurrenceAt(rule.start_date, freq, start + n)
      if (rule.end_date && date > rule.end_date) break
      out.push(date)
    }
    return out
  }, [rule])

  if (!rule) {
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }

  const incoming = rule.type === "incoming"
  const money = (n: number) => formatMoney(n, currency)
  const signed = (n: number) => `${incoming ? "+" : "−"}${money(Math.abs(n))}`
  const amountClass = incoming ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
  const ended = !rule.active && ruleExhausted(rule.next_due_at, rule.end_date)
  const freqLabel = rule.frequency_interval > 1
    ? t("recurring.everyN", { count: rule.frequency_interval, unit: t(`recurring.unit_${rule.frequency_unit}` as const) })
    : t("recurring.everyOne", { unit: t(`recurring.unit_${rule.frequency_unit}` as const) })

  const nextDelta = daysFromToday(rule.next_due_at)
  const relativeNext = nextDelta < 0
    ? t("recurring.overdue")
    : nextDelta === 0
      ? t("recurring.dueToday")
      : nextDelta === 1
        ? t("recurring.dueTomorrow")
        : t("recurring.dueInDays", { count: nextDelta })

  const postedTotal = Number(rule.posted_total ?? 0)
  const hasMore = txs.length < txTotal

  const statusPill = ended
    ? <Badge variant="outline" className="shrink-0">{t("recurring.ended")}</Badge>
    : rule.active
      ? <Badge variant="secondary" className="shrink-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{t("recurring.active")}</Badge>
      : <Badge variant="outline" className="shrink-0">{t("recurring.paused")}</Badge>

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" onClick={goBack} className="-ms-2 mt-0.5 shrink-0" aria-label={t("recurring.back")}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">{rule.name}</h1>
            {statusPill}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{freqLabel}</span>
            <span aria-hidden>·</span>
            <span>{incoming ? t("recurring.incoming") : t("recurring.outgoing")}</span>
            {hasClients && (
              <>
                <span aria-hidden>·</span>
                {rule.client_id ? (
                  <Link to={`/clients/${rule.client_id}`} className="truncate underline-offset-2 hover:text-foreground hover:underline">
                    {rule.client_name}
                  </Link>
                ) : (
                  <span className="truncate">{t("recurring.ownCompany")}</span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canWrite && !ended && (
            <Button
              variant="outline"
              size="icon"
              onClick={togglePause}
              disabled={pausing}
              aria-label={rule.active ? t("recurring.pause") : t("recurring.resume")}
              title={rule.active ? t("recurring.pause") : t("recurring.resume")}
            >
              {rule.active ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          )}
          {canWrite && (
            <Button variant="outline" size="icon" onClick={() => setEditOpen(true)} aria-label={t("recurring.edit")} title={t("recurring.edit")}>
              <Pencil className="size-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setDeleting(rule)}
              aria-label={t("recurring.delete")}
              title={t("recurring.delete")}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Why it stopped posting — the rule keeps its cursor, so fixing the cause
          catches the missed occurrences up on the next read. */}
      {rule.last_error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-amber-900 dark:text-amber-200">{t("recurring.blockedTitle")}</p>
            <p className="mt-0.5 break-words text-amber-800 dark:text-amber-300">{rule.last_error}</p>
          </div>
        </div>
      )}
      {ended && (
        <p className="text-sm text-muted-foreground">{t("recurring.endedHint", { date: fmtDate(rule.end_date ?? rule.next_due_at) })}</p>
      )}

      {/* Figures */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
        <div className="rounded-2xl border bg-card p-3 sm:p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.eachPayment")}</p>
          <p className={`mt-1 text-lg font-bold tabular-nums sm:text-xl ${amountClass}`}>{signed(Number(rule.amount))}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{freqLabel}</p>
        </div>
        <div className="rounded-2xl border bg-card p-3 sm:p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.nextPayment")}</p>
          {rule.active ? (
            <>
              <p className="mt-1 text-lg font-bold sm:text-xl">{fmtDate(rule.next_due_at)}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{relativeNext}</p>
            </>
          ) : (
            <>
              <p className="mt-1 text-lg font-bold sm:text-xl">{ended ? t("recurring.ended") : t("recurring.paused")}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{ended ? t("recurring.noMore") : t("recurring.pausedHint")}</p>
            </>
          )}
        </div>
        <div className="col-span-2 rounded-2xl border bg-card p-3 sm:col-span-1 sm:p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.postedSoFar")}</p>
          <p className={`mt-1 text-lg font-bold tabular-nums sm:text-xl ${postedTotal ? amountClass : ""}`}>{signed(postedTotal)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {t("recurring.paymentsCount", { count: rule.generated_count ?? 0 })}
            {rule.last_posted_date ? <> · {t("recurring.lastOn", { date: fmtDate(rule.last_posted_date) })}</> : null}
          </p>
        </div>
      </div>

      {/* Facts */}
      <div className="rounded-2xl border bg-card p-3 sm:p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.category")}</dt>
            <dd className="mt-0.5 truncate font-medium">{rule.category || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.cardPayWith")}</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1.5 font-medium">
              {ruleCard ? (
                <CardChip card={ruleCard} />
              ) : rule.wealth_account_id ? (
                <Link to={`/wealth/${rule.wealth_account_id}`} className="flex min-w-0 items-center gap-1.5 underline-offset-2 hover:underline">
                  <WealthAccountIcon
                    account={{ type: rule.account_type ?? "bank", icon: rule.account_icon ?? "bank", logo_url: rule.account_logo_url }}
                    className="size-5 shrink-0"
                  />
                  <span className="truncate">{rule.account_name || t("recurring.account")}</span>
                </Link>
              ) : (
                <span className="text-muted-foreground">{t("recurring.noAccount")}</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.startsOn")}</dt>
            <dd className="mt-0.5 truncate font-medium">{fmtDate(rule.start_date)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("recurring.endsOn")}</dt>
            <dd className="mt-0.5 truncate font-medium">{rule.end_date ? fmtDate(rule.end_date) : t("recurring.noEndDate")}</dd>
          </div>
        </dl>
      </div>

      {/* What is still to come */}
      {upcoming.length > 0 && (
        <div className="rounded-2xl border bg-muted/40 p-3 sm:p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden /> {t("recurring.previewTitle")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {upcoming.map((d) => (
              <Badge key={d} variant="outline" className="bg-background font-normal">{fmtDate(d)}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Everything it has created */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {t("recurring.paymentsTitle")} {txTotal > 0 && <span className="text-muted-foreground">({txTotal})</span>}
        </h2>
      </div>

      {txLoading && txs.length === 0 ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
      ) : txs.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-14 text-center">
          <Repeat className="mx-auto size-7 text-muted-foreground/50" aria-hidden />
          <p className="mt-2 text-sm font-medium text-muted-foreground">{t("recurring.noPayments")}</p>
          <p className="mt-1 px-4 text-xs text-muted-foreground">
            {rule.active ? t("recurring.noPaymentsHint", { date: fmtDate(rule.next_due_at) }) : t("recurring.noPaymentsPaused")}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border">
            <div className="divide-y">
              {txs.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => view.open(tx.id)}
                  className="pressable ios-tap flex w-full items-center gap-3 px-3 py-3 text-start transition-colors hover:bg-muted/50 sm:gap-4 sm:px-4"
                >
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    tx.kind === "transfer" ? "bg-primary/10" : tx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
                  }`}>
                    {tx.kind === "transfer"
                      ? <ArrowLeftRight className="size-4 text-primary" />
                      : tx.type === "incoming"
                        ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                        : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tx.description || rule.name}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{fmtDate(tx.date)}</span>
                      <TxKindBadge tx={tx} />
                      {tx.category && tx.kind !== "transfer" && (
                        <Badge variant="outline" className="hidden py-0 text-xs sm:inline-flex">{tx.category}</Badge>
                      )}
                      <AttachmentBadge count={tx.attachment_count} />
                    </div>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {tx.type === "incoming" ? "+" : "−"}{money(Number(tx.amount))}
                  </p>
                </button>
              ))}
            </div>
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t("recurring.loadingMore") : t("recurring.loadMore", { count: txTotal - txs.length })}
              </Button>
            </div>
          )}
        </>
      )}

      <TransactionDetailModal
        tx={viewTx}
        open={!!view.value && !!viewTx}
        onClose={view.close}
        currency={currency}
        canEdit={canWrite && !!editAccount}
        canDelete={canDelete}
        onEdit={editAccount ? (tx) => { view.close({ replace: true }); setEditTx(tx); setEditTxOpen(true) } : undefined}
        disableBackClose
      />

      {editAccount && (
        <AccountQuickAddSheet
          account={editAccount}
          open={editTxOpen}
          onOpenChange={(o) => { setEditTxOpen(o); if (!o) setEditTx(null) }}
          currency={currency}
          isPersonal={isPersonal}
          editTx={editTx}
          onSaved={() => refetch()}
        />
      )}

      <RecurringRuleDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        rule={rule}
        accounts={accounts}
        clients={clients}
        cards={payableCards}
        onSaved={() => refetch()}
      />

      <DeleteRecurringDialog
        rule={deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        onConfirm={handleDelete}
      />
    </div>
  )
}
