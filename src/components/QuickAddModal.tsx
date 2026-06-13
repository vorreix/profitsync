import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ChevronDown, Loader as Loader2 } from "lucide-react"
import { apiPost } from "@/lib/api"
import type { Client, Quotation } from "@/lib/types"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useModalDraft } from "@/hooks/use-modal-draft"

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
 *
 * Each form starts minimal (just the essentials) but a collapsible "Advanced"
 * section reveals every field the full create form has — so power users never have
 * to leave the overlay, while the common path stays a two-field affair.
 */
export function QuickAddModal({ entity, onClose }: { entity: QuickAddEntity | null; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [submitting, setSubmitting] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Client form
  const [clientName, setClientName] = useState("")
  const [clientCompany, setClientCompany] = useState("")
  const [clientEmail, setClientEmail] = useState("")
  const [clientPhone, setClientPhone] = useState("")
  const [clientStatus, setClientStatus] = useState<"active" | "inactive">("active")
  const [clientOnboard, setClientOnboard] = useState(todayStr)
  const [clientCategory, setClientCategory] = useState("")
  const [clientNotes, setClientNotes] = useState("")

  // Quotation form
  const [qTitle, setQTitle] = useState("")
  const [qProspect, setQProspect] = useState("")
  const [qAmount, setQAmount] = useState("")
  const [qDate, setQDate] = useState(todayStr)
  const [qCompany, setQCompany] = useState("")
  const [qEmail, setQEmail] = useState("")
  const [qPhone, setQPhone] = useState("")
  const [qStatus, setQStatus] = useState<"draft" | "sent" | "accepted" | "rejected">("draft")
  const [qCategory, setQCategory] = useState("")
  const [qNotes, setQNotes] = useState("")

  // A draft worth keeping: anything the user typed into the active entity's form.
  const dirty =
    entity === "client"
      ? !!(clientName || clientCompany || clientEmail || clientPhone || clientCategory || clientNotes)
      : entity === "quotation"
        ? !!(qTitle || qProspect || qAmount || qCompany || qEmail || qPhone || qCategory || qNotes)
        : false
  const draft = useModalDraft({ open: entity !== null, dirty, contextKey: entity ?? "" })

  // Seed a fresh form when opening — UNLESS a dismissed draft for this entity is
  // being restored (outside-click/Esc/Back keep it; Cancel/success clear it).
  useEffect(() => {
    if (!entity) return
    setSubmitting(false)
    if (!draft.shouldSeed(entity)) return
    setAdvancedOpen(false)
    setClientName(""); setClientCompany(""); setClientEmail("")
    setClientPhone(""); setClientStatus("active"); setClientOnboard(todayStr()); setClientCategory(""); setClientNotes("")
    setQTitle(""); setQProspect(""); setQAmount(""); setQDate(todayStr())
    setQCompany(""); setQEmail(""); setQPhone(""); setQStatus("draft"); setQCategory(""); setQNotes("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          phone: clientPhone.trim() || undefined,
          status: clientStatus,
          notes: clientNotes.trim() || undefined,
          category: clientCategory.trim() || undefined,
          onboard_date: clientOnboard || undefined,
        })
        successToast(t("quickAdd.clientCreated", { name: created.name }), `/clients/${created.id}`)
      } else if (entity === "quotation") {
        const created = await apiPost<Quotation>("/api/quotations", token, {
          title: qTitle.trim(),
          prospect_name: qProspect.trim(),
          amount: qAmount ? Number(qAmount) : undefined,
          date: qDate || todayStr(),
          company: qCompany.trim() || undefined,
          email: qEmail.trim() || undefined,
          phone: qPhone.trim() || undefined,
          status: qStatus,
          notes: qNotes.trim() || undefined,
          category: qCategory.trim() || undefined,
        })
        successToast(t("quickAdd.quotationCreated", { title: created.title }), `/quotations?view=${created.id}`)
      }
      draft.clearDraft()
      onClose()
    } catch (err) {
      // Keep the modal open with the typed data so the user can fix + retry.
      toast.error(err instanceof Error ? err.message : "Failed to create")
      setSubmitting(false)
    }
  }

  // The expand/collapse uses the grid 0fr→1fr trick (animates on the compositor, no
  // reflow) with an inner overflow-hidden; reduced-motion users get an instant snap.
  const advancedSection = (children: React.ReactNode) => (
    <>
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-expanded={advancedOpen}
        className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={`size-4 transition-transform duration-200 motion-reduce:transition-none ${advancedOpen ? "rotate-180" : ""}`} />
        {t("quickAdd.advanced")}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: advancedOpen ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 pt-1">{children}</div>
        </div>
      </div>
    </>
  )

  return (
    <Dialog open={entity !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[90svh] w-[92vw] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-thin px-6 py-4">
        {entity === "client" && (
          <>
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
            {advancedSection(
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-client-phone">{t("clients.phoneField")}</Label>
                    <Input id="qa-client-phone" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("clients.statusField")}</Label>
                    <Select value={clientStatus} onValueChange={(v) => setClientStatus(v as "active" | "inactive")}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">{t("clients.statusActive")}</SelectItem>
                        <SelectItem value="inactive">{t("clients.statusInactive")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-client-onboard">{t("clients.onboardDateField")}</Label>
                    <Input id="qa-client-onboard" type="date" value={clientOnboard} onChange={(e) => setClientOnboard(e.target.value)} className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-client-category">{t("filters.category")}</Label>
                    <Input id="qa-client-category" value={clientCategory} onChange={(e) => setClientCategory(e.target.value)} className="h-11" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qa-client-notes">{t("clients.notesField")}</Label>
                  <Textarea id="qa-client-notes" rows={2} className="resize-none" value={clientNotes} onChange={(e) => setClientNotes(e.target.value)} placeholder={t("clients.notesPlaceholder")} />
                </div>
              </>,
            )}
          </>
        )}

        {entity === "quotation" && (
          <>
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
            {advancedSection(
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-q-company">{t("quotations.companyLabel")}</Label>
                    <Input id="qa-q-company" value={qCompany} onChange={(e) => setQCompany(e.target.value)} className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-q-email">{t("quotations.emailLabel")}</Label>
                    <Input id="qa-q-email" type="email" value={qEmail} onChange={(e) => setQEmail(e.target.value)} className="h-11" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="qa-q-phone">{t("quotations.phoneLabel")}</Label>
                    <Input id="qa-q-phone" value={qPhone} onChange={(e) => setQPhone(e.target.value)} className="h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("quotations.statusLabel")}</Label>
                    <Select value={qStatus} onValueChange={(v) => setQStatus(v as typeof qStatus)}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">{t("quotations.statusDraft")}</SelectItem>
                        <SelectItem value="sent">{t("quotations.statusSent")}</SelectItem>
                        <SelectItem value="accepted">{t("quotations.statusAccepted")}</SelectItem>
                        <SelectItem value="rejected">{t("quotations.statusRejected")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qa-q-category">{t("filters.category")}</Label>
                  <Input id="qa-q-category" value={qCategory} onChange={(e) => setQCategory(e.target.value)} className="h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qa-q-notes">{t("quotations.notesLabel")}</Label>
                  <Textarea id="qa-q-notes" rows={2} className="resize-none" value={qNotes} onChange={(e) => setQNotes(e.target.value)} />
                </div>
              </>,
            )}
          </>
        )}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
          <Button variant="outline" onClick={() => { draft.clearDraft(); onClose() }} disabled={submitting}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default QuickAddModal
