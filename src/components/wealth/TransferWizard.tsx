import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ArrowRight, Paperclip, X } from "lucide-react"
import { apiErrorMessage, apiErrorUpgradeHint, apiPost } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import { availableCredit, isLiabilityType } from "@/lib/credit-card"
import { ACCEPT_ATTR, attachmentsListPath, uploadAttachment, validateFile } from "@/lib/attachments-client"
import type { WealthAccount } from "@/lib/types"
import { usableCards, useCards } from "@/lib/use-cards"
import { accountBalanceLabel, accountDisplayName, accountSpendableLabel, currencySymbol, useBalancePrivacy } from "@/lib/wealth"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AccountCombobox } from "@/components/wealth/AccountCombobox"

const today = () => new Date().toISOString().split("T")[0]
const formatFileSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`)

/**
 * One end of the transfer, with the figure that side actually needs.
 *
 * `spendable` marks the SOURCE: there the question is how much can leave, so a
 * credit card shows the credit it has left — which is also what this wizard's
 * own insufficient-funds check has always measured against. The destination
 * asks the opposite, so a card being PAID still shows what it owes.
 *
 * Either way the raw signed balance never reaches the screen. It used to, so a
 * card rendered here as "-€950.00", the one thing src/lib/credit-card.ts says
 * no component may do.
 */
function AccountPill({
  account, currency, visible, spendable, t,
}: {
  account?: WealthAccount
  currency: string
  visible: boolean
  spendable: boolean
  t: (k: string, o?: Record<string, unknown>) => string
}) {
  if (!account) return null
  const labels = {
    owed: (amount: string) => t("owed", { amount }),
    nothingOwed: t("nothingOwed"),
  }
  const figure = spendable
    ? accountSpendableLabel(account, currency, visible, { ...labels, available: (amount) => t("creditAvailableShort", { amount }) })
    : accountBalanceLabel(account, currency, visible, { ...labels, credit: (amount) => t("cardCredit", { amount }) })
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-card px-3 py-2">
      <WealthAccountIcon account={account} className="size-8" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{accountDisplayName(account)}</p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">{figure}</p>
      </div>
    </div>
  )
}

/**
 * N26-style account-to-account transfer. Step 1 is just the amount (with the
 * from→to summary); step 2 collects the date, an optional note and attachments.
 * Opened either from the "Transfer" button (accounts chosen here) or by dragging
 * one account or card tile onto another (from/to pre-filled).
 */
export function TransferWizard({
  open,
  onOpenChange,
  accounts,
  initialFromId,
  initialFromCardId,
  initialToId,
  currency,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: WealthAccount[]
  initialFromId?: string
  /** The CARD used on the source side (a drag from a card tile). */
  initialFromCardId?: string
  initialToId?: string
  currency: string
  onDone?: () => void
}) {
  const { t } = useTranslation("wealth")
  const { balancesVisible } = useBalancePrivacy()
  const { getToken } = useAuth()
  const navigate = useNavigate()
  const symbol = currencySymbol(currency)
  const active = accounts.filter((a) => !a.archived_at)
  // A debit card can be the paying instrument on the "from" side: the money
  // still leaves its bank, and the card is recorded on that leg (from_card_id).
  const { cards } = useCards({ enabled: open })
  // Both kinds can be the source: a debit card is an instrument (the money
  // leaves its bank), a credit card is a balance transfer or a cash advance.
  const payWithCards = useMemo(() => usableCards(cards), [cards])

  const [step, setStep] = useState<1 | 2>(1)
  const [fromId, setFromId] = useState("")
  const [fromCardId, setFromCardId] = useState("")
  const [toId, setToId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(today())
  const [note, setNote] = useState("")
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setStep(1)
    setFromId(initialFromId ?? "")
    // Dragging a CARD onto another is a gesture about that card, so its identity
    // has to survive onto the leg — otherwise the ledger shows a plain
    // bank-to-bank transfer with no chip.
    setFromCardId(initialFromCardId ?? "")
    setToId(initialToId ?? "")
    setAmount("")
    setDate(today())
    setNote("")
    setPendingFiles([])
    // Re-arm: the wizard stays mounted between opens, so a request left in flight
    // when the user closed it must not freeze the confirm button on reopen.
    setSaving(false)
  }, [open, initialFromId, initialFromCardId, initialToId])

  const from = active.find((a) => a.id === fromId)
  const to = active.find((a) => a.id === toId)
  const amt = parseFloat(amount)
  const amountValid = !!amt && !isNaN(amt) && amt > 0
  const accountsValid = !!fromId && !!toId && fromId !== toId
  // A credit card's balance is NEGATIVE by design (it is what you owe), so the
  // plain comparison would flag every amount as "insufficient funds" the moment
  // a card can be the source. What is short on a liability is CREDIT, not cash.
  const overBalance =
    from && amountValid
      ? isLiabilityType(from.type)
        ? amt > (availableCredit(from.credit_limit, from.current_balance) ?? Infinity)
        : amt > Number(from.current_balance)
      : false

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files || [])
    if (fileRef.current) fileRef.current.value = ""
    const valid = files.filter((f) => { const err = validateFile(f); if (err) toast.error(err); return !err })
    setPendingFiles((p) => [...p, ...valid])
  }

  async function submit() {
    if (!accountsValid) { toast.error(t("sameAccountError")); return }
    if (!amountValid) { toast.error(t("transferAmount")); return }
    if (amountExceedsLimit(amt)) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await apiPost<{ group_id: string; attach_to: string }>("/api/wealth/transfer", token, {
        from_account_id: fromId,
        from_card_id: fromCardId || null,
        to_account_id: toId,
        amount: amt,
        date,
        note,
      })
      if (res.attach_to && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          try { await uploadAttachment(attachmentsListPath("transaction", res.attach_to), file, token) }
          catch (e) { toast.error(e instanceof Error ? e.message : `Failed to attach ${file.name}`) }
        }
      }
      toast.success(t("transferred"))
      onOpenChange(false)
      onDone?.()
    } catch (e) {
      // The server's JSON body, not the raw thrown string — a free-plan 402
      // would otherwise toast "{\"allowed\":false,\"reason\":…}".
      if (apiErrorUpgradeHint(e)) {
        toast.error(apiErrorMessage(e, t("transferFailed")), { action: { label: t("upgradeBanksCta"), onClick: () => navigate("/subscription") } })
      } else {
        toast.error(apiErrorMessage(e, t("transferFailed")))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{t("transferMoney")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          {/* From → To summary (always visible) */}
          <div className="mb-4 flex items-center gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">{t("fromAccount")}</Label>
              <AccountCombobox
                accounts={active}
                cards={payWithCards}
                cardsLayout="nested"
                value={fromCardId || fromId}
                onChange={(id, picked) => { setFromId(picked ? picked.account_id : id); setFromCardId(picked?.card_id ?? "") }}
                currency={currency}
                excludeIds={[toId]}
              />
            </div>
            <ArrowRight className="mt-5 size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">{t("toAccount")}</Label>
              <AccountCombobox accounts={active} value={toId} onChange={setToId} currency={currency} excludeIds={[fromId]} />
            </div>
          </div>

          {step === 1 ? (
            <div className="space-y-3">
              <Label htmlFor="tr-amount" className="sr-only">{t("transferAmount")}</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-muted-foreground">{symbol}</span>
                <Input
                  id="tr-amount"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-16 pl-11 text-center text-3xl font-bold tabular-nums"
                  autoFocus
                />
              </div>
              {overBalance && <p className="text-center text-xs text-amber-600 dark:text-amber-500">{t("insufficientFunds")}</p>}
              <div className="flex items-center justify-center gap-2 pt-1">
                <AccountPill account={from} currency={currency} visible={balancesVisible} spendable t={t} />
                <ArrowRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                <AccountPill account={to} currency={currency} visible={balancesVisible} spendable={false} t={t} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-3 text-center">
                <p className="text-2xl font-bold tabular-nums">{symbol}{amountValid ? amt.toFixed(2) : "0.00"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {from && to ? `${accountDisplayName(from)} → ${accountDisplayName(to)}` : ""}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-date">{t("transferDate")}</Label>
                <Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tr-note">{t("transferNote")}</Label>
                <Textarea id="tr-note" rows={2} className="resize-none" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5"><Paperclip className="size-3.5" /> {t("attachments")}</Label>
                  <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={onPickFiles} />
                  <Button size="sm" variant="outline" type="button" onClick={() => fileRef.current?.click()}>{t("addFiles")}</Button>
                </div>
                {pendingFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {pendingFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{file.name}</p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                        </div>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}>
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
              <Button onClick={() => setStep(2)} disabled={!accountsValid || !amountValid}>{t("next")}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={saving}>{t("back")}</Button>
              <Button onClick={submit} disabled={saving}>{saving ? t("transferring") : t("transferNow")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
