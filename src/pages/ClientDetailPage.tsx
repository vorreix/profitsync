import { useEffect, useState, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { ArrowLeft, Plus, Trash2, DollarSign, Building2, Mail, Phone, FileText, ArrowUpRight, ArrowDownRight, Pencil, Search, Calendar } from "lucide-react"

type NewTransaction = { type: "incoming" | "outgoing"; amount: string; description: string; category: string; date: string }
type NewClient = { name: string; company: string; email: string; phone: string; status: "active" | "inactive" | "archived"; notes: string; onboard_date?: string | null }

const defaultTxForm: NewTransaction = { type: "incoming", amount: "", description: "", category: "", date: new Date().toISOString().split("T")[0] }
const CATEGORIES_IN = ["Payment", "Retainer", "Project Fee", "Consultation", "Other"]
const CATEGORIES_OUT = ["Hosting", "Design", "Development", "Advertising", "Salary", "Software", "Travel", "Taxes", "Miscellaneous"]

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const formatCurrency = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount)
  const [client, setClient] = useState<Client | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [txDialogOpen, setTxDialogOpen] = useState(false)
  const [editClientDialogOpen, setEditClientDialogOpen] = useState(false)
  const [editTxDialogOpen, setEditTxDialogOpen] = useState(false)
  const [txForm, setTxForm] = useState<NewTransaction>(defaultTxForm)
  const [editTxForm, setEditTxForm] = useState<(NewTransaction & { id: string }) | null>(null)
  const [clientForm, setClientForm] = useState<NewClient | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteType, setDeleteType] = useState<"transaction" | "client" | null>(null)
  const [activeTab, setActiveTab] = useState("all")
  const [txSearch, setTxSearch] = useState("")

  const loadData = useCallback(async () => {
    if (!id) return
    const token = await getToken()
    if (!token) return
    const [clientData, txData] = await Promise.all([
      apiGet<Client>(`/api/clients/${id}`, token),
      apiGet<Transaction[]>(`/api/transactions?clientId=${id}`, token),
    ])
    if (!clientData) { navigate("/clients"); return }
    setClient(clientData)
    setTransactions(txData)
    setLoading(false)
  }, [id, navigate, getToken])

  useEffect(() => { loadData() }, [loadData])

  const totalIncoming = transactions.filter((t) => t.type === "incoming").reduce((s, t) => s + Number(t.amount), 0)
  const totalOutgoing = transactions.filter((t) => t.type === "outgoing").reduce((s, t) => s + Number(t.amount), 0)
  const netProfit = totalIncoming - totalOutgoing

  const filteredTx = transactions.filter((t) => {
    const matchesTab = activeTab === "all" || t.type === activeTab
    const matchesSearch = txSearch === "" || t.description.toLowerCase().includes(txSearch.toLowerCase()) || t.category.toLowerCase().includes(txSearch.toLowerCase())
    return matchesTab && matchesSearch
  })

  const handleAddTransaction = async () => {
    if (!txForm.amount || isNaN(parseFloat(txForm.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Transaction>("/api/transactions", token, { client_id: id, type: txForm.type, amount: parseFloat(txForm.amount), description: txForm.description, category: txForm.category, date: txForm.date })
      toast.success(`${txForm.type === "incoming" ? "Income" : "Expense"} added`)
      setTxDialogOpen(false)
      setTxForm(defaultTxForm)
      loadData()
    } catch {
      toast.error("Failed to add transaction")
    } finally {
      setSaving(false)
    }
  }

  const handleEditTransaction = async () => {
    if (!editTxForm || !editTxForm.amount || isNaN(parseFloat(editTxForm.amount))) { toast.error("Valid amount is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Transaction>(`/api/transactions/${editTxForm.id}`, token, { type: editTxForm.type, amount: parseFloat(editTxForm.amount), description: editTxForm.description, category: editTxForm.category, date: editTxForm.date })
      toast.success("Transaction updated")
      setEditTxDialogOpen(false)
      setEditTxForm(null)
      loadData()
    } catch {
      toast.error("Failed to update transaction")
    } finally {
      setSaving(false)
    }
  }

  const handleEditClient = async () => {
    if (!clientForm || !client) return
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Client>(`/api/clients/${client.id}`, token, clientForm)
      toast.success("Client updated")
      setEditClientDialogOpen(false)
      setClient({ ...client, ...clientForm })
    } catch {
      toast.error("Failed to update client")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId || !deleteType) return
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      if (deleteType === "transaction") {
        await apiDelete(`/api/transactions/${deleteId}`, token)
        toast.success("Transaction deleted")
      } else {
        await apiDelete(`/api/clients/${client?.id}`, token)
        toast.success("Client moved to trash")
        navigate("/clients")
        return
      }
    } catch {
      toast.error("Failed to delete")
    }
    setDeleteId(null)
    setDeleteType(null)
    loadData()
  }

  if (loading) return (
    <div className="p-3 sm:p-6 space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      <Skeleton className="h-64" />
    </div>
  )

  if (!client) return null

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/clients")} className="-ml-2 mt-0.5 shrink-0"><ArrowLeft className="size-4" /></Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{client.name}</h1>
              <Badge variant={client.status === "active" ? "default" : "secondary"}>{client.status}</Badge>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4 mt-1.5 flex-wrap">
              {client.company && <span className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0"><Building2 className="size-3.5 shrink-0" /><span className="truncate">{client.company}</span></span>}
              {client.email && <span className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0"><Mail className="size-3.5 shrink-0" /><span className="truncate">{client.email}</span></span>}
              {client.phone && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Phone className="size-3.5 shrink-0" />{client.phone}</span>}
              {client.onboard_date && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Calendar className="size-3.5 shrink-0" />Onboarded {formatDate(client.onboard_date)}</span>}
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Calendar className="size-3.5 shrink-0" />Client since {formatDate(client.created_at)}</span>
            </div>
            {client.notes && <p className="text-sm text-muted-foreground mt-1.5 flex items-start gap-1.5"><FileText className="size-3.5 mt-0.5 shrink-0" />{client.notes}</p>}
          </div>
          {/* Desktop actions */}
          <div className="hidden sm:flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" size="icon" onClick={() => { setClientForm(client); setEditClientDialogOpen(true) }}><Pencil className="size-4" /></Button>
            <Button variant="outline" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => { setDeleteId(client.id); setDeleteType("client") }}><Trash2 className="size-4" /></Button>
            <Button onClick={() => { setTxForm(defaultTxForm); setTxDialogOpen(true) }}><Plus className="size-4" />Add Transaction</Button>
          </div>
        </div>
        {/* Mobile actions */}
        <div className="flex sm:hidden gap-2">
          <Button className="flex-1" onClick={() => { setTxForm(defaultTxForm); setTxDialogOpen(true) }}><Plus className="size-4" />Add Transaction</Button>
          <Button variant="outline" size="icon" className="shrink-0" onClick={() => { setClientForm(client); setEditClientDialogOpen(true) }}><Pencil className="size-4" /></Button>
          <Button variant="outline" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => { setDeleteId(client.id); setDeleteType("client") }}><Trash2 className="size-4" /></Button>
        </div>
      </div>

      <Separator />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">Income</p>
          <p className="text-base sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums truncate">{formatCurrency(totalIncoming)}</p>
          <p className="hidden sm:flex text-xs text-muted-foreground mt-1 items-center gap-1"><ArrowUpRight className="size-3" />{transactions.filter((t) => t.type === "incoming").length} transaction{transactions.filter((t) => t.type === "incoming").length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">Expenses</p>
          <p className="text-base sm:text-xl font-bold text-destructive mt-1 tabular-nums truncate">{formatCurrency(totalOutgoing)}</p>
          <p className="hidden sm:flex text-xs text-muted-foreground mt-1 items-center gap-1"><ArrowDownRight className="size-3" />{transactions.filter((t) => t.type === "outgoing").length} transaction{transactions.filter((t) => t.type === "outgoing").length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">Net</p>
          <p className={`text-base sm:text-xl font-bold mt-1 tabular-nums truncate ${netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{formatCurrency(netProfit)}</p>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">{totalIncoming > 0 ? ((netProfit / totalIncoming) * 100).toFixed(1) : 0}% margin</p>
        </div>
      </div>

      {/* Transactions */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col gap-2 mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="-mx-3 px-3 overflow-x-auto scrollbar-none sm:mx-0 sm:px-0 sm:overflow-visible">
              <TabsList>
                <TabsTrigger value="all">All ({transactions.length})</TabsTrigger>
                <TabsTrigger value="incoming">Income ({transactions.filter((t) => t.type === "incoming").length})</TabsTrigger>
                <TabsTrigger value="outgoing">Expenses ({transactions.filter((t) => t.type === "outgoing").length})</TabsTrigger>
              </TabsList>
            </div>
            <div className="relative w-full sm:flex-1 sm:min-w-48 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Search transactions..." className="pl-9 h-9" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} />
            </div>
          </div>

          <TabsContent value={activeTab} className="mt-0">
            {filteredTx.length === 0 ? (
              <div className="py-16 text-center border rounded-xl">
                <DollarSign className="size-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground font-medium">No transactions found</p>
                <Button className="mt-3" variant="outline" onClick={() => { setTxForm(defaultTxForm); setTxDialogOpen(true) }}><Plus className="size-4" />Add first transaction</Button>
              </div>
            ) : (
              <div className="border rounded-xl overflow-hidden">
                <div className="divide-y">
                  {filteredTx.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors group">
                      <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${tx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                        {tx.type === "incoming" ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.description || (tx.type === "incoming" ? "Income" : "Expense")}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                          {tx.category && <Badge variant="outline" className="text-xs py-0">{tx.category}</Badge>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {tx.type === "incoming" ? "+" : "−"}{formatCurrency(Number(tx.amount))}
                        </p>
                      </div>
                      <div className="flex gap-0.5 sm:gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon-sm" onClick={() => { setEditTxForm({ ...tx, amount: tx.amount.toString() }); setEditTxDialogOpen(true) }}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => { setDeleteId(tx.id); setDeleteType("transaction") }}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Transaction Dialog */}
      <Dialog open={txDialogOpen} onOpenChange={setTxDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {["incoming", "outgoing"].map((type) => (
                  <button key={type} type="button" onClick={() => setTxForm((f) => ({ ...f, type: type as NewTransaction["type"], category: "" }))}
                    className={`flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors ${
                      txForm.type === type ? (type === "incoming" ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600" : "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600") : "border-border hover:bg-muted"
                    }`}
                  >
                    {type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    {type === "incoming" ? "Incoming" : "Outgoing"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="amount">Amount *</Label><Input id="amount" type="number" min="0" step="0.01" placeholder="0.00" value={txForm.amount} onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="description">Description</Label><Input id="description" placeholder={txForm.type === "incoming" ? "Invoice #1234" : "Hosting fee"} value={txForm.description} onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={txForm.category} onValueChange={(v) => setTxForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{(txForm.type === "incoming" ? CATEGORIES_IN : CATEGORIES_OUT).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={txForm.date} onChange={(e) => setTxForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddTransaction} disabled={saving}>{saving ? "Adding..." : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Transaction Dialog */}
      <Dialog open={editTxDialogOpen} onOpenChange={setEditTxDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
          {editTxForm && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {["incoming", "outgoing"].map((type) => (
                    <button key={type} type="button" onClick={() => setEditTxForm((f) => f ? { ...f, type: type as NewTransaction["type"], category: "" } : null)}
                      className={`flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors ${
                        editTxForm.type === type ? (type === "incoming" ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600" : "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600") : "border-border hover:bg-muted"
                      }`}
                    >
                      {type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                      {type === "incoming" ? "Incoming" : "Outgoing"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="edit-amount">Amount *</Label><Input id="edit-amount" type="number" min="0" step="0.01" placeholder="0.00" value={editTxForm.amount} onChange={(e) => setEditTxForm((f) => f ? { ...f, amount: e.target.value } : null)} /></div>
              <div className="space-y-1.5"><Label htmlFor="edit-description">Description</Label><Input id="edit-description" placeholder={editTxForm.type === "incoming" ? "Invoice #1234" : "Hosting fee"} value={editTxForm.description} onChange={(e) => setEditTxForm((f) => f ? { ...f, description: e.target.value } : null)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select value={editTxForm.category} onValueChange={(v) => setEditTxForm((f) => f ? { ...f, category: v } : null)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>{(editTxForm.type === "incoming" ? CATEGORIES_IN : CATEGORIES_OUT).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-date">Date</Label>
                  <Input id="edit-date" type="date" value={editTxForm.date} onChange={(e) => setEditTxForm((f) => f ? { ...f, date: e.target.value } : null)} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTxDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditTransaction} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Client Dialog */}
      <Dialog open={editClientDialogOpen} onOpenChange={setEditClientDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Edit Client</DialogTitle></DialogHeader>
          {clientForm && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5"><Label htmlFor="client-name">Name *</Label><Input id="client-name" value={clientForm.name} onChange={(e) => setClientForm((f) => f ? { ...f, name: e.target.value } : null)} /></div>
              <div className="space-y-1.5"><Label htmlFor="client-company">Company</Label><Input id="client-company" value={clientForm.company} onChange={(e) => setClientForm((f) => f ? { ...f, company: e.target.value } : null)} /></div>
              <div className="space-y-1.5"><Label htmlFor="client-email">Email</Label><Input id="client-email" type="email" value={clientForm.email} onChange={(e) => setClientForm((f) => f ? { ...f, email: e.target.value } : null)} /></div>
              <div className="space-y-1.5"><Label htmlFor="client-phone">Phone</Label><Input id="client-phone" value={clientForm.phone} onChange={(e) => setClientForm((f) => f ? { ...f, phone: e.target.value } : null)} /></div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={clientForm.status} onValueChange={(v) => setClientForm((f) => f ? { ...f, status: v as NewClient["status"] } : null)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["active", "inactive", "archived"].map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="client-onboard">Onboard Date</Label><Input id="client-onboard" type="date" value={clientForm.onboard_date ?? ""} onChange={(e) => setClientForm((f) => f ? { ...f, onboard_date: e.target.value || null } : null)} /></div>
              <div className="space-y-1.5"><Label htmlFor="client-notes">Notes</Label><Textarea id="client-notes" value={clientForm.notes} onChange={(e) => setClientForm((f) => f ? { ...f, notes: e.target.value } : null)} className="resize-none" rows={3} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditClientDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleEditClient} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteType(null) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteType === "client" ? "Move Client to Trash?" : "Delete Transaction?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteType === "transaction" ? "This transaction will be permanently deleted. This action cannot be undone." : "This client will be moved to trash. You can restore it from the Trash page."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteType === "client" ? "Move to Trash" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
