import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2 } from "lucide-react"
import { apiPost } from "@/lib/api"
import type { Client, Quotation } from "@/lib/types"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type QuickAddEntity = "client" | "quotation"

const todayStr = () => new Date().toISOString().split("T")[0]

/**
 * A lightweight "quick add" overlay opened by the + FAB from ANY screen, for the
 * simple entities (client / quotation). Transactions use the full shared
 * AddTransactionDialog instead (splits, accounts, attachments, budgets) so the
 * add-transaction experience is identical everywhere. On success it shows a toast
 * with the created item + a "View" deep link; pressing Back after View returns to
 * the page the user was on. Back while the modal is open just closes it (the Dialog
 * wrapper's useModalBackClose).
 */
export function QuickAddModal({ entity, onClose }: { entity: QuickAddEntity | null; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [submitting, setSubmitting] = useState(false)

  // Client form
  const [clientName, setClientName] = useState("")
  const [clientCompany, setClientCompany] = useState("")
  const [clientEmail, setClientEmail] = useState("")

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
    setQTitle(""); setQProspect(""); setQAmount(""); setQDate(todayStr())
  }, [entity])

  const title = useMemo(() => {
    if (entity === "client") return t("actions.addClient")
    if (entity === "quotation") return t("actions.createQuotation")
    return ""
  }, [entity, t])

  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (entity === "client") return clientName.trim().length > 0
    if (entity === "quotation") return qTitle.trim().length > 0 && qProspect.trim().length > 0
    return false
  }, [entity, submitting, clientName, qTitle, qProspect])

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
