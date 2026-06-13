import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  Archive,
  ArrowDownRight,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Eye,
  EyeOff,
  MoreVertical,
  Pencil,
  Plus,
  SlidersHorizontal,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { apiDelete, apiGet } from "@/lib/api"
import type { Transaction, WealthAccount } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { accountDisplayName, formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { useUrlModal } from "@/hooks/use-url-modal"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { WealthAccountDialogs } from "@/components/wealth/WealthAccountDialogs"
import { AccountQuickAddSheet } from "@/components/wealth/AccountQuickAddSheet"
import { AccountDetailsSection } from "@/components/wealth/AccountDetailsSection"
import { TransactionDetailModal } from "@/components/TransactionDetailModal"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FitText } from "@/components/FitText"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Summary = { incoming: number; outgoing: number }

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

export function WealthAccountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const isPersonal = activeOrg?.account_type === "personal"
  const { balancesVisible, setBalancesVisible } = useBalancePrivacy()

  const [account, setAccount] = useState<WealthAccount | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<Summary>({ incoming: 0, outgoing: 0 })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [editing, setEditing] = useState<WealthAccount | null>(null)
  const [adjusting, setAdjusting] = useState<WealthAccount | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [closeConfirm, setCloseConfirm] = useState(false)

  const view = useUrlModal("view")
  const [viewTx, setViewTx] = useState<Transaction | null>(null)

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n)

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!id) return
    const token = await getToken()
    if (!token) return
    if (!silent) setLoading(true)
    try {
      const [acc, txRes] = await Promise.all([
        apiGet<WealthAccount>(`/api/wealth/accounts/${id}`, token),
        apiGet<{ data: Transaction[]; total: number; summary: Summary }>(`/api/transactions?wealthAccountId=${id}&page=1`, token),
      ])
      setAccount(acc)
      setTransactions(txRes.data)
      setTotal(txRes.total)
      setSummary(txRes.summary)
      setPage(1)
    } catch {
      toast.error(t("accountNotFound"))
      navigate("/wealth")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id, getToken, navigate, t])

  useEffect(() => { load() }, [load])

  // Refresh when balances change elsewhere (any transaction/transfer/account
  // mutation — signaled centrally from the API client). Silent: no skeleton.
  useEffect(() => {
    const handler = () => load({ silent: true })
    window.addEventListener("wealth:accounts-changed", handler)
    return () => window.removeEventListener("wealth:accounts-changed", handler)
  }, [load])

  async function loadMore() {
    if (!id) return
    const token = await getToken()
    if (!token) return
    setLoadingMore(true)
    try {
      const next = page + 1
      const res = await apiGet<{ data: Transaction[]; total: number; summary: Summary }>(
        `/api/transactions?wealthAccountId=${id}&page=${next}`, token,
      )
      setTransactions((prev) => [...prev, ...res.data])
      setPage(next)
    } catch {
      toast.error(t("failedToLoad"))
    } finally {
      setLoadingMore(false)
    }
  }

  // Sync the ?view=<txId> modal with the loaded list (deep-link aware).
  useEffect(() => {
    const v = view.value
    if (!v) { setViewTx(null); return }
    if (viewTx?.id === v) return
    const found = transactions.find((tx) => tx.id === v)
    if (found) { setViewTx(found); return }
    let cancelled = false
    ;(async () => {
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
  }, [view.value, transactions])

  async function archive() {
    if (!account) return
    const token = await getToken()
    if (!token) return
    try {
      await apiDelete(`/api/wealth/accounts/${account.id}`, token)
      toast.success(t("accountArchived"))
      navigate("/wealth")
    } catch {
      toast.error(t("failedToArchive"))
    }
  }

  const net = summary.incoming - summary.outgoing
  const isCash = account?.type === "cash"
  const hasMore = transactions.length < total

  const stats = useMemo(() => ([
    { key: "income", label: t("income"), value: summary.incoming, className: "text-emerald-600 dark:text-emerald-400" },
    { key: "expenses", label: t("expenses"), value: summary.outgoing, className: "text-destructive" },
    { key: "net", label: t("net"), value: net, className: net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive" },
  ]), [summary, net, t])

  if (loading) {
    return (
      <div className="space-y-6 p-3 sm:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (!account) return null

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/wealth")} className="-ml-2 mt-0.5 shrink-0" aria-label={t("back")}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <WealthAccountIcon account={account} className="size-11" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{accountDisplayName(account)}</h1>
              <Badge variant="secondary">{isCash ? t("cash") : t("bank")}</Badge>
            </div>
            {account.nickname && !isCash && <p className="truncate text-sm text-muted-foreground">{account.bank_name}</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={balancesVisible ? t("hideBalances") : t("showBalances")}
            onClick={() => setBalancesVisible((v) => !v)}
          >
            {balancesVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </Button>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={t("account")}><MoreVertical className="size-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(account)}><Pencil className="size-4" /> {t("edit")}</DropdownMenuItem>
                {!isCash && <DropdownMenuItem onSelect={() => setCloseConfirm(true)} className="text-destructive focus:text-destructive"><Archive className="size-4" /> {t("closeAccount")}</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Balance hero */}
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("balance")}</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="text-3xl font-bold tabular-nums sm:text-4xl">{formatMoney(Number(account.current_balance), currency, balancesVisible)}</p>
          {canWrite && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={t("adjust")}
              title={t("adjust")}
              onClick={() => setAdjusting(account)}
            >
              <SlidersHorizontal className="size-4" />
            </Button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
          {stats.map((s) => (
            <div key={s.key} className="rounded-xl border bg-card/60 p-2.5 sm:p-3">
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{s.label}</p>
              <FitText className={`mt-1 ${s.className}`} textClassName="text-sm sm:text-lg font-bold tabular-nums">
                {balancesVisible ? fmt(s.value) : "•••"}
              </FitText>
            </div>
          ))}
        </div>
      </div>

      {/* Bank details + attachments (bank accounts only) */}
      {!isCash && <AccountDetailsSection account={account} canWrite={canWrite} canDelete={canDelete} />}

      {/* Transactions */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("transactions")} {total > 0 && <span className="text-muted-foreground">({total})</span>}</h2>
        {canWrite && (
          <Button size="sm" onClick={() => { setEditTx(null); setAddOpen(true) }}>
            <Plus className="size-4" /> {t("addTransaction")}
          </Button>
        )}
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-2xl border py-16 text-center">
          <p className="font-medium text-muted-foreground">{t("noTransactionsForAccount")}</p>
          {canWrite && (
            <Button className="mt-3" variant="outline" onClick={() => { setEditTx(null); setAddOpen(true) }}>
              <Plus className="size-4" /> {t("addTransaction")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border">
            <div className="divide-y">
              {transactions.map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => view.open(tx.id)}
                  className="pressable ios-tap flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50 sm:gap-4 sm:px-4"
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
                    <p className="truncate text-sm font-medium">{tx.description || (tx.type === "incoming" ? t("income") : t("expenses"))}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                      {tx.category && <Badge variant="outline" className="hidden py-0 text-xs sm:inline-flex">{tx.category}</Badge>}
                      <AttachmentBadge count={tx.attachment_count} />
                    </div>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {tx.type === "incoming" ? "+" : "−"}{balancesVisible ? fmt(Number(tx.amount)) : "•••"}
                  </p>
                </button>
              ))}
            </div>
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t("saving") : `${t("transactions")} (${total - transactions.length})`}
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
        canEdit={canWrite}
        canDelete={canDelete}
        onEdit={(tx) => { view.close(); setEditTx(tx); setAddOpen(true) }}
        disableBackClose
      />

      <WealthAccountDialogs
        editing={editing}
        onEditingChange={setEditing}
        adjusting={adjusting}
        onAdjustingChange={setAdjusting}
        currency={currency}
        onChanged={load}
      />

      <AccountQuickAddSheet
        account={account}
        open={addOpen}
        onOpenChange={(o) => { setAddOpen(o); if (!o) setEditTx(null) }}
        currency={currency}
        isPersonal={isPersonal}
        onSaved={() => void load()}
        editTx={editTx}
      />

      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeAccountTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("closeAccountDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={archive} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("closeAccount")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
