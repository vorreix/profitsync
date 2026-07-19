import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Check, Loader as Loader2, Pencil, Quote } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import type { AiAssistantResponse } from "@/lib/ai-parse"
import type { Client, WealthAccount } from "@/lib/types"
import { useOrg } from "@/lib/org-context"
import { useCategories } from "@/lib/use-categories"
import { accountDisplayName, formatMoney } from "@/lib/wealth"
import { defaultAccountId } from "@/components/transactions/tx-form-utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const today = () => new Date().toISOString().split("T")[0]

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
  const [amount, setAmount] = useState(() => tx?.fields.amount != null ? String(tx.fields.amount) : (quotation?.amount != null ? String(quotation.amount) : ""))
  const [clientId, setClientId] = useState(tx?.fields.client_id ?? "")
  const [category, setCategory] = useState(tx?.fields.category ?? "")
  const [prospect, setProspect] = useState(quotation?.prospect_name ?? "")

  // Org data needed to render/save — fetched lazily, cached by apiGet.
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [clients, setClients] = useState<Client[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token || !tx) return
      const [accs, cls] = await Promise.all([
        apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[]),
        !isPersonal
          ? apiGet<Client[] | { data: Client[] }>("/api/clients", token).catch(() => [] as Client[])
          : Promise.resolve([] as Client[]),
      ])
      if (cancelled) return
      setAccounts((accs as WealthAccount[]).filter((a) => !a.archived_at))
      setClients(Array.isArray(cls) ? cls : (cls?.data ?? []))
    })()
    return () => { cancelled = true }
  }, [getToken, tx, isPersonal])

  const account = useMemo(() => {
    if (!tx) return null
    const matched = tx.fields.account_id ? accounts.find((a) => a.id === tx.fields.account_id) : null
    return matched ?? accounts.find((a) => a.id === defaultAccountId(accounts)) ?? null
  }, [tx, accounts])

  const matchedClient = clients.find((c) => c.id === clientId) ?? null
  const catChips = tx ? (tx.fields.type === "incoming" ? categoriesByType.incoming : categoriesByType.outgoing).slice(0, 6) : []

  const needsClient = Boolean(tx && !isPersonal && !clientId)
  const needsAmount = Boolean((tx || quotation) && !(Number(amount) > 0))
  const needsProspect = Boolean(quotation && !prospect.trim())
  const canSave = !saving && !needsClient && !needsAmount && !needsProspect && response.intent !== "unknown"

  const headline = (() => {
    if (tx) {
      return t("aiVoice.confirm.transaction", {
        type: t(`transactions:${tx.fields.type}`),
        amount: Number(amount) > 0 ? formatMoney(Number(amount), currency) : "…",
      })
    }
    if (client) return t("aiVoice.confirm.client", { name: client.name })
    if (quotation) return t("aiVoice.confirm.quotation", { title: quotation.title })
    return response.say ?? t("aiVoice.cantHelp")
  })()

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      if (tx) {
        await apiPost("/api/transactions/group", token, {
          client_id: clientId,
          type: tx.fields.type,
          description: tx.fields.description ?? "",
          category,
          tags: [],
          date: tx.fields.date ?? today(),
          allocations: [{ wealth_account_id: account?.id ?? defaultAccountId(accounts), amount: Number(amount) }],
        })
        toast.success(t("aiVoice.savedTransaction", { amount: formatMoney(Number(amount), currency) }))
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
          date: quotation.date ?? today(),
          status: "draft",
        })
        toast.success(t("quickAdd.quotationCreated", { title: created.title }))
      }
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error && err.message && !err.message.startsWith("{") ? err.message : t("aiVoice.failed"))
      setSaving(false)
    }
  }

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-end text-sm font-medium">{children}</div>
    </div>
  )

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
              {!isPersonal && (
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
              {needsAmount ? (
                <Row label={t("transactions:amount")}>
                  <Input
                    type="number" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-11 w-28 text-end text-base md:text-sm"
                    onFocus={(e) => e.target.scrollIntoView({ block: "center", behavior: "smooth" })}
                    aria-label={t("transactions:amount")}
                  />
                </Row>
              ) : (
                <Row label={t("transactions:amount")}>{formatMoney(Number(amount), currency)}</Row>
              )}
              {account && <Row label={t("transactions:account")}>{accountDisplayName(account)}</Row>}
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
                {needsProspect ? (
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
              {needsAmount ? (
                <Row label={t("transactions:amount")}>
                  <Input
                    type="number" inputMode="decimal" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-11 w-28 text-end text-base md:text-sm"
                    onFocus={(e) => e.target.scrollIntoView({ block: "center", behavior: "smooth" })}
                    aria-label={t("transactions:amount")}
                  />
                </Row>
              ) : (
                Number(amount) > 0 && <Row label={t("transactions:amount")}>{formatMoney(Number(amount), currency)}</Row>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
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
