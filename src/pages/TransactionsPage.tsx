import { useEffect, useState, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Transaction, TransactionAttachment } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { Plus, Search, ArrowUpRight, ArrowDownRight, DollarSign, Pencil, Trash2, Paperclip, Download, X, Eye } from "lucide-react"

type PaginatedResponse<T> = { data: T[]; total: number }

type TxForm = {
  client_id: string
  type: "incoming" | "outgoing"
  amount: string
  description: string
  category: string
  date: string
}

const CATEGORIES_IN = ["Payment", "Retainer", "Project Fee", "Consultation", "Other"]
const CATEGORIES_OUT = ["Hosting", "Design", "Development", "Advertising", "Salary", "Software", "Travel", "Taxes", "Miscellaneous"]
const PAGE_SIZE = 20

const defaultForm = (): TxForm => ({
  client_id: "",
  type: "incoming",
  amount: "",
  description: "",
  category: "",
  date: new Date().toISOString().split("T")[0],
})

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TransactionsPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState("all")
  const searchRef = useRef(search)
  searchRef.current = search
  const tabRef = useRef(tab)
  tabRef.current = tab

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [viewTx, setViewTx] = useState<Transaction | null>(null)
  const [form, setForm] = useState<TxForm>(defaultForm())
  const [editForm, setEditForm] = useState<TxForm & { id: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const [attachments, setAttachments] = useState<TransactionAttachment[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteAttachId, setDeleteAttachId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const buildParams = useCallback((pageNum: number, s: string, t: string) => {
    const params = new URLSearchParams({ page: String(pageNum) })
    if (s.trim()) params.set("search", s.trim())
    if (t !== "all") params.set("type", t)
    return params.toString()
  }, [])

  const fetchPage1 = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    setLoading(true)
    try {
      const [result, cls] = await Promise.all([
        apiGet<PaginatedResponse<Transaction>>(`/api/transactions?${buildParams(1, searchRef.current, tabRef.current)}`, token),
        apiGet<{ data: Client[]; total: number } | Client[]>("/api/clients?page=1", token),
      ])
      setTransactions(result.data)
      setTotal(result.total)
      setPage(1)
      const clsData = Array.isArray(cls) ? cls : cls.data
      setClients(clsData)
    } finally {
      setLoading(false)
    }
  }, [getToken, buildParams])

  useEffect(() => {
    const timer = setTimeout(() => { fetchPage1() }, search === "" ? 0 : 300)
    return () => clearTimeout(timer)
  }, [search, tab, fetchPage1])

  const handleLoadMore = async () => {
    const token = await getToken()
    if (!token) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const result = await apiGet<PaginatedResponse<Transaction>>(
        `/api/transactions?${buildParams(nextPage, search, tab)}`,
        token,
      )
      setTransactions((prev) => [...prev, ...result.data])
      setPage(nextPage)
    } finally {
      setLoadingMore(false)
    }
  }

  const totalIncoming = transactions.filter((t) => t.type === "incoming").reduce((s, t) => s + Number(t.amount), 0)
  const totalOutgoing = transactions.filter((t) => t.type === "outgoing").reduce((s, t) => s + Number(t.amount), 0)

  async function handleAdd() {
    if (!form.client_id) { toast.error("Client is required"); return }
    if (!form.amount || isNaN(parseFloat(form.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Transaction>("/api/transactions", token, {
        client_id: form.client_id,
        type: form.type,
        amount: parseFloat(form.amount),
        description: form.description,
        category: form.category,
        date: form.date,
      })
      toast.success("Transaction added")
      setAddOpen(false)
      setForm(defaultForm())
      fetchPage1()
    } catch {
      toast.error("Failed to add transaction")
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!editForm || !editForm.amount || isNaN(parseFloat(editForm.amount))) {
      toast.error("Valid amount is required"); return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Transaction>(`/api/transactions/${editForm.id}`, token, {
        type: editForm.type,
        amount: parseFloat(editForm.amount),
        description: editForm.description,
        category: editForm.category,
        date: editForm.date,
      })
      toast.success("Transaction updated")
      setEditOpen(false)
      setEditForm(null)
      fetchPage1()
    } catch {
      toast.error("Failed to update transaction")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/transactions/${deleteId}`, token)
      toast.success("Transaction deleted")
      setDeleteId(null)
      fetchPage1()
    } catch {
      toast.error("Failed to delete transaction")
    }
  }

  async function loadAttachments(txId: string) {
    setAttachLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<TransactionAttachment[]>(`/api/transactions/${txId}/attachments`, token)
      setAttachments(data)
    } catch {
      toast.error("Failed to load attachments")
    } finally {
      setAttachLoading(false)
    }
  }

  function openViewModal(tx: Transaction) {
    setViewTx(tx)
    setAttachments([])
    loadAttachments(tx.id)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !viewTx) return
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
        const res = await fetch(`/api/transactions/${viewTx.id}/attachments`, {
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
          throw new Error(err.error ?? "Upload failed")
        }
        toast.success("Attachment uploaded")
        loadAttachments(viewTx.id)
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to upload attachment")
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    }
    reader.readAsDataURL(file)
  }

  async function handleDownload(attachment: TransactionAttachment) {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/attachments/${attachment.id}`, {
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
    if (!deleteAttachId || !viewTx) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await fetch(`/api/attachments/${deleteAttachId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error()
      toast.success("Attachment deleted")
      setDeleteAttachId(null)
      loadAttachments(viewTx.id)
    } catch {
      toast.error("Failed to delete attachment")
    }
  }

  const TxFormFields = ({
    f, onChange, showClient,
  }: { f: TxForm; onChange: (patch: Partial<TxForm>) => void; showClient: boolean }) => (
    <div className="space-y-4 py-2">
      {showClient && (
        <div className="space-y-1.5">
          <Label>Client *</Label>
          <Select value={f.client_id} onValueChange={(v) => onChange({ client_id: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select client..." /></SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(["incoming", "outgoing"] as const).map((type) => (
            <button key={type} type="button" onClick={() => onChange({ type, category: "" })} className={`flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors ${
              f.type === type
                ? type === "incoming"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600"
                  : "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600"
                : "border-border hover:bg-muted"
            }`}>
              {type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
              {type === "incoming" ? "Incoming" : "Outgoing"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Amount *</Label>
        <Input type="number" min="0" step="0.01" placeholder="0.00" value={f.amount} onChange={(e) => onChange({ amount: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <Textarea placeholder={f.type === "incoming" ? "Invoice #1234" : "Hosting fee"} value={f.description} onChange={(e) => onChange({ description: e.target.value })} rows={3} className="resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={f.category} onValueChange={(v) => onChange({ category: v })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
            <SelectContent>
              {(f.type === "incoming" ? CATEGORIES_IN : CATEGORIES_OUT).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={f.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          {!loading && <p className="text-sm text-muted-foreground mt-1">{total} total</p>}
        </div>
        <Button onClick={() => { setForm(defaultForm()); setAddOpen(true) }}>
          <Plus className="size-4" />
          Add Transaction
        </Button>
      </div>

      {!loading && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Income</p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{fmt(totalIncoming)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Expenses</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400 mt-1">{fmt(totalOutgoing)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Net</p>
            <p className={`text-xl font-bold mt-1 ${totalIncoming - totalOutgoing >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
              {fmt(totalIncoming - totalOutgoing)}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Search by client, description, category..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Tabs value={tab} onValueChange={(v) => { setTab(v) }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="incoming">Income</TabsTrigger>
            <TabsTrigger value="outgoing">Expenses</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-20 text-center border rounded-xl">
          <DollarSign className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground font-medium">
            {search || tab !== "all" ? "No transactions match your filters" : "No transactions yet"}
          </p>
          {!search && tab === "all" && clients.length > 0 && (
            <Button className="mt-4" onClick={() => { setForm(defaultForm()); setAddOpen(true) }}>
              <Plus className="size-4" />
              Add first transaction
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="border rounded-xl overflow-hidden">
            <div className="divide-y">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors group cursor-pointer"
                  onClick={() => openViewModal(tx)}
                >
                  <div className={`size-9 rounded-full flex items-center justify-center shrink-0 ${
                    tx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
                  }`}>
                    {tx.type === "incoming"
                      ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                      : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {tx.description
                          ? tx.description.length > 60 ? tx.description.slice(0, 60) + "…" : tx.description
                          : (tx.type === "incoming" ? "Income" : "Expense")}
                      </p>
                      {tx.category && (
                        <Badge variant="outline" className="text-xs py-0 shrink-0">{tx.category}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={(e) => { e.stopPropagation(); navigate(`/clients/${tx.client_id}`) }}
                      >
                        {tx.client_name ?? tx.client_id}
                      </button>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                    </div>
                  </div>

                  <p className={`text-sm font-semibold shrink-0 ${
                    tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {tx.type === "incoming" ? "+" : "−"}{fmt(Number(tx.amount))}
                  </p>

                  <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="size-7" onClick={(e) => { e.stopPropagation(); openViewModal(tx) }}>
                      <Eye className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={(e) => {
                      e.stopPropagation()
                      setEditForm({ id: tx.id, client_id: tx.client_id, type: tx.type, amount: String(tx.amount), description: tx.description, category: tx.category, date: tx.date })
                      setEditOpen(true)
                    }}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(tx.id) }}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {transactions.length < total && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? "Loading..." : `Load More (${total - transactions.length} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* View Modal */}
      <Dialog open={viewTx !== null} onOpenChange={(open) => { if (!open) setViewTx(null) }}>
        <DialogContent className="sm:max-w-md">
          {viewTx && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <div className={`size-8 rounded-full flex items-center justify-center ${
                    viewTx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
                  }`}>
                    {viewTx.type === "incoming"
                      ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                      : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                  </div>
                  Transaction Details
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Amount</p>
                    <p className={`font-semibold mt-0.5 ${viewTx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {viewTx.type === "incoming" ? "+" : "−"}{fmt(Number(viewTx.amount))}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Type</p>
                    <Badge variant={viewTx.type === "incoming" ? "default" : "secondary"} className="mt-0.5">
                      {viewTx.type === "incoming" ? "Income" : "Expense"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Client</p>
                    <button
                      className="text-sm text-primary hover:underline mt-0.5"
                      onClick={() => { setViewTx(null); navigate(`/clients/${viewTx.client_id}`) }}
                    >
                      {viewTx.client_name ?? viewTx.client_id}
                    </button>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Date</p>
                    <p className="mt-0.5">{formatDate(viewTx.date)}</p>
                  </div>
                  {viewTx.description && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Description</p>
                      <p className="mt-0.5">{viewTx.description}</p>
                    </div>
                  )}
                  {viewTx.category && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Category</p>
                      <p className="mt-0.5">{viewTx.category}</p>
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
                  setViewTx(null)
                  setEditForm({ id: viewTx.id, client_id: viewTx.client_id, type: viewTx.type, amount: String(viewTx.amount), description: viewTx.description, category: viewTx.category, date: viewTx.date })
                  setEditOpen(true)
                }}>
                  <Pencil className="size-3.5" />
                  Edit
                </Button>
                <Button onClick={() => setViewTx(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <TxFormFields f={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} showClient />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? "Adding..." : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
          {editForm && (
            <TxFormFields f={editForm} onChange={(p) => setEditForm((f) => f ? { ...f, ...p } : null)} showClient={false} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This transaction will be permanently deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
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
