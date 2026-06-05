import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, Plus, Split } from "lucide-react"
import type { WealthAccount } from "@/lib/types"
import { cn } from "@/lib/utils"
import { accountDisplayName, currencySymbol, formatMoney } from "@/lib/wealth"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

export type Allocation = { account_id: string; amount: string }

/**
 * Smoothly expands/collapses to auto height via the grid `0fr → 1fr` trick — the
 * track size is interpolable (unlike `height: auto`) and the inner
 * `overflow-hidden` clips content so nothing spills or pops. Used for both the
 * "+more" reveal and the single↔split swap.
 */
function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      inert={open ? undefined : true}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

/**
 * Amount + source picker for the transaction form.
 *
 * - Single-pay (default): one amount field, then Cash in Hand pinned + ONE
 *   rotating bank slot beside it; "+more" grid-expands the rest.
 * - Split (header toggle, 2+ accounts and `max` > 1): the single view collapses
 *   and a vertical multi-select view expands in — each a grid-collapsible that
 *   cross-fades, so the section grows/shrinks in place with no reflow or pop.
 *
 * `max={1}` (edit) forces single-pay and hides the split toggle.
 * Allocations are the single source of truth — one per selected account.
 */
export function AccountSelector({
  accounts,
  allocations,
  onChange,
  currency,
  max = Infinity,
  onAddAccount,
  loading = false,
  disabled = false,
}: {
  accounts: WealthAccount[]
  allocations: Allocation[]
  onChange: (next: Allocation[]) => void
  currency: string
  max?: number
  onAddAccount?: () => void
  loading?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation("transactions")
  const symbol = currencySymbol(currency)
  const single = max === 1
  const canSplit = !single && accounts.length > 1
  const [split, setSplit] = useState(() => !single && allocations.length > 1)
  const [expanded, setExpanded] = useState(false)
  // The bank shown in the second collapsed slot. Initialised from the opening
  // selection (the last-used account) and then left ALONE for this entry, so
  // clicking accounts never repositions the grid — it only "follows" the chosen
  // account on the next add (the form reopens with it pre-selected).
  const [secondaryId, setSecondaryId] = useState<string>(() => {
    const s = allocations[0]
    const cashAcc = accounts.find((a) => a.type === "cash")
    if (s && cashAcc && s.account_id !== cashAcc.id) return s.account_id
    return accounts.find((a) => a.type === "bank")?.id ?? ""
  })

  const selectedIds = useMemo(() => new Set(allocations.map((a) => a.account_id)), [allocations])
  const isSelected = (id: string) => selectedIds.has(id)
  const amountFor = (id: string) => allocations.find((a) => a.account_id === id)?.amount ?? ""
  const fallbackId = () => accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? ""

  const cash = useMemo(() => accounts.find((a) => a.type === "cash"), [accounts])
  const banks = useMemo(() => accounts.filter((a) => a.type === "bank"), [accounts])

  const total = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
  const selectedCount = allocations.length
  const incomplete = allocations.some((a) => !(Number(a.amount) > 0))

  const sole = allocations[0]

  // Lazy one-time init for the cold-load case (accounts arrive after mount).
  // Never updates afterwards, so the grid never reshuffles while selecting.
  useEffect(() => {
    if (secondaryId || banks.length === 0) return
    setSecondaryId(sole && cash && sole.account_id !== cash.id ? sole.account_id : banks[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryId, banks.length])

  const selectSingle = (id: string) => onChange([{ account_id: id, amount: sole?.amount ?? "" }])
  const setSingleAmount = (amount: string) => onChange([{ account_id: sole?.account_id ?? fallbackId(), amount }])
  // Selecting an account keeps "+more" open and does NOT move it to the second
  // slot — positions stay put for this entry (per user request).
  const pickSingle = (id: string) => selectSingle(id)

  const toggleSplitAccount = (id: string) =>
    isSelected(id)
      ? onChange(allocations.filter((a) => a.account_id !== id))
      : onChange([...allocations, { account_id: id, amount: "" }])
  const setAmount = (id: string, amount: string) =>
    onChange(allocations.map((a) => (a.account_id === id ? { ...a, amount } : a)))

  const enterSplit = () => setSplit(true)
  const exitSplit = () => {
    setSplit(false)
    onChange([allocations[0] ?? { account_id: fallbackId(), amount: "" }])
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm font-medium">{t("amountSource")}</Label>
      {canSplit && (
        <button
          type="button"
          onClick={() => (split ? exitSplit() : enterSplit())}
          aria-pressed={split}
          className={cn(
            "pressable inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
            split ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Split className="size-3.5" /> {t("split")}
        </button>
      )}
    </div>
  )

  const addAccountLink = onAddAccount ? (
    <button
      type="button"
      onClick={onAddAccount}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <Plus className="size-3.5" /> {t("addAccount")}
    </button>
  ) : null

  if (loading && accounts.length === 0) {
    return (
      <div className="space-y-2">
        {header}
        <Skeleton className="h-11 rounded-xl" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-2">
        {header}
        <div className="rounded-xl border border-dashed p-4 text-center">
          <p className="text-sm font-medium">{t("noAccountFound")}</p>
          {onAddAccount && (
            <Button type="button" size="sm" className="mt-3" onClick={onAddAccount}>
              <Plus className="size-4" /> {t("addAccount")}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const secondary = banks.find((b) => b.id === secondaryId) ?? banks[0]
  const primary = [cash, secondary].filter((a): a is WealthAccount => !!a)
  const extras = accounts.filter((a) => !primary.some((p) => p.id === a.id))
  const hiddenCount = extras.length

  const renderCard = (account: WealthAccount, mode: "single" | "split") => (
    <AccountCard
      key={account.id}
      account={account}
      currency={currency}
      symbol={symbol}
      split={mode === "split"}
      disabled={disabled}
      selected={mode === "split" ? isSelected(account.id) : sole?.account_id === account.id}
      amount={amountFor(account.id)}
      onPrimary={mode === "split" ? toggleSplitAccount : pickSingle}
      onAmount={setAmount}
    />
  )

  return (
    <div className="space-y-2">
      {header}

      {/* ── SINGLE-PAY VIEW ─────────────────────────────────────────────── */}
      <Collapse open={!split}>
        <div className="space-y-2">
          <MoneyInput symbol={symbol} value={sole?.amount ?? ""} onChange={setSingleAmount} size="lg" />
          <div className={cn("grid gap-2", primary.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {primary.map((a) => renderCard(a, "single"))}
          </div>
          {hiddenCount > 0 && (
            <Collapse open={expanded}>
              <div className="grid grid-cols-2 gap-2 pt-2">
                {extras.map((a) => renderCard(a, "single"))}
              </div>
            </Collapse>
          )}
          <div className="flex items-center justify-between gap-2">
            {addAccountLink ?? <span />}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary"
              >
                <ChevronDown className={cn("size-3.5 transition-transform duration-300", expanded && "rotate-180")} />
                {expanded ? t("showLess") : t("moreAccounts", { count: hiddenCount })}
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </Collapse>

      {/* ── SPLIT VIEW ──────────────────────────────────────────────────── */}
      {canSplit && (
        <Collapse open={split}>
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2">
              {accounts.map((a) => renderCard(a, "split"))}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {selectedCount > 0 ? t("splitAcross", { count: selectedCount }) : t("selectAtLeastOneAccount")}
              </span>
              <span className="font-semibold tabular-nums">{formatMoney(total, currency)}</span>
            </div>
            {selectedCount > 0 && incomplete && (
              <p className="text-xs text-muted-foreground">{t("enterAmountForEachAccount")}</p>
            )}
            {addAccountLink && <div className="flex justify-end">{addAccountLink}</div>}
          </div>
        </Collapse>
      )}
    </div>
  )
}

function AccountCard({
  account, currency, symbol, split, selected, amount, disabled, onPrimary, onAmount,
}: {
  account: WealthAccount
  currency: string
  symbol: string
  split: boolean
  selected: boolean
  amount: string
  disabled: boolean
  onPrimary: (id: string) => void
  onAmount: (id: string, amount: string) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors",
        selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPrimary(account.id)}
        aria-pressed={selected}
        className="pressable ios-tap flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <AccountAvatar account={account} selected={selected} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{accountDisplayName(account)}</span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">
            {formatMoney(Number(account.current_balance), currency)}
          </span>
        </span>
        {split && !selected && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-muted-foreground">
            <Plus className="size-3" />
          </span>
        )}
      </button>
      {split && selected && (
        <MoneyInput
          symbol={symbol}
          value={amount}
          onChange={(v) => onAmount(account.id, v)}
          autoFocus={amount === ""}
          className="w-28 shrink-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200"
        />
      )}
    </div>
  )
}

function AccountAvatar({ account, selected }: { account: WealthAccount; selected: boolean }) {
  return (
    <span className="relative shrink-0">
      <WealthAccountIcon account={account} className="size-8" />
      {selected && (
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      )}
    </span>
  )
}

function MoneyInput({
  symbol, value, onChange, autoFocus, invalid, className = "", size = "md",
}: {
  symbol: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  invalid?: boolean
  className?: string
  size?: "md" | "lg"
}) {
  const lg = size === "lg"
  return (
    <div className={cn("relative", className)}>
      <span className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground", lg ? "left-3 text-base" : "left-2.5 text-sm")}>
        {symbol}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        placeholder="0.00"
        autoFocus={autoFocus}
        aria-invalid={invalid ? true : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={lg ? "h-11 pl-8 text-right text-lg font-semibold tabular-nums" : "h-9 pl-7 text-right tabular-nums"}
      />
    </div>
  )
}
