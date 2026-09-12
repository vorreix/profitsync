import { useCallback, useEffect, useMemo, useState } from "react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
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
  Repeat,
  SlidersHorizontal,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { apiDelete, apiGet } from "@/lib/api"
import type { CreditCardSummary, Transaction, WealthAccount } from "@/lib/types"
import { isLiabilityType, suggestFeeCategory } from "@/lib/credit-card"
import { useCategories } from "@/lib/use-categories"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { accountDisplayName, formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { useUrlModal } from "@/hooks/use-url-modal"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { WealthAccountDialogs } from "@/components/wealth/WealthAccountDialogs"
import { AccountQuickAddSheet } from "@/components/wealth/AccountQuickAddSheet"
import { AccountDetailsSection } from "@/components/wealth/AccountDetailsSection"
import { CreditCardPanel } from "@/components/wealth/CreditCardPanel"
import { PayCardSheet, type PayPreset } from "@/components/wealth/PayCardSheet"
import { cardDisplayName } from "@/lib/cards"
import { useCardMap } from "@/lib/use-cards"
import { CardChip } from "@/components/cards/CardChip"
import { BankCardsButton } from "@/components/cards/BankCardsButton"
import { TxKindBadge } from "@/components/transactions/TxKindBadge"
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
import { SpaceLinkBadge } from "@/components/spaces/SpaceLinkBadge"
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
  // Credit cards: the ledger-derived card view (owed / available / statement /
  // cycle) and the other accounts (sources for Pay card).
  const [cardSummary, setCardSummary] = useState<CreditCardSummary | null>(null)
  const [allAccounts, setAllAccounts] = useState<WealthAccount[]>([])
  const [payOpen, setPayOpen] = useState(false)
  const [payPreset, setPayPreset] = useState<PayPreset>("statement")
  const [addPreset, setAddPreset] = useState<{ type: "incoming" | "outgoing"; kind: "standard" | "refund"; category?: string } | null>(null)
  const { byType: categoriesByType } = useCategories()
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
  // Which card paid each row (the chip), and which cards this bank carries /
  // funds (the close-account warning). Includes closed cards so old rows keep
  // their chip.
  const cardMap = useCardMap()

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
      if (isLiabilityType(acc.type)) {
        // The card view + the accounts it can be paid from. Failures leave the
        // page usable (the hero falls back to the account row's figures).
        const [summary, accounts] = await Promise.all([
          apiGet<CreditCardSummary>(`/api/wealth/accounts/${id}/card`, token).catch(() => null),
          apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        ])
        setCardSummary(summary)
        setAllAccounts(accounts)
      } else {
        setCardSummary(null)
      }
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
  const isCard = !!account && isLiabilityType(account.type)
  const hasMore = transactions.length < total

  // Card quick actions: open the in-place add sheet pre-set to a purchase, a
  // refund (an incoming that reverses spending) or a fee/interest charge (a real
  // expense, on an existing fee-like category when there is one).
  function openAdd(preset: { type: "incoming" | "outgoing"; kind: "standard" | "refund"; category?: string } | null) {
    setEditTx(null)
    setAddPreset(preset)
    setAddOpen(true)
  }
  function openPay(preset: PayPreset) {
    setPayPreset(preset)
    setPayOpen(true)
  }

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

  // A credit-card account IS its card: its page lives at /wealth/cards/:cardId
  // (the account GET returns `card_id`). Rows that predate the cards table have
  // none and keep rendering the account view below.
  const accountCardId = account.card_id
  if (isCard && accountCardId) return <Navigate replace to={`/wealth/cards/${accountCardId}`} />

  const linkedDebitCards = cardMap.cards.filter((c) => c.kind === "debit" && c.account_id === account.id && c.status !== "closed")
  const autopayCards = cardMap.cards.filter((c) => c.kind === "credit" && c.funding_account_id === account.id && c.autopay && c.status !== "closed")

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/wealth")} className="-ml-2 mt-0.5 shrink-0" aria-label={t("back")}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <WealthAccountIcon account={account} className="size-10 shrink-0 sm:size-11" />
          {/* The account type reads as a quiet meta line rather than a badge
              beside the name: on a phone the name then keeps the full width the
              header's action buttons leave it. */}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{accountDisplayName(account)}</h1>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              {isCash ? t("cash") : isCard ? t("creditCard") : t("bank")}
              {account.nickname && !isCash && account.bank_name ? ` · ${account.bank_name}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* The cards linked to this account — one tap away instead of a
              permanent grid in the page body. */}
          {!isCard && (
            <BankCardsButton
              account={account}
              cards={cardMap.cards}
              loading={cardMap.loading}
              canWrite={canWrite}
            />
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={t("recurringForAccount")}
            title={t("recurringForAccount")}
            onClick={() => navigate(`/recurring?account=${account.id}`)}
          >
            <Repeat className="size-4" />
          </Button>
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

      {/* Credit card: owed / available / statement / new cycle (ledger-derived) */}
      {isCard && (
        <CreditCardPanel
          account={account}
          summary={cardSummary}
          currency={currency}
          balancesVisible={balancesVisible}
          canWrite={canWrite}
          onPay={openPay}
          onAdjust={() => setAdjusting(account)}
          onAddPurchase={() => openAdd({ type: "outgoing", kind: "standard" })}
          onAddRefund={() => openAdd({ type: "incoming", kind: "refund" })}
          onAddFee={() => openAdd({ type: "outgoing", kind: "standard", category: suggestFeeCategory(categoriesByType.outgoing) })}
        />
      )}

      {/* Balance hero (bank / cash) */}
      {!isCard && (
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
      )}

      {/* Bank details + attachments (bank accounts only) */}
      {!isCash && <AccountDetailsSection account={account} canWrite={canWrite} canDelete={canDelete} />}

      {/* Transactions */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{isCard ? t("recentActivity") : t("transactions")} {total > 0 && <span className="text-muted-foreground">({total})</span>}</h2>
        {canWrite && (
          <Button size="sm" onClick={() => openAdd(isCard ? { type: "outgoing", kind: "standard" } : null)}>
            <Plus className="size-4" /> {t("addTransaction")}
          </Button>
        )}
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-2xl border py-16 text-center">
          <p className="font-medium text-muted-foreground">{t("noTransactionsForAccount")}</p>
          {canWrite && (
            <Button className="mt-3" variant="outline" onClick={() => openAdd(isCard ? { type: "outgoing", kind: "standard" } : null)}>
              <Plus className="size-4" /> {t("addTransaction")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border">
            <div className="divide-y">
              {transactions.map((tx) => {
                // The card that paid this row (a debit card on this bank). Not a
                // link here: the whole row is already a button.
                const paidWith = isCard ? undefined : cardMap.forTx(tx)
                return (
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
                      <TxKindBadge tx={{ ...tx, wealth_account_type: account.type }} />
                      {paidWith && <CardChip card={paidWith} linked={false} />}
                      <SpaceLinkBadge tx={tx} />
                      {/* A transfer leg's category is the literal "Transfer" — the kind badge already says so. */}
                      {tx.category && tx.kind !== "transfer" && <Badge variant="outline" className="hidden py-0 text-xs sm:inline-flex">{tx.category}</Badge>}
                      <AttachmentBadge count={tx.attachment_count} />
                    </div>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {tx.type === "incoming" ? "+" : "−"}{balancesVisible ? fmt(Number(tx.amount)) : "•••"}
                  </p>
                </button>
                )
              })}
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
        initialType={addPreset?.type}
        initialKind={addPreset?.kind}
        initialCategory={addPreset?.category}
      />

      {isCard && (
        <PayCardSheet
          open={payOpen}
          onOpenChange={setPayOpen}
          card={account}
          summary={cardSummary}
          accounts={allAccounts}
          currency={currency}
          initialPreset={payPreset}
          onDone={() => void load()}
        />
      )}

      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("closeAccountTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("closeAccountDesc")}
              {/* What closing this bank does to the cards that depend on it */}
              {linkedDebitCards.length > 0 && <> {t("cards.closeBankCards", { count: linkedDebitCards.length })}</>}
              {autopayCards.length > 0 && <> {t("cards.closeBankAutopay", { names: autopayCards.map((c) => cardDisplayName(c)).join(", ") })}</>}
            </AlertDialogDescription>
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
