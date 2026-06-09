import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowDownRight, ArrowUpRight, Loader as Loader2 } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { accountDisplayName, formatMoney } from "@/lib/wealth"
import { accountTypeAllows, type Client, type Quotation, type Transaction, type WealthAccount } from "@/lib/types"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type QuickAddEntity = "client" | "transaction" | "quotation"

const todayStr = () => new Date().toISOString().split("T")[0]

/**
 * A lightweight "quick add" overlay opened by the + FAB from ANY screen. It hosts
 * minimal create forms for a client / transaction / quotation, so the user creates
 * in place (no navigation away from the current page). On success it shows a toast
 * with the created item + a "View" deep link; pressing Back after View returns to
 * the page the user was on. Back while the modal is open just closes it (the Dialog
 * wrapper's useModalBackClose). Power features (splits, attachments) stay on the
 * full section pages.
 */
export function QuickAddModal({ entity, onClose }: { entity: QuickAddEntity | null; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const accountType = activeOrg?.account_type
  const isBusiness = accountTypeAllows(accountType, "clients")

  const [submitting, setSubmitting] = useState(false)

  // Client form
  const [clientName, setClientName] = useState("")
  const [clientCompany, setClientCompany] = useState("")
  const [clientEmail, setClientEmail] = useState("")

  // Transaction form
  const [txType, setTxType] = useState<"incoming" | "outgoing">("outgoing")
  const [txAmount, setTxAmount] = useState("")
  const [txAccountId, setTxAccountId] = useState("")
  const [txClientId, setTxClientId] = useState("")
  const [txCategory, setTxCategory] = useState("")
  const [txDate, setTxDate] = useState(todayStr)
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [clients, setClients] = useState<Client[]>([])

  // Quotation form
  const [qTitle, setQTitle] = useState("")
  const [qProspect, setQProspect] = useState("")
  const [qAmount, setQAmount] = useState("")
  const [qDate, setQDate] = useState(todayStr)

  // Reset all fields whenever the modal (re)opens for a given entity.
  useEffect(() => {
    if (!entity) return
    setSubmitting(false)
    setClientName(""); setClientCompany(""); setClientEmail("")
    setTxType("outgoing"); setTxAmount(""); setTxCategory(""); setTxDate(todayStr())
    setQTitle(""); setQProspect(""); setQAmount(""); setQDate(todayStr())
  }, [entity])

  // The transaction form needs the org's accounts (+ clients for business). Fetch
  // them lazily when that form opens.
  useEffect(() => {
    if (entity !== "transaction") return
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      try {
        const [accs, cls] = await Promise.all([
          apiGet<WealthAccount[]>("/api/wealth/accounts", token),
          isBusiness ? apiGet<Client[] | { data: Client[] }>("/api/clients", token) : Promise.resolve([]),
        ])
        if (cancelled) return
        const active = (accs || []).filter((a) => !a.archived_at)
        setAccounts(active)
        // Default to the first account (Cash in Hand is provisioned first).
        setTxAccountId((prev) => prev || active[0]?.id || "")
        const clientList = Array.isArray(cls) ? cls : (cls?.data ?? [])
        setClients(clientList)
        // Default to the own/first client so a business user can submit fast.
        setTxClientId((prev) => prev || clientList.find((c) => c.is_own)?.id || clientList[0]?.id || "")
      } catch {
        /* best-effort; the user can still try to submit and see the API error */
      }
    })()
    return () => { cancelled = true }
  }, [entity, isBusiness, getToken])

  const title = useMemo(() => {
    if (entity === "client") return t("actions.addClient")
    if (entity === "transaction") return t("actions.addTransaction")
    if (entity === "quotation") return t("actions.createQuotation")
    return ""
  }, [entity, t])

  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (entity === "client") return clientName.trim().length > 0
    if (entity === "transaction") {
      const amt = Number(txAmount)
      return Number.isFinite(amt) && amt > 0 && !!txAccountId && (!isBusiness || !!txClientId)
    }
    if (entity === "quotation") return qTitle.trim().length > 0 && qProspect.trim().length > 0
    return false
  }, [entity, submitting, clientName, txAmount, txAccountId, txClientId, isBusiness, qTitle, qProspect])

  // Show a success toast with a "View" action that deep-links to the new item, then
  // close. navigate pushes a fresh entry over the origin page, so Back returns here.
  const successToast = (message: string, target: string) => {
    toast.success(message, {
      action: { label: t("quickAdd.viewAction"), onClick: () => navigate(target) },
    })
  }

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) return
      if (entity === "client") {
        const created = await apiPost<Client>("/api/clients", token, {
          name: clientName.trim(),
          company: clientCompany.trim() || undefined,
          email: clientEmail.trim() || undefined,
        })
        successToast(t("quickAdd.clientCreated", { name: created.name }), `/clients/${created.id}`)
      } else if (entity === "transaction") {
        const amt = Number(txAmount)
        const created = await apiPost<Transaction>("/api/transactions", token, {
          client_id: isBusiness ? txClientId : undefined,
          type: txType,
          amount: amt,
          wealth_account_id: txAccountId,
          category: txCategory.trim() || undefined,
          date: txDate || todayStr(),
        })
        const label = txType === "incoming" ? t("transactions.income") : t("transactions.expense")
        successToast(
          t("quickAdd.transactionCreated", { label, amount: formatMoney(amt, currency) }),
          `/transactions?view=${created.id}`,
        )
      } else if (entity === "quotation") {
        const created = await apiPost<Quotation>("/api/quotations", token, {
          title: qTitle.trim(),
          prospect_name: qProspect.trim(),
          amount: qAmount ? Number(qAmount) : undefined,
          date: qDate || todayStr(),
        })
        successToast(t("quickAdd.quotationCreated", { title: created.title }), "/quotations")
      }
      onClose()
    } catch (err) {
      // Keep the modal open with the typed data so the user can fix + retry.
      toast.error(err instanceof Error ? err.message : "Failed to create")
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={entity !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {entity === "client" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qa-client-name">{t("clients.nameField")}</Label>
              <Input id="qa-client-name" value={clientName} autoFocus
                onChange={(e) => setClientName(e.target.value)} placeholder={t("clients.namePlaceholder")} className="h-11" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="qa-client-company">{t("clients.companyField")}</Label>
                <Input id="qa-client-company" value={clientCompany}
                  onChange={(e) => setClientCompany(e.target.value)} className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-client-email">{t("clients.emailField")}</Label>
                <Input id="qa-client-email" type="email" value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)} className="h-11" />
              </div>
            </div>
          </div>
        )}

        {entity === "transaction" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["incoming", "outgoing"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTxType(type)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                    txType === type
                      ? type === "incoming"
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  {type === "incoming" ? t("transactions.income") : t("transactions.expense")}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="qa-tx-amount">{t("transactions.amount")}</Label>
                <Input id="qa-tx-amount" inputMode="decimal" value={txAmount} autoFocus
                  onChange={(e) => setTxAmount(e.target.value)} placeholder="0.00" className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-tx-date">{t("transactions.date")}</Label>
                <Input id="qa-tx-date" type="date" value={txDate}
                  onChange={(e) => setTxDate(e.target.value)} className="h-11" />
              </div>
            </div>
            {isBusiness && (
              <div className="space-y-1.5">
                <Label>{t("transactions.client")}</Label>
                <Select value={txClientId} onValueChange={setTxClientId}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("transactions.account")}</Label>
              <Select value={txAccountId} onValueChange={setTxAccountId}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {accountDisplayName(a)} · {formatMoney(a.current_balance, currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-tx-category">{t("transactions.category")}</Label>
              <Input id="qa-tx-category" value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)} className="h-11" />
            </div>
          </div>
        )}

        {entity === "quotation" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qa-q-title">{t("quotations.titleLabel")}</Label>
              <Input id="qa-q-title" value={qTitle} autoFocus
                onChange={(e) => setQTitle(e.target.value)} placeholder={t("quotations.titlePlaceholder")} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-q-prospect">{t("quotations.prospectNameLabel")}</Label>
              <Input id="qa-q-prospect" value={qProspect}
                onChange={(e) => setQProspect(e.target.value)} placeholder={t("quotations.prospectNamePlaceholder")} className="h-11" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="qa-q-amount">{t("quotations.amountLabel")}</Label>
                <Input id="qa-q-amount" inputMode="decimal" value={qAmount}
                  onChange={(e) => setQAmount(e.target.value)} placeholder="0.00" className="h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-q-date">{t("quotations.dateLabel")}</Label>
                <Input id="qa-q-date" type="date" value={qDate}
                  onChange={(e) => setQDate(e.target.value)} className="h-11" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default QuickAddModal
