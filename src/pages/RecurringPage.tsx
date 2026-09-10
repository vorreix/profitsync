import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowDownRight, ArrowUpRight, ChevronRight, Pause, Pencil, Play, Plus, Repeat, Trash2, TriangleAlert, X } from "lucide-react"
import { apiDelete, apiGet, apiPatch } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { accountTypeAllows } from "@/lib/types"
import type { Client, RecurringRule, WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cardDisplayName, maskedTail } from "@/lib/cards"
import { usableCards, useCardMap } from "@/lib/use-cards"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { CardChip } from "@/components/cards/CardChip"
import { RecurringRuleDialog, DeleteRecurringDialog, type RuleForm } from "@/components/recurring/RecurringRuleDialog"

export function RecurringPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const hasClients = accountTypeAllows(activeOrg?.account_type ?? null, "clients")

  const [searchParams, setSearchParams] = useSearchParams()
  // Older links (a transaction's recurring badge before the rule got its own
  // page, a notification from a cached bundle) point at /recurring?view=<id>.
  // They mean "open that rule" — which is now a route, so send them there and
  // replace the entry so Back still returns where the user came from.
  const legacyViewId = searchParams.get("view")
  useEffect(() => {
    if (legacyViewId) navigate(`/recurring/${legacyViewId}`, { replace: true })
  }, [legacyViewId, navigate])

  const [rules, setRules] = useState<RecurringRule[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringRule | null>(null)
  const [preset, setPreset] = useState<Partial<RuleForm> | undefined>(undefined)
  const [deleting, setDeleting] = useState<RecurringRule | null>(null)
  // Cards: chips on the rows (incl. closed cards, so old rules keep theirs) and
  // the "pay with" picker (usable ones only).
  const cardMap = useCardMap()
  const payableCards = useMemo(() => usableCards(cardMap.cards), [cardMap.cards])

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    // On the way to a rule's own page — don't spend three requests on a list
    // that is about to unmount.
    if (legacyViewId) return
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
  }, [getToken, hasClients, legacyViewId, t])

  useEffect(() => { load() }, [load])

  // Optional account / card filter, e.g. from a wealth account's or a card's
  // "recurring" button: /recurring?account=<id> or ?card=<id> shows only the
  // rules tied to it (a credit card's rules are the ones on its account).
  const accountFilter = searchParams.get("account")
  const cardFilter = searchParams.get("card")
  const filterAccount = accountFilter ? accounts.find((a) => a.id === accountFilter) : null
  const filterCard = cardFilter ? cardMap.byId.get(cardFilter) ?? null : null
  const visibleRules = useMemo(
    () => rules.filter((r) => {
      if (accountFilter && r.wealth_account_id !== accountFilter) return false
      if (cardFilter && !(r.card_id === cardFilter || (filterCard?.kind === "credit" && r.wealth_account_id === filterCard.account_id))) return false
      return true
    }),
    [rules, accountFilter, cardFilter, filterCard],
  )
  function clearFilter(key: "account" | "card") {
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete(key); return n }, { replace: true })
  }

  const upcoming = useMemo(() => visibleRules.filter((r) => r.active), [visibleRules])
  const paused = useMemo(() => visibleRules.filter((r) => !r.active), [visibleRules])

  const openCreate = useCallback((seed?: Partial<RuleForm>) => {
    setEditing(null)
    setPreset(seed)
    setFormOpen(true)
  }, [])

  // /recurring?new=1[&card=<id>] (a card page's "Add recurring"): open the
  // create dialog, preselected on that card while it can still pay. The card
  // param stays as the list filter; only `new` is consumed.
  const newParam = searchParams.get("new")
  useEffect(() => {
    if (newParam !== "1") return
    if (cardFilter && cardMap.loading) return
    const card = cardFilter ? payableCards.find((c) => c.id === cardFilter) : undefined
    openCreate(card ? { wealth_account_id: card.account_id, card_id: card.id } : undefined)
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("new"); return n }, { replace: true })
  }, [newParam, cardFilter, cardMap.loading, payableCards, openCreate, setSearchParams])

  function openEdit(rule: RecurringRule) {
    setEditing(rule)
    setPreset(undefined)
    setFormOpen(true)
  }

  async function toggleActive(rule: RecurringRule) {
    const next = !rule.active
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, active: next } : r)))
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/recurring/${rule.id}`, token, { active: next })
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
      await apiDelete(`/api/recurring/${rule.id}`, token)
      toast.success(t("recurring.deleted"))
    } catch {
      toast.error(t("recurring.deleteFailed"))
      await load({ silent: true })
    }
  }

  const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

  const freqLabel = (rule: RecurringRule) => {
    const unit = t(`recurring.unit_${rule.frequency_unit}` as const)
    return rule.frequency_interval > 1
      ? t("recurring.everyN", { count: rule.frequency_interval, unit })
      : t("recurring.everyOne", { unit })
  }

  const renderRule = (rule: RecurringRule) => {
    const ruleCard = cardMap.forTx({ card_id: rule.card_id, wealth_account_id: rule.wealth_account_id })
    return (
    <li
      key={rule.id}
      className="relative flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/40 sm:p-4"
    >
      {/* The whole row opens the rule. An overlay link keeps the row's own
          buttons (pause / edit / delete) as real siblings rather than nesting
          interactive elements inside a link. */}
      <Link
        to={`/recurring/${rule.id}`}
        aria-label={t("recurring.openRule", { name: rule.name })}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      />
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
              <span className="sr-only">{rule.last_error}</span>
            </span>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <span className="truncate">
            {freqLabel(rule)}
            {hasClients && <> · {rule.client_id ? rule.client_name : t("recurring.ownCompany")}</>}
          </span>
          {ruleCard ? (
            <>
              <span aria-hidden>·</span>
              {/* Not a link here: the row already leads somewhere. */}
              <CardChip card={ruleCard} linked={false} />
            </>
          ) : rule.account_name ? (
            <span className="truncate">· {rule.account_name}</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {rule.active
            ? t("recurring.nextOn", { date: fmtDate(rule.next_due_at) })
            : t("recurring.paused")}
          {rule.end_date ? <> · {t("recurring.until", { date: fmtDate(rule.end_date) })}</> : null}
        </p>
      </div>
      <div className="relative flex shrink-0 flex-col items-end gap-1">
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
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 rtl:rotate-180" aria-hidden />
        </div>
      </div>
    </li>
    )
  }

  const filterPillClass = "mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full border bg-muted/50 py-1 ps-1.5 pe-2.5 text-xs font-medium transition-colors hover:bg-muted"

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("recurring.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground sm:mt-1">{t("recurring.subtitle")}</p>
          {filterAccount && (
            <button type="button" onClick={() => clearFilter("account")} className={filterPillClass}>
              <WealthAccountIcon account={filterAccount} className="size-4" />
              <span className="truncate">{filterAccount.nickname || filterAccount.bank_name}</span>
              <X className="size-3.5 text-muted-foreground" />
            </button>
          )}
          {cardFilter && filterCard && (
            <button
              type="button"
              onClick={() => clearFilter("card")}
              className={`${filterPillClass} ms-2`}
              aria-label={`${t("recurring.cardFilter", { name: `${cardDisplayName(filterCard)} ${maskedTail(filterCard.last4)}` })} — ${t("recurring.cardClearFilter")}`}
            >
              <CardChip card={filterCard} linked={false} />
              <X className="size-3.5 text-muted-foreground" aria-hidden />
            </button>
          )}
        </div>
        {canWrite && (
          <Button onClick={() => openCreate()} className="shrink-0">
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
          onClick={canWrite ? () => openCreate() : undefined}
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

      <RecurringRuleDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        rule={editing}
        preset={preset}
        accounts={accounts}
        clients={clients}
        cards={payableCards}
        onSaved={(saved, info) => {
          // A create may have materialized backdated occurrences — reload so the
          // new row shows its real next-due; an edit answers with the full row.
          if (info.created) void load({ silent: true })
          else setRules((prev) => prev.map((r) => (r.id === saved.id ? { ...r, ...saved } : r)))
        }}
      />

      <DeleteRecurringDialog
        rule={deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        onConfirm={handleDelete}
      />
    </div>
  )
}
