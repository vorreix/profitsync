import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Check, Loader as Loader2, Pencil, Quote } from "lucide-react"
import { apiErrorMessage, apiGet, apiPost } from "@/lib/api"
import type { AiAssistantResponse } from "@/lib/ai-parse"
import type { Client, WealthAccount } from "@/lib/types"
import { useOrg } from "@/lib/org-context"
import { useCategories } from "@/lib/use-categories"
import { accountCurrency, accountDisplayName, formatMoney, formatRate } from "@/lib/wealth"
import { getCurrencySymbol } from "@/lib/currencies"
import { ledgerAmountProblem } from "@/lib/money"
import { isLiabilityType } from "@/lib/credit-card"
import { defaultAccountId } from "@/components/transactions/tx-form-utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const today = () => new Date().toISOString().split("T")[0]

// Below this the AI is unsure of the figure: the amount stays editable (the
// full dialog's "high" line, AddTransactionDialog HIGH).
const SURE = 0.85

// Module level, not inside the card: a component declared in render is a new
// type every render, so React remounted the amount input on each keystroke.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-end text-sm font-medium">{children}</div>
    </div>
  )
}

/** An amount box prefixed with the symbol of the currency it is SAVED in. */
function MoneyInput({ currency, value, onChange, label, id }: {
  currency: string
  value: string
  onChange: (v: string) => void
  label: string
  id?: string
}) {
  return (
    <InputGroup className="h-11 w-36">
      <InputGroupAddon>
        <InputGroupText>{getCurrencySymbol(currency)}</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput
        id={id} type="number" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full text-end text-base md:text-sm"
        onFocus={(e) => e.target.scrollIntoView({ block: "center", behavior: "smooth" })}
        aria-label={label}
      />
    </InputGroup>
  )
}

/**
 * The assistant's review card: shows WHAT will be created ("Creating outgoing
 * transaction of €20.00"), the transcript ("You said …"), and the resolved
 * fields — with inline pickers ONLY for what's missing (client on business
 * orgs, amount) and optional one-tap category chips. Save creates the record
 * directly; Edit hands off to the full prefilled dialog; nothing is written
 * until the user chooses.
 */
export function AiAssistantConfirm({ response, currency, onSaved, onEdit, onCancel }: {
  response: AiAssistantResponse
  currency: string
  onSaved: () => void
  onEdit: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  const { byType: categoriesByType } = useCategories()
  const [saving, setSaving] = useState(false)
  // Move focus to the card when it appears so screen readers announce the
  // listening→review transition.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { rootRef.current?.focus() }, [])

  const tx = response.intent === "add_transaction" ? response.transaction : null
  const client = response.intent === "add_client" ? response.client : null
  const quotation = response.intent === "add_quotation" ? response.quotation : null

  // ── Editable gaps (only what the AI couldn't resolve) ─────────────────────
  // The figure the AI heard, and the currency the user SAID it in (null = none).
  const heard = tx?.fields.amount ?? quotation?.amount ?? null
  const heardCurrency = tx?.fields.currency ?? null
  // What the user typed over it (null = untouched), and the other side of a
  // cross-currency transfer, which nobody said.
  const [typedAmount, setTypedAmount] = useState<string | null>(null)
  const [otherAmount, setOtherAmount] = useState("")
  const [clientId, setClientId] = useState(tx?.fields.client_id ?? "")
  // Transfers / card payments: source + destination are editable gaps too.
  const isTransfer = tx?.fields.kind === "transfer"
  const isRefund = tx?.fields.kind === "refund"
  const [fromId, setFromId] = useState(tx?.fields.account_id ?? "")
  // Expense/income: the account the AI resolved (else the default, below).
  const [accountId, setAccountId] = useState(tx?.fields.account_id ?? "")
  const [toId, setToId] = useState(tx?.fields.to_account_id ?? "")
  const [category, setCategory] = useState(tx?.fields.category ?? "")
  const [prospect, setProspect] = useState(quotation?.prospect_name ?? "")

  // Org data needed to render/save — fetched lazily, cached by apiGet.
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [clients, setClients] = useState<Client[]>([])
  // Until the accounts arrive no currency is known — show no figure in a guessed one.
  const [loaded, setLoaded] = useState(false)
  // Save waits for the accounts; a failed load says so (with a retry) instead
  // of leaving a disabled button and a "…" headline with no reason.
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => {
    if (!tx) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) throw new Error("auth")
        const [accs, cls] = await Promise.all([
          apiGet<WealthAccount[]>("/api/wealth/accounts", token),
          !isPersonal
            ? apiGet<Client[] | { data: Client[] }>("/api/clients", token)
            : Promise.resolve([] as Client[]),
        ])
        if (cancelled) return
        setAccounts(accs.filter((a) => !a.archived_at))
        setClients(Array.isArray(cls) ? cls : (cls?.data ?? []))
        setLoaded(true)
      } catch {
        if (!cancelled) setLoadFailed(true)
      }
    })()
    return () => { cancelled = true }
  }, [getToken, tx, isPersonal, loadAttempt])

  const account = useMemo(() => {
    if (!tx) return null
    return accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.id === defaultAccountId(accounts)) ?? null
  }, [tx, accounts, accountId])
  const multiCurrency = new Set(accounts.map((a) => accountCurrency(a, currency))).size > 1
  // Same-name accounts in different currencies must be told apart in a picker.
  const optionLabel = (a: WealthAccount) => multiCurrency ? `${accountDisplayName(a)} · ${accountCurrency(a, currency)}` : accountDisplayName(a)
  // The AI resolved no account: with several currencies the default wallet may
  // not be the one meant, so the row becomes a picker (a single-currency
  // workspace keeps its read-only row, as before).
  const pickAccount = Boolean(tx && !isTransfer && multiCurrency && !accounts.some((a) => a.id === tx.fields.account_id))
  // A card is paid FROM money you hold; you can transfer TO anything but the source.
  const sources = accounts.filter((a) => !isLiabilityType(a.type) && a.type !== "space")
  const fromAccount = accounts.find((a) => a.id === fromId) ?? null
  const toAccount = accounts.find((a) => a.id === toId) ?? null
  const needsFrom = Boolean(isTransfer && !fromAccount)
  const needsTo = Boolean(isTransfer && (!toAccount || toId === fromId))
  const cardPayment = Boolean(isTransfer && toAccount && isLiabilityType(toAccount.type))

  // ── Currencies: every amount is saved in its account's currency ───────────
  const fromCurrency = accountCurrency(fromAccount, currency)
  const toCurrency = accountCurrency(toAccount, currency)
  // Money between currencies needs BOTH figures — what leaves and what arrives;
  // the server can't invent a rate and refuses one alone (MC-105).
  const crossCurrency = Boolean(isTransfer && fromAccount && toAccount && fromCurrency !== toCurrency)
  // The heard figure is what ARRIVES when it was said (or a statement filled
  // it) in the destination's currency and not the source's; otherwise what
  // leaves — or, while no source is picked yet, the destination's.
  const arrives = Boolean(toAccount && heardCurrency === toCurrency && !(fromAccount && fromCurrency === heardCurrency))
  const heardArrives = crossCurrency && arrives
  // The account (and so the currency) the heard figure is saved in.
  const amountAccount = isTransfer ? (arrives || !fromAccount ? toAccount : fromAccount) : account
  const amountCurrency = quotation ? (quotation.currency ?? currency) : accountCurrency(amountAccount, currency)
  // "20 dollars" into a EUR account must never save as €20 (MC-029/030): the
  // figure is dropped and the user types it in the account's currency.
  const ready = !tx || loaded
  const currencyMismatch = Boolean(tx && ready && heardCurrency && heardCurrency !== amountCurrency)
  const amount = typedAmount ?? (heard != null && !currencyMismatch ? String(heard) : "")
  const sourceAmount = heardArrives ? otherAmount : amount
  const destinationAmount = heardArrives ? amount : otherAmount
  const setSourceAmount = heardArrives ? setOtherAmount : setTypedAmount
  const setDestinationAmount = heardArrives ? setTypedAmount : setOtherAmount
  // An unsure figure stays editable instead of saving with one tap (MC-106).
  const amountUnsure = Boolean(tx && tx.confidence.amount < SURE)
  // A typed figure belongs to the currency it was typed in: changing an
  // account drops it (the heard one re-applies only where its currency fits),
  // so 46 typed into a € box never posts as $46 after a USD source is picked.
  const resetTyped = () => { setTypedAmount(null); setOtherAmount("") }

  const matchedClient = clients.find((c) => c.id === clientId) ?? null
  // A refund reverses an EXPENSE, so it offers the expense categories; a transfer has none.
  const catChips = tx && !isTransfer
    ? (tx.fields.type === "incoming" && !isRefund ? categoriesByType.incoming : categoriesByType.outgoing).slice(0, 6)
    : []

  const needsClient = Boolean(tx && !isPersonal && !isTransfer && !clientId)
  const needsAmount = Boolean((tx || quotation) && (!(Number(amount) > 0) || (crossCurrency && !(Number(otherAmount) > 0))))
  // Once shown, the box stays while the user types (it used to vanish after the
  // first digit) and across an account change that resets what was typed.
  const editableNow = needsAmount || amountUnsure || currencyMismatch || typedAmount !== null
  const [amountOpened, setAmountOpened] = useState(false)
  if (editableNow && !amountOpened) setAmountOpened(true)
  const amountEditable = editableNow || amountOpened
  const needsProspect = Boolean(quotation && !prospect.trim())
  // Asked once, kept while typing (same as the amount box).
  const prospectAsked = Boolean(quotation && !quotation.prospect_name?.trim())
  // The account the money posts to must be loaded — its currency decides what is saved.
  const needsAccount = Boolean(tx && !isTransfer && !account)
  const canSave = !saving && !needsClient && !needsAmount && !needsProspect && !needsFrom && !needsTo && !needsAccount && response.intent !== "unknown"
  const money = ready && Number(amount) > 0 ? formatMoney(Number(amount), amountCurrency) : "…"
  const heardText = heard != null && heardCurrency ? formatMoney(heard, heardCurrency) : ""

  const headline = (() => {
    if (tx) {
      if (isTransfer) {
        return t(cardPayment ? "aiVoice.confirm.cardPayment" : "aiVoice.confirm.transfer", {
          amount: money,
          from: fromAccount ? accountDisplayName(fromAccount) : "…",
          to: toAccount ? accountDisplayName(toAccount) : "…",
        })
      }
      if (isRefund) return t("aiVoice.confirm.refund", { amount: money })
      return t("aiVoice.confirm.transaction", {
        type: t(`transactions:${tx.fields.type}`),
        amount: money,
      })
    }
    if (client) return t("aiVoice.confirm.client", { name: client.name })
    if (quotation) return t("aiVoice.confirm.quotation", { title: quotation.title })
    return response.say ?? t("aiVoice.cantHelp")
  })()

  async function save() {
    if (!canSave) return
    // The server's own amount rules, said before the round trip.
    const problem = tx ? (ledgerAmountProblem(amount) ?? (crossCurrency ? ledgerAmountProblem(otherAmount) : null)) : null
    if (problem) { toast.error(t(`apiErrors.${problem}`)); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      if (tx && isTransfer) {
        // A card payment / transfer is recorded through the transfer endpoint —
        // two legs, never an expense (src/lib/credit-card.ts). Same currency
        // keeps the historical body; across currencies both native sides go,
        // so the server records the real rate.
        await apiPost("/api/wealth/transfer", token, {
          from_account_id: fromId,
          to_account_id: toId,
          ...(crossCurrency
            ? { source_amount: Number(sourceAmount), destination_amount: Number(destinationAmount), source_currency: fromCurrency, destination_currency: toCurrency }
            : { amount: Number(amount) }),
          date: tx.fields.date ?? today(),
          note: tx.fields.description ?? "",
        })
        toast.success(t(cardPayment ? "aiVoice.savedCardPayment" : "aiVoice.savedTransfer", { amount: money }))
      } else if (tx) {
        await apiPost("/api/transactions/group", token, {
          client_id: clientId,
          type: tx.fields.type,
          kind: isRefund ? "refund" : "standard",
          description: tx.fields.description ?? "",
          category,
          tags: [],
          date: tx.fields.date ?? today(),
          allocations: [{ wealth_account_id: account?.id ?? defaultAccountId(accounts), amount: Number(amount) }],
        })
        toast.success(t("aiVoice.savedTransaction", { amount: money }))
      } else if (client) {
        const created = await apiPost<Client>("/api/clients", token, {
          name: client.name,
          company: client.company ?? undefined,
          email: client.email ?? undefined,
          phone: client.phone ?? undefined,
          status: "active",
          notes: client.notes ?? undefined,
          onboard_date: today(),
        })
        toast.success(t("quickAdd.clientCreated", { name: created.name }))
      } else if (quotation) {
        const created = await apiPost<{ title: string }>("/api/quotations", token, {
          title: quotation.title,
          prospect_name: prospect.trim(),
          amount: Number(amount) > 0 ? Number(amount) : undefined,
          // The currency the quote was asked in; omitted = the workspace's.
          currency_code: quotation.currency ?? undefined,
          date: quotation.date ?? today(),
          status: "draft",
        })
        toast.success(t("quickAdd.quotationCreated", { title: created.title }))
      }
      onSaved()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("aiVoice.failed")))
      setSaving(false)
    }
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="flex w-full max-w-sm flex-col gap-4 outline-none animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      <p className="text-center text-base font-semibold">{headline}</p>

      {response.transcript && (
        <p className="mx-auto flex max-w-[22rem] items-start gap-1.5 text-center text-xs text-muted-foreground">
          <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="line-clamp-2">{response.transcript}</span>
        </p>
      )}

      {(tx || client || quotation) && (
        <div className="space-y-1 rounded-xl border bg-background/60 p-4">
          {tx && (
            <>
              {isTransfer && (
                <>
                  <Row label={t("aiVoice.field.from")}>
                    {fromAccount && !needsFrom ? (
                      <span className="truncate">{accountDisplayName(fromAccount)}</span>
                    ) : (
                      <Select value={fromId} onValueChange={(v) => { setFromId(v); resetTyped() }}>
                        <SelectTrigger className="h-11 w-44" aria-label={t("aiVoice.whichAccount")}>
                          <SelectValue placeholder={t("aiVoice.whichAccount")} />
                        </SelectTrigger>
                        <SelectContent>
                          {sources.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{optionLabel(a)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Row>
                  <Row label={t("aiVoice.field.to")}>
                    {toAccount && !needsTo ? (
                      <span className="truncate">{accountDisplayName(toAccount)}</span>
                    ) : (
                      <Select value={toId} onValueChange={(v) => { setToId(v); resetTyped() }}>
                        <SelectTrigger className="h-11 w-44" aria-label={t("aiVoice.whichAccount")}>
                          <SelectValue placeholder={t("aiVoice.whichAccount")} />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.filter((a) => a.id !== fromId && a.type !== "space").map((a) => (
                            <SelectItem key={a.id} value={a.id}>{optionLabel(a)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Row>
                </>
              )}
              {!isPersonal && !isTransfer && (
                <Row label={t("transactions:client")}>
                  {matchedClient && !needsClient ? (
                    <span className="truncate">{matchedClient.name}</span>
                  ) : (
                    <Select value={clientId} onValueChange={setClientId}>
                      <SelectTrigger className="h-11 w-44" aria-label={t("aiVoice.whichClient")}>
                        <SelectValue placeholder={t("aiVoice.whichClient")} />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Row>
              )}
              {crossCurrency && fromAccount && toAccount ? (
                // Two currencies: what leaves and what arrives, stacked so the
                // long labels never squeeze the boxes on a phone.
                <div className="space-y-2 py-1">
                  {[
                    { id: "ai-src", label: t("spaces:amountLeaving", { account: accountDisplayName(fromAccount), currency: fromCurrency }), cur: fromCurrency, value: sourceAmount, set: setSourceAmount },
                    { id: "ai-dst", label: t("spaces:amountReceived", { account: accountDisplayName(toAccount), currency: toCurrency }), cur: toCurrency, value: destinationAmount, set: setDestinationAmount },
                  ].map((f) => (
                    <div key={f.id} className="flex flex-col items-end gap-1">
                      <label htmlFor={f.id} className="self-start text-xs text-muted-foreground">{f.label}</label>
                      <MoneyInput id={f.id} currency={f.cur} value={f.value} onChange={f.set} label={f.label} />
                    </div>
                  ))}
                  {Number(sourceAmount) > 0 && Number(destinationAmount) > 0 && (
                    <p className="text-end text-xs text-muted-foreground tabular-nums">{formatRate(fromCurrency, toCurrency, Number(destinationAmount) / Number(sourceAmount))}</p>
                  )}
                </div>
              ) : (
                <Row label={t("transactions:amount")}>
                  {amountEditable ? (
                    <MoneyInput currency={amountCurrency} value={amount} onChange={setTypedAmount} label={t("transactions:amount")} />
                  ) : (
                    <span>{money}</span>
                  )}
                </Row>
              )}
              {currencyMismatch && heardText ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {crossCurrency
                    ? t("aiVoice.currencyHeardTransfer", { amount: heardText })
                    : t("aiVoice.currencyHeard", {
                        amount: heardText,
                        account: amountAccount ? accountDisplayName(amountAccount) : "…",
                        currency: amountCurrency,
                      })}
                </p>
              ) : tx.fields.amount_source === "statement" ? (
                <p className="text-end text-[11px] text-amber-600 dark:text-amber-400">{t("aiVoice.fromStatement")}</p>
              ) : amountUnsure && typedAmount === null && heard != null ? (
                <p className="text-end text-[11px] text-amber-600 dark:text-amber-400">{t("transactions:ai.checkField")}</p>
              ) : null}
              {pickAccount ? (
                <Row label={t("transactions:account")}>
                  <Select value={account?.id ?? ""} onValueChange={(v) => { setAccountId(v); resetTyped() }}>
                    <SelectTrigger className="h-11 w-44" aria-label={t("aiVoice.whichAccount")}>
                      <SelectValue placeholder={t("aiVoice.whichAccount")} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.filter((a) => a.type !== "space").map((a) => (
                        <SelectItem key={a.id} value={a.id}>{optionLabel(a)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Row>
              ) : account && !isTransfer && <Row label={t("transactions:account")}>{accountDisplayName(account)}</Row>}
              <Row label={t("transactions:date")}>{tx.fields.date ?? today()}</Row>
              {tx.fields.description && <Row label={t("transactions:description")}><span className="truncate">{tx.fields.description}</span></Row>}
              {catChips.length > 0 && (
                <div className="space-y-1.5 pt-1.5">
                  <p className="text-xs text-muted-foreground">{t("aiVoice.addCategory")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {catChips.map((c) => (
                      <button
                        key={c} type="button"
                        onClick={() => setCategory((prev) => (prev === c ? "" : c))}
                        className={`h-11 rounded-full border px-4 text-xs font-medium transition-colors ${
                          category === c ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {client && (
            <>
              <Row label={t("aiVoice.field.name")}>{client.name}</Row>
              {client.company && <Row label={t("aiVoice.field.company")}>{client.company}</Row>}
              {client.email && <Row label="Email"><span className="truncate">{client.email}</span></Row>}
              {client.phone && <Row label={t("aiVoice.field.phone")}>{client.phone}</Row>}
            </>
          )}
          {quotation && (
            <>
              <Row label={t("aiVoice.field.title")}><span className="truncate">{quotation.title}</span></Row>
              <Row label={t("aiVoice.field.prospect")}>
                {prospectAsked ? (
                  <Input
                    value={prospect} onChange={(e) => setProspect(e.target.value)}
                    className="h-11 w-44 text-end text-base md:text-sm"
                    onFocus={(e) => e.target.scrollIntoView({ block: "center", behavior: "smooth" })}
                    aria-label={t("aiVoice.whichProspect")}
                    placeholder={t("aiVoice.whichProspect")}
                  />
                ) : (
                  <span className="truncate">{prospect}</span>
                )}
              </Row>
              {amountEditable ? (
                <Row label={t("transactions:amount")}>
                  <MoneyInput currency={amountCurrency} value={amount} onChange={setTypedAmount} label={t("transactions:amount")} />
                </Row>
              ) : (
                Number(amount) > 0 && <Row label={t("transactions:amount")}>{formatMoney(Number(amount), amountCurrency)}</Row>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {loadFailed && (
          <div role="alert" className="flex items-center justify-center gap-2 text-xs text-destructive">
            <span>{t("aiVoice.failed")}</span>
            <Button
              variant="outline" size="sm" className="h-11 px-4"
              onClick={() => { setLoadFailed(false); setLoadAttempt((n) => n + 1) }}
            >
              {t("aiVoice.tryAgain")}
            </Button>
          </div>
        )}
        <Button className="h-12 w-full" disabled={!canSave} onClick={() => void save()}>
          {saving ? <Loader2 className="me-2 size-4 animate-spin motion-reduce:animate-none" /> : <Check className="me-2 size-4" />}
          {t("aiVoice.save")}
        </Button>
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" className="h-11 px-4 text-muted-foreground" onClick={onEdit} disabled={saving}>
            <Pencil className="me-1.5 size-3.5" /> {t("aiVoice.editDetails")}
          </Button>
          <Button variant="ghost" size="sm" className="h-11 px-4 text-muted-foreground" onClick={onCancel} disabled={saving}>
            {t("transactions:cancel")}
          </Button>
        </div>
      </div>
    </div>
  )
}
