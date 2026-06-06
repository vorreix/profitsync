import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  Archive,
  ArrowLeftRight,
  ChevronRight,
  Eye,
  EyeOff,
  MoreVertical,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Pencil,
  Wallet,
} from "lucide-react"
import { apiDelete, apiGet, apiPatch, apiPost, clearApiCache } from "@/lib/api"
import type { WealthAccount } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { WealthAccountDialogs } from "@/components/wealth/WealthAccountDialogs"
import { TransferWizard } from "@/components/wealth/TransferWizard"
import { BankAccountFormFields } from "@/components/wealth/BankAccountFormFields"
import { type BankFormState, bankDetailsPayload, emptyBankForm } from "@/lib/bank-form"
import { accountDisplayName, currencySymbol, formatMoney, useBalancePrivacy, useWealthSummary } from "@/lib/wealth"
import { useTranslation } from "react-i18next"

const MAX_BANKS = 5

type CreateForm = BankFormState & { opening_balance: string }
const emptyCreate: CreateForm = { ...emptyBankForm, opening_balance: "" }

export function WealthPage() {
  const { t } = useTranslation("wealth")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const symbol = currencySymbol(currency)
  const { balancesVisible, setBalancesVisible } = useBalancePrivacy()
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(emptyCreate)
  const [editing, setEditing] = useState<WealthAccount | null>(null)
  const [adjusting, setAdjusting] = useState<WealthAccount | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferFrom, setTransferFrom] = useState<string | undefined>(undefined)
  const [transferTo, setTransferTo] = useState<string | undefined>(undefined)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Mouse: small move to drag. Touch: press-and-hold so taps + page scroll still
  // work, then drag — the standard dnd-kit mobile setup.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  )

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id))
  }

  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null)
    const fromId = String(e.active.id)
    const toId = e.over ? String(e.over.id) : ""
    if (toId && toId !== fromId) {
      setTransferFrom(fromId)
      setTransferTo(toId)
      setTransferOpen(true)
    }
  }

  function openTransfer() {
    setTransferFrom(undefined)
    setTransferTo(undefined)
    setTransferOpen(true)
  }

  const { active, total } = useWealthSummary(accounts)
  const bankCount = active.filter((a) => a.type === "bank").length
  const archived = useMemo(() => accounts.filter((a) => a.archived_at), [accounts])

  async function load() {
    const token = await getToken()
    if (!token) return
    setLoading(true)
    try {
      setAccounts(await apiGet<WealthAccount[]>("/api/wealth/accounts", token))
    } catch {
      toast.error(t("failedToLoad"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openCreate() {
    setForm(emptyCreate)
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!form.bank_name.trim()) {
      toast.error(t("bankNameRequired"))
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/wealth/accounts", token, {
        type: "bank",
        bankName: form.bank_name.trim(),
        nickname: form.nickname.trim(),
        icon: form.icon,
        openingBalance: Number(form.opening_balance || 0),
        ...bankDetailsPayload(form),
      })
      clearApiCache()
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success(t("accountAdded"))
      setCreateOpen(false)
      await load()
    } catch {
      toast.error(t("couldNotAdd"))
    } finally {
      setSaving(false)
    }
  }

  async function deleteOrArchive(account: WealthAccount) {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/wealth/accounts/${account.id}`, token)
      clearApiCache()
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success((account.transaction_count ?? 0) > 0 ? t("accountArchived") : t("accountRemoved"))
      await load()
    } catch {
      toast.error(t("failedToArchive"))
    } finally {
      setSaving(false)
    }
  }

  async function restore(account: WealthAccount) {
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/wealth/accounts/${account.id}`, token, { restore: true })
      clearApiCache()
      window.dispatchEvent(new Event("wealth:accounts-changed"))
      toast.success(t("accountRestored"))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToArchive"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={balancesVisible ? t("hideBalances") : t("showBalances")}
          onClick={() => setBalancesVisible((v) => !v)}
        >
          {balancesVisible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
      </div>

      {/* Net-worth hero */}
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("netWorth")}</p>
        {loading ? (
          <Skeleton className="mt-2 h-9 w-40" />
        ) : (
          <p className="mt-1 text-3xl font-bold tabular-nums sm:text-4xl">{formatMoney(total, currency, balancesVisible)}</p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {active.length} {active.length === 1 ? t("account") : t("accounts")}
          </p>
          <div className="flex items-center gap-2">
            {active.length >= 2 && (
              <Button size="sm" variant="outline" onClick={openTransfer} disabled={loading}>
                <ArrowLeftRight className="size-4" /> {t("transfer")}
              </Button>
            )}
            <Button size="sm" onClick={openCreate} disabled={bankCount >= MAX_BANKS || loading}>
              <Plus className="size-4" /> {t("addBank")}
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((account) => (
              <DndAccountCard key={account.id} account={account} dimmed={draggingId === account.id}>
                <AccountCard
                  account={account}
                  currency={currency}
                  balancesVisible={balancesVisible}
                  onOpen={() => navigate(`/wealth/${account.id}`)}
                  onAdjust={() => setAdjusting(account)}
                  onEdit={() => setEditing(account)}
                  onArchive={() => deleteOrArchive(account)}
                  saving={saving}
                />
              </DndAccountCard>
            ))}
            {bankCount === 0 && (
              <button
                type="button"
                onClick={openCreate}
                className="pressable ios-tap flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-4 text-center text-muted-foreground transition-colors hover:bg-muted/50"
              >
                <Plus className="size-5" />
                <span className="text-sm font-medium">{t("addBankAccount")}</span>
                <span className="text-xs">{t("cashAlwaysHere")}</span>
              </button>
            )}
          </div>
          <DragOverlay dropAnimation={null}>
            {draggingId ? (
              <div className="rounded-2xl border bg-card p-4 opacity-95 shadow-xl ring-2 ring-primary">
                <div className="flex items-center gap-3">
                  <WealthAccountIcon account={accounts.find((a) => a.id === draggingId) ?? { type: "bank", icon: "bank" }} className="size-10" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{accountDisplayName(accounts.find((a) => a.id === draggingId) ?? { bank_name: "", nickname: "" })}</p>
                    <p className="text-xs text-muted-foreground">{t("transfer")}…</p>
                  </div>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {active.length >= 2 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowLeftRight className="size-3" /> {t("dragHint")}
        </p>
      )}

      {archived.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">{t("archived")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 opacity-70">
                <div className="flex min-w-0 items-center gap-3">
                  <WealthAccountIcon account={account} className="grayscale" />
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-semibold">{accountDisplayName(account)}</p>
                      <Badge variant="outline" className="shrink-0 py-0 text-[10px]">{t("archived")}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground tabular-nums">{formatMoney(Number(account.current_balance), currency, balancesVisible)}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => restore(account)} disabled={saving}>
                  <RotateCcw className="size-4" /> {t("restore")}
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("archivedHint")}</p>
        </div>
      )}

      {/* Create bank dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>{t("addBankAccount")}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-4">
            <BankAccountFormFields form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} autoFocusName />
            <div className="space-y-1.5">
              <Label>{t("openingBalanceLabel", { symbol })}</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.opening_balance}
                placeholder={`${symbol} 0.00`}
                onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? t("saving") : t("addAccount")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WealthAccountDialogs
        editing={editing}
        onEditingChange={setEditing}
        adjusting={adjusting}
        onAdjustingChange={setAdjusting}
        currency={currency}
        onChanged={load}
      />

      <TransferWizard
        open={transferOpen}
        onOpenChange={setTransferOpen}
        accounts={accounts}
        initialFromId={transferFrom}
        initialToId={transferTo}
        currency={currency}
        onDone={load}
      />
    </div>
  )
}

// Wraps an account card to make it both a drag source and a drop target for
// transfers. Drag listeners sit on the wrapper; the inner card's own click /
// adjust button still work (the pointer sensor only starts a drag after 8px).
function DndAccountCard({ account, dimmed, children }: { account: WealthAccount; dimmed: boolean; children: ReactNode }) {
  const drag = useDraggable({ id: account.id })
  const drop = useDroppable({ id: account.id })
  const setRefs = (el: HTMLDivElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el) }
  const isTarget = drop.isOver && drop.active?.id !== account.id
  return (
    <div
      ref={setRefs}
      {...drag.listeners}
      {...drag.attributes}
      className={`rounded-2xl transition-all ${dimmed ? "opacity-40" : ""} ${isTarget ? "scale-[1.02] ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
    >
      {children}
    </div>
  )
}

function AccountCard({
  account, currency, balancesVisible, onOpen, onAdjust, onEdit, onArchive, saving,
}: {
  account: WealthAccount
  currency: string
  balancesVisible: boolean
  onOpen: () => void
  onAdjust: () => void
  onEdit: () => void
  onArchive: () => void
  saving: boolean
}) {
  const { t } = useTranslation("wealth")
  const isCash = account.type === "cash"

  return (
    // "Stretched overlay" card: a single full-bleed button is the click target
    // (z-0); the visible content sits above it (pointer-events-none) and only the
    // genuinely interactive bits — Adjust + the actions menu — re-enable pointer
    // events. This keeps the Adjust control right next to the balance without
    // nesting interactive elements inside another button.
    <div className={`group relative rounded-2xl border bg-card transition-colors hover:border-primary/40 ${isCash ? "ring-1 ring-primary/20" : ""}`}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${accountDisplayName(account)} — ${t("viewTransactions")}`}
        className="pressable ios-tap absolute inset-0 z-0 rounded-2xl outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative z-10 flex flex-col p-4">
        <div className="flex min-w-0 items-center gap-3 pr-8">
          <WealthAccountIcon account={account} className="size-10" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{accountDisplayName(account)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {isCash ? t("cash") : (account.nickname ? account.bank_name : t("bank"))}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          <p className="text-2xl font-bold tabular-nums">{formatMoney(Number(account.current_balance), currency, balancesVisible)}</p>
          <Button
            variant="ghost"
            size="icon"
            className="pointer-events-auto size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={t("adjust")}
            title={t("adjust")}
            onClick={(e) => { e.stopPropagation(); onAdjust() }}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <Badge variant="secondary" className="gap-1">
            {isCash ? <Wallet className="size-3" /> : null}
            {isCash ? t("cash") : t("bank")}
          </Badge>
          <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
            {t("viewTransactions")} <ChevronRight className="size-3.5 rtl:rotate-180" />
          </span>
        </div>
      </div>

      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("account")}>
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}><Pencil className="size-4" /> {t("edit")}</DropdownMenuItem>
            {!isCash && (
              <DropdownMenuItem onSelect={onArchive} disabled={saving} className="text-muted-foreground">
                <Archive className="size-4" /> {t("archive")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
