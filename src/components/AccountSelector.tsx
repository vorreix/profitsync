import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronDown, Plus, Split, Star } from "lucide-react"
import type { Card, WealthAccount } from "@/lib/types"
import { cn } from "@/lib/utils"
import { accountBalanceLabel, accountDisplayName, accountSpendableLabel, currencySymbol, formatMoney, useBalancePrivacy } from "@/lib/wealth"
import { cardDisplayName, maskedTail, resolveCardPalette } from "@/lib/cards"
import { CREDIT_CARD_TYPE, isLiabilityType } from "@/lib/credit-card"
import { todayIso } from "@/lib/recurring"
import { useCards } from "@/lib/use-cards"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { NetworkMark } from "@/components/cards/NetworkMark"
import { allocationKey, buildPayOptions, optionAllocation, type PayOption } from "@/components/transactions/pay-options"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

// One leg of a transaction: the account the money lands on and, when a card
// paid, which card (attribution only — the server forces account_id to the
// card's own account). `card_id` null/absent = paid straight from the account.
export type Allocation = { account_id: string; card_id?: string | null; amount: string }

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
 * Amount + "pay with" picker for the transaction form: accounts AND cards.
 *
 * - Single-pay (default): one amount field, then Cash in Hand pinned + ONE
 *   rotating slot beside it (the last-used account or card); "+more" grid-expands
 *   the rest — remaining accounts, then a small "Cards" group.
 * - Split (header toggle, 2+ options and `max` > 1): the single view collapses
 *   and a vertical multi-select view expands in — each a grid-collapsible that
 *   cross-fades, so the section grows/shrinks in place with no reflow or pop.
 *
 * Cards come from useCards() (see pay-options.ts for the rules: a credit card
 * stands in for its account, a debit card sits beside its bank, frozen/closed
 * cards are not offered, expired ones are — with an "Expired" pill). Selection
 * is keyed by `card_id ?? account_id`.
 *
 * `max={1}` (edit) forces single-pay and hides the split toggle.
 * Allocations are the single source of truth — one per selected option.
 */
/**
 * The currency an option's money is actually in — its account's native one.
 *
 * Every figure this picker shows belongs to ONE account, so it must be
 * formatted in that account's currency. Using the workspace's for all of them
 * printed a rupee balance as "$12,000.00" and put a "$" in front of an amount
 * that was about to be recorded in rupees.
 */
function optionCurrency(option: PayOption, fallback: string): string {
  return (option.kind === "card" ? option.account?.currency_code : option.account.currency_code) || fallback
}

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
  const { balancesVisible } = useBalancePrivacy()
  const { cards } = useCards()
  const single = max === 1
  const [split, setSplit] = useState(() => !single && allocations.length > 1)
  const [expanded, setExpanded] = useState(false)

  const today = useMemo(() => todayIso(), [])
  const keepCardIds = allocations.map((a) => a.card_id)
  const options = useMemo(
    () => buildPayOptions(accounts, cards, { todayIso: today, keepCardIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, cards, today, keepCardIds.join("|")],
  )
  const canSplit = !single && options.all.length > 1

  const keyOf = (a: Allocation) => allocationKey(a, options.creditByAccount)
  const selectedKeys = useMemo(() => new Set(allocations.map(keyOf)), [allocations, options.creditByAccount]) // eslint-disable-line react-hooks/exhaustive-deps
  const isSelected = (key: string) => selectedKeys.has(key)
  const amountFor = (key: string) => allocations.find((a) => keyOf(a) === key)?.amount ?? ""

  const cash = useMemo(() => options.accounts.find((o) => o.kind === "account" && o.account.type === "cash"), [options])
  // Everything that can take the rotating second slot: banks + cards.
  const rotating = useMemo(() => options.all.filter((o) => o !== cash), [options, cash])

  // The option shown in the second collapsed slot. Initialised from the opening
  // selection (the last-used account or card) and then left ALONE for this entry,
  // so clicking never repositions the grid — it only "follows" the chosen option
  // on the next add (the form reopens with it pre-selected).
  const [secondaryKey, setSecondaryKey] = useState<string>(() => {
    const s = allocations[0]
    if (s) {
      const k = allocationKey(s, options.creditByAccount)
      if (!cash || k !== cash.key) return k
    }
    // No opening selection → surface the user's default bank in the second slot.
    return rotating.find((o) => o.kind === "account" && o.account.is_default)?.key ?? rotating[0]?.key ?? ""
  })

  // Which currency is this entry in? The first selected account decides, and in
  // split mode every other account must match it — one purchase paid from
  // several accounts is one amount, and amounts in different currencies cannot
  // be added. Nothing is restricted while nothing is selected.
  const currencyOfKey = (key: string) => {
    const opt = options.all.find((o) => o.key === key)
    return opt ? optionCurrency(opt, currency) : currency
  }
  const activeCurrency = allocations.length > 0 ? currencyOfKey(keyOf(allocations[0])) : null
  const entryCurrency = activeCurrency ?? currency
  const entrySymbol = currencySymbol(entryCurrency)

  const total = allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
  const selectedCount = allocations.length
  const incomplete = allocations.some((a) => !(Number(a.amount) > 0))

  const sole = allocations[0]

  // Preselect order: the user's chosen default account → Cash → first.
  const fallback = () =>
    options.accounts.find((o) => o.kind === "account" && o.account.is_default) ?? cash ?? options.all[0]
  const fallbackAlloc = () => {
    const o = fallback()
    return o ? optionAllocation(o) : { account_id: "", card_id: null }
  }

  // Lazy one-time init for the cold-load case (accounts/cards arrive after mount).
  // Never updates afterwards, so the grid never reshuffles while selecting.
  useEffect(() => {
    if (secondaryKey || rotating.length === 0) return
    const k = sole ? keyOf(sole) : ""
    setSecondaryKey(k && (!cash || k !== cash.key) && options.byKey.has(k) ? k : rotating[0].key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryKey, rotating.length])

  const selectSingle = (o: PayOption) => onChange([{ ...optionAllocation(o), amount: sole?.amount ?? "" }])
  const setSingleAmount = (amount: string) =>
    onChange([{ ...(sole ? { account_id: sole.account_id, card_id: sole.card_id ?? null } : fallbackAlloc()), amount }])

  const toggleSplit = (o: PayOption) =>
    isSelected(o.key)
      ? onChange(allocations.filter((a) => keyOf(a) !== o.key))
      : onChange([...allocations, { ...optionAllocation(o), amount: "" }])
  const setAmount = (key: string, amount: string) =>
    onChange(allocations.map((a) => (keyOf(a) === key ? { ...a, amount } : a)))

  const enterSplit = () => setSplit(true)
  const exitSplit = () => {
    setSplit(false)
    onChange([allocations[0] ?? { ...fallbackAlloc(), amount: "" }])
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
            "pressable inline-flex min-h-8 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
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
      className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
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

  const secondary = options.byKey.get(secondaryKey) ?? rotating[0]
  const primary = [cash, secondary].filter((o): o is PayOption => !!o)
  const inPrimary = (o: PayOption) => primary.some((p) => p.key === o.key)
  const extraAccounts = options.accounts.filter((o) => !inPrimary(o))
  const extraCards = options.cards.filter((o) => !inPrimary(o))
  const hiddenCount = extraAccounts.length + extraCards.length

  const renderTile = (o: PayOption, mode: "single" | "split") => {
    const own = optionCurrency(o, currency)
    // In a split, an account in another currency cannot join this entry.
    const wrongCurrency = mode === "split" && !!activeCurrency && own !== activeCurrency && !isSelected(o.key)
    return (
    <PayTile
      key={o.key}
      option={o}
      currency={own}
      symbol={currencySymbol(own)}
      balancesVisible={balancesVisible}
      split={mode === "split"}
      disabled={disabled || wrongCurrency}
      note={wrongCurrency ? t("splitSameCurrency", { currency: activeCurrency }) : null}
      selected={mode === "split" ? isSelected(o.key) : (sole ? keyOf(sole) : "") === o.key}
      amount={amountFor(o.key)}
      onPrimary={mode === "split" ? toggleSplit : selectSingle}
      onAmount={(amount) => setAmount(o.key, amount)}
    />
    )
  }

  const cardsHeading = (
    <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cardsHeading")}</p>
  )

  return (
    <div className="space-y-2">
      {header}

      {/* ── SINGLE-PAY VIEW ─────────────────────────────────────────────── */}
      <Collapse open={!split}>
        <div className="space-y-2">
          <MoneyInput symbol={entrySymbol} value={sole?.amount ?? ""} onChange={setSingleAmount} size="lg" />
          <div className={cn("grid gap-2", primary.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {primary.map((o) => renderTile(o, "single"))}
          </div>
          {hiddenCount > 0 && (
            <Collapse open={expanded}>
              <div className="space-y-2 pt-2">
                {extraAccounts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {extraAccounts.map((o) => renderTile(o, "single"))}
                  </div>
                )}
                {extraCards.length > 0 && (
                  <div className="space-y-2">
                    {cardsHeading}
                    <div className="grid grid-cols-2 gap-2">
                      {extraCards.map((o) => renderTile(o, "single"))}
                    </div>
                  </div>
                )}
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
                className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary"
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
              {options.accounts.map((o) => renderTile(o, "split"))}
            </div>
            {options.cards.length > 0 && (
              <div className="space-y-2">
                {cardsHeading}
                <div className="grid grid-cols-1 gap-2">
                  {options.cards.map((o) => renderTile(o, "split"))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {selectedCount > 0 ? t("splitAcross", { count: selectedCount }) : t("selectAtLeastOneAccount")}
              </span>
              {/* The user's own typed total — never masked by privacy mode (that hides balances). */}
              <span className="font-semibold tabular-nums">{formatMoney(total, entryCurrency)}</span>
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

/** "Credit · €780 owed" / "Debit · €2,651" — the one-line status under a card's name. */
type SublineT = (k: string, o?: Record<string, unknown>) => string

/**
 * What a CREDIT card says under its name in this picker.
 *
 * AVAILABLE CREDIT, not debt. This picker asks one question — where should the
 * money come out of? — and every other tile answers it with what is there to
 * spend. A card answering "€900 owed" replies to a question nobody asked here,
 * and buries the only figure that decides the tap: whether the charge will even
 * fit. Debt is the right number on the wealth screens, which are about what is
 * owed; it is the wrong one in front of a payment.
 *
 * A card with no credit limit set has no available figure to give, so it falls
 * back to what it owes — the only number it actually has.
 */
function creditSubline(
  creditLimit: number | string | null | undefined,
  currentBalance: number | string | null | undefined,
  currency: string,
  visible: boolean,
  t: SublineT,
): string {
  return accountSpendableLabel(
    { type: CREDIT_CARD_TYPE, current_balance: String(currentBalance ?? 0), credit_limit: creditLimit ?? null },
    currency,
    visible,
    {
      available: (amount) => t("cardCreditAvailable", { amount }),
      owed: (amount) => t("cardCreditOwed", { amount }),
      nothingOwed: t("cardCreditNothingOwed"),
    },
  )
}

function cardSubline(card: Card, account: WealthAccount | null, currency: string, visible: boolean, t: SublineT): string {
  if (card.kind === "credit") {
    return creditSubline(card.account_credit_limit, card.account_current_balance, currency, visible, t)
  }
  const balance = Number(account?.current_balance ?? card.account_current_balance ?? 0)
  return t("cardDebitBalance", { amount: formatMoney(balance, currency, visible) })
}

function PayTile({
  option, currency, symbol, balancesVisible, split, selected, amount, disabled, note = null, onPrimary, onAmount,
}: {
  option: PayOption
  /** The ACCOUNT's own currency — every figure on this tile is in it. */
  currency: string
  symbol: string
  balancesVisible: boolean
  split: boolean
  selected: boolean
  amount: string
  disabled: boolean
  /** Why this tile cannot be picked right now (a split is one currency). */
  note?: string | null
  onPrimary: (o: PayOption) => void
  onAmount: (amount: string) => void
}) {
  const { t } = useTranslation("transactions")
  const isCard = option.kind === "card"
  const isDefault = !isCard && !!option.account.is_default
  const name = isCard ? cardDisplayName(option.card) : accountDisplayName(option.account)
  const tail = isCard ? maskedTail(option.card.last4) : ""
  const kindWord = isCard ? (option.card.kind === "credit" ? t("cardCredit") : t("cardDebit")) : ""
  const subline = isCard
    ? cardSubline(option.card, option.account, currency, balancesVisible, t)
    : // A credit-card account with no card row of its own (data predating the
      // card backfill) still reaches this picker as a plain account tile, and
      // it is just as much a thing you pay WITH — same rule, same figure.
      isLiabilityType(option.account.type)
      ? creditSubline(option.account.credit_limit, option.account.current_balance, currency, balancesVisible, t)
      : accountBalanceLabel(option.account, currency, balancesVisible, {
          owed: (amt) => t("owedShort", { amount: amt }),
          credit: (amt) => t("cardCreditShort", { amount: amt }),
          nothingOwed: formatMoney(0, currency),
        })
  const bank = isCard ? (option.account ? accountDisplayName(option.account) : option.card.account_bank_name ?? "") : ""
  const ariaLabel = isCard ? `${kindWord} · ${name} ${tail}${bank ? ` · ${bank}` : ""}` : name

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors",
        selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30" : "hover:bg-muted/50",
        note && "opacity-55",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onPrimary(option)}
        aria-pressed={selected}
        aria-label={ariaLabel}
        className="pressable ios-tap flex min-h-11 min-w-0 flex-1 items-center gap-2.5 text-start"
      >
        <span className="relative shrink-0">
          {/* A card wears its own colours as a mini card (same 32px column as the
              bank logo) — instantly tells a card tile from an account tile. */}
          {isCard ? <CardMini card={option.card} /> : <WealthAccountIcon account={option.account} className="size-8" />}
          {selected ? (
            <span className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-200">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          ) : isDefault ? (
            // The org's default account — preselected for new transactions.
            <span className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full border border-amber-500/40 bg-amber-100 text-amber-600 dark:bg-amber-900/60 dark:text-amber-300">
              <Star className="size-2.5 fill-current" />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{name}</span>
            {isCard && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" dir="ltr">{tail}</span>}
            {isCard && option.expired && (
              <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium leading-4 text-amber-700 dark:text-amber-300">
                {t("cardExpired")}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground tabular-nums">{subline}</span>
          {/* Why this one is greyed out: a split has to stay in one currency. */}
          {note && <span className="block truncate text-[11px] text-muted-foreground/80">{note}</span>}
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
          onChange={onAmount}
          autoFocus={amount === ""}
          className="w-28 shrink-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200"
        />
      )}
    </div>
  )
}

/** A 32×20 mini card in the card's palette with its network mark — the tile avatar. */
function CardMini({ card }: { card: Card }) {
  const p = resolveCardPalette({ tier: card.tier, design: card.design, brand_colors: card.brand_colors, brand_domain: card.account_brand_domain })
  return (
    <span className="flex size-8 items-center justify-center" aria-hidden>
      <span
        className="relative block h-5 w-8 overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.18)]"
        style={{ backgroundImage: `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)` }}
      >
        <span className="absolute left-1 top-1 h-[5px] w-[7px] rounded-[1px] bg-white/35" />
        <NetworkMark network={card.network} tone={p.text} className="absolute bottom-[3px] right-[3px] h-[7px]" />
      </span>
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
