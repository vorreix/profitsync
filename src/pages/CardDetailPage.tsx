import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarClock,
  Eye,
  EyeOff,
  Plus,
  Repeat,
  RotateCcw,
  Snowflake,
  Sun,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { apiErrorMessage, apiGet, apiPatch } from "@/lib/api"
import { WEALTH_CHANGED_EVENT } from "@/lib/data-events"
import { NETWORK_LABEL, cardDisplayName, expiryLabel, isCardExpired, isCardNetwork, maskedTail } from "@/lib/cards"
import { suggestFeeCategory } from "@/lib/credit-card"
import type { Card, CardSummary, CreditCardSummary, RecurringRule, Transaction, WealthAccount } from "@/lib/types"
import { useCategories } from "@/lib/use-categories"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { accountDisplayName, formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { useUrlModal } from "@/hooks/use-url-modal"
import { cn } from "@/lib/utils"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { AddCardWizard } from "@/components/cards/AddCardWizard"
import { CardActionsMenu } from "@/components/cards/CardActionsMenu"
import { AutopayPanel } from "@/components/cards/AutopayPanel"
import { CardStatusPill } from "@/components/cards/CardTile"
import { shortDate, todayIso } from "@/components/cards/card-dates"
import { WealthAccountDialogs } from "@/components/wealth/WealthAccountDialogs"
import { AccountQuickAddSheet } from "@/components/wealth/AccountQuickAddSheet"
import { CreditCardPanel } from "@/components/wealth/CreditCardPanel"
import { PayCardSheet, type PayPreset } from "@/components/wealth/PayCardSheet"
import { TxKindBadge } from "@/components/transactions/TxKindBadge"
import { TransactionDetailModal } from "@/components/TransactionDetailModal"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { SpaceLinkBadge } from "@/components/spaces/SpaceLinkBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FitText } from "@/components/FitText"

type TxPage = { data: Transaction[]; total: number; summary: { incoming: number; outgoing: number } }
type AddPreset = { type: "incoming" | "outgoing"; kind: "standard" | "refund"; category?: string } | null

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/**
 * The card row already carries every column of its ledger account; this
 * builds the WealthAccount the existing sheets (pay / quick-add / adjust)
 * expect from it, so the page renders even if the account GET is slow or fails.
 */
function accountFromCard(card: Card): WealthAccount {
  return {
    id: card.account_id,
    organization_id: card.organization_id,
    type: card.account_type ?? (card.kind === "credit" ? "credit_card" : "bank"),
    bank_name: card.account_bank_name ?? "",
    nickname: card.account_nickname ?? "",
    opening_balance: 0,
    current_balance: Number(card.account_current_balance ?? 0),
    icon: card.kind === "credit" ? "card" : "bank",
    brand_domain: card.account_brand_domain,
    logo_url: card.account_logo_url,
    logo_src: card.account_logo_src ?? null,
    credit_limit: card.account_credit_limit ?? null,
    statement_closing_day: card.account_statement_closing_day ?? null,
    payment_due_day: card.account_payment_due_day ?? null,
    archived_at: card.account_archived_at ?? null,
    created_at: card.created_at,
    updated_at: card.updated_at,
  }
}

/**
 * /wealth/cards/:cardId — one card: the large visual, its facts, the credit
 * view (owed / statement / cycle + autopay) or the debit spending view, the
 * quick actions, upcoming recurring charges, and its transactions
 * (`/api/transactions?cardId=`: a credit card's whole account, a debit card's
 * own rows — transfers included). Money never lives on the card: every figure
 * comes from its ledger account.
 */
export function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const isPersonal = activeOrg?.account_type === "personal"
  const { balancesVisible, setBalancesVisible } = useBalancePrivacy()
  const { byType: categoriesByType } = useCategories()
  const [searchParams, setSearchParams] = useSearchParams()

  const [card, setCard] = useState<Card | null>(null)
  const [summary, setSummary] = useState<CardSummary | null>(null)
  const [account, setAccount] = useState<WealthAccount | null>(null)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [rules, setRules] = useState<RecurringRule[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  const [wizardOpen, setWizardOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addPreset, setAddPreset] = useState<AddPreset>(null)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payPreset, setPayPreset] = useState<PayPreset>("statement")
  const [adjusting, setAdjusting] = useState<WealthAccount | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)

  const view = useUrlModal("view")
  const [viewTx, setViewTx] = useState<Transaction | null>(null)

  const fmt = (n: number) => formatMoney(n, currency, balancesVisible)

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!cardId) return
    const token = await getToken()
    if (!token) return
    if (!silent) setLoading(true)
    try {
      const [row, txRes] = await Promise.all([
        apiGet<Card>(`/api/cards/${cardId}`, token),
        apiGet<TxPage>(`/api/transactions?cardId=${cardId}&page=1`, token),
      ])
      setCard(row)
      setTransactions(txRes.data)
      setTotal(txRes.total)
      setPage(1)
      if (!silent) setLoading(false)
      // The rest fills in behind the first paint; each is optional.
      const [sum, acc, accs, rr] = await Promise.all([
        apiGet<CardSummary>(`/api/cards/${cardId}/summary`, token).catch(() => null),
        apiGet<WealthAccount>(`/api/wealth/accounts/${row.account_id}`, token).catch(() => null),
        apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        apiGet<RecurringRule[]>("/api/recurring", token).catch(() => [] as RecurringRule[]),
      ])
      setSummary(sum)
      setAccount(acc)
      setAccounts(accs)
      setRules(rr.filter((r) => r.card_id === cardId))
    } catch {
      toast.error(t("cards.notFound"))
      navigate("/wealth?tab=cards", { replace: true })
    } finally {
      if (!silent) setLoading(false)
    }
  }, [cardId, getToken, navigate, t])

  useEffect(() => { void load() }, [load])

  // Any wealth-affecting mutation elsewhere (a payment, a purchase from the
  // FAB, a card edit) refreshes this page in place — no skeleton.
  useEffect(() => {
    const handler = () => void load({ silent: true })
    window.addEventListener(WEALTH_CHANGED_EVENT, handler)
    return () => window.removeEventListener(WEALTH_CHANGED_EVENT, handler)
  }, [load])

  // Deep links from the mobile FAB (?new=1 → add a purchase) and from the
  // "pay off before closing" dialog (?pay=1). Consumed once, stripped in place.
  useEffect(() => {
    if (!card) return
    const wantsNew = searchParams.get("new") === "1"
    const wantsPay = searchParams.get("pay") === "1"
    if (!wantsNew && !wantsPay) return
    if (wantsNew && canWrite && card.status === "active") openAdd({ type: "outgoing", kind: "standard" })
    if (wantsPay && canWrite && card.kind === "credit") openPay("statement")
    const next = new URLSearchParams(searchParams)
    next.delete("new")
    next.delete("pay")
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, searchParams])

  async function loadMore() {
    if (!cardId) return
    const token = await getToken()
    if (!token) return
    setLoadingMore(true)
    try {
      const next = page + 1
      const res = await apiGet<TxPage>(`/api/transactions?cardId=${cardId}&page=${next}`, token)
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

  function openAdd(preset: AddPreset) {
    setEditTx(null)
    setAddPreset(preset)
    setAddOpen(true)
  }
  function openPay(preset: PayPreset) {
    setPayPreset(preset)
    setPayOpen(true)
  }

  async function setStatus(status: "active" | "frozen") {
    if (!card) return
    setStatusBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<Card>(`/api/cards/${card.id}`, token, { status })
      setCard(updated)
      toast.success(t(status === "frozen" ? "cards.freezeToast" : card.status === "closed" ? "cards.reopenToast" : "cards.unfreezeToast"))
    } catch (err) {
      toast.error(apiErrorMessage(err, t("cards.updateFailed")))
    } finally {
      setStatusBusy(false)
    }
  }

  // The ledger account the sheets act on — the real row when it arrived, else
  // one rebuilt from the card's joined columns (same balance, same limit).
  const ledgerAccount = useMemo(() => (card ? account ?? accountFromCard(card) : null), [card, account])
  const creditSummary: CreditCardSummary | null = useMemo(
    () => (summary?.credit && ledgerAccount ? { ...summary.credit, account: ledgerAccount } : null),
    [summary, ledgerAccount],
  )
  const bankLink = useMemo(() => {
    if (!card) return null
    if (card.kind === "debit") {
      const name = (card.account_nickname || card.account_bank_name || "").trim()
      return name ? { id: card.account_id, name } : null
    }
    const name = (card.funding_account_nickname || card.funding_account_bank_name || "").trim()
    return card.funding_account_id && name ? { id: card.funding_account_id, name } : null
  }, [card])

  if (loading) {
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_1fr]">
          <Skeleton className="mx-auto aspect-[1.586] w-full max-w-md rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }

  if (!card || !ledgerAccount) return null

  const name = cardDisplayName(card)
  const isCredit = card.kind === "credit"
  const frozen = card.status === "frozen"
  const closed = card.status === "closed"
  const usable = canWrite && card.status === "active"
  const expired = isCardExpired(card.expiry_month, card.expiry_year, todayIso())
  const kindWord = isCredit ? t("cards.kindCredit") : t("cards.kindDebit")
  const hasMore = transactions.length < total
  const debitInfo = summary?.debit ?? null
  const feeCategory = () => suggestFeeCategory(categoriesByType.outgoing)

  const addRecurringButton = canWrite && !closed && (
    <Button size="sm" variant="outline" onClick={() => navigate(`/recurring?new=1&card=${card.id}`)} className="pressable" disabled={frozen}>
      <Repeat className="size-4" /> {t("cards.addRecurring")}
    </Button>
  )

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex items-start gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/wealth?tab=cards")} className="-ms-2 mt-0.5 shrink-0" aria-label={t("cards.back")}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
            <CardStatusPill card={card} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>{kindWord}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums" dir="ltr">{maskedTail(card.last4)}</span>
            {bankLink && (
              <>
                <span aria-hidden>·</span>
                <Link to={`/wealth/${bankLink.id}`} className="truncate underline-offset-2 hover:text-foreground hover:underline">
                  {isCredit ? t("cards.paidFrom", { bank: bankLink.name }) : t("cards.linkedTo", { bank: bankLink.name })}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("recurringForAccount")}
            title={t("recurringForAccount")}
            onClick={() => navigate(`/recurring?card=${card.id}`)}
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
          <CardActionsMenu
            card={card}
            canWrite={canWrite}
            canDelete={canDelete}
            currency={currency}
            variant="outline"
            size="icon"
            onEdit={() => setWizardOpen(true)}
            onPayCard={() => openPay("full")}
            onChanged={(next) => {
              if (next) setCard(next)
              else navigate("/wealth?tab=cards", { replace: true })
            }}
          />
        </div>
      </div>

      {/* Frozen / closed: say what it means and offer the way back */}
      {(frozen || closed) && (
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 text-sm", frozen ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200" : "bg-muted text-muted-foreground")}>
          {frozen ? <Snowflake className="size-4 shrink-0" aria-hidden /> : <RotateCcw className="size-4 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">{frozen ? t("cards.frozenHint") : t("cards.closedHint")}</span>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => void setStatus("active")} disabled={statusBusy} className="pressable">
              {frozen ? <Sun className="size-4" /> : <RotateCcw className="size-4" />}
              {frozen ? t("cards.unfreeze") : t("cards.reopen")}
            </Button>
          )}
        </div>
      )}

      {/* Visual + facts */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_1fr] lg:items-start">
        <div className="mx-auto w-full max-w-md lg:mx-0">
          <CardVisual {...visualPropsFromCard(card)} size="lg" className="w-full" />
        </div>

        <div className="space-y-4">
          {/* Debit: what the card can spend + this month's use */}
          {!isCredit && (
            <section aria-labelledby="card-spending-heading" className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
              <h2 id="card-spending-heading" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("cards.spending")}</h2>
              <p className="mt-1 text-2xl font-bold tabular-nums sm:text-3xl">
                {t("cards.availableAt", { balance: fmt(Number(ledgerAccount.current_balance)), bank: accountDisplayName(ledgerAccount) })}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
                {[
                  { key: "spent", label: t("cards.spentThisMonth"), value: debitInfo ? fmt(debitInfo.month_spent) : null, className: "text-destructive" },
                  { key: "refunds", label: t("cards.refundsThisMonth"), value: debitInfo ? fmt(debitInfo.month_refunds) : null, className: "text-emerald-600 dark:text-emerald-400" },
                  { key: "last", label: t("cards.lastUsed"), value: debitInfo ? (debitInfo.last_used ? shortDate(debitInfo.last_used) : t("cards.neverUsed")) : null, className: "" },
                ].map((s) => (
                  <div key={s.key} className="rounded-xl border bg-card/60 p-2.5 sm:p-3">
                    <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{s.label}</p>
                    {s.value === null ? (
                      <Skeleton className="mt-1.5 h-5 w-16" />
                    ) : (
                      <FitText className={`mt-1 ${s.className}`} textClassName="text-sm sm:text-lg font-bold tabular-nums">{s.value}</FitText>
                    )}
                  </div>
                ))}
              </div>
              {canWrite && !closed && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => openAdd({ type: "outgoing", kind: "standard" })} disabled={!usable} className="pressable">
                    <Plus className="size-4" /> {t("cards.addPurchase")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openAdd({ type: "incoming", kind: "refund" })} disabled={!usable} className="pressable">
                    <RotateCcw className="size-4" /> {t("cards.addRefund")}
                  </Button>
                  {addRecurringButton}
                </div>
              )}
              {frozen && <p className="mt-2 text-xs text-muted-foreground">{t("cards.frozenActions")}</p>}
            </section>
          )}

          {/* Facts */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border bg-card p-4 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{isCredit ? t("cardIssuer") : t("bank")}</dt>
              <dd className="truncate font-medium">{(isCredit ? card.account_bank_name : card.account_nickname || card.account_bank_name) || "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{isCardNetwork(card.network) && card.network !== "other" ? NETWORK_LABEL[card.network] : kindWord}</dt>
              <dd className="truncate font-medium tabular-nums" dir="ltr">{maskedTail(card.last4)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cards.expires")}</dt>
              <dd className="flex items-center gap-1.5 font-medium tabular-nums">
                <span dir="ltr">{expiryLabel(card.expiry_month, card.expiry_year) || "—"}</span>
                {expired && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 py-0 text-[10px] text-amber-700 dark:text-amber-300">{t("cards.statusExpired")}</Badge>}
              </dd>
            </div>
            {card.holder_name && (
              <div className="min-w-0 col-span-2 sm:col-span-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cards.holder")}</dt>
                <dd className="truncate font-medium">{card.holder_name}</dd>
              </div>
            )}
            {isCredit && card.account_statement_closing_day != null && card.account_payment_due_day != null && (
              <div className="min-w-0 col-span-2 sm:col-span-3">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cards.cycle")}</dt>
                <dd className="flex items-center gap-1.5 font-medium">
                  <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
                  {t("cards.cycleLine", { closing: card.account_statement_closing_day, due: card.account_payment_due_day })}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Credit: owed / statement / cycle + autopay */}
      {isCredit && (
        <>
          <CreditCardPanel
            account={ledgerAccount}
            summary={creditSummary}
            currency={currency}
            balancesVisible={balancesVisible}
            canWrite={canWrite && !closed}
            embedded
            frozen={frozen}
            frozenHint={t("cards.frozenActions")}
            extraActions={addRecurringButton}
            onPay={openPay}
            onAdjust={() => setAdjusting(ledgerAccount)}
            onAddPurchase={() => openAdd({ type: "outgoing", kind: "standard" })}
            onAddRefund={() => openAdd({ type: "incoming", kind: "refund" })}
            onAddFee={() => openAdd({ type: "outgoing", kind: "standard", category: feeCategory() })}
          />
          {!closed && (
            <AutopayPanel
              card={card}
              summary={summary}
              accounts={accounts}
              currency={currency}
              balancesVisible={balancesVisible}
              canWrite={canWrite}
              // The next-autopay preview lives in the summary — refetch it too.
              onChanged={(next) => { setCard(next); void load({ silent: true }) }}
              onPayManually={() => openPay("statement")}
            />
          )}
        </>
      )}

      {/* Upcoming recurring charges on this card */}
      {rules.length > 0 && (
        <section aria-labelledby="card-upcoming-heading" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 id="card-upcoming-heading" className="text-sm font-semibold">{t("cards.upcoming")} <span className="text-muted-foreground">({rules.length})</span></h2>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/recurring?card=${card.id}`)}>{t("cards.viewAllRecurring")}</Button>
          </div>
          <div className="overflow-hidden rounded-2xl border">
            <div className="divide-y">
              {rules.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(`/recurring?view=${r.id}`)}
                  className="pressable ios-tap flex w-full items-center gap-3 px-3 py-3 text-start transition-colors hover:bg-muted/50 sm:px-4"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Repeat className="size-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{t("cards.nextOn", { date: shortDate(r.next_due_at) })}</span>
                      {(!r.active || r.last_error) && <Badge variant="outline" className="py-0 text-[10px]">{t("cards.paused")}</Badge>}
                    </p>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${r.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {r.type === "incoming" ? "+" : "−"}{fmt(Number(r.amount))}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Transactions */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("cards.transactions")} {total > 0 && <span className="text-muted-foreground">({total})</span>}</h2>
        {canWrite && !closed && !isCredit && (
          <Button size="sm" onClick={() => openAdd({ type: "outgoing", kind: "standard" })} disabled={!usable} className="sm:hidden">
            <Plus className="size-4" /> {t("addTransaction")}
          </Button>
        )}
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-2xl border py-16 text-center">
          <p className="font-medium text-muted-foreground">{t("cards.noTransactions")}</p>
          {/* Generic label on purpose: "Add purchase" already lives in the panel above. */}
          {usable && (
            <Button className="mt-3" variant="outline" onClick={() => openAdd({ type: "outgoing", kind: "standard" })}>
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
                    <p className="truncate text-sm font-medium">{tx.description || (tx.type === "incoming" ? t("income") : t("expenses"))}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                      <TxKindBadge tx={{ ...tx, wealth_account_type: ledgerAccount.type }} />
                      <SpaceLinkBadge tx={tx} />
                      {/* A transfer leg's category is the literal "Transfer" — the kind badge already says so. */}
                      {tx.category && tx.kind !== "transfer" && <Badge variant="outline" className="hidden py-0 text-xs sm:inline-flex">{tx.category}</Badge>}
                      <AttachmentBadge count={tx.attachment_count} />
                    </div>
                  </div>
                  <p className={`shrink-0 text-sm font-semibold tabular-nums ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {tx.type === "incoming" ? "+" : "−"}{fmt(Number(tx.amount))}
                  </p>
                </button>
              ))}
            </div>
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? t("saving") : t("cards.loadMore", { count: total - transactions.length })}
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
        editing={null}
        onEditingChange={() => {}}
        adjusting={adjusting}
        onAdjustingChange={setAdjusting}
        currency={currency}
        onChanged={() => void load({ silent: true })}
      />

      <AccountQuickAddSheet
        account={ledgerAccount}
        cardId={card.id}
        open={addOpen}
        onOpenChange={(o) => { setAddOpen(o); if (!o) setEditTx(null) }}
        currency={currency}
        isPersonal={isPersonal}
        onSaved={() => void load({ silent: true })}
        editTx={editTx}
        initialType={addPreset?.type}
        initialKind={addPreset?.kind}
        initialCategory={addPreset?.category}
      />

      {isCredit && (
        <PayCardSheet
          open={payOpen}
          onOpenChange={setPayOpen}
          card={ledgerAccount}
          summary={creditSummary}
          accounts={accounts}
          currency={currency}
          initialPreset={payPreset}
          onDone={() => void load({ silent: true })}
        />
      )}

      <AddCardWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        mode="edit"
        card={card}
        onSaved={(next) => { if (next) setCard(next); void load({ silent: true }) }}
      />
    </div>
  )
}
