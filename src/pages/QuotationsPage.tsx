import { useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Quotation } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Plus, Search, FileText, Building2, Mail, Phone, UserPlus, Trash2, CreditCard as Edit, ExternalLink } from "lucide-react"

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

export function QuotationsPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState("all")
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Quotation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Quotation | null>(null)
  const [convertTarget, setConvertTarget] = useState<Quotation | null>(null)
  const [form, setForm] = useState<QuotationForm>(defaultForm())
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const [qs, cls] = await Promise.all([
      apiGet<Quotation[]>("/api/quotations", token),
      apiGet<Client[]>("/api/clients", token),
    ])
    setQuotations(qs)
    setClients(cls)
    setLoading(false)
  }, [getToken])

  useEffect(() => { loadData() }, [loadData])

  const clientById = (id: string | null) => id ? clients.find((c) => c.id === id) : undefined

  const filtered = quotations.filter((q) => {
    const matchesTab = tab === "all" || q.status === tab
    const s = search.toLowerCase()
    const matchesSearch =
      !s ||
      q.title.toLowerCase().includes(s) ||
      q.prospect_name.toLowerCase().includes(s) ||
      q.company.toLowerCase().includes(s) ||
      q.email.toLowerCase().includes(s)
    return matchesTab && matchesSearch
  })

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
      loadData()
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
      loadData()
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
      loadData()
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
      const newClient = await apiPost<Client>(
        `/api/quotations/${convertTarget.id}/convert`,
        token,
        {}
      )
      toast.success(`${newClient.name} added as client`)
      setConvertTarget(null)
      loadData()
      navigate(`/clients/${newClient.id}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ""
      toast.error(msg.includes("already converted") ? "Already converted to a client" : "Failed to convert")
    } finally {
      setSaving(false)
    }
  }

  const QuotationFormFields = ({ f, onChange }: { f: QuotationForm; onChange: (p: Partial<QuotationForm>) => void }) => (
    <div className="space-y-4 py-2">
      <div className="space-y-1.5">
        <Label>Title *</Label>
        <Input placeholder="Web Design Proposal" value={f.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label>Prospect Name *</Label>
        <Input placeholder="Jane Smith" value={f.prospect_name} onChange={(e) => onChange({ prospect_name: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Company</Label>
          <Input placeholder="Acme Corp" value={f.company} onChange={(e) => onChange({ company: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Amount</Label>
          <Input type="number" min="0" step="0.01" placeholder="0.00" value={f.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotations</h1>
          {!loading && <p className="text-sm text-muted-foreground mt-1">{quotations.length} quotation{quotations.length !== 1 ? "s" : ""}</p>}
        </div>
        <Button onClick={() => { setForm(defaultForm()); setCreateOpen(true) }}>
          <Plus className="size-4" />
          New Quotation
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, company, title..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {ALL_STATUSES.map((s) => (
              <TabsTrigger key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((q) => {
            const linkedClient = clientById(q.linked_client_id)
            const canConvert = !q.linked_client_id && (q.status === "draft" || q.status === "sent")
            return (
              <Card key={q.id} className="group">
                <CardContent className="p-4 space-y-3">
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
                  </div>

                  {/* Amount + linked client */}
                  <div className="flex items-center justify-between pt-1 border-t">
                    <p className="text-base font-bold">{fmt(Number(q.amount))}</p>
                    {linkedClient ? (
                      <button
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                        onClick={() => navigate(`/clients/${linkedClient.id}`)}
                      >
                        <ExternalLink className="size-3" />
                        {linkedClient.name}
                      </button>
                    ) : q.linked_client_id ? (
                      <Badge variant="outline" className="text-xs">Converted</Badge>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1">
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
                      onClick={() => { setForm({ title: q.title, prospect_name: q.prospect_name, company: q.company, email: q.email, phone: q.phone, amount: q.amount, status: q.status, notes: q.notes }); setEditTarget(q) }}
                    >
                      <Edit className="size-3.5" />
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
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
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
        <DialogContent className="sm:max-w-md">
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
    </div>
  )
}
