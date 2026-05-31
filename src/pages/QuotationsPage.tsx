import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Quotation, QuotationAttachment } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Plus, Search, FileText, Building2, Mail, Phone, UserPlus, Trash2, Pencil, ExternalLink, Calendar, Paperclip, Download, X } from "lucide-react"

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
  return (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label>Title *</Label>
        <Input placeholder="Web Design Proposal" value={f.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Prospect Name *</Label>
        <Input placeholder="Jane Smith" value={f.prospect_name} onChange={(e) => onChange({ prospect_name: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Company</Label>
          <Input placeholder="Acme Corp" value={f.company} onChange={(e) => onChange({ company: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Amount</Label>
          <Input type="number" min="0" step="0.01" placeholder="0.00" value={f.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" placeholder="jane@acme.com" value={f.email} onChange={(e) => onChange({ email: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Phone</Label>
          <Input placeholder="+1 555 0000" value={f.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Status</Label>
        <Select value={f.status} onValueChange={(v) => onChange({ status: v as QuotationForm["status"] })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Notes</Label>
        <Textarea placeholder="Additional details..." className="resize-none" rows={2} value={f.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>
    </div>
  )
}

export function QuotationsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
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
  searchRef.current = search
  tabRef.current = tab

  async function fetchPage1() {
    setLoading(true)
    setPage(1)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ page: "1" })
      if (searchRef.current.trim()) params.set("search", searchRef.current.trim())
      if (tabRef.current !== "all") params.set("status", tabRef.current)
      const data = await apiGet<{ data: Quotation[]; total: number }>(`/api/quotations?${params}`, token)
      setQuotations(data.data)
      setTotal(data.total)
    } catch (err) {
      console.error("Failed to load quotations:", err)
      toast.error("Failed to load quotations")
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
      const data = await apiGet<{ data: Quotation[]; total: number }>(`/api/quotations?${params}`, token)
      setQuotations((prev) => [...prev, ...data.data])
      setTotal(data.total)
      setPage(nextPage)
    } catch (err) {
      console.error("Failed to load more quotations:", err)
      toast.error("Failed to load more quotations")
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(fetchPage1, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced refetch keyed on search/tab; fetchPage1 reads the latest values via refs
  }, [search, tab])

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setForm(defaultForm())
      setCreateOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

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
      toast.error("Failed to load attachments")
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
      toast.error("File exceeds 2MB limit")
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
        toast.success("Attachment uploaded")
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
      toast.error("Failed to download attachment")
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
      toast.success("Attachment deleted")
      setDeleteAttachId(null)
      loadAttachments(viewTarget.id)
    } catch {
      toast.error("Failed to delete attachment")
    }
  }

  async function handleCreate() {
    if (!form.title.trim()) { toast.error("Title is required"); return }
    if (!form.prospect_name.trim()) { toast.error("Prospect name is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Quotation>("/api/quotations", token, {
        ...form,
        amount: form.amount ? parseFloat(form.amount) : 0,
      })
      toast.success("Quotation created")
      setCreateOpen(false)
      setForm(defaultForm())
      fetchPage1()
    } catch {
      toast.error("Failed to create quotation")
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editTarget) return
    if (!form.title.trim()) { toast.error("Title is required"); return }
    if (!form.prospect_name.trim()) { toast.error("Prospect name is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Quotation>(`/api/quotations/${editTarget.id}`, token, {
        ...form,
        amount: form.amount ? parseFloat(form.amount) : 0,
      })
      toast.success("Quotation updated")
      setEditTarget(null)
      fetchPage1()
    } catch {
      toast.error("Failed to update quotation")
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
      toast.success("Quotation moved to trash")
      setDeleteTarget(null)
      fetchPage1()
    } catch {
      toast.error("Failed to delete quotation")
    }
  }

  async function handleConvert() {
    if (!convertTarget) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const newClient = await apiPost<Client>(`/api/quotations/${convertTarget.id}/convert`, token, {})
      toast.success(`${newClient.name} added as client`)
      setConvertTarget(null)
      fetchPage1()
      navigate(`/clients/${newClient.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      toast.error(msg.includes("already converted") ? "Already converted to a client" : "Failed to convert")
    } finally {
      setSaving(false)
    }
  }

  const remaining = total - quotations.length

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Quotations</h1>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
              {total} quotation{total !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <Button onClick={() => { setForm(defaultForm()); setCreateOpen(true) }} className="shrink-0">
          <Plus className="size-4" />
          <span className="hidden sm:inline">New Quotation</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative w-full sm:flex-1 sm:min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, company, title..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="-mx-3 px-3 overflow-x-auto scrollbar-none sm:mx-0 sm:px-0 sm:overflow-visible">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {ALL_STATUSES.map((s) => (
                <TabsTrigger key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}
        </div>
      ) : quotations.length === 0 ? (
        <div className="py-20 text-center">
          <FileText className="size-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">
            {search || tab !== "all" ? "No quotations match your filters" : "No quotations yet"}
          </p>
          {!search && tab === "all" && (
            <Button className="mt-4" onClick={() => { setForm(defaultForm()); setCreateOpen(true) }}>
              <Plus className="size-4" />
              Create first quotation
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
                <Card key={q.id} className="group cursor-pointer hover:shadow-md transition-shadow py-0" onClick={() => openViewModal(q)}>
                  <CardContent className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-2">
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
                    <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                      {canConvert && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-xs"
                          onClick={() => setConvertTarget(q)}
                        >
                          <UserPlus className="size-3" />
                          Convert to Client
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
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {remaining > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? "Loading..." : `Load More (${remaining} remaining)`}
              </Button>
            </div>
          )}
        </>
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
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Prospect</p>
                    <p className="mt-0.5 font-medium">{viewTarget.prospect_name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Status</p>
                    <span className={`inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[viewTarget.status] ?? ""}`}>
                      {viewTarget.status.charAt(0).toUpperCase() + viewTarget.status.slice(1)}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Amount</p>
                    <p className="mt-0.5 font-bold">{fmt(Number(viewTarget.amount))}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Created</p>
                    <p className="mt-0.5">{formatDate(viewTarget.created_at)}</p>
                  </div>
                  {viewTarget.company && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Company</p>
                      <p className="mt-0.5">{viewTarget.company}</p>
                    </div>
                  )}
                  {viewTarget.email && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Email</p>
                      <p className="mt-0.5 truncate">{viewTarget.email}</p>
                    </div>
                  )}
                  {viewTarget.phone && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Phone</p>
                      <p className="mt-0.5">{viewTarget.phone}</p>
                    </div>
                  )}
                  {viewTarget.notes && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Notes</p>
                      <p className="mt-0.5 text-sm whitespace-pre-wrap">{viewTarget.notes}</p>
                    </div>
                  )}
                  {viewTarget.linked_client_id && clientById(viewTarget.linked_client_id) && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Linked Client</p>
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
                      <Paperclip className="size-3.5" /> Attachments
                    </p>
                    <div>
                      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} accept="*/*" />
                      <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                        {uploading ? "Uploading..." : "Upload"}
                      </Button>
                    </div>
                  </div>

                  {attachLoading ? (
                    <div className="space-y-1.5">
                      {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                    </div>
                  ) : attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">No attachments yet</p>
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
                  <p className="text-xs text-muted-foreground">Max 2MB per file</p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setViewTarget(null)
                  setForm({ title: viewTarget.title, prospect_name: viewTarget.prospect_name, company: viewTarget.company, email: viewTarget.email, phone: viewTarget.phone, amount: viewTarget.amount, status: viewTarget.status, notes: viewTarget.notes })
                  setEditTarget(viewTarget)
                }}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button onClick={() => setViewTarget(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          <DialogHeader><DialogTitle>New Quotation</DialogTitle></DialogHeader>
          <QuotationFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(open) => { if (!open) setEditTarget(null) }}>
        <DialogContent className="w-[92vw] max-w-md sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Quotation</DialogTitle></DialogHeader>
          <QuotationFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Confirmation */}
      <AlertDialog open={convertTarget !== null} onOpenChange={(open) => { if (!open) setConvertTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert to Client?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new client from <strong>{convertTarget?.prospect_name}</strong> and mark this quotation as accepted. You'll be redirected to the new client's page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={saving}>
              {saving ? "Converting..." : "Convert"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This quotation will be moved to the trash. You can restore it later from the Trash page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Attachment Confirmation */}
      <AlertDialog open={deleteAttachId !== null} onOpenChange={(open) => { if (!open) setDeleteAttachId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Attachment?</AlertDialogTitle>
            <AlertDialogDescription>This attachment will be permanently deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAttachment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
