import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Quotation, QuotationAttachment } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole } from "@/lib/roles"
import { useMultiSelect } from "@/lib/use-multi-select"
import { useLongPress } from "@/lib/use-long-press"
import { BulkActionBar } from "@/components/BulkActionBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "sonner"
import { Plus, FileText, Building2, Mail, Phone, UserPlus, Trash2, Pencil, ExternalLink, Calendar, Paperclip, Download, X, CheckSquare, ChevronDown, Archive, ArchiveRestore } from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { AttachmentBadge } from "@/components/AttachmentBadge"

type QuotationForm = {
  title: string
  prospect_name: string
  company: string
  email: string
  phone: string
  amount: string
  status: "draft" | "sent" | "accepted" | "rejected"
  notes: string
}

const defaultForm = (): QuotationForm => ({
  title: "",
  prospect_name: "",
  company: "",
  email: "",
  phone: "",
  amount: "",
  status: "draft",
  notes: "",
})

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

const ALL_STATUSES = ["draft", "sent", "accepted", "rejected"] as const

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function QuotationFormFields({
  f,
  onChange,
}: {
  f: QuotationForm
  onChange: (p: Partial<QuotationForm>) => void
}) {
  const { t } = useTranslation("quotations")
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label>{t("titleLabel")}</Label>
        <Input placeholder={t("titlePlaceholder")} value={f.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>{t("prospectNameLabel")}</Label>
        <Input placeholder={t("prospectNamePlaceholder")} value={f.prospect_name} onChange={(e) => onChange({ prospect_name: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("companyLabel")}</Label>
          <Input placeholder={t("companyPlaceholder")} value={f.company} onChange={(e) => onChange({ company: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("amountLabel")}</Label>
          <Input type="number" min="0" step="0.01" placeholder={t("amountPlaceholder")} value={f.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("emailLabel")}</Label>
          <Input type="email" placeholder={t("emailPlaceholder")} value={f.email} onChange={(e) => onChange({ email: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("phoneLabel")}</Label>
          <Input placeholder={t("phonePlaceholder")} value={f.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("statusLabel")}</Label>
        <Select value={f.status} onValueChange={(v) => onChange({ status: v as QuotationForm["status"] })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{t(`status${s.charAt(0).toUpperCase() + s.slice(1)}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("notesLabel")}</Label>
        <Textarea placeholder={t("notesPlaceholder")} className="resize-none" rows={2} value={f.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
    </div>
  )
}

export function QuotationsPage() {
  const { t } = useTranslation("quotations")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canDelete = canDeleteRole(activeOrg?.role)
  const sel = useMultiSelect()
  const longPress = useLongPress()
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [closedOpen, setClosedOpen] = useState(false)
  const [closedQuotations, setClosedQuotations] = useState<Quotation[]>([])
  const [closedLoaded, setClosedLoaded] = useState(false)
  const [closedLoading, setClosedLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Quotation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Quotation | null>(null)
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null)
  const [viewTarget, setViewTarget] = useState<Quotation | null>(null)
  const [form, setForm] = useState<QuotationForm>(defaultForm())
  const [saving, setSaving] = useState(false)

  const [attachments, setAttachments] = useState<QuotationAttachment[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteAttachId, setDeleteAttachId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const searchRef = useRef(search)
  const tabRef = useRef(tab)
  const dateFromRef = useRef(dateFrom)
  const dateToRef = useRef(dateTo)
  searchRef.current = search
  tabRef.current = tab
  dateFromRef.current = dateFrom
  dateToRef.current = dateTo
  const appliedFilterCount = (tab !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)
  const clearFilters = () => {
    setTab("all")
    setDateFrom("")
    setDateTo("")
  }

  async function fetchPage1() {
    setLoading(true)
    setPage(1)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ page: "1" })
      if (searchRef.current.trim()) params.set("search", searchRef.current.trim())
      if (tabRef.current !== "all") params.set("status", tabRef.current)
      if (dateFromRef.current) params.set("dateFrom", dateFromRef.current)
      if (dateToRef.current) params.set("dateTo", dateToRef.current)
      const data = await apiGet<{ data: Quotation[]; total: number }>(`/api/quotations?${params}`, token)
      setQuotations(data.data)
      setTotal(data.total)
    } catch (err) {
      console.error("Failed to load quotations:", err)
      toast.error(t("failedLoadQuotations"))
    } finally {
      setLoading(false)
    }
  }

  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ page: String(nextPage) })
      if (searchRef.current.trim()) params.set("search", searchRef.current.trim())
      if (tabRef.current !== "all") params.set("status", tabRef.current)
      if (dateFromRef.current) params.set("dateFrom", dateFromRef.current)
      if (dateToRef.current) params.set("dateTo", dateToRef.current)
      const data = await apiGet<{ data: Quotation[]; total: number }>(`/api/quotations?${params}`, token)
      setQuotations((prev) => [...prev, ...data.data])
      setTotal(data.total)
      setPage(nextPage)
    } catch (err) {
      console.error("Failed to load more quotations:", err)
      toast.error(t("failedLoadMoreQuotations"))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(fetchPage1, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced refetch keyed on filters; fetchPage1 reads the latest values via refs
  }, [search, tab, dateFrom, dateTo])

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setForm(defaultForm())
      setCreateOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Deep link from the client media hub: ?view=<quotationId> opens that quote.
  useEffect(() => {
    const viewId = searchParams.get("view")
    if (!viewId) return
    const next = new URLSearchParams(searchParams)
    next.delete("view")
    setSearchParams(next, { replace: true })
    const existing = quotations.find((q) => q.id === viewId)
    if (existing) { openViewModal(existing); return }
    ;(async () => {
      const token = await getToken()
      if (!token) return
      try {
        const q = await apiGet<Quotation>(`/api/quotations/${viewId}`, token)
        if (q) openViewModal(q)
      } catch { /* not found or no access */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    async function loadClients() {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<Client[]>("/api/clients", token)
      setClients(Array.isArray(data) ? data : (data as { data: Client[] }).data ?? [])
    }
    loadClients()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, [])

  const clientById = (id: string | null) => id ? clients.find((c) => c.id === id) : undefined

  async function loadAttachments(quotationId: string) {
    setAttachLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<QuotationAttachment[]>(`/api/quotations/${quotationId}/attachments`, token)
      setAttachments(data)
    } catch {
      toast.error(t("failedLoadAttachments"))
    } finally {
      setAttachLoading(false)
    }
  }

  function openViewModal(q: Quotation) {
    setViewTarget(q)
    setAttachments([])
    loadAttachments(q.id)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !viewTarget) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("fileExceedsSizeLimit"))
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1]
      setUploading(true)
      try {
        const token = await getToken()
        if (!token) throw new Error("Not authenticated")
        const res = await fetch(`/api/quotations/${viewTarget.id}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            file_name: file.name,
            file_type: file.type || "application/octet-stream",
            file_size: file.size,
            file_data: base64,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error ?? "Upload failed")
        }
        toast.success(t("attachmentUploaded"))
        loadAttachments(viewTarget.id)
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to upload attachment")
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    }
    reader.readAsDataURL(file)
  }

  async function handleDownload(attachment: QuotationAttachment) {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/quotation-attachments/${attachment.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = attachment.file_name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t("failedDownloadAttachment"))
    }
  }

  async function handleDeleteAttachment() {
    if (!deleteAttachId || !viewTarget) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await fetch(`/api/quotation-attachments/${deleteAttachId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      toast.success(t("attachmentDeleted"))
      setDeleteAttachId(null)
      loadAttachments(viewTarget.id)
    } catch {
      toast.error(t("failedDeleteAttachment"))
    }
  }

  async function handleCreate() {
    if (!form.title.trim()) { toast.error(t("titleRequired")); return }
    if (!form.prospect_name.trim()) { toast.error(t("prospectNameRequired")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Quotation>("/api/quotations", token, {
        ...form,
        amount: form.amount ? parseFloat(form.amount) : 0,
      })
      toast.success(t("quotationCreated"))
      setCreateOpen(false)
      setForm(defaultForm())
      fetchPage1()
    } catch {
      toast.error(t("failedCreateQuotation"))
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editTarget) return
    if (!form.title.trim()) { toast.error(t("titleRequired")); return }
    if (!form.prospect_name.trim()) { toast.error(t("prospectNameRequired")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Quotation>(`/api/quotations/${editTarget.id}`, token, {
        ...form,
        amount: form.amount ? parseFloat(form.amount) : 0,
      })
      toast.success(t("quotationUpdated"))
      setEditTarget(null)
      fetchPage1()
    } catch {
      toast.error(t("failedUpdateQuotation"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/quotations/${deleteTarget.id}`, token)
      toast.success(t("quotationMovedToTrash"))
      setDeleteTarget(null)
      fetchPage1()
    } catch {
      toast.error(t("failedDeleteQuotation"))
    }
  }

  async function handleConvert() {
    if (!convertTarget) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const newClient = await apiPost<Client>(`/api/quotations/${convertTarget.id}/convert`, token, {})
      toast.success(t("clientAddedSuccess", { name: newClient.name }))
      setConvertTarget(null)
      fetchPage1()
      navigate(`/clients/${newClient.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      toast.error(msg.includes("already converted") ? t("alreadyConverted") : t("failedConvert"))
    } finally {
      setSaving(false)
    }
  }

  const remaining = total - quotations.length

  const selectableIds = quotations.map((q) => q.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => sel.isSelected(id))

  async function loadClosed() {
    setClosedLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<{ data: Quotation[]; total: number }>("/api/quotations?closed=1&page=1", token)
      setClosedQuotations(data.data)
      setClosedLoaded(true)
    } catch {
      toast.error(t("failedLoadQuotations"))
    } finally {
      setClosedLoading(false)
    }
  }

  function toggleClosedSection() {
    const next = !closedOpen
    setClosedOpen(next)
    if (next && !closedLoaded) loadClosed()
  }

  async function setQuotationClosed(quotationId: string, closed: boolean) {
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/quotations/${quotationId}`, token, { closed })
      toast.success(closed ? t("closed.quotationClosed") : t("closed.quotationReopened"))
      if (closed) {
        setViewTarget(null)
        fetchPage1()
      } else {
        setClosedQuotations((prev) => prev.filter((q) => q.id !== quotationId))
        fetchPage1()
      }
    } catch {
      toast.error(t("closed.actionFailed"))
    }
  }

  async function handleBulkDelete() {
    if (sel.count === 0) return
    setBulkDeleting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const { deleted } = await apiPost<{ deleted: number }>("/api/quotations/bulk-delete", token, {
        ids: sel.selectedIds,
      })
      toast.success(t("multiSelect.deleted", { count: deleted }))
      sel.exitSelection()
      fetchPage1()
    } catch {
      toast.error(t("multiSelect.deleteFailed"))
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
              {t("totalQuotations", { count: total })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {canDelete && quotations.length > 0 && (
            <Button
              variant={sel.selectionMode ? "secondary" : "outline"}
              size="sm"
              className="hidden sm:inline-flex h-9"
              onClick={() => (sel.selectionMode ? sel.exitSelection() : sel.enterSelection())}
            >
              <CheckSquare className="size-4" />
              {t("multiSelect.select")}
            </Button>
          )}
          <Button onClick={() => { setForm(defaultForm()); setCreateOpen(true) }} className="shrink-0">
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("newQuotationBtn")}</span>
            <span className="sm:hidden">{t("newShort")}</span>
          </Button>
        </div>
      </div>

      {/* Filters — status + date live inside the filter sheet to keep the
          toolbar compact and consistent across the app. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder={t("searchPlaceholder")}
          expandedClassName="w-full sm:w-72"
        />
        <FilterSheet count={appliedFilterCount} onClear={clearFilters} triggerClassName="shrink-0 ml-auto">
          <FilterSection label={t("filters.status")}>
            <Select value={tab} onValueChange={setTab}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("tabAll")}</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{t(`status${s.charAt(0).toUpperCase() + s.slice(1)}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>
          <FilterSection label={t("filters.dateRange")}>
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" aria-label={t("filters.from")} value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" aria-label={t("filters.to")} value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </FilterSection>
        </FilterSheet>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
        </div>
      ) : quotations.length === 0 ? (
        <div className="py-20 text-center">
          <FileText className="size-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">
            {search || tab !== "all" || dateFrom || dateTo ? t("noQuotationsMatch") : t("noQuotationsYet")}
          </p>
          {!search && tab === "all" && !dateFrom && !dateTo && (
            <Button className="mt-4" onClick={() => { setForm(defaultForm()); setCreateOpen(true) }}>
              <Plus className="size-4" />
              {t("createFirstQuotation")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {quotations.map((q) => {
              const linkedClient = clientById(q.linked_client_id)
              const canConvert = !q.linked_client_id && (q.status === "draft" || q.status === "sent")
              return (
                <Card
                  key={q.id}
                  className={`group cursor-pointer hover:shadow-md transition-shadow py-0 ${sel.isSelected(q.id) ? "ring-2 ring-primary" : ""}`}
                  onClick={() => {
                    if (sel.selectionMode) { sel.toggle(q.id); return }
                    if (longPress.didLongPress()) return
                    openViewModal(q)
                  }}
                  {...(canDelete ? longPress.bind(() => sel.enterSelection(q.id)) : {})}
                >
                  <CardContent className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2">
                      {sel.selectionMode && (
                        <Checkbox
                          checked={sel.isSelected(q.id)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => sel.toggle(q.id)}
                          className="mt-0.5 shrink-0"
                          aria-label={`Select ${q.title}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{q.title}</p>
                        <p className="text-sm text-muted-foreground truncate">{q.prospect_name}</p>
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[q.status] ?? ""}`}>
                        {q.status.charAt(0).toUpperCase() + q.status.slice(1)}
                      </span>
                    </div>

                    {/* Details */}
                    <div className="space-y-1">
                      {q.company && (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="size-3 text-muted-foreground shrink-0" />
                          <p className="text-xs text-muted-foreground truncate">{q.company}</p>
                        </div>
                      )}
                      {q.email && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="size-3 text-muted-foreground shrink-0" />
                          <p className="text-xs text-muted-foreground truncate">{q.email}</p>
                        </div>
                      )}
                      {q.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="size-3 text-muted-foreground shrink-0" />
                          <p className="text-xs text-muted-foreground truncate">{q.phone}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Calendar className="size-3 text-muted-foreground shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          {formatDate(q.created_at)}
                        </p>
                        <AttachmentBadge count={q.attachment_count} className="ml-auto" />
                      </div>
                    </div>

                    {/* Amount + linked client */}
                    <div className="flex items-center justify-between pt-1 border-t">
                      <p className="text-base font-bold">{fmt(Number(q.amount))}</p>
                      {linkedClient ? (
                        <button
                          className="flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={(e) => { e.stopPropagation(); navigate(`/clients/${linkedClient.id}`) }}
                        >
                          <ExternalLink className="size-3" />
                          {linkedClient.name}
                        </button>
                      ) : q.linked_client_id ? (
                        <Badge variant="outline" className="text-xs">Converted</Badge>
                      ) : null}
                    </div>

                    {/* Actions */}
                    {!sel.selectionMode && (
                    <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      {canConvert && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          onClick={() => setConvertTarget(q)}
                        >
                          <UserPlus className="size-3" />
                          {t("convertToClientBtn")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-8 p-0 shrink-0"
                        onClick={() => {
                          setForm({ title: q.title, prospect_name: q.prospect_name, company: q.company, email: q.email, phone: q.phone, amount: q.amount, status: q.status, notes: q.notes })
                          setEditTarget(q)
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(q)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {remaining > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? t("loading") : t("loadMore", { remaining })}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Closed quotations — separate, lazily-loaded section. */}
      {!loading && (
        <div className="border-t pt-3">
          <button
            type="button"
            onClick={toggleClosedSection}
            className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-4 transition-transform ${closedOpen ? "" : "-rotate-90"}`} />
            {t("closed.quotationsSection")}
            {closedLoaded && <span className="text-xs">({closedQuotations.length})</span>}
          </button>
          {closedOpen && (
            <div className="mt-3">
              {closedLoading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
                </div>
              ) : closedQuotations.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("closed.noClosedQuotations")}</p>
              ) : (
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {closedQuotations.map((q) => (
                    <Card key={q.id} className="py-0 opacity-90">
                      <CardContent className="p-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <button className="min-w-0 flex-1 text-left" onClick={() => openViewModal(q)}>
                            <p className="font-semibold text-sm truncate">{q.title}</p>
                            <p className="text-xs text-muted-foreground truncate">{q.prospect_name}</p>
                          </button>
                          <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-300">{t("closed.closedBadge")}</Badge>
                        </div>
                        <Button variant="outline" size="sm" className="w-full" onClick={() => setQuotationClosed(q.id, false)}>
                          <ArchiveRestore className="size-3.5" /> {t("closed.reopen")}
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* View Modal */}
      <Dialog open={viewTarget !== null} onOpenChange={(open) => { if (!open) setViewTarget(null) }}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          {viewTarget && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="size-4" />
                  {viewTarget.title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("prospectLabel")}</p>
                    <p className="mt-0.5 font-medium">{viewTarget.prospect_name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("statusLabel")}</p>
                    <span className={`inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[viewTarget.status] ?? ""}`}>
                      {viewTarget.status.charAt(0).toUpperCase() + viewTarget.status.slice(1)}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("amountLabel")}</p>
                    <p className="mt-0.5 font-bold">{fmt(Number(viewTarget.amount))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("createdLabel")}</p>
                    <p className="mt-0.5">{formatDate(viewTarget.created_at)}</p>
                  </div>
                  {viewTarget.company && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("companyLabel")}</p>
                      <p className="mt-0.5">{viewTarget.company}</p>
                    </div>
                  )}
                  {viewTarget.email && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("emailLabel")}</p>
                      <p className="mt-0.5 truncate">{viewTarget.email}</p>
                    </div>
                  )}
                  {viewTarget.phone && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("phoneLabel")}</p>
                      <p className="mt-0.5">{viewTarget.phone}</p>
                    </div>
                  )}
                  {viewTarget.notes && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("notesLabel")}</p>
                      <p className="mt-0.5 text-sm whitespace-pre-wrap">{viewTarget.notes}</p>
                    </div>
                  )}
                  {viewTarget.linked_client_id && clientById(viewTarget.linked_client_id) && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("linkedClientLabel")}</p>
                      <button
                        className="mt-0.5 flex items-center gap-1 text-sm text-primary hover:underline"
                        onClick={() => { setViewTarget(null); navigate(`/clients/${viewTarget.linked_client_id}`) }}
                      >
                        <ExternalLink className="size-3" />
                        {clientById(viewTarget.linked_client_id)?.name}
                      </button>
                    </div>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Paperclip className="size-3.5" /> {t("attachmentsLabel")}
                    </p>
                    <div>
                      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} accept="*/*" />
                      <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                        {uploading ? t("uploading") : t("uploadBtn")}
                      </Button>
                    </div>
                  </div>

                  {attachLoading ? (
                    <div className="space-y-1.5">
                      {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                    </div>
                  ) : attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">{t("noAttachmentsYet")}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {attachments.map((att) => (
                        <div key={att.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                          <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{att.file_name}</p>
                            <p className="text-xs text-muted-foreground">{formatFileSize(att.file_size)}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => handleDownload(att)}>
                            <Download className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteAttachId(att.id)}>
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t("maxFileSize")}</p>
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setQuotationClosed(viewTarget.id, !viewTarget.closed_at)}
                >
                  {viewTarget.closed_at ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
                  {viewTarget.closed_at ? t("closed.reopen") : t("closed.close")}
                </Button>
                <Button variant="outline" onClick={() => {
                  setViewTarget(null)
                  setForm({ title: viewTarget.title, prospect_name: viewTarget.prospect_name, company: viewTarget.company, email: viewTarget.email, phone: viewTarget.phone, amount: viewTarget.amount, status: viewTarget.status, notes: viewTarget.notes })
                  setEditTarget(viewTarget)
                }}>
                  <Pencil className="size-3.5" />
                  {t("editBtn")}
                </Button>
                <Button onClick={() => setViewTarget(null)}>{t("closeBtn")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          <DialogHeader><DialogTitle>{t("newQuotationTitle")}</DialogTitle></DialogHeader>
          <QuotationFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cancelBtn")}</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? t("creating") : t("createBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          <DialogHeader><DialogTitle>{t("editQuotationTitle")}</DialogTitle></DialogHeader>
          <QuotationFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t("cancelBtn")}</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? t("saving") : t("saveBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Confirmation */}
      <AlertDialog open={convertTarget !== null} onOpenChange={(open) => { if (!open) setConvertTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("convertToClientTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("convertToClientDescription", { name: convertTarget?.prospect_name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancelBtn")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={saving}>
              {saving ? t("converting") : t("convertBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("moveToTrashTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("moveToTrashDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancelBtn")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("moveToTrashBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Attachment Confirmation */}
      <AlertDialog open={deleteAttachId !== null} onOpenChange={(open) => { if (!open) setDeleteAttachId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteAttachmentTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteAttachmentDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancelBtn")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAttachment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("deleteBtn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {sel.selectionMode && (
        <BulkActionBar
          count={sel.count}
          allSelected={allSelected}
          onToggleSelectAll={() => (allSelected ? sel.clear() : sel.selectAll(selectableIds))}
          onDelete={handleBulkDelete}
          onCancel={sel.exitSelection}
          deleting={bulkDeleting}
        />
      )}
    </div>
  )
}
