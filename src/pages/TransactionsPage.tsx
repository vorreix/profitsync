import { useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { Plus, Search, ArrowUpRight, ArrowDownRight, DollarSign, CreditCard as Edit, Trash2 } from "lucide-react"

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

export function TransactionsPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState("all")
  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<TxForm>(defaultForm())
  const [editForm, setEditForm] = useState<TxForm & { id: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const [txs, cls] = await Promise.all([
      apiGet<Transaction[]>("/api/transactions", token),
      apiGet<Client[]>("/api/clients", token),
    ])
    setTransactions(txs)
    setClients(cls)
    setLoading(false)
  }, [getToken])

  useEffect(() => { loadData() }, [loadData])

  const filtered = transactions.filter((t) => {
    const matchesTab = tab === "all" || t.type === tab
    const q = search.toLowerCase()
    const matchesSearch =
      !q ||
      (t.client_name ?? "").toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    return matchesTab && matchesSearch
  })

  const totalIncoming = filtered.filter((t) => t.type === "incoming").reduce((s, t) => s + Number(t.amount), 0)
  const totalOutgoing = filtered.filter((t) => t.type === "outgoing").reduce((s, t) => s + Number(t.amount), 0)

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
      loadData()
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
      loadData()
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
      loadData()
    } catch {
      toast.error("Failed to delete transaction")
    }
  }

  const TxFormFields = ({
    f,
    onChange,
    showClient,
  }: {
    f: TxForm
    onChange: (patch: Partial<TxForm>) => void
    showClient: boolean
  }) => (
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
            <button
              key={type}
              type="button"
              onClick={() => onChange({ type, category: "" })}
              className={`flex items-center justify-center gap-2 rounded-md border py-2.5 text-sm font-medium transition-colors ${
                f.type === type
                  ? type === "incoming"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-600"
                    : "border-red-500 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 dark:border-red-600"
                  : "border-border hover:bg-muted"
              }`}
            >
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
        <Input placeholder={f.type === "incoming" ? "Invoice #1234" : "Hosting fee"} value={f.description} onChange={(e) => onChange({ description: e.target.value })} />
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">{transactions.length} total</p>
        </div>
        <Button onClick={() => { setForm(defaultForm()); setAddOpen(true) }}>
          <Plus className="size-4" />
          Add Transaction
        </Button>
      </div>

      {/* Summary row */}
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

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by client, description, category..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="incoming">Income</TabsTrigger>
            <TabsTrigger value="outgoing">Expenses</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
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
        <div className="border rounded-xl overflow-hidden">
          <div className="divide-y">
            {filtered.map((tx) => (
              <div key={tx.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors group">
                <div className={`size-9 rounded-full flex items-center justify-center shrink-0 ${
                  tx.type === "incoming"
                    ? "bg-emerald-100 dark:bg-emerald-900/30"
                    : "bg-red-100 dark:bg-red-900/30"
                }`}>
                  {tx.type === "incoming"
                    ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                    : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">
                      {tx.description || (tx.type === "incoming" ? "Income" : "Expense")}
                    </p>
                    {tx.category && (
                      <Badge variant="outline" className="text-xs py-0 shrink-0">{tx.category}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => navigate(`/clients/${tx.client_id}`)}
                    >
                      {tx.client_name ?? tx.client_id}
                    </button>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                  </div>
                </div>

                <p className={`text-sm font-semibold shrink-0 ${
                  tx.type === "incoming"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}>
                  {tx.type === "incoming" ? "+" : "−"}{fmt(Number(tx.amount))}
                </p>

                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setEditForm({
                        id: tx.id,
                        client_id: tx.client_id,
                        type: tx.type,
                        amount: String(tx.amount),
                        description: tx.description,
                        category: tx.category,
                        date: tx.date,
                      })
                      setEditOpen(true)
                    }}
                  >
                    <Edit className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteId(tx.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <TxFormFields
            f={form}
            onChange={(p) => setForm((f) => ({ ...f, ...p }))}
            showClient
          />
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
            <TxFormFields
              f={editForm}
              onChange={(p) => setEditForm((f) => f ? { ...f, ...p } : null)}
              showClient={false}
            />
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
    </div>
  )
}
