import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowDownToLine, ArrowUpFromLine, Crown, Pencil, Plus, Target, Trash2, TrendingUp } from "lucide-react"
import { apiDelete, apiGet, apiPatch } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canWriteRole } from "@/lib/roles"
import type { WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { spaceGoalStatus, spaceProgress } from "@/lib/spaces"
import { spaceIconFor } from "@/components/wealth/space-icons"
import { SpaceTransferModal } from "@/components/spaces/SpaceTransferModal"
import { SpaceFormModal } from "@/components/spaces/SpaceFormModal"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type SpacesQuota = { plan_key: string; spaces: { current: number; limit: number } }

export function SpacesPage() {
  const { t } = useTranslation("spaces")
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const canWrite = canWriteRole(activeOrg?.role)

  const [spaces, setSpaces] = useState<WealthAccount[]>([])
  const [accounts, setAccounts] = useState<WealthAccount[]>([]) // spendable (bank/cash) — fund/withdraw endpoints
  const [quota, setQuota] = useState<SpacesQuota | null>(null)
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<WealthAccount | null>(null)

  const [transfer, setTransfer] = useState<{ space: WealthAccount; mode: "fund" | "withdraw" } | null>(null)
  const [deleting, setDeleting] = useState<WealthAccount | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const [spaceRows, accountRows, quotaRow] = await Promise.all([
        apiGet<WealthAccount[]>("/api/spaces", token),
        apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        apiGet<SpacesQuota>("/api/wealth/quota", token).catch(() => null),
      ])
      setSpaces(spaceRows)
      setAccounts(accountRows.filter((a) => a.type !== "space" && !a.archived_at))
      setQuota(quotaRow)
    } catch {
      toast.error(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [getToken, t])

  useEffect(() => { void load() }, [load])

  // Deep link / FAB: /spaces?new=1 opens the create modal once the data (and the
  // quota gate) is ready, then strips the param.
  useEffect(() => {
    if (loading || searchParams.get("new") !== "1") return
    openCreate()
    setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("new"); return n }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams])

  const active = useMemo(() => spaces.filter((s) => !s.archived_at), [spaces])
  const archived = useMemo(() => spaces.filter((s) => s.archived_at), [spaces])
  const totalSaved = useMemo(() => active.reduce((sum, s) => sum + Number(s.current_balance), 0), [active])
  const atLimit = quota != null && quota.spaces.current >= quota.spaces.limit

  async function handleRestore(space: WealthAccount) {
    if (atLimit) { setUpgradeOpen(true); return }
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      const restored = await apiPatch<WealthAccount>(`/api/spaces/${space.id}`, token, { archived: false }, ["/api/spaces", "/api/wealth"])
      setSpaces((prev) => prev.map((s) => (s.id === restored.id ? { ...s, ...restored } : s)))
      setQuota((q) => (q ? { ...q, spaces: { ...q.spaces, current: q.spaces.current + 1 } } : q))
      toast.success(t("restored"))
    } catch (err) {
      toast.error(err instanceof Error && err.message && err.message !== "auth" ? err.message : t("saveFailed"))
    }
  }

  function openCreate() {
    if (atLimit) { setUpgradeOpen(true); return }
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(space: WealthAccount) {
    setEditing(space)
    setFormOpen(true)
  }

  function onSaved(saved: WealthAccount, isNew: boolean) {
    if (isNew) {
      setSpaces((prev) => [...prev, saved])
      setQuota((q) => (q ? { ...q, spaces: { ...q.spaces, current: q.spaces.current + 1 } } : q))
    } else {
      setSpaces((prev) => prev.map((s) => (s.id === saved.id ? { ...s, ...saved } : s)))
    }
  }

  async function handleDelete() {
    if (!deleting) return
    const space = deleting
    setDeleting(null)
    try {
      const token = await getToken()
      if (!token) throw new Error("auth")
      await apiDelete(`/api/spaces/${space.id}`, token, undefined, ["/api/spaces", "/api/wealth"])
      setSpaces((prev) => prev.filter((s) => s.id !== space.id))
      setQuota((q) => (q ? { ...q, spaces: { ...q.spaces, current: Math.max(0, q.spaces.current - 1) } } : q))
      toast.success(t("deleted"))
    } catch (err) {
      toast.error(err instanceof Error && err.message && err.message !== "auth" ? err.message : t("deleteFailed"))
      void load({ silent: true })
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-2xl" />)}</div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {t("title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground sm:mt-1">{t("subtitle")}</p>
        </div>
        {canWrite && (
          <Button onClick={openCreate} className="shrink-0">
            {atLimit ? <Crown className="size-4 text-amber-500 dark:text-amber-400" /> : <Plus className="size-4" />}
            <span className="hidden sm:inline">{t("addSpace")}</span>
            <span className="sm:hidden">{t("new")}</span>
          </Button>
        )}
      </div>

      {/* Total saved hero */}
      {active.length > 0 && (
        <div className="rounded-2xl border bg-gradient-to-br from-emerald-500/10 to-transparent p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("totalSaved")}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">{formatMoney(totalSaved, currency)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("savedAcross", { count: active.length })}</p>
        </div>
      )}

      {active.length === 0 ? (
        <button
          type="button"
          onClick={canWrite ? openCreate : undefined}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-16 text-center text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            {(() => { const Icon = spaceIconFor("piggy"); return <Icon className="size-7" /> })()}
          </span>
          <span className="text-base font-medium text-foreground">{t("empty")}</span>
          <span className="max-w-sm text-sm">{t("emptyHint")}</span>
        </button>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              currency={currency}
              canWrite={canWrite}
              onOpen={() => navigate(`/spaces/${space.id}`)}
              onFund={() => setTransfer({ space, mode: "fund" })}
              onWithdraw={() => setTransfer({ space, mode: "withdraw" })}
              onEdit={() => openEdit(space)}
              onDelete={() => setDeleting(space)}
            />
          ))}
        </ul>
      )}

      {/* Closed (archived) Spaces — kept so the transfer history survives; reopen anytime */}
      {archived.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{t("closedSpaces")}</p>
          <ul className="space-y-2">
            {archived.map((space) => {
              const Icon = spaceIconFor(space.icon)
              return (
                <li key={space.id} className="flex items-center gap-3 rounded-xl border bg-card/60 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{space.nickname}</span>
                  {canWrite && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => handleRestore(space)}>{t("restore")}</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Create / edit modal */}
      <SpaceFormModal open={formOpen} space={editing} onClose={() => setFormOpen(false)} onSaved={onSaved} />

      {/* Fund / withdraw modal */}
      <SpaceTransferModal
        state={transfer}
        accounts={accounts}
        currency={currency}
        onClose={() => setTransfer(null)}
        onDone={() => { setTransfer(null); void load({ silent: true }) }}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteBody", { name: deleting?.nickname ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upgrade dialog (free plan at the Space limit) */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="w-[92vw] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="size-4 text-amber-500 dark:text-amber-400" /> {t("upgradeTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("upgradeBody", { limit: quota?.spaces.limit ?? 1 })}</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>{t("cancel")}</Button>
            <Button onClick={() => { setUpgradeOpen(false); navigate("/subscription") }}>{t("upgrade")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SpaceCard({
  space, currency, canWrite, onOpen, onFund, onWithdraw, onEdit, onDelete,
}: {
  space: WealthAccount
  currency: string
  canWrite: boolean
  onOpen: () => void
  onFund: () => void
  onWithdraw: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation("spaces")
  const Icon = spaceIconFor(space.icon)
  const balance = Number(space.current_balance)
  const progress = spaceProgress(balance, space.goal_amount)
  const status = spaceGoalStatus(balance, space.goal_amount, space.target_date, new Date().toISOString().split("T")[0])

  return (
    <li className="flex flex-col rounded-2xl border bg-card p-4 transition-shadow hover:shadow-sm">
      <button type="button" onClick={onOpen} className="flex items-start gap-3 text-left">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{space.nickname}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatMoney(balance, currency)}</p>
        </div>
        {status.kind === "reached" && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{t("goalReached")}</span>
        )}
      </button>

      {progress && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${progress.pct}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{progress.pct}% · {formatMoney(balance, currency)} / {formatMoney(Number(space.goal_amount), currency)}</span>
            {status.kind === "on_pace" && status.suggestedMonthly > 0 && (
              <span className="flex items-center gap-1 tabular-nums text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="size-3" /> {t("perMonth", { amount: formatMoney(status.suggestedMonthly, currency) })}
              </span>
            )}
            {status.kind === "overdue" && <span className="text-amber-600 dark:text-amber-400">{t("pastTarget")}</span>}
          </div>
        </div>
      )}
      {!progress && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Target className="size-3.5" /> {t("noGoalHint")}
        </p>
      )}

      {canWrite && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="secondary" className="flex-1" onClick={onFund}>
            <ArrowDownToLine className="size-4" /> {t("addMoney")}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={onWithdraw} disabled={balance <= 0}>
            <ArrowUpFromLine className="size-4" /> {t("withdraw")}
          </Button>
          <Button size="icon" variant="ghost" className="size-9 shrink-0 text-muted-foreground" aria-label={t("edit")} onClick={onEdit}>
            <Pencil className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" className="size-9 shrink-0 text-muted-foreground hover:text-destructive" aria-label={t("delete")} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </li>
  )
}
