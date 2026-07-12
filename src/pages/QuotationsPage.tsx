import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import type { Client, Quotation, QuotationAttachment } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole } from "@/lib/roles"
import { useMultiSelect } from "@/lib/use-multi-select"
import { useLongPress } from "@/lib/use-long-press"
import { dropModalBackEntry } from "@/hooks/use-back-close"
import { BulkActionBar } from "@/components/BulkActionBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { getCurrencySymbol } from "@/lib/currencies"
import { useFieldErrors } from "@/lib/use-field-errors"
import { z } from "zod"
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
import { Plus, FileText, Pencil, ExternalLink, Paperclip, Download, X, CheckSquare, ChevronDown, ArchiveRestore } from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { CategoryPicker } from "@/components/CategoryPicker"
import { AuditHistory } from "@/components/AuditHistory"
import { ViewToggle } from "@/components/ViewToggle"
import { useViewMode } from "@/lib/use-view-mode"
import { useInfiniteScroll } from "@/lib/use-infinite-scroll"
import {
  QuotationCard, QuotationListRow, QuotationTable,
  type QuotationActions, type QuotationColumn,
} from "@/components/quotations/quotation-views"
import { STATUS_COLORS, formatQuotationDate as formatDate } from "@/lib/quotation-display"

type QuotationForm = {
  title: string
  prospect_name: string
  company: string
  email: string
  phone: string
  amount: string
  date: string
  status: "draft" | "sent" | "accepted" | "rejected"
  notes: string
  category: string
}

const todayIso = () => new Date().toISOString().split("T")[0]

const defaultForm = (): QuotationForm => ({
  title: "",
  prospect_name: "",
  company: "",
  email: "",
  phone: "",
  amount: "",
  date: todayIso(),
  status: "draft",
  notes: "",
  category: "",
})

const ALL_STATUSES = ["draft", "sent", "accepted", "rejected"] as const

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function QuotationFormFields({
  f,
  onChange,
  errors = {},
  clearField,
}: {
  f: QuotationForm
  onChange: (p: Partial<QuotationForm>) => void
  errors?: Record<string, string>
  clearField?: (field: string) => void
}) {
  const { t } = useTranslation("quotations")
  const { currency } = useCurrency()
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label>{t("titleLabel")}</Label>
        <Input placeholder={t("titlePlaceholder")} value={f.title} aria-invalid={!!errors.title} onChange={(e) => { onChange({ title: e.target.value }); clearField?.("title") }} />
        {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
      </div>
      <div className="space-y-1.5">
        <Label>{t("prospectNameLabel")}</Label>
        <Input placeholder={t("prospectNamePlaceholder")} value={f.prospect_name} aria-invalid={!!errors.prospect_name} onChange={(e) => { onChange({ prospect_name: e.target.value }); clearField?.("prospect_name") }} />
        {errors.prospect_name && <p className="text-xs text-destructive">{errors.prospect_name}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("companyLabel")}</Label>
          <Input placeholder={t("companyPlaceholder")} value={f.company} onChange={(e) => onChange({ company: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("amountLabel")}</Label>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>{getCurrencySymbol(currency)}</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput type="number" min="0" step="0.01" placeholder={t("amountPlaceholder")} value={f.amount} onChange={(e) => onChange({ amount: e.target.value })} />
          </InputGroup>
        </div>
      </div>
      {/* Date + Category side by side — keeps the meta fields compact. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("dateLabel")}</Label>
          <Input type="date" value={f.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("filters.category")}</Label>
          <CategoryPicker type="quotation" value={f.category} onChange={(v) => onChange({ category: v })} />
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
  const quotationSchema = z.object({
    title: z.string().trim().min(1, t("titleRequired")),
    prospect_name: z.string().trim().min(1, t("prospectNameRequired")),
  })
  const { errors, validate, clearField, clearAll } = useFieldErrors(quotationSchema)
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
  const [sort, setSort] = useState("created_desc")
  const [view, setView] = useViewMode("quotations")
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

  // Create-dialog draft. `form` is shared with the edit dialog, so we keep the
  // create draft in a dedicated ref (snapshotted on dismiss) to avoid edit data
  // leaking in. Policy: dismissing the create dialog (outside-click/Esc/Back)
  // keeps what was typed; Cancel and a successful create clear it; opening fresh
  // with no kept draft seeds defaults (with today's date).
  const createDraftRef = useRef<QuotationForm | null>(null)
  const createDirty = (f: QuotationForm) =>
    !!(f.title || f.prospect_name || f.company || f.email || f.phone || f.amount || f.notes || f.category)
  const openCreate = () => {
    setForm(createDraftRef.current ?? defaultForm())
    clearAll()
    setCreateOpen(true)
  }
  const closeCreate = (o: boolean) => {
    // o=false here only via dismissal (Cancel/success route through clearAll paths
    // that null the ref first) — snapshot the draft if it has content.
    if (!o) createDraftRef.current = createDirty(form) ? form : null
    setCreateOpen(o)
  }

  const [attachments, setAttachments] = useState<QuotationAttachment[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteAttachId, setDeleteAttachId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const searchRef = useRef(search)
  const tabRef = useRef(tab)
  const dateFromRef = useRef(dateFrom)
  const dateToRef = useRef(dateTo)
  const sortRef = useRef(sort)
  searchRef.current = search
  tabRef.current = tab
  dateFromRef.current = dateFrom
  dateToRef.current = dateTo
  sortRef.current = sort
  const appliedFilterCount = (tab !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)
  const clearFilters = () => {
    setTab("all")
    setDateFrom("")
    setDateTo("")
  }

  // `silent` reconciles in the background after a mutation without swapping to the
  // skeleton, so the list never visibly "reloads".
  async function fetchPage1(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true)
    setPage(1)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ page: "1" })
      if (searchRef.current.trim()) params.set("search", searchRef.current.trim())
      if (tabRef.current !== "all") params.set("status", tabRef.current)
      if (dateFromRef.current) params.set("dateFrom", dateFromRef.current)
      if (dateToRef.current) params.set("dateTo", dateToRef.current)
      if (sortRef.current !== "created_desc") params.set("sort", sortRef.current)
      const data = await apiGet<{ data: Quotation[]; total: number }>(`/api/quotations?${params}`, token)
      setQuotations(data.data)
      setTotal(data.total)
    } catch (err) {
      console.error("Failed to load quotations:", err)
      if (!opts?.silent) toast.error(t("failedLoadQuotations"))
    } finally {
      if (!opts?.silent) setLoading(false)
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
      if (sortRef.current !== "created_desc") params.set("sort", sortRef.current)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced refetch keyed on filters+sort; fetchPage1 reads the latest values via refs
  }, [search, tab, dateFrom, dateTo, sort])

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openCreate()
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // O(1) client lookup by id (was an O(N) find per card → O(N²) across the list).
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const clientById = useCallback((id: string | null) => (id ? clientMap.get(id) : undefined), [clientMap])

  // Table column header click: toggle asc/desc on the active column, else start a
  // sensible default (amount/date newest-or-biggest first, text A→Z).
  const handleSort = useCallback((key: QuotationColumn["key"]) => {
    setSort((prev) => {
      const [prevKey, prevDir] = prev.split("_")
      if (prevKey === key) return `${key}_${prevDir === "asc" ? "desc" : "asc"}`
      return `${key}_${key === "amount" || key === "date" ? "desc" : "asc"}`
    })
  }, [])

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
    if (!validate(form)) return
    if (amountExceedsLimit(form.amount)) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const created = await apiPost<Quotation>("/api/quotations", token, {
        ...form,
        amount: form.amount ? parseFloat(form.amount) : 0,
      })
      toast.success(t("quotationCreated"))
      createDraftRef.current = null // a successful create clears the kept draft
      setCreateOpen(false)
      setForm(defaultForm())
      clearAll()
      // Insert the new quotation in place — no full-list reload.
      setQuotations((prev) => [created, ...prev])
      setTotal((n) => n + 1)
    } catch {
      toast.error(t("failedCreateQuotation"))
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editTarget) return
    if (!validate(form)) return
    if (amountExceedsLimit(form.amount)) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<Quotation>(`/api/quotations/${editTarget.id}`, token, {
        ...form,
        amount: form.amount ? parseFloat(form.amount) : 0,
      })
      toast.success(t("quotationUpdated"))
      setEditTarget(null)
      clearAll()
      // Replace the edited quotation in place — no full-list reload.
      setQuotations((prev) => prev.map((q) => (q.id === updated.id ? updated : q)))
    } catch {
      toast.error(t("failedUpdateQuotation"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    // Optimistic: remove the row instantly; reconcile only on failure.
    setDeleteTarget(null)
    setQuotations((prev) => prev.filter((q) => q.id !== target.id))
    setTotal((n) => Math.max(0, n - 1))
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/quotations/${target.id}`, token)
      toast.success(t("quotationMovedToTrash"))
    } catch {
      toast.error(t("failedDeleteQuotation"))
      fetchPage1({ silent: true }) // restore on failure
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
      fetchPage1({ silent: true })
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

  // Auto infinite scroll — loads the next page as the sentinel nears the viewport;
  // the visible "Load More" button stays as the manual / no-observer fallback.
  const { sentinelRef } = useInfiniteScroll({
    hasMore: remaining > 0,
    loading: loadingMore,
    onLoadMore: handleLoadMore,
    enabled: !loading,
  })

  // Stable action bundle for the memoized Card/List/Table rows. Handler bodies
  // close over changing state, so we keep the latest set in a ref and hand the
  // rows fixed wrappers — a row re-renders only when its own data/selection
  // changes, never because a parent closure was recreated (e.g. on every keystroke).
  const openEdit = (q: Quotation) => {
    setForm({ title: q.title, prospect_name: q.prospect_name, company: q.company, email: q.email, phone: q.phone, amount: q.amount, date: q.date ?? todayIso(), status: q.status, notes: q.notes, category: q.category ?? "" })
    setEditTarget(q)
  }
  const latestActions = {
    onView: openViewModal,
    onEdit: openEdit,
    onConvert: (q: Quotation) => setConvertTarget(q),
    onClose: (id: string) => setQuotationClosed(id, true),
    onDelete: (q: Quotation) => setDeleteTarget(q),
    onToggleSelect: sel.toggle,
    onEnterSelection: sel.enterSelection,
    onOpenClient: (id: string) => navigate(`/clients/${id}`),
    formatAmount: fmt,
    bindLongPress: longPress.bind,
    didLongPress: longPress.didLongPress,
  }
  const latestActionsRef = useRef(latestActions)
  latestActionsRef.current = latestActions
  const actions = useMemo<QuotationActions>(() => ({
    onView: (q) => latestActionsRef.current.onView(q),
    onEdit: (q) => latestActionsRef.current.onEdit(q),
    onConvert: (q) => latestActionsRef.current.onConvert(q),
    onClose: (id) => latestActionsRef.current.onClose(id),
    onDelete: (q) => latestActionsRef.current.onDelete(q),
    onToggleSelect: (id) => latestActionsRef.current.onToggleSelect(id),
    onEnterSelection: (id) => latestActionsRef.current.onEnterSelection(id),
    onOpenClient: (id) => latestActionsRef.current.onOpenClient(id),
    formatAmount: (n) => latestActionsRef.current.formatAmount(n),
    bindLongPress: (cb) => latestActionsRef.current.bindLongPress(cb),
    didLongPress: () => latestActionsRef.current.didLongPress(),
  }), [])

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
        // Optimistically drop it from the open list; closed list refreshes lazily.
        setQuotations((prev) => prev.filter((q) => q.id !== quotationId))
        setTotal((n) => Math.max(0, n - 1))
        setClosedLoaded(false)
        fetchPage1({ silent: true })
      } else {
        setClosedQuotations((prev) => prev.filter((q) => q.id !== quotationId))
        fetchPage1({ silent: true })
      }
    } catch {
      toast.error(t("closed.actionFailed"))
    }
  }

  async function handleBulkDelete() {
    if (sel.count === 0) return
    const ids = sel.selectedIds
    // Optimistic: drop the selected quotations from the list instantly.
    const removedCount = quotations.filter((q) => ids.includes(q.id)).length
    setQuotations((prev) => prev.filter((q) => !ids.includes(q.id)))
    setTotal((n) => Math.max(0, n - removedCount))
    sel.exitSelection()
    setBulkDeleting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const { deleted } = await apiPost<{ deleted: number }>("/api/quotations/bulk-delete", token, { ids })
      toast.success(t("multiSelect.deleted", { count: deleted }))
    } catch {
      toast.error(t("multiSelect.deleteFailed"))
      fetchPage1({ silent: true }) // restore on failure
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
          <Button onClick={openCreate} className="shrink-0">
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
        <ViewToggle value={view} onChange={setView} className="ml-auto" />
        <FilterSheet count={appliedFilterCount} onClear={clearFilters} triggerClassName="shrink-0">
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
        view === "card" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </div>
        )
      ) : quotations.length === 0 ? (
        <div className="py-20 text-center">
          <FileText className="size-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">
            {search || tab !== "all" || dateFrom || dateTo ? t("noQuotationsMatch") : t("noQuotationsYet")}
          </p>
          {!search && tab === "all" && !dateFrom && !dateTo && (
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="size-4" />
              {t("createFirstQuotation")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {view === "table" ? (
            <QuotationTable
              quotations={quotations}
              clientFor={clientById}
              isSelected={sel.isSelected}
              selectionMode={sel.selectionMode}
              canDelete={canDelete}
              actions={actions}
              sort={sort}
              onSort={handleSort}
            />
          ) : view === "list" ? (
            <div className="space-y-2">
              {quotations.map((q) => (
                <QuotationListRow
                  key={q.id}
                  q={q}
                  linkedClient={clientById(q.linked_client_id)}
                  selected={sel.isSelected(q.id)}
                  selectionMode={sel.selectionMode}
                  canDelete={canDelete}
                  actions={actions}
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {quotations.map((q) => (
                <QuotationCard
                  key={q.id}
                  q={q}
                  linkedClient={clientById(q.linked_client_id)}
                  selected={sel.isSelected(q.id)}
                  selectionMode={sel.selectionMode}
                  canDelete={canDelete}
                  actions={actions}
                />
              ))}
            </div>
          )}

          {/* Auto infinite scroll: the sentinel triggers the next page as it nears
              the viewport; the button stays as a visible manual fallback. */}
          {remaining > 0 && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <div ref={sentinelRef} aria-hidden className="h-px w-full" />
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

                <div className="border-t pt-3 space-y-1.5">
                  <p className="text-sm font-medium">{t("audit.history")}</p>
                  <AuditHistory entityType="quotation" entityId={viewTarget.id} />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  // Neutralize the view modal's back-entry first so closing it doesn't
                  // fire a history.back() popstate that the edit dialog's useBackClose
                  // catches and slams shut (same race as the client overview→edit fix).
                  dropModalBackEntry()
                  setViewTarget(null)
                  setForm({ title: viewTarget.title, prospect_name: viewTarget.prospect_name, company: viewTarget.company, email: viewTarget.email, phone: viewTarget.phone, amount: viewTarget.amount, date: viewTarget.date ?? todayIso(), status: viewTarget.status, notes: viewTarget.notes, category: viewTarget.category ?? "" })
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
      <Dialog open={createOpen} onOpenChange={closeCreate}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          <DialogHeader><DialogTitle>{t("newQuotationTitle")}</DialogTitle></DialogHeader>
          <QuotationFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} errors={errors} clearField={clearField} />
          <DialogFooter>
            {/* Cancel = discard. */}
            <Button variant="outline" onClick={() => { createDraftRef.current = null; setForm(defaultForm()); clearAll(); setCreateOpen(false) }}>{t("cancelBtn")}</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? t("creating") : t("createBtn")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          <DialogHeader><DialogTitle>{t("editQuotationTitle")}</DialogTitle></DialogHeader>
          <QuotationFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} errors={errors} clearField={clearField} />
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
