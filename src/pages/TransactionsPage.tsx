import { useEffect, useMemo, useState, useCallback, useRef } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import { amountExceedsLimit } from "@/lib/money"
import type { Budget, Client, Transaction, TransactionAttachment, WealthAccount } from "@/lib/types"
import { budgetState } from "@/lib/budget"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { useCategories } from "@/lib/use-categories"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { useMultiSelect } from "@/lib/use-multi-select"
import { useLongPress } from "@/lib/use-long-press"
import { BulkActionBar } from "@/components/BulkActionBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { FitText } from "@/components/FitText"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { toast } from "sonner"
import { Plus, ArrowUpRight, ArrowDownRight, DollarSign, Pencil, Trash2, Paperclip, Download, X, Eye, ChevronsUpDown, Check, Tag, CheckSquare, Layers } from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { AttachmentDetailModal, type AttachmentModalItem } from "@/components/AttachmentDetailModal"
import { TransactionAttachments } from "@/components/transactions/TransactionAttachments"
import { AuditHistory } from "@/components/AuditHistory"
import { accountDisplayName, formatMoney } from "@/lib/wealth"
import { WealthAccountIcon } from "@/components/WealthAccountIcon"
import { AccountSelector, type Allocation } from "@/components/AccountSelector"
import { useUrlModal } from "@/hooks/use-url-modal"
import { useDialogContainer } from "@/hooks/use-dialog-container"
import { loadLastTx, saveLastTx } from "@/lib/last-tx"

type PaginatedResponse<T> = { data: T[]; total: number; summary?: { incoming: number; outgoing: number } }

type TxForm = {
  client_id: string
  // One allocation per account. A single entry can be split across several
  // accounts; each allocation is saved as its own transaction row upstream.
  allocations: Allocation[]
  type: "incoming" | "outgoing"
  description: string
  category: string
  date: string
}

const PAGE_SIZE = 20

const defaultForm = (): TxForm => ({
  client_id: "",
  allocations: [],
  type: "incoming",
  description: "",
  category: "",
  date: new Date().toISOString().split("T")[0],
})

// Cash in Hand is the default source; fall back to the first account.
const defaultAccountId = (accounts: WealthAccount[]) =>
  accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? ""

const allocationFor = (tx: { wealth_account_id?: string | null; amount: number }, accounts: WealthAccount[]): Allocation[] => [
  { account_id: tx.wealth_account_id ?? defaultAccountId(accounts), amount: String(tx.amount) },
]

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Client combobox ─────────────────────────────────────────────────────────

function ClientCombobox({ clients, value, onChange }: {
  clients: Client[]
  value: string
  onChange: (id: string) => void
}) {
  const { t } = useTranslation("transactions")
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const selected = clients.find((c) => c.id === value)

  return (
    <div ref={triggerRef} className="contents">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {selected
            ? `${selected.name}${selected.company ? ` — ${selected.company}` : ""}`
            : <span className="text-muted-foreground">{t("selectClient")}</span>}
          <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        className="max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[--radix-popover-trigger-width] overflow-hidden p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={t("searchClients")} />
          <CommandList className="scrollbar-thin">
            <CommandEmpty>{t("noClientFound")}</CommandEmpty>
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.company}`}
                  onSelect={() => { onChange(c.id); setOpen(false) }}
                >
                  <Check className={`mr-2 size-4 shrink-0 ${value === c.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{c.name}{c.company ? ` — ${c.company}` : ""}</span>
                  {c.is_own && (
                    <Badge variant="outline" className="ml-auto text-[10px] py-0 shrink-0">{t("own")}</Badge>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  )
}

// ─── Category combobox ────────────────────────────────────────────────────────

function CategoryCombobox({ categories, value, onChangeCategories, onChange }: {
  categories: string[]
  value: string
  onChangeCategories: (cats: string[]) => void
  onChange: (v: string) => void
}) {
  const { t } = useTranslation("transactions")
  const { triggerRef, container } = useDialogContainer()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editVal, setEditVal] = useState("")

  const filtered = categories.filter((c) => c.toLowerCase().includes(search.toLowerCase()))
  const canAdd = search.trim() !== "" && !categories.some((c) => c.toLowerCase() === search.trim().toLowerCase())

  function close() { setOpen(false); setSearch(""); setEditingIdx(null) }

  function select(cat: string) { onChange(cat); close() }

  function addCategory() {
    const name = search.trim()
    if (!name) return
    const next = [...categories, name]
    onChangeCategories(next)
    onChange(name)
    close()
  }

  function startEdit(idx: number) {
    setEditingIdx(idx)
    setEditVal(categories[idx])
  }

  function saveEdit(idx: number) {
    const trimmed = editVal.trim()
    if (!trimmed) return
    if (trimmed !== categories[idx] && categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return
    const next = [...categories]
    const old = next[idx]
    next[idx] = trimmed
    onChangeCategories(next)
    if (value === old) onChange(trimmed)
    setEditingIdx(null)
  }

  function deleteCategory(idx: number) {
    const next = categories.filter((_, i) => i !== idx)
    onChangeCategories(next)
    if (value === categories[idx]) onChange("")
  }

  return (
    <div ref={triggerRef} className="contents">
    <Popover open={open} onOpenChange={(o) => { if (!o) close(); else setOpen(true) }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {value || <span className="text-muted-foreground">{t("select")}</span>}
          <ChevronsUpDown className="size-4 ml-2 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        className="flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-[--radix-popover-trigger-width] flex-col overflow-hidden p-0"
        align="start"
      >
        <div className="p-2 border-b shrink-0">
          <Input
            placeholder={t("searchOrTypeToAdd")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && canAdd) addCategory() }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          {filtered.length === 0 && !canAdd && (
            <p className="text-xs text-muted-foreground text-center py-4">{t("noCategoriesFound")}</p>
          )}
          {filtered.map((cat) => {
            const realIdx = categories.indexOf(cat)
            return (
              <div key={cat} className="flex items-center gap-0.5 px-1 py-0.5 group">
                {editingIdx === realIdx ? (
                  <>
                    <Input
                      value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(realIdx)
                        if (e.key === "Escape") setEditingIdx(null)
                      }}
                    />
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => saveEdit(realIdx)}>
                      <Check className="size-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => setEditingIdx(null)}>
                      <X className="size-3" />
                    </Button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex-1 text-sm text-left py-1.5 px-2 rounded-md hover:bg-muted transition-colors flex items-center gap-2"
                      onClick={() => select(cat)}
                    >
                      <Check className={`size-3 shrink-0 text-primary ${value === cat ? "opacity-100" : "opacity-0"}`} />
                      {cat}
                    </button>
                    <Button
                      size="icon" variant="ghost"
                      className="size-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); startEdit(realIdx) }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      className="size-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); deleteCategory(realIdx) }}
                    >
                      <X className="size-3" />
                    </Button>
                  </>
                )}
              </div>
            )
          })}
          {canAdd && (
            <button
              className="w-full text-left text-sm px-3 py-2 flex items-center gap-2 text-primary hover:bg-muted transition-colors"
              onClick={addCategory}
            >
              <Plus className="size-3.5" />
              {t("addCategory", { category: search.trim() })}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
    </div>
  )
}

// ─── Transaction form fields ──────────────────────────────────────────────────

function TxFormFields({
  f, onChange, showClient, clients, accounts, accountsLoading, categories, onChangeCats, onAddAccount, currency, singleAccount = false, budget = null,
}: {
  f: TxForm
  onChange: (patch: Partial<TxForm>) => void
  showClient: boolean
  clients: Client[]
  accounts: WealthAccount[]
  accountsLoading: boolean
  categories: { incoming: string[]; outgoing: string[] }
  onChangeCats: (type: "incoming" | "outgoing", cats: string[]) => void
  onAddAccount: () => void
  currency: string
  singleAccount?: boolean
  // The resolved expense budget for the current client (or personal/org budget),
  // used to show the live "x left after this expense" impact on outgoing.
  budget?: Budget | null
}) {
  const { t } = useTranslation("transactions")
  const cats = f.type === "incoming" ? categories.incoming : categories.outgoing
  // Live budget impact (outgoing only): sum the split allocations and project the
  // remaining budget for its period.
  const txTotal = f.allocations.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)
  const budgetHint = (() => {
    if (f.type !== "outgoing" || !budget || budget.amount <= 0 || txTotal <= 0) return null
    const { remaining, state } = budgetState((budget.spent ?? 0) + txTotal, budget.amount)
    return remaining >= 0
      ? { over: false, state, text: t("budget.remainingAfter", { ns: "translation", amount: formatMoney(remaining, currency) }) }
      : { over: true, state, text: t("budget.overAfter", { ns: "translation", amount: formatMoney(-remaining, currency) }) }
  })()

  return (
    <div className="space-y-4 py-2">
      {showClient && (
        <div className="space-y-1.5">
          <Label>{t("clientRequired")}</Label>
          <ClientCombobox clients={clients} value={f.client_id} onChange={(id) => onChange({ client_id: id })} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{t("type")}</Label>
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
              {t(type)}
            </button>
          ))}
        </div>
      </div>
      <AccountSelector
        accounts={accounts}
        allocations={f.allocations}
        onChange={(allocations) => onChange({ allocations })}
        currency={currency}
        max={singleAccount ? 1 : Infinity}
        onAddAccount={onAddAccount}
        loading={accountsLoading}
      />
      {budgetHint && (
        <p className={`-mt-1 text-xs ${budgetHint.over ? "text-red-600 dark:text-red-400" : budgetHint.state === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
          {budgetHint.text}
        </p>
      )}
      <div className="space-y-1.5">
        <Label>{t("description")}</Label>
        <Textarea
          placeholder={f.type === "incoming" ? t("invoicePlaceholder") : t("hostingFeePlaceholder")}
          value={f.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={3}
          className="resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("category")}</Label>
          <CategoryCombobox
            categories={cats}
            value={f.category}
            onChangeCategories={(next) => onChangeCats(f.type, next)}
            onChange={(v) => onChange({ category: v })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("date")}</Label>
          <Input type="date" value={f.date} onChange={(e) => onChange({ date: e.target.value })} />
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TransactionsPage() {
  const { t } = useTranslation("transactions")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // ?view=<txId> drives the detail modal; useUrlModal makes browser/OS back
  // close it (and keeps it deep-linkable) instead of leaving the page.
  const view = useUrlModal("view")
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  // Personal accounts have no Clients UI — the client picker is hidden and
  // transactions anchor to the workspace's single default client server-side.
  const isPersonal = activeOrg?.account_type === "personal"
  const canDelete = canDeleteRole(activeOrg?.role)
  const canWrite = canWriteRole(activeOrg?.role)
  const sel = useMultiSelect()
  const longPress = useLongPress()
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(n)

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [accounts, setAccounts] = useState<WealthAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  // Expense budgets keyed by client_id; the org/personal budget is keyed by "".
  // Drives the live "x left after this expense" hint in the add/edit form.
  const [budgetMap, setBudgetMap] = useState<Map<string, Budget>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState("all")
  const [sort, setSort] = useState("date_desc")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [summary, setSummary] = useState<{ incoming: number; outgoing: number }>({ incoming: 0, outgoing: 0 })
  const searchRef = useRef(search)
  searchRef.current = search
  const tabRef = useRef(tab)
  tabRef.current = tab
  const sortRef = useRef(sort)
  sortRef.current = sort
  const categoryRef = useRef(categoryFilter)
  categoryRef.current = categoryFilter
  const dateFromRef = useRef(dateFrom)
  dateFromRef.current = dateFrom
  const dateToRef = useRef(dateTo)
  dateToRef.current = dateTo
  const appliedFilterCount =
    (tab !== "all" ? 1 : 0) + (categoryFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)
  const clearFilters = () => {
    setTab("all")
    setCategoryFilter("all")
    setSort("date_desc")
    setDateFrom("")
    setDateTo("")
  }

  // Categories are now org-scoped and managed server-side (see /categories).
  const { categories: catRows, byType: categories, refresh: refreshCats } = useCategories()

  // The picker emits the full desired name list for a type; diff it against the
  // server state and apply the minimal create/rename/delete. A single
  // swap (one added + one removed, same length) is treated as a rename so the
  // matching transactions' stored category text is updated too.
  const handleChangeCats = useCallback(
    async (type: "incoming" | "outgoing", names: string[]) => {
      const token = await getToken()
      if (!token) return
      const current = catRows.filter((c) => c.type === type)
      const currentNames = current.map((c) => c.name)
      const added = names.filter((n) => !currentNames.includes(n))
      const removed = currentNames.filter((n) => !names.includes(n))
      try {
        if (added.length === 1 && removed.length === 1 && names.length === currentNames.length) {
          const cat = current.find((c) => c.name === removed[0])
          if (cat) await apiPatch(`/api/categories/${cat.id}`, token, { name: added[0] })
        } else {
          for (const n of added) await apiPost("/api/categories", token, { name: n, type })
          for (const n of removed) {
            const cat = current.find((c) => c.name === n)
            if (cat) await apiDelete(`/api/categories/${cat.id}`, token)
          }
        }
        await refreshCats()
      } catch {
        toast.error("Failed to update categories")
      }
    },
    [getToken, catRows, refreshCats],
  )

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteLegCount, setDeleteLegCount] = useState(1)
  const [viewTx, setViewTx] = useState<Transaction | null>(null)
  const [viewLegs, setViewLegs] = useState<Transaction[]>([])
  const [viewAttachment, setViewAttachment] = useState<AttachmentModalItem | null>(null)
  const [form, setForm] = useState<TxForm>(defaultForm())
  const [editForm, setEditForm] = useState<TxForm & { id: string; group_id?: string | null } | null>(null)
  const [saving, setSaving] = useState(false)

  const [attachments, setAttachments] = useState<TransactionAttachment[]>([])
  const [attachLoading, setAttachLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteAttachId, setDeleteAttachId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const addFileInputRef = useRef<HTMLInputElement>(null)

  const buildParams = useCallback(
    (pageNum: number, s: string, t: string, srt: string, cat: string, from: string, to: string) => {
      const params = new URLSearchParams({ page: String(pageNum) })
      if (s.trim()) params.set("search", s.trim())
      if (t !== "all") params.set("type", t)
      if (srt) params.set("sort", srt)
      if (cat && cat !== "all") params.set("category", cat)
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      return params.toString()
    },
    [],
  )

  // `silent` reconciles the list/summary in the background WITHOUT swapping to the
  // skeleton — used after a mutation so the screen never "reloads"; React diffs by
  // key, so only the added/changed row actually re-renders.
  const fetchPage1 = useCallback(async (opts?: { silent?: boolean }) => {
    const token = await getToken()
    if (!token) return
    if (!opts?.silent) setLoading(true)
    try {
      const [result, cls] = await Promise.all([
        apiGet<PaginatedResponse<Transaction>>(`/api/transactions?${buildParams(1, searchRef.current, tabRef.current, sortRef.current, categoryRef.current, dateFromRef.current, dateToRef.current)}`, token),
        apiGet<{ data: Client[]; total: number } | Client[]>("/api/clients?page=1", token),
      ])
      setTransactions(result.data)
      setTotal(result.total)
      setSummary(result.summary ?? { incoming: 0, outgoing: 0 })
      setPage(1)
      const clsData = Array.isArray(cls) ? cls : cls.data
      setClients(clsData)
    } catch (err) {
      console.error("Failed to load transactions:", err)
      if (!opts?.silent) toast.error("Failed to load transactions")
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [getToken, buildParams])

  useEffect(() => {
    const timer = setTimeout(() => { fetchPage1() }, search === "" ? 0 : 300)
    return () => clearTimeout(timer)
  }, [search, tab, sort, categoryFilter, dateFrom, dateTo, fetchPage1])

  // Accounts load independently of the (slower) transactions query so the
  // transaction form's source picker is ready fast and never flashes an empty
  // state. Refreshes when accounts change elsewhere (e.g. on the Wealth page).
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

  const loadBudgets = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    try {
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      const m = new Map<string, Budget>()
      for (const b of res.budgets) m.set(b.client_id ?? "", b)
      setBudgetMap(m)
    } catch {
      /* non-blocking — the form just won't show a budget hint */
    }
  }, [getToken])

  useEffect(() => { void loadBudgets() }, [loadBudgets])

  // Resolve the budget for a form. Personal → the org/personal budget (its spend is
  // the whole workspace). Business → the client's OWN budget only; the org default
  // is a template (spend isn't client-specific), so it's not used for the live hint.
  const budgetFor = useCallback(
    (clientId: string | undefined): Budget | null =>
      (isPersonal ? budgetMap.get("") : clientId ? budgetMap.get(clientId) : undefined) ?? null,
    [isPersonal, budgetMap],
  )

  // Remembers a requested source account (e.g. opened from a wealth account
  // page) until accounts finish loading, so the seed effect below can apply it.
  const pendingAddAccountRef = useRef<string | null>(null)

  const openAddDialog = useCallback((preselectAccountId?: string) => {
    const last = loadLastTx()
    // Default the source to the explicitly requested account, else the last-used
    // one, else Cash in Hand — so the last account leads next time.
    const desired = preselectAccountId ?? last.wealth_account_id
    pendingAddAccountRef.current = desired ?? null
    const accountId = (desired && accounts.some((a) => a.id === desired))
      ? desired
      : defaultAccountId(accounts)
    setForm({
      ...defaultForm(),
      client_id: last.client_id ?? "",
      allocations: accountId ? [{ account_id: accountId, amount: "" }] : [],
      type: last.type ?? "incoming",
      category: last.category ?? "",
    })
    setPendingFiles([])
    setAddOpen(true)
  }, [accounts])

  // If the add dialog opened before accounts loaded (deep link on a cold page),
  // seed the default source — the requested account if valid, else Cash in Hand.
  useEffect(() => {
    if (!addOpen || accounts.length === 0) return
    setForm((f) => {
      if (f.allocations.length > 0) return f
      const want = pendingAddAccountRef.current && accounts.some((a) => a.id === pendingAddAccountRef.current)
        ? pendingAddAccountRef.current
        : defaultAccountId(accounts)
      return want ? { ...f, allocations: [{ account_id: want, amount: "" }] } : f
    })
  }, [addOpen, accounts])

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openAddDialog(searchParams.get("account") ?? undefined)
      const next = new URLSearchParams(searchParams)
      next.delete("new")
      next.delete("account")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams, openAddDialog])

  // Keep the detail modal in sync with ?view=<txId>: opens on a pasted/deep link
  // and closes when the param is removed (e.g. browser/OS back). Uses showTx so
  // it never re-pushes a history entry the user didn't create.
  useEffect(() => {
    const viewId = view.value
    if (!viewId) { if (viewTx) setViewTx(null); return }
    if (viewTx?.id === viewId) return
    const existing = transactions.find((t) => t.id === viewId)
    if (existing) { showTx(existing); return }
    ;(async () => {
      const token = await getToken()
      if (!token) return
      try {
        const tx = await apiGet<Transaction>(`/api/transactions/${viewId}`, token)
        if (tx) showTx(tx)
      } catch { /* not found or no access */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.value, transactions])

  const handleLoadMore = async () => {
    const token = await getToken()
    if (!token) return
    setLoadingMore(true)
    try {
      const nextPage = page + 1
      const result = await apiGet<PaginatedResponse<Transaction>>(
        `/api/transactions?${buildParams(nextPage, search, tab, sort, categoryFilter, dateFrom, dateTo)}`,
        token,
      )
      setTransactions((prev) => [...prev, ...result.data])
      setTotal(result.total)
      if (result.summary) setSummary(result.summary)
      setPage(nextPage)
    } catch (err) {
      console.error("Failed to load more transactions:", err)
      toast.error("Failed to load more transactions")
    } finally {
      setLoadingMore(false)
    }
  }

  // Income/expense totals come from the server (full filtered set), so they stay
  // correct across pagination and reflect the search + category filters.
  const totalIncoming = summary.incoming
  const totalOutgoing = summary.outgoing
  const ownClientIds = useMemo(() => new Set(clients.filter((c) => c.is_own).map((c) => c.id)), [clients])
  // Filter options = the user's defined categories plus any category that appears
  // in the loaded transactions (covers ones added on another device).
  const allCategoryOptions = useMemo(() => {
    const set = new Set<string>([...categories.incoming, ...categories.outgoing])
    for (const tx of transactions) if (tx.category?.trim()) set.add(tx.category.trim())
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [categories, transactions])

  // Open the add dialog pre-filled with the last-used client/type/category
  // (date always today), so repeat entry is fast.
  async function handleAdd() {
    if (!isPersonal && !form.client_id) { toast.error(t("clientIsRequired")); return }
    const allocs = form.allocations.filter((a) => a.account_id && Number(a.amount) > 0)
    if (allocs.length === 0) { toast.error(t("validAmountIsRequired")); return }
    if (allocs.some((a) => amountExceedsLimit(a.amount))) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      // A split entry is ONE logical transaction saved atomically as one group of
      // account-legs (the server shares a group_id across them and syncs each
      // account's balance). Attachments anchor to the first returned leg.
      const result = await apiPost<{ group_id: string | null; ids: string[] }>("/api/transactions/group", token, {
        client_id: form.client_id,
        type: form.type,
        description: form.description,
        category: form.category,
        date: form.date,
        allocations: allocs.map((a) => ({ wealth_account_id: a.account_id, amount: parseFloat(a.amount) })),
      })
      const firstId = result.ids[0] ?? null
      if (firstId) {
        for (const file of pendingFiles) {
          try {
            await uploadFile(file, firstId, token)
          } catch {
            toast.error(t("failedToUploadFile", { name: file.name }))
          }
        }
      }
      saveLastTx({ client_id: form.client_id, type: form.type, category: form.category, wealth_account_id: allocs[0]?.account_id })
      toast.success(t("transactionAdded"))
      setAddOpen(false)
      setForm(defaultForm())
      setPendingFiles([])
      fetchPage1({ silent: true })
    } catch {
      toast.error(t("failedToAddTransaction"))
    } finally {
      setSaving(false)
    }
  }

  // Open the edit dialog. For a split (grouped) row we load every leg so the user
  // edits the whole split; a single-account row prefills one allocation.
  async function openEditTx(tx: Transaction) {
    const isGroup = (tx.leg_count ?? 1) > 1 || !!tx.group_id
    if (isGroup && tx.group_id) {
      // A split must be edited as the full set of legs. If we can't load them,
      // abort rather than silently collapsing the split into a single account
      // (which would destroy the split on save).
      try {
        const token = await getToken()
        const legs = token ? await apiGet<Transaction[]>(`/api/transactions?groupId=${tx.group_id}`, token) : []
        if (!legs.length) { toast.error(t("failedToUpdateTransaction")); return }
        setEditForm({
          id: legs[0].id,
          group_id: tx.group_id,
          client_id: tx.client_id,
          allocations: legs.map((l) => ({ account_id: l.wealth_account_id ?? "", amount: String(l.amount) })),
          type: tx.type, description: tx.description, category: tx.category, date: tx.date,
        })
        setEditOpen(true)
      } catch {
        toast.error(t("failedToUpdateTransaction"))
      }
      return
    }
    setEditForm({
      id: tx.id, group_id: tx.group_id ?? null, client_id: tx.client_id,
      allocations: allocationFor(tx, accounts), type: tx.type, description: tx.description, category: tx.category, date: tx.date,
    })
    setEditOpen(true)
  }

  async function handleEdit() {
    if (!editForm) return
    const allocs = editForm.allocations.filter((a) => a.account_id && Number(a.amount) > 0)
    if (allocs.length === 0) { toast.error(t("validAmountIsRequired")); return }
    if (allocs.some((a) => amountExceedsLimit(a.amount))) { toast.error(t("common.amountTooLarge")); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      // A split (existing group, or a single edited into multiple accounts) is
      // replaced wholesale: delete the old group (reverses balances) then recreate.
      // A single→single edit stays a balance-preserving in-place PATCH.
      if (editForm.group_id || allocs.length > 1) {
        await apiDelete(`/api/transactions/${editForm.id}`, token)
        await apiPost("/api/transactions/group", token, {
          client_id: editForm.client_id,
          type: editForm.type,
          description: editForm.description,
          category: editForm.category,
          date: editForm.date,
          allocations: allocs.map((a) => ({ wealth_account_id: a.account_id, amount: parseFloat(a.amount) })),
        })
      } else {
        const alloc = allocs[0]
        await apiPatch<Transaction>(`/api/transactions/${editForm.id}`, token, {
          type: editForm.type,
          wealth_account_id: alloc.account_id,
          amount: parseFloat(alloc.amount),
          description: editForm.description,
          category: editForm.category,
          date: editForm.date,
        })
      }
      toast.success(t("transactionUpdated"))
      setEditOpen(false)
      setEditForm(null)
      fetchPage1({ silent: true })
    } catch {
      toast.error(t("failedToUpdateTransaction"))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    const id = deleteId
    // Optimistic: remove the row instantly + adjust the summary; reconcile only on failure.
    const removed = transactions.find((t) => t.id === id)
    setDeleteId(null)
    setTransactions((prev) => prev.filter((tx) => tx.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    if (removed) {
      const amt = Number(removed.amount)
      setSummary((s) => removed.type === "incoming" ? { ...s, incoming: s.incoming - amt } : { ...s, outgoing: s.outgoing - amt })
    }
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/transactions/${id}`, token)
      toast.success(t("transactionDeleted"))
    } catch {
      toast.error(t("failedToDeleteTransaction"))
      fetchPage1({ silent: true }) // restore the row on failure
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
      toast.error(t("failedToLoadAttachments"))
    } finally {
      setAttachLoading(false)
    }
  }

  // Load every account-leg of a split so the detail view can break it down.
  async function loadLegs(groupId: string) {
    try {
      const token = await getToken()
      if (!token) return
      setViewLegs(await apiGet<Transaction[]>(`/api/transactions?groupId=${groupId}`, token))
    } catch { /* non-blocking — the row total still shows */ }
  }

  // Show the transaction without touching the URL (used by the deep-link effect).
  function showTx(tx: Transaction) {
    setViewTx(tx)
    setAttachments([])
    setViewLegs([])
    loadAttachments(tx.id)
    if ((tx.leg_count ?? 1) > 1 && tx.group_id) loadLegs(tx.group_id)
  }

  // User-initiated open: push ?view=<id> so back closes the modal.
  function openViewModal(tx: Transaction) {
    showTx(tx)
    view.open(tx.id)
  }

  function closeViewModal() {
    setViewTx(null)
    view.close()
  }

  async function uploadFile(file: File, txId: string, token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1]
        const res = await fetch(`/api/transactions/${txId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            file_name: file.name,
            file_type: file.type || "application/octet-stream",
            file_size: file.size,
            file_data: base64,
          }),
        })
        if (!res.ok) reject(new Error("Upload failed"))
        else resolve()
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })
  }

  function handleAddFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    const valid = files.filter((f) => {
      if (f.size > 2 * 1024 * 1024) {
        toast.error(t("fileExceeds2MBLimit", { name: f.name }))
        return false
      }
      return true
    })
    setPendingFiles((prev) => [...prev, ...valid])
    if (addFileInputRef.current) addFileInputRef.current.value = ""
  }

  function removePendingFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !viewTx) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t("fileExceeds2MB"))
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
          throw new Error((err as { error?: string }).error ?? t("uploadFailed"))
        }
        toast.success(t("attachmentUploaded"))
        loadAttachments(viewTx.id)
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : t("failedToUploadAttachment"))
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
      toast.error(t("failedToDownloadAttachment"))
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
      toast.success(t("attachmentDeleted"))
      setDeleteAttachId(null)
      loadAttachments(viewTx.id)
    } catch {
      toast.error(t("failedToDeleteAttachment"))
    }
  }

  const selectableIds = transactions.map((tx) => tx.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => sel.isSelected(id))

  async function handleBulkDelete() {
    if (sel.count === 0) return
    const ids = sel.selectedIds
    // Optimistic: drop the selected rows + adjust the summary immediately.
    const removed = transactions.filter((tx) => ids.includes(tx.id))
    setTransactions((prev) => prev.filter((tx) => !ids.includes(tx.id)))
    setTotal((n) => Math.max(0, n - removed.length))
    setSummary((s) => {
      let incoming = s.incoming, outgoing = s.outgoing
      for (const r of removed) {
        if (r.type === "incoming") incoming -= Number(r.amount)
        else outgoing -= Number(r.amount)
      }
      return { incoming, outgoing }
    })
    sel.exitSelection()
    setBulkDeleting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const { deleted } = await apiPost<{ deleted: number }>("/api/transactions/bulk-delete", token, { ids })
      toast.success(t("multiSelect.deleted", { count: deleted }))
    } catch {
      toast.error(t("multiSelect.deleteFailed"))
      fetchPage1({ silent: true }) // restore rows on failure
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("transactions")}</h1>
          {!loading && <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">{t("totalCount", { count: total })}</p>}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {canDelete && transactions.length > 0 && (
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
          <Button onClick={() => openAddDialog()} className="shrink-0">
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("addTransaction")}</span>
            <span className="sm:hidden">{t("add")}</span>
          </Button>
        </div>
      </div>

      {!loading && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
          <div className="rounded-xl border p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide">{t("income")}</p>
            <FitText className="text-emerald-600 dark:text-emerald-400 mt-1" textClassName="text-base sm:text-xl font-bold tabular-nums">{fmt(totalIncoming)}</FitText>
          </div>
          <div className="rounded-xl border p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide">{t("expenses")}</p>
            <FitText className="text-red-600 dark:text-red-400 mt-1" textClassName="text-base sm:text-xl font-bold tabular-nums">{fmt(totalOutgoing)}</FitText>
          </div>
          <div className="rounded-xl border p-3 sm:p-4">
            <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide">{t("net")}</p>
            <FitText className={`mt-1 ${totalIncoming - totalOutgoing >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} textClassName="text-base sm:text-xl font-bold tabular-nums">
              {fmt(totalIncoming - totalOutgoing)}
            </FitText>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 sm:gap-3">
        <ExpandableSearch
          value={search}
          onChange={setSearch}
          placeholder={t("searchByClientDescriptionCategory")}
          expandedClassName="w-full sm:w-72"
        />
        <FilterSheet count={appliedFilterCount} onClear={clearFilters} triggerClassName="shrink-0 ml-auto">
          <FilterSection label={t("filters.type")}>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full">
                <TabsTrigger value="all" className="flex-1">{t("all")}</TabsTrigger>
                <TabsTrigger value="incoming" className="flex-1">{t("income")}</TabsTrigger>
                <TabsTrigger value="outgoing" className="flex-1">{t("expenses")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </FilterSection>
          <FilterSection label={t("category")}>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full">
                <Tag className="size-3.5 opacity-60" />
                <SelectValue placeholder={t("category")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allCategories")}</SelectItem>
                {allCategoryOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterSection>
          <FilterSection label={t("filters.sortBy")}>
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("sortBy")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date_desc">{t("dateNewest")}</SelectItem>
                <SelectItem value="date_asc">{t("dateOldest")}</SelectItem>
                <SelectItem value="amount_desc">{t("amountLargest")}</SelectItem>
                <SelectItem value="amount_asc">{t("amountSmallest")}</SelectItem>
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

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      ) : transactions.length === 0 ? (
        <div className="py-20 text-center border rounded-xl">
          <DollarSign className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground font-medium">
            {search || tab !== "all" || categoryFilter !== "all" || dateFrom || dateTo ? t("noTransactionsMatchFilters") : t("noTransactionsYet")}
          </p>
          {!search && tab === "all" && categoryFilter === "all" && !dateFrom && !dateTo && clients.length > 0 && (
            <Button className="mt-4" onClick={() => openAddDialog()}>
              <Plus className="size-4" />
              {t("addFirstTransaction")}
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
                  className={`flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 hover:bg-muted/50 transition-colors group cursor-pointer ${sel.isSelected(tx.id) ? "bg-primary/5" : ""}`}
                  onClick={() => {
                    if (sel.selectionMode) { sel.toggle(tx.id); return }
                    if (longPress.didLongPress()) return
                    openViewModal(tx)
                  }}
                  {...(canDelete ? longPress.bind(() => sel.enterSelection(tx.id)) : {})}
                >
                  {sel.selectionMode ? (
                    <Checkbox
                      checked={sel.isSelected(tx.id)}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => sel.toggle(tx.id)}
                      className="shrink-0"
                      aria-label="Select transaction"
                    />
                  ) : (
                    <div className={`size-9 rounded-full flex items-center justify-center shrink-0 ${
                      tx.type === "incoming" ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-red-100 dark:bg-red-900/30"
                    }`}>
                      {tx.type === "incoming"
                        ? <ArrowUpRight className="size-4 text-emerald-600 dark:text-emerald-400" />
                        : <ArrowDownRight className="size-4 text-red-600 dark:text-red-400" />}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium truncate min-w-0 flex-1">
                        {tx.description
                          ? tx.description.length > 60 ? tx.description.slice(0, 60) + "…" : tx.description
                          : (tx.type === "incoming" ? t("income") : t("expense"))}
                      </p>
                      {(tx.leg_count ?? 1) > 1 && (
                        <Badge variant="secondary" className="text-[10px] py-0 shrink-0 gap-1">
                          <Layers className="size-3" /> {t("split")}
                        </Badge>
                      )}
                      {tx.category && (
                        <Badge variant="outline" className="text-xs py-0 shrink-0 hidden sm:inline-flex">{tx.category}</Badge>
                      )}
                      <AttachmentBadge count={tx.attachment_count} />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 min-w-0">
                      {!isPersonal && (
                        <>
                          <button
                            className="text-xs text-primary hover:underline truncate min-w-0"
                            onClick={(e) => { e.stopPropagation(); navigate(`/clients/${tx.client_id}`) }}
                          >
                            {tx.client_name ?? tx.client_id}
                          </button>
                          {ownClientIds.has(tx.client_id) && (
                            <Badge variant="outline" className="text-[10px] py-0 shrink-0">Own</Badge>
                          )}
                          <span className="text-xs text-muted-foreground shrink-0">·</span>
                        </>
                      )}
                      <span className="text-xs text-muted-foreground shrink-0">{formatDate(tx.date)}</span>
                      {(tx.leg_count ?? 1) > 1 ? (
                        <>
                          <span className="hidden text-xs text-muted-foreground shrink-0 sm:inline">·</span>
                          <span className="hidden text-xs text-muted-foreground shrink-0 sm:inline">
                            {t("splitAccounts", { count: tx.account_count ?? tx.leg_count })}
                          </span>
                        </>
                      ) : (tx.wealth_account_name || tx.wealth_account_bank_name) ? (
                        <>
                          <span className="hidden text-xs text-muted-foreground shrink-0 sm:inline">·</span>
                          <span className="hidden min-w-0 max-w-[10rem] truncate text-xs text-muted-foreground sm:inline">
                            {accountDisplayName({ bank_name: tx.wealth_account_bank_name ?? "", nickname: tx.wealth_account_name ?? "" })}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <p className={`text-sm font-semibold shrink-0 tabular-nums text-right ${
                    tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}>
                    {tx.type === "incoming" ? "+" : "−"}{fmt(Number(tx.amount))}
                  </p>

                  <div className={`hidden sm:flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${sel.selectionMode ? "sm:hidden" : ""}`}>
                    <Button variant="ghost" size="icon" className="size-8 sm:size-9" onClick={(e) => { e.stopPropagation(); openViewModal(tx) }}>
                      <Eye className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 sm:size-9" onClick={(e) => {
                      e.stopPropagation()
                      openEditTx(tx)
                    }}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8 sm:size-9 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteLegCount(tx.leg_count ?? 1); setDeleteId(tx.id) }}>
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
                {loadingMore ? t("loading") : t("loadMore", { remaining: total - transactions.length })}
              </Button>
            </div>
          )}
        </>
      )}

      {/* View Modal — driven by useUrlModal(?view), which already owns the history
          entry, so opt out of the Dialog's own back-close to avoid a double entry. */}
      <Dialog open={viewTx !== null} onOpenChange={(open) => { if (!open) closeViewModal() }} disableBackClose>
        <DialogContent className="w-[92vw] max-w-md">
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
                  {t("transactionDetails")}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3 py-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("amount")}</p>
                    <p className={`font-semibold mt-0.5 ${viewTx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {viewTx.type === "incoming" ? "+" : "−"}{fmt(Number(viewTx.amount))}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("type")}</p>
                    <Badge variant={viewTx.type === "incoming" ? "default" : "secondary"} className="mt-0.5">
                      {viewTx.type === "incoming" ? t("income") : t("expense")}
                    </Badge>
                  </div>
                  {!isPersonal && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("client")}</p>
                      <button
                        className="text-sm text-primary hover:underline mt-0.5"
                        onClick={() => { setViewTx(null); navigate(`/clients/${viewTx.client_id}`) }}
                      >
                        {viewTx.client_name ?? viewTx.client_id}
                      </button>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("date")}</p>
                    <p className="mt-0.5">{formatDate(viewTx.date)}</p>
                  </div>
                  {viewTx.description && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("description")}</p>
                      <p className="mt-0.5 whitespace-pre-wrap">{viewTx.description}</p>
                    </div>
                  )}
                  {viewTx.category && (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("category")}</p>
                      <p className="mt-0.5">{viewTx.category}</p>
                    </div>
                  )}
                  {(viewTx.leg_count ?? 1) > 1 ? (
                    <div className="col-span-2">
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {t("splitAcross", { count: viewLegs.length || viewTx.account_count || viewTx.leg_count })}
                      </p>
                      <div className="mt-1.5 space-y-1.5">
                        {viewLegs.map((leg) => (
                          <div key={leg.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                            <span className="flex min-w-0 items-center gap-2">
                              <WealthAccountIcon
                                account={{ type: leg.wealth_account_type ?? "bank", icon: leg.wealth_account_icon ?? "bank" }}
                                className="size-6"
                              />
                              <span className="truncate text-sm font-medium">
                                {accountDisplayName({ bank_name: leg.wealth_account_bank_name ?? "", nickname: leg.wealth_account_name ?? "" })}
                              </span>
                            </span>
                            <span className={`shrink-0 text-sm font-semibold tabular-nums ${viewTx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                              {viewTx.type === "incoming" ? "+" : "−"}{fmt(Number(leg.amount))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : viewTx.wealth_account_id ? (
                    <div>
                      <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{t("account")}</p>
                      <p className="mt-0.5">{viewTx.wealth_account_name || viewTx.wealth_account_bank_name || viewTx.wealth_account_id}</p>
                    </div>
                  ) : null}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <Paperclip className="size-3.5" /> {t("attachments")}
                    </p>
                    <div>
                      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} accept="*/*" />
                      <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                        {uploading ? t("uploading") : t("upload")}
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
                          <button
                            type="button"
                            className="flex flex-1 items-center gap-2 min-w-0 text-left"
                            onClick={() => viewTx && setViewAttachment({
                              id: att.id, source: "transaction", source_id: viewTx.id, source_label: viewTx.description?.trim() || (viewTx.type === "incoming" ? t("income") : t("expense")),
                              file_name: att.file_name, file_type: att.file_type, file_size: att.file_size,
                              created_at: att.created_at, display_name: att.display_name, tags: att.tags, category: att.category,
                            })}
                          >
                            <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{att.display_name || att.file_name}</p>
                              <p className="text-xs text-muted-foreground">{formatFileSize(att.file_size)}</p>
                            </div>
                          </button>
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
                  <p className="text-xs text-muted-foreground">{t("max2MBPerFile")}</p>
                </div>

                <Separator />
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">{t("audit.history")}</p>
                  <AuditHistory entityType="transaction" entityId={viewTx.id} />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  // Strip ?view in place (no history pop) before opening Edit, so the
                  // detail modal's close doesn't fire a popstate that would instantly
                  // close the freshly-opened edit dialog.
                  const tx = viewTx
                  setViewTx(null)
                  view.close({ replace: true })
                  if (tx) void openEditTx(tx)
                }}>
                  <Pencil className="size-3.5" />
                  {t("edit")}
                </Button>
                <Button onClick={closeViewModal}>{t("close")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={(open) => { if (!open) setPendingFiles([]); setAddOpen(open) }}>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>{t("addTransaction")}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin px-6 py-1">
          <TxFormFields
            f={form}
            onChange={(p) => setForm((f) => ({ ...f, ...p }))}
            showClient={!isPersonal}
            clients={clients}
            accounts={accounts}
            accountsLoading={accountsLoading}
            categories={categories}
            onChangeCats={handleChangeCats}
            onAddAccount={() => { setAddOpen(false); navigate("/wealth") }}
            currency={currency}
            budget={budgetFor(form.client_id)}
          />
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Paperclip className="size-3.5" /> {t("attachments")}
                <span className="text-xs font-normal text-muted-foreground">({t("max2MBPerFile")})</span>
              </Label>
              <div>
                <input ref={addFileInputRef} type="file" className="hidden" multiple onChange={handleAddFileSelect} />
                <Button size="sm" variant="outline" type="button" onClick={() => addFileInputRef.current?.click()}>
                  {t("addFiles")}
                </Button>
              </div>
            </div>
            {pendingFiles.length > 0 && (
              <div className="space-y-1.5">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <Paperclip className="size-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removePendingFile(i)}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => { setAddOpen(false); setPendingFiles([]) }}>{t("cancel")}</Button>
            <Button onClick={handleAdd} disabled={saving}>{saving ? t("adding") : t("add")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="inset-x-0 bottom-0 top-auto flex max-h-[92svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:inset-x-auto sm:bottom-auto sm:top-[7svh] sm:left-1/2 sm:max-h-[86svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl">
          <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6"><DialogTitle>{t("editTransaction")}</DialogTitle></DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-1">
          {editForm && (
            <TxFormFields
              f={editForm}
              onChange={(p) => setEditForm((f) => f ? { ...f, ...p } : null)}
              showClient={false}
              clients={clients}
              accounts={accounts}
              accountsLoading={accountsLoading}
              categories={categories}
              onChangeCats={handleChangeCats}
              onAddAccount={() => { setEditOpen(false); navigate("/wealth") }}
              currency={currency}
            />
          )}
          {/* Attachments — only for a single (non-split) transaction: editing a
              split recreates it (delete+create), which would orphan attachments. */}
          {editForm?.id && !editForm.group_id && editForm.allocations.length <= 1 && (
            <div className="mt-2 border-t pt-3">
              <TransactionAttachments
                txId={editForm.id}
                txLabel={editForm.description?.trim() || (editForm.type === "incoming" ? t("income") : t("expense"))}
                canEdit={canWrite}
                canDelete={canDelete}
              />
            </div>
          )}
          </div>
          <DialogFooter className="shrink-0 border-t px-6 pb-6 pt-3">
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>{saving ? t("saving") : t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTransaction")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLegCount > 1 ? t("deleteSplitWarning", { count: deleteLegCount }) : t("transactionWillBeDeletedPermanently")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Attachment Confirmation */}
      <AlertDialog open={deleteAttachId !== null} onOpenChange={(open) => { if (!open) setDeleteAttachId(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteAttachment")}</AlertDialogTitle>
            <AlertDialogDescription>{t("attachmentWillBeDeletedPermanently")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAttachment} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("delete")}
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

      <AttachmentDetailModal
        item={viewAttachment}
        open={viewAttachment !== null}
        onOpenChange={(o) => { if (!o) setViewAttachment(null) }}
        canEdit={canWrite}
        canDelete={canDelete}
        onUpdated={() => { if (viewTx) loadAttachments(viewTx.id) }}
        onDeleted={() => { setViewAttachment(null); if (viewTx) loadAttachments(viewTx.id) }}
      />
    </div>
  )
}

// suppress unused import warning — PAGE_SIZE is intentional for documentation
void PAGE_SIZE
