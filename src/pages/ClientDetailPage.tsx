import { useEffect, useState, useCallback, useRef } from "react"
import { useParams, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import type { Budget, Client, Transaction, TransactionAttachment, WealthAccount } from "@/lib/types"
import { AccountSelector, type Allocation } from "@/components/AccountSelector"
import { loadLastTx, saveLastTx } from "@/lib/last-tx"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole, canDeleteRole } from "@/lib/roles"
import { CategoryPicker } from "@/components/CategoryPicker"
import { ClientOverviewModal } from "@/components/ClientOverviewModal"
import { BudgetDialog } from "@/components/budget/BudgetDialog"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import { dropModalBackEntry } from "@/hooks/use-back-close"
import { AuditHistory } from "@/components/AuditHistory"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { ACCEPT_ATTR, attachmentsListPath, uploadAttachment, validateFile } from "@/lib/attachments-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { FitText } from "@/components/FitText"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import { ArrowLeft, Plus, Trash2, DollarSign, Building2, Mail, Phone, FileText, ArrowUpRight, ArrowDownRight, Pencil, Calendar, Paperclip, Upload, X, FolderOpen, Archive, ArchiveRestore, Eye, PiggyBank, ChevronRight } from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"

type NewTransaction = { type: "incoming" | "outgoing"; allocations: Allocation[]; description: string; category: string; date: string }
type NewClient = { name: string; company: string; email: string; phone: string; status: "active" | "inactive" | "archived"; notes: string; category?: string; onboard_date?: string | null }

// A function (not a const) so `date` is evaluated per call — a module-level const
// captures the date at chunk load and goes stale once the app stays open past midnight.
const defaultTxForm = (): NewTransaction => ({ type: "incoming", allocations: [], description: "", category: "", date: new Date().toISOString().split("T")[0] })

// Cash in Hand is the default source; fall back to the first active account.
const defaultAccountId = (accounts: WealthAccount[]) =>
  accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? ""

const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const formatCurrency = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount)
  const [client, setClient] = useState<Client | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [txDialogOpen, setTxDialogOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const addFileRef = useRef<HTMLInputElement>(null)
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
  const [txSort, setTxSort] = useState("date_desc")
  const [txFrom, setTxFrom] = useState("")
  const [txTo, setTxTo] = useState("")
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [viewTx, setViewTx] = useState<Transaction | null>(null)
  const [viewTxAtt, setViewTxAtt] = useState<TransactionAttachment[]>([])
  const [viewAttachment, setViewAttachment] = useState<AttachmentModalItem | null>(null)
  const [clientBudget, setClientBudget] = useState<Budget | null>(null)
  const [defaultBudget, setDefaultBudget] = useState<Budget | null>(null)
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false)

  const { activeOrg } = useOrg()
  const canModify = canWriteRole(activeOrg?.role)
  const canRemove = canDeleteRole(activeOrg?.role)

  const loadViewTxAtt = useCallback(async (txId: string) => {
    setViewTxAtt([])
    const token = await getToken()
    if (!token) return
    try {
      const rows = await apiGet<TransactionAttachment[]>(`/api/transactions/${txId}/attachments`, token)
      setViewTxAtt(rows)
    } catch { /* ignore */ }
  }, [getToken])

  function openTxView(tx: Transaction) {
    setViewTx(tx)
    loadViewTxAtt(tx.id)
  }

  // The per-client expense budget (+ the org default, used as the dialog prefill).
  // Spend is derived server-side, so we read it from /api/budgets rather than store
  // it; reloading after a budget save or a transaction change keeps "spent" accurate.
  const refreshBudget = useCallback(async () => {
    if (!id) return
    const token = await getToken()
    if (!token) return
    try {
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      setClientBudget(res.budgets.find((b) => b.client_id === id) ?? null)
      setDefaultBudget(res.budgets.find((b) => b.client_id === null) ?? null)
    } catch {
      /* non-blocking — the budget card just stays empty */
    }
  }, [id, getToken])

  const loadData = useCallback(async () => {
    if (!id) return
    const token = await getToken()
    if (!token) return
    const [clientData, txData] = await Promise.all([
      apiGet<Client>(`/api/clients/${id}`, token),
      apiGet<Transaction[]>(`/api/transactions?clientId=${id}`, token),
      refreshBudget(),
    ])
    if (!clientData) { navigate("/clients"); return }
    setClient(clientData)
    setTransactions(txData)
    setLoading(false)
  }, [id, navigate, getToken, refreshBudget])

  useEffect(() => { loadData() }, [loadData])

  // Accounts load independently of the client/transactions fetch so the add-tx
  // form's source picker is ready fast (and never flashes an empty state).
  const loadAccounts = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    try {
      const list = await apiGet<WealthAccount[]>("/api/wealth/accounts", token)
      setAccounts(list.filter((a) => !a.archived_at))
    } catch {
      /* non-blocking */
    } finally {
      setAccountsLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    loadAccounts()
    window.addEventListener("wealth:accounts-changed", loadAccounts)
    return () => window.removeEventListener("wealth:accounts-changed", loadAccounts)
  }, [loadAccounts])

  const pickDefaultAccount = useCallback(() => {
    const lastAcc = loadLastTx().wealth_account_id
    return (lastAcc && accounts.some((a) => a.id === lastAcc)) ? lastAcc : defaultAccountId(accounts)
  }, [accounts])

  const openAddTx = useCallback(() => {
    const acc = pickDefaultAccount()
    setTxForm({ ...defaultTxForm(), allocations: acc ? [{ account_id: acc, amount: "" }] : [] })
    setPendingFiles([])
    setTxDialogOpen(true)
  }, [pickDefaultAccount])

  // If the dialog opened (e.g. via ?newTx=1) before accounts loaded, seed the
  // default source (last-used account, else Cash in Hand) once they arrive.
  useEffect(() => {
    if (!txDialogOpen || accounts.length === 0) return
    setTxForm((f) => {
      if (f.allocations.length > 0) return f
      const acc = pickDefaultAccount()
      return acc ? { ...f, allocations: [{ account_id: acc, amount: "" }] } : f
    })
  }, [txDialogOpen, accounts, pickDefaultAccount])

  // The FAB on this page links to ?newTx=1 to add a transaction for this client.
  useEffect(() => {
    if (searchParams.get("newTx") === "1") {
      openAddTx()
      const next = new URLSearchParams(searchParams)
      next.delete("newTx")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, openAddTx])

  // The mobile client "view" sheet links here with ?edit=1 to jump straight into
  // editing — open the dialog once the client has loaded.
  useEffect(() => {
    if (searchParams.get("edit") === "1" && client) {
      setClientForm(client)
      setEditClientDialogOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete("edit")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, client])

  const totalIncoming = transactions.filter((t) => t.type === "incoming").reduce((s, t) => s + Number(t.amount), 0)
  const totalOutgoing = transactions.filter((t) => t.type === "outgoing").reduce((s, t) => s + Number(t.amount), 0)
  const netProfit = totalIncoming - totalOutgoing

  const filteredTx = transactions
    .filter((t) => {
      const matchesTab = activeTab === "all" || t.type === activeTab
      const matchesSearch = txSearch === "" || t.description.toLowerCase().includes(txSearch.toLowerCase()) || t.category.toLowerCase().includes(txSearch.toLowerCase())
      const matchesFrom = !txFrom || t.date >= txFrom
      const matchesTo = !txTo || t.date <= txTo
      return matchesTab && matchesSearch && matchesFrom && matchesTo
    })
    .sort((a, b) => {
      if (txSort === "amount_desc") return Number(b.amount) - Number(a.amount)
      if (txSort === "amount_asc") return Number(a.amount) - Number(b.amount)
      if (txSort === "date_asc") return a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)
      return b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
    })
  const txFilterCount = (txFrom || txTo ? 1 : 0)

  const handleAddTransaction = async () => {
    const allocs = txForm.allocations.filter((a) => a.account_id && Number(a.amount) > 0)
    if (allocs.length === 0) { toast.error("Valid amount is required"); return }
    if (allocs.some((a) => amountExceedsLimit(a.amount))) { toast.error("Amount is too large"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      // A split entry is ONE logical transaction saved atomically as a group of
      // account-legs (the server shares a group_id and syncs each balance). Files
      // attach to the first created leg.
      const result = await apiPost<{ group_id: string | null; ids: string[] }>("/api/transactions/group", token, {
        client_id: id,
        type: txForm.type,
        description: txForm.description,
        category: txForm.category,
        date: txForm.date,
        allocations: allocs.map((a) => ({ wealth_account_id: a.account_id, amount: parseFloat(a.amount) })),
      })
      const firstId = result.ids[0] ?? null
      if (firstId && pendingFiles.length > 0) {
        let failed = 0
        for (const file of pendingFiles) {
          try {
            await uploadAttachment(attachmentsListPath("transaction", firstId), file, token)
          } catch (e) {
            failed++
            toast.error(e instanceof Error ? e.message : `Failed to attach ${file.name}`)
          }
        }
        if (failed < pendingFiles.length) toast.success(pendingFiles.length - failed === 1 ? "File attached" : "Files attached")
      }
      saveLastTx({ wealth_account_id: allocs[0]?.account_id })
      toast.success(`${txForm.type === "incoming" ? "Income" : "Expense"} added`)
      setTxDialogOpen(false)
      setTxForm(defaultTxForm())
      setPendingFiles([])
      loadData()
    } catch {
      toast.error("Failed to add transaction")
    } finally {
      setSaving(false)
    }
  }

  function handlePendingFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (addFileRef.current) addFileRef.current.value = ""
    const valid: File[] = []
    for (const file of files) {
      const err = validateFile(file)
      if (err) { toast.error(err); continue }
      valid.push(file)
    }
    if (valid.length) setPendingFiles((prev) => [...prev, ...valid])
  }

  const handleEditTransaction = async () => {
    const alloc = editTxForm?.allocations[0]
    if (!editTxForm || !alloc || !alloc.amount || isNaN(parseFloat(alloc.amount))) { toast.error("Valid amount is required"); return }
    if (amountExceedsLimit(alloc.amount)) { toast.error("Amount is too large"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch<Transaction>(`/api/transactions/${editTxForm.id}`, token, { type: editTxForm.type, amount: parseFloat(alloc.amount), wealth_account_id: alloc.account_id, description: editTxForm.description, category: editTxForm.category, date: editTxForm.date })
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

  const handleToggleClosed = async () => {
    if (!client) return
    const closing = !client.closed_at
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/clients/${client.id}`, token, { closed: closing })
      toast.success(closing ? "Client closed" : "Client reopened")
      loadData()
    } catch {
      toast.error("Action failed")
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
              {client.closed_at && <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-300">Closed</Badge>}
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
          {/* Actions — kept in the client-name row on every breakpoint to save
              vertical space on mobile (icon-only there, labelled on desktop). */}
          <div className="flex gap-1.5 sm:gap-2 shrink-0">
            {/* The own/internal company is permanent — it anchors internal expenses. Keep
                Close and Delete VISIBLE (so the page matches every other client) but
                DISABLED with a hint for it; the server also rejects both for is_own. */}
            <Button
              variant="outline"
              size="icon"
              disabled={client.is_own}
              onClick={() => setCloseConfirm(true)}
              aria-label={client.is_own ? "Your own company can't be closed" : client.closed_at ? "Reopen client" : "Close client"}
              title={client.is_own ? "Your own company can't be closed" : client.closed_at ? "Reopen client" : "Close client"}
            >
              {client.closed_at ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={() => setOverviewOpen(true)} aria-label="View client"><Eye className="size-4" /></Button>
            <Button
              variant="outline"
              size="icon"
              disabled={client.is_own}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => { setDeleteId(client.id); setDeleteType("client") }}
              aria-label={client.is_own ? "Your own company can't be deleted" : "Delete client"}
              title={client.is_own ? "Your own company can't be deleted" : "Delete client"}
            >
              <Trash2 className="size-4" />
            </Button>
            <Button className="px-2.5 sm:px-4" onClick={() => { setTxForm(defaultTxForm()); setTxDialogOpen(true) }} aria-label="Add transaction">
              <Plus className="size-4" /><span className="hidden sm:inline">Add Transaction</span>
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">Income</p>
          <FitText className="text-emerald-600 dark:text-emerald-400 mt-1" textClassName="text-base sm:text-xl font-bold tabular-nums">{formatCurrency(totalIncoming)}</FitText>
          <p className="hidden sm:flex text-xs text-muted-foreground mt-1 items-center gap-1"><ArrowUpRight className="size-3" />{transactions.filter((t) => t.type === "incoming").length} transaction{transactions.filter((t) => t.type === "incoming").length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">Expenses</p>
          <FitText className="text-destructive mt-1" textClassName="text-base sm:text-xl font-bold tabular-nums">{formatCurrency(totalOutgoing)}</FitText>
          <p className="hidden sm:flex text-xs text-muted-foreground mt-1 items-center gap-1"><ArrowDownRight className="size-3" />{transactions.filter((t) => t.type === "outgoing").length} transaction{transactions.filter((t) => t.type === "outgoing").length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl border p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide truncate">Net</p>
          <FitText className={`mt-1 ${netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} textClassName="text-base sm:text-xl font-bold tabular-nums">{formatCurrency(netProfit)}</FitText>
          <p className="hidden sm:block text-xs text-muted-foreground mt-1">{totalIncoming > 0 ? ((netProfit / totalIncoming) * 100).toFixed(1) : 0}% margin</p>
        </div>
      </div>

      {/* Budget — tap to open this client's full budget history & insights; quick-edit inline. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => id && navigate(`/budgets/${id}`)}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && id) { e.preventDefault(); navigate(`/budgets/${id}`) } }}
        className="group w-full text-left rounded-xl border p-3 sm:p-4 cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium flex items-center gap-1.5"><PiggyBank className="size-4 text-muted-foreground" /> Budget</p>
          <div className="flex items-center gap-0.5">
            {canModify && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setBudgetDialogOpen(true) }}>
                {clientBudget ? <><Pencil className="size-3 mr-1" />Edit</> : <><Plus className="size-3 mr-1" />Set budget</>}
              </Button>
            )}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
          </div>
        </div>
        <div className="mt-3">
          {clientBudget ? (
            <BudgetIndicator amount={clientBudget.amount} spent={clientBudget.spent ?? 0} period={clientBudget.period} currency={currency} />
          ) : (
            <p className="text-xs text-muted-foreground">No budget set for this client.</p>
          )}
        </div>
      </div>

      {/* Transactions */}
      <div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 min-w-0 -mx-3 px-3 overflow-x-auto scrollbar-none sm:mx-0 sm:px-0 sm:overflow-visible">
              <TabsList>
                <TabsTrigger value="all">All ({transactions.length})</TabsTrigger>
                <TabsTrigger value="incoming">Income ({transactions.filter((t) => t.type === "incoming").length})</TabsTrigger>
                <TabsTrigger value="outgoing">Expenses ({transactions.filter((t) => t.type === "outgoing").length})</TabsTrigger>
              </TabsList>
            </div>
            <ExpandableSearch value={txSearch} onChange={setTxSearch} placeholder="Search transactions..." className="shrink-0" />
            <FilterSheet
              count={txFilterCount}
              onClear={() => { setTxSort("date_desc"); setTxFrom(""); setTxTo("") }}
              registerFloating={false}
              triggerClassName="shrink-0"
            >
              <FilterSection label="Sort by">
                <Select value={txSort} onValueChange={setTxSort}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date_desc">Newest first</SelectItem>
                    <SelectItem value="date_asc">Oldest first</SelectItem>
                    <SelectItem value="amount_desc">Amount (high → low)</SelectItem>
                    <SelectItem value="amount_asc">Amount (low → high)</SelectItem>
                  </SelectContent>
                </Select>
              </FilterSection>
              <FilterSection label="Date range">
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" aria-label="From" value={txFrom} max={txTo || undefined} onChange={(e) => setTxFrom(e.target.value)} />
                  <Input type="date" aria-label="To" value={txTo} min={txFrom || undefined} onChange={(e) => setTxTo(e.target.value)} />
                </div>
              </FilterSection>
            </FilterSheet>
            {id && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate(`/clients/${id}/files`)}>
                <FolderOpen className="size-4" /> Files
              </Button>
            )}
          </div>

          <TabsContent value={activeTab} className="mt-0">
            {filteredTx.length === 0 ? (
              <div className="py-16 text-center border rounded-xl">
                <DollarSign className="size-10 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground font-medium">No transactions found</p>
                <Button className="mt-3" variant="outline" onClick={() => { setTxForm(defaultTxForm()); setTxDialogOpen(true) }}><Plus className="size-4" />Add first transaction</Button>
              </div>
            ) : (
              <div className="border rounded-xl overflow-hidden">
                <div className="divide-y">
                  {filteredTx.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors group cursor-pointer" onClick={() => openTxView(tx)}>
                      <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${tx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                        {tx.type === "incoming" ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" /> : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.description || (tx.type === "incoming" ? "Income" : "Expense")}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                          {tx.category && <Badge variant="outline" className="text-xs py-0">{tx.category}</Badge>}
                          <AttachmentBadge count={tx.attachment_count} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {tx.type === "incoming" ? "+" : "−"}{formatCurrency(Number(tx.amount))}
                        </p>
                      </div>
                      <div className="flex gap-0.5 sm:gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); setEditTxForm({ id: tx.id, type: tx.type, allocations: [{ account_id: tx.wealth_account_id ?? defaultAccountId(accounts), amount: String(tx.amount) }], description: tx.description, category: tx.category, date: tx.date }); setEditTxDialogOpen(true) }}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(tx.id); setDeleteType("transaction") }}><Trash2 className="size-3.5" /></Button>
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
      <Dialog open={txDialogOpen} onOpenChange={(open) => { setTxDialogOpen(open); if (!open) setPendingFiles([]) }}>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-1">
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
            <AccountSelector
              accounts={accounts}
              allocations={txForm.allocations}
              onChange={(allocations) => setTxForm((f) => ({ ...f, allocations }))}
              currency={currency}
              onAddAccount={() => { setTxDialogOpen(false); navigate("/wealth") }}
              loading={accountsLoading}
            />
            <div className="space-y-1.5"><Label htmlFor="description">Description</Label><Textarea id="description" rows={2} className="resize-none" placeholder={txForm.type === "incoming" ? "Invoice #1234" : "Hosting fee"} value={txForm.description} onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <CategoryPicker type={txForm.type} value={txForm.category} onChange={(v) => setTxForm((f) => ({ ...f, category: v }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" value={txForm.date} onChange={(e) => setTxForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5"><Paperclip className="size-3.5" /> Attachments <span className="text-xs font-normal text-muted-foreground">(Max 2MB per file)</span></Label>
                <Button type="button" variant="outline" size="sm" onClick={() => addFileRef.current?.click()}>
                  <Upload className="size-3.5" /> Add file
                </Button>
                <input ref={addFileRef} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={handlePendingFileSelect} />
              </div>
              {pendingFiles.length > 0 && (
                <ul className="space-y-1.5">
                  {pendingFiles.map((file, idx) => (
                    <li key={idx} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      <FileText className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1 min-w-0">{file.name}</span>
                      <button type="button" onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive shrink-0" aria-label="Remove">
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddTransaction} disabled={saving}>{saving ? "Adding..." : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Transaction Dialog */}
      <Dialog open={editTxDialogOpen} onOpenChange={setEditTxDialogOpen}>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
          {editTxForm && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-1">
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
              <AccountSelector
                accounts={accounts}
                allocations={editTxForm.allocations}
                onChange={(allocations) => setEditTxForm((f) => f ? { ...f, allocations } : null)}
                currency={currency}
                max={1}
                onAddAccount={() => { setEditTxDialogOpen(false); navigate("/wealth") }}
                loading={accountsLoading}
              />
              <div className="space-y-1.5"><Label htmlFor="edit-description">Description</Label><Textarea id="edit-description" rows={2} className="resize-none" placeholder={editTxForm.type === "incoming" ? "Invoice #1234" : "Hosting fee"} value={editTxForm.description} onChange={(e) => setEditTxForm((f) => f ? { ...f, description: e.target.value } : null)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <CategoryPicker type={editTxForm.type} value={editTxForm.category} onChange={(v) => setEditTxForm((f) => f ? { ...f, category: v } : null)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-date">Date</Label>
                  <Input id="edit-date" type="date" value={editTxForm.date} onChange={(e) => setEditTxForm((f) => f ? { ...f, date: e.target.value } : null)} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
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
              <div className="space-y-1.5">
                <Label>Category</Label>
                <CategoryPicker type="client" value={clientForm.category ?? ""} onChange={(v) => setClientForm((f) => f ? { ...f, category: v } : null)} />
              </div>
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

      {/* Close / reopen confirmation */}
      <AlertDialog open={closeConfirm} onOpenChange={setCloseConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{client.closed_at ? "Reopen this client?" : "Close this client?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {client.closed_at
                ? "It will be active again and included in lists and analytics."
                : "It stays for history but is hidden from the default list and excluded from analytics. You can reopen it anytime."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setCloseConfirm(false); handleToggleClosed() }}>
              {client.closed_at ? "Reopen" : "Close"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Transaction detail modal */}
      <Dialog open={viewTx !== null} onOpenChange={(open) => { if (!open) setViewTx(null) }}>
        <DialogContent className="w-[92vw] max-w-md">
          {viewTx && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className={`flex size-7 items-center justify-center rounded-full ${viewTx.type === "incoming" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
                    {viewTx.type === "incoming" ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  </span>
                  Transaction
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className={`text-2xl font-bold tabular-nums ${viewTx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {viewTx.type === "incoming" ? "+" : "−"}{formatCurrency(Number(viewTx.amount))}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><p className="text-xs text-muted-foreground">Date</p><p className="font-medium">{formatDate(viewTx.date)}</p></div>
                  {viewTx.category && <div><p className="text-xs text-muted-foreground">Category</p><Badge variant="outline">{viewTx.category}</Badge></div>}
                </div>
                {viewTx.description && <div><p className="text-xs text-muted-foreground">Description</p><p className="text-sm whitespace-pre-wrap break-words">{viewTx.description}</p></div>}
                <div className="border-t pt-3 space-y-1.5">
                  <p className="text-sm font-medium flex items-center gap-1.5"><Paperclip className="size-3.5" /> Attachments</p>
                  {viewTxAtt.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No attachments.</p>
                  ) : viewTxAtt.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                      <button
                        type="button"
                        className="flex flex-1 items-center gap-2 min-w-0 text-left"
                        onClick={() => setViewAttachment({
                          id: att.id, source: "transaction", source_id: viewTx.id, source_label: viewTx.description?.trim() || (viewTx.type === "incoming" ? "Income" : "Expense"),
                          file_name: att.file_name, file_type: att.file_type, file_size: att.file_size,
                          created_at: att.created_at, display_name: att.display_name, tags: att.tags, category: att.category,
                        })}
                      >
                        <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 min-w-0 truncate text-xs font-medium">{att.display_name || att.file_name}</span>
                      </button>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 space-y-1.5">
                  <p className="text-sm font-medium">History</p>
                  <AuditHistory entityType="transaction" entityId={viewTx.id} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { const tx = viewTx; dropModalBackEntry(); setViewTx(null); setEditTxForm({ id: tx.id, type: tx.type, allocations: [{ account_id: tx.wealth_account_id ?? defaultAccountId(accounts), amount: String(tx.amount) }], description: tx.description, category: tx.category, date: tx.date }); setEditTxDialogOpen(true) }}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
                <Button onClick={() => setViewTx(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttachmentDetailModal
        item={viewAttachment}
        open={viewAttachment !== null}
        onOpenChange={(o) => { if (!o) setViewAttachment(null) }}
        canEdit={canModify}
        canDelete={canRemove}
        onUpdated={() => { if (viewTx) loadViewTxAtt(viewTx.id) }}
        onDeleted={() => { setViewAttachment(null); if (viewTx) loadViewTxAtt(viewTx.id) }}
      />

      <ClientOverviewModal
        client={client}
        open={overviewOpen}
        onOpenChange={setOverviewOpen}
        onEdit={() => { setClientForm(client); setEditClientDialogOpen(true) }}
        canModify={canModify}
        canRemove={canRemove}
        onFiles={id ? () => navigate(`/clients/${id}/files`) : undefined}
        totalIncoming={totalIncoming}
        totalOutgoing={totalOutgoing}
      />

      <BudgetDialog
        open={budgetDialogOpen}
        onOpenChange={setBudgetDialogOpen}
        clientId={client.id}
        label={client.name}
        current={clientBudget}
        prefill={defaultBudget ? { amount: defaultBudget.amount, period: defaultBudget.period } : null}
        onSaved={() => { void refreshBudget() }}
      />
    </div>
  )
}
