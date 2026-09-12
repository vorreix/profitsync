import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ChevronsUpDown, CornerDownRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { CardSwatch } from "@/components/transactions/CardSwatch"
import { buildPayOptions, type PayOption } from "@/components/transactions/pay-options"
import { accountBalanceLabel, accountDisplayName, accountSpendableLabel, formatMoney } from "@/lib/wealth"
import { cardDisplayName, maskedTail } from "@/lib/cards"
import { CREDIT_CARD_TYPE } from "@/lib/credit-card"
import { todayIso } from "@/lib/recurring"
import type { Card, WealthAccount } from "@/lib/types"

/** What the caller learns when a choice is made: the ledger account and, if a card was picked, the card. */
export type PickedSource = { account_id: string; card_id: string | null }

/**
 * Searchable account picker showing each account's logo, name and balance.
 * Reused by the wealth transfer wizard and the Spaces fund/withdraw + auto-save
 * modals. Dialog-aware (portals the popover into the dialog so it scrolls).
 *
 * With `cards` it becomes a "pay with" picker (src/components/transactions/
 * pay-options.ts rules): a credit card stands in for its account, a debit card
 * is offered beside its bank. `value` is then the CARD id when a card is chosen
 * (the second `onChange` argument carries the card's account id).
 *   • `cardsLayout="group"` (default): a "Cards" section after the accounts —
 *     "Federal •••• 1234 · Debit" (recurring rules, transaction sources).
 *   • `cardsLayout="nested"`: each debit card sits under its bank as a
 *     secondary "via •••• 1234" option (Pay card / Transfer "from").
 */
export function AccountCombobox({
  accounts, value, onChange, currency, placeholder, disabled, excludeIds, balancesVisible = true, allowNone, noneLabel, cards, cardsLayout = "group",
}: {
  accounts: WealthAccount[]
  value: string
  onChange: (id: string, picked?: PickedSource) => void
  currency: string
  placeholder?: string
  disabled?: boolean
  excludeIds?: string[]
  balancesVisible?: boolean
  // When set, an explicit "no account" choice (value "") is offered at the top.
  allowNone?: boolean
  noneLabel?: string
  // Cards offered alongside the accounts (pass usableCards(); the selected one is kept even if not).
  cards?: Card[]
  cardsLayout?: "group" | "nested"
}) {
  const { t } = useTranslation("wealth")
  const { t: tTx } = useTranslation("transactions")
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const today = useMemo(() => todayIso(), [])
  const visibleAccounts = useMemo(() => accounts.filter((a) => !excludeIds?.includes(a.id)), [accounts, excludeIds])
  const options = useMemo(
    () => buildPayOptions(visibleAccounts, cards ?? [], { todayIso: today, keepCardIds: [value] }),
    [visibleAccounts, cards, today, value],
  )
  const q = search.trim().toLowerCase()
  const matches = (o: PayOption) => {
    if (!q) return true
    if (o.kind === "account") return accountDisplayName(o.account).toLowerCase().includes(q) || o.account.bank_name.toLowerCase().includes(q)
    return (
      cardDisplayName(o.card).toLowerCase().includes(q) ||
      (o.card.account_bank_name ?? "").toLowerCase().includes(q) ||
      (o.card.last4 && q.includes(o.card.last4)) ||
      o.card.network.toLowerCase().includes(q)
    )
  }
  const filteredAccounts = options.accounts.filter(matches)
  const filteredCards = options.cards.filter(matches)
  const shownAccountIds = new Set(filteredAccounts.map((o) => (o.kind === "account" ? o.account.id : "")))
  const ungrouped =
    cardsLayout === "group" ? filteredCards : filteredCards.filter((c) => c.kind === "card" && !shownAccountIds.has(c.card.account_id))
  // A value naming a credit card's ACCOUNT (legacy rows) resolves to the card option.
  const selected = options.byKey.get(value) ?? (options.creditByAccount.get(value) ? options.byKey.get(options.creditByAccount.get(value)!.id) : undefined)
    ?? accounts.filter((a) => a.id === value).map((a): PayOption => ({ key: a.id, kind: "account", account: a, card: null, expired: false }))[0]

  // A credit card shows what is OWED, never a bare negative balance.
  const balanceOf = (a: WealthAccount) =>
    accountBalanceLabel(a, currency, balancesVisible, {
      owed: (amount) => t("owed", { amount }),
      credit: (amount) => t("cardCredit", { amount }),
      nothingOwed: t("nothingOwed"),
    })
  const balanceOfOption = (o: PayOption) => {
    if (o.kind === "account") return balanceOf(o.account)
    // Every caller that passes `cards` is a "what do I pay with / pay from"
    // picker, so a credit card answers with the credit it has LEFT. Showing what
    // it owes here made this dropdown disagree with the tile picker on the same
    // screen, and disagree with this wizard's own affordability check, which has
    // always measured the amount against available credit.
    if (o.card.kind === "credit") {
      return accountSpendableLabel(
        { type: CREDIT_CARD_TYPE, current_balance: String(o.card.account_current_balance ?? 0), credit_limit: o.card.account_credit_limit ?? null },
        currency,
        balancesVisible,
        { available: (amount) => t("creditAvailableShort", { amount }), owed: (amount) => t("owed", { amount }), nothingOwed: t("nothingOwed") },
      )
    }
    return formatMoney(Number(o.account?.current_balance ?? o.card.account_current_balance ?? 0), currency, balancesVisible)
  }
  const kindWord = (c: Card) => (c.kind === "credit" ? tTx("cardCredit") : tTx("cardDebit"))
  const viaLabel = (c: Card) => (c.last4 ? tTx("cardVia", { last4: c.last4 }) : tTx("cardViaNoTail"))

  function close() { setOpen(false); setSearch("") }
  function pick(o: PayOption) {
    if (o.kind === "card") onChange(o.card.id, { account_id: o.card.account_id, card_id: o.card.id })
    else onChange(o.account.id, { account_id: o.account.id, card_id: null })
    close()
  }

  const rowClass = "flex min-h-11 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent"
  const isPicked = (o: PayOption) => selected?.key === o.key

  const accountRow = (o: PayOption & { kind: "account" }) => (
    <button key={o.key} type="button" className={rowClass} onClick={() => pick(o)} aria-pressed={isPicked(o)}>
      <Check className={cn("size-4 shrink-0", isPicked(o) ? "opacity-100" : "opacity-0")} />
      <WealthAccountIcon account={o.account} className="size-6" />
      <span className="min-w-0 flex-1 truncate">{accountDisplayName(o.account)}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{balanceOf(o.account)}</span>
    </button>
  )

  const cardRow = (o: PayOption & { kind: "card" }, nested: boolean) => (
    <button
      key={o.key}
      type="button"
      className={cn(rowClass, nested && "ps-7")}
      onClick={() => pick(o)}
      aria-pressed={isPicked(o)}
      aria-label={`${kindWord(o.card)} · ${cardDisplayName(o.card)} ${maskedTail(o.card.last4)}`}
    >
      {nested ? (
        <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden />
      ) : (
        <Check className={cn("size-4 shrink-0", isPicked(o) ? "opacity-100" : "opacity-0")} />
      )}
      <CardSwatch card={o.card} />
      {nested ? (
        <>
          <span className="min-w-0 flex-1 truncate">
            <span dir="ltr">{viaLabel(o.card)}</span>
            <span className="ms-1.5 text-xs text-muted-foreground">{cardDisplayName(o.card)}</span>
          </span>
          {isPicked(o) && <Check className="size-4 shrink-0 text-primary" />}
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">
            {cardDisplayName(o.card)}
            <span className="ms-1.5 text-xs text-muted-foreground tabular-nums" dir="ltr">{maskedTail(o.card.last4)}</span>
            <span className="ms-1.5 text-xs text-muted-foreground">· {kindWord(o.card)}</span>
            {o.expired && <span className="ms-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">{tTx("cardExpired")}</span>}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{balanceOfOption(o)}</span>
        </>
      )}
    </button>
  )

  const nothing = filteredAccounts.length === 0 && filteredCards.length === 0

  return (
      <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="h-11 w-full justify-between font-normal" disabled={disabled}>
            {selected ? (
              selected.kind === "card" ? (
                <span className="flex min-w-0 items-center gap-2">
                  <CardSwatch card={selected.card} />
                  <span className="truncate">{cardDisplayName(selected.card)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums" dir="ltr">{maskedTail(selected.card.last4)}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">· {kindWord(selected.card)}</span>
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <WealthAccountIcon account={selected.account} className="size-5" />
                  <span className="truncate">{accountDisplayName(selected.account)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{balanceOf(selected.account)}</span>
                </span>
              )
            ) : allowNone ? (
              <span className="truncate">{noneLabel ?? t("selectAccount")}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder ?? t("selectAccount")}</span>
            )}
            <ChevronsUpDown className="ms-2 size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[var(--radix-popover-trigger-width)] min-w-[14rem] flex-col overflow-hidden p-0"
          align="start"
          collisionPadding={12}
        >
          <div className="shrink-0 border-b p-2">
            <Input placeholder={t("searchAccounts")} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 text-base sm:text-sm" autoFocus />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin p-1">
            {allowNone && (
              <button
                type="button"
                className={cn(rowClass, "text-muted-foreground")}
                onClick={() => { onChange("", { account_id: "", card_id: null }); close() }}
              >
                <Check className={cn("size-4 shrink-0", value === "" ? "opacity-100" : "opacity-0")} />
                {noneLabel ?? t("selectAccount")}
              </button>
            )}
            {filteredAccounts.map((o) => {
              if (o.kind !== "account") return null
              if (cardsLayout !== "nested") return accountRow(o)
              // Nested: the bank, then each of its debit cards as "via •••• 1234".
              const under = filteredCards.filter((c): c is PayOption & { kind: "card" } => c.kind === "card" && c.card.account_id === o.account.id)
              return (
                <div key={o.key}>
                  {accountRow(o)}
                  {under.map((c) => cardRow(c, true))}
                </div>
              )
            })}
            {/* Cards that sit under no listed account get their own group. In
                "group" mode that is all of them; in "nested" mode it is the
                credit cards, whose liability account buildPayOptions replaces
                with the card itself — without this they would render nowhere. */}
            {ungrouped.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{tTx("cardsHeading")}</p>
                {ungrouped.map((o) => (o.kind === "card" ? cardRow(o, false) : null))}
              </>
            )}
            {nothing && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("noAccountFound")}</p>}
          </div>
        </PopoverContent>
      </Popover>
  )
}
