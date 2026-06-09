import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { apiGet, apiPost } from "@/lib/api"
import { runOptimistic } from "@/lib/optimistic"
import { useFieldErrors } from "@/lib/use-field-errors"
import type { Budget, Client } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { useMultiSelect } from "@/lib/use-multi-select"
import { useLongPress } from "@/lib/use-long-press"
import { BulkActionBar } from "@/components/BulkActionBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import {
  Plus, Users, Building2, Mail, Phone, ChevronRight, Eye, PiggyBank,
  TrendingUp, TrendingDown, DollarSign, LayoutGrid, LayoutList, CheckSquare, Archive,
} from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { AttachmentBadge } from "@/components/AttachmentBadge"
import { ClientDetailSheet } from "@/components/ClientDetailSheet"
import { CategoryPicker } from "@/components/CategoryPicker"

type NewClient = {
  name: string
  company: string
  email: string
  phone: string
  status: "active" | "inactive"
  notes: string
  category: string
  onboard_date: string
}

type ClientWithStats = Client & { profit: number }

// Onboard date defaults to today so the common case needs no edit.
const defaultForm = (): NewClient => ({
  name: "",
  company: "",
  email: "",
  phone: "",
  status: "active",
  notes: "",
  category: "",
  onboard_date: new Date().toISOString().split("T")[0],
})

function toWithStats(c: Client): ClientWithStats {
  const incoming = Number(c.total_incoming ?? 0)
  const outgoing = Number(c.total_outgoing ?? 0)
  return { ...c, total_incoming: incoming, total_outgoing: outgoing, profit: incoming - outgoing }
}

export function ClientsPage() {
  const { t } = useTranslation("clients")
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canDelete = canDeleteRole(activeOrg?.role)
  const canWrite = canWriteRole(activeOrg?.role)
  const sel = useMultiSelect()
  const longPress = useLongPress()
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Search is mirrored to ?q= so it survives navigating into a client and back.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "")
  const [sort, setSort] = useState("date_desc")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<NewClient>(defaultForm)
  const clientSchema = z.object({ name: z.string().trim().min(1, t("clientNameRequired")) })
  const { errors, validate, clearField, clearAll } = useFieldErrors(clientSchema)
  const [viewClient, setViewClient] = useState<ClientWithStats | null>(null)
  // Per-client expense budgets (client_id → budget, with current-period spend) +
  // the org default (template). Drives the card indicator + the set/edit dialog.
  const [budgets, setBudgets] = useState<Map<string, Budget>>(new Map())

  const loadBudgets = async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      const map = new Map<string, Budget>()
      for (const b of res.budgets) {
        if (b.client_id) map.set(b.client_id, b)
      }
      setBudgets(map)
    } catch {
      /* non-blocking — cards just won't show budget bars */
    }
  }

  const searchRef = useRef(search)
  const sortRef = useRef(sort)
  searchRef.current = search
  sortRef.current = sort

  // While searching we also include closed clients (shown in their own section
  // below); with no query the list is active-only.
  async function fetchPage1() {
    setLoading(true)
    setPage(1)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ page: "1" })
      const q = searchRef.current.trim()
      if (q) { params.set("search", q); params.set("includeClosed", "1") }
      if (sortRef.current) params.set("sort", sortRef.current)
      const data = await apiGet<{ data: Client[]; total: number }>(`/api/clients?${params}`, token)
      setClients(data.data.map(toWithStats))
      setTotal(data.total)
    } catch (err) {
      console.error("Failed to load clients:", err)
      toast.error(t("loadClientsFailed"))
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
      const q = searchRef.current.trim()
      if (q) { params.set("search", q); params.set("includeClosed", "1") }
      if (sortRef.current) params.set("sort", sortRef.current)
      const data = await apiGet<{ data: Client[]; total: number }>(`/api/clients?${params}`, token)
      setClients((prev) => [...prev, ...data.data.map(toWithStats)])
      setTotal(data.total)
      setPage(nextPage)
    } catch (err) {
      console.error("Failed to load more clients:", err)
      toast.error(t("loadMoreClientsFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(fetchPage1, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced refetch keyed on search/sort; fetchPage1 reads the latest values via refs
  }, [search, sort])

  // Budgets load once per workspace (independent of the search/sort refetch).
  useEffect(() => {
    void loadBudgets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id])

  // Keep ?q= in sync with the search box (replace, so no history spam) so the
  // query — and therefore the results — restore when the user comes back.
  useEffect(() => {
    const current = searchParams.get("q") ?? ""
    const next = search.trim()
    if (current === next) return
    const params = new URLSearchParams(searchParams)
    if (next) params.set("q", next); else params.delete("q")
    setSearchParams(params, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setDialogOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete("new")
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  async function handleCreate() {
    if (!validate(form)) return
    const token = await getToken()
    if (!token) { toast.error(t("createClientFailed")); return }
    const body: Record<string, unknown> = {
      name: form.name,
      company: form.company,
      email: form.email,
      phone: form.phone,
      status: form.status,
      notes: form.notes,
      category: form.category,
    }
    if (form.onboard_date) body.onboard_date = form.onboard_date
    // Optimistic feel: close the modal instantly and save in the background. On
    // failure, reopen the same modal (data intact) with an error toast. Granular
    // cache invalidation keeps wealth/transactions/dashboard caches warm.
    const snapshot = form
    await runOptimistic({
      apply: () => setDialogOpen(false),
      rollback: () => { setForm(snapshot); setDialogOpen(true) },
      mutate: () => apiPost<Client>("/api/clients", token, body, ["/api/clients"]),
      errorMessage: t("createClientFailed"),
      // Insert the new client in place — no full-list reload.
      onSuccess: (created) => {
        toast.success(t("clientCreated"))
        setForm(defaultForm())
        clearAll()
        setClients((prev) => [toWithStats(created), ...prev])
        setTotal((n) => n + 1)
      },
    })
  }

  // When searching we also pull closed clients; split them out so active matches
  // show first and closed matches appear in their own labelled section.
  const searching = search.trim().length > 0
  const activeClients = searching ? clients.filter((c) => !c.closed_at) : clients
  const closedMatches = searching ? clients.filter((c) => !!c.closed_at) : []
  const remaining = total - clients.length

  // The own/internal client can't be deleted, so it's never selectable.
  const selectableIds = activeClients.filter((c) => !c.is_own).map((c) => c.id)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => sel.isSelected(id))

  async function handleBulkDelete() {
    if (sel.count === 0) return
    const ids = sel.selectedIds
    // Optimistic: remove the selected clients from the list instantly.
    const removedCount = clients.filter((c) => ids.includes(c.id)).length
    setClients((prev) => prev.filter((c) => !ids.includes(c.id)))
    setTotal((n) => Math.max(0, n - removedCount))
    sel.exitSelection()
    setBulkDeleting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const { deleted } = await apiPost<{ deleted: number }>("/api/clients/bulk-delete", token, { ids })
      toast.success(t("multiSelect.deleted", { count: deleted }))
    } catch {
      toast.error(t("multiSelect.deleteFailed"))
      fetchPage1() // restore on failure
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header — on mobile the search + filter sit right next to "+ New"
          (sort lives inside the filter); on desktop the view toggle joins them. */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {loading ? t("loading") : t("clientCount", { count: total })}
          </p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ExpandableSearch
            value={search}
            onChange={setSearch}
            placeholder={t("searchPlaceholder")}
            expandedClassName="w-36 sm:w-64"
          />
          <FilterSheet count={0} onClear={() => setSort("date_desc")}>
            <FilterSection label={t("filters.sortBy")}>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("sortBy")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name_asc">{t("nameAscending")}</SelectItem>
                  <SelectItem value="name_desc">{t("nameDescending")}</SelectItem>
                  <SelectItem value="date_asc">{t("dateOldest")}</SelectItem>
                  <SelectItem value="date_desc">{t("dateNewest")}</SelectItem>
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterSheet>
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => navigate("/clients/closed")}
            aria-label={t("closed.clientsSection")}
            title={t("closed.clientsSection")}
          >
            <Archive className="size-4" />
            <span className="hidden lg:inline">{t("closed.closedBadge")}</span>
          </Button>
          {canDelete && activeClients.length > 0 && (
            <Button
              variant={sel.selectionMode ? "secondary" : "outline"}
              size="sm"
              className="hidden sm:inline-flex shrink-0 h-9"
              onClick={() => (sel.selectionMode ? sel.exitSelection() : sel.enterSelection())}
            >
              <CheckSquare className="size-4" />
              {t("multiSelect.select")}
            </Button>
          )}
          <div className="hidden sm:flex items-center border rounded-md overflow-hidden shrink-0">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="rounded-none border-0 h-9 w-9"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="rounded-none border-0 h-9 w-9"
              onClick={() => setViewMode("list")}
            >
              <LayoutList className="size-4" />
            </Button>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="shrink-0">
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("newClientButton")}</span>
            <span className="sm:hidden">{t("newButton")}</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className={viewMode === "grid" ? "grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2"}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className={viewMode === "grid" ? "h-36 w-full rounded-xl" : "h-16 w-full rounded-lg"} />
          ))}
        </div>
      ) : activeClients.length === 0 && closedMatches.length === 0 ? (
        <div className="py-20 text-center">
          <Users className="size-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">
            {search ? t("noClientsMatch") : t("noClientsYet")}
          </p>
          {!search && (
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              {t("createFirstClient")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {viewMode === "grid" ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {activeClients.map((client) => {
                const selectable = canDelete && !client.is_own
                return (
                <Card
                  key={client.id}
                  className={`cursor-pointer hover:shadow-md transition-shadow group py-0 ${sel.isSelected(client.id) ? "ring-2 ring-primary" : ""}`}
                  onClick={() => {
                    if (sel.selectionMode && selectable) { sel.toggle(client.id); return }
                    if (longPress.didLongPress()) return
                    navigate(`/clients/${client.id}`)
                  }}
                  {...(selectable ? longPress.bind(() => sel.enterSelection(client.id)) : {})}
                >
                  <CardContent className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      {sel.selectionMode && selectable && (
                        <Checkbox
                          checked={sel.isSelected(client.id)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => sel.toggle(client.id)}
                          className="mt-0.5 shrink-0"
                          aria-label={`Select ${client.name}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm truncate">{client.name}</p>
                          {client.is_own && (
                            <Badge variant="outline" className="text-xs shrink-0 border-primary/40 text-primary">
                              <Building2 className="size-3 mr-0.5" /> {t("ownCompany")}
                            </Badge>
                          )}
                          <Badge
                            variant={client.status === "active" ? "default" : "secondary"}
                            className="text-xs shrink-0"
                          >
                            {client.status}
                          </Badge>
                          <AttachmentBadge count={client.attachment_count} />
                          {client.category && (
                            <Badge variant="outline" className="text-xs shrink-0">{client.category}</Badge>
                          )}
                        </div>
                        {client.company && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Building2 className="size-3 text-muted-foreground shrink-0" />
                            <p className="text-xs text-muted-foreground truncate">{client.company}</p>
                          </div>
                        )}
                      </div>
                      {/* Mobile: an explicit "view" (eye) opens a quick details
                          sheet; desktop keeps the chevron nav hint. */}
                      {!sel.selectionMode && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 -mt-1 -mr-1 sm:hidden"
                          aria-label={`View ${client.name}`}
                          onClick={(e) => { e.stopPropagation(); setViewClient(client) }}
                        >
                          <Eye className="size-4" />
                        </Button>
                      )}
                      <ChevronRight className="hidden sm:block size-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">{t("incomeLabel")}</p>
                        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                          <TrendingUp className="size-3" />
                          {formatCurrency(Number(client.total_incoming ?? 0))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">{t("expenseLabel")}</p>
                        <p className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
                          <TrendingDown className="size-3" />
                          {formatCurrency(Number(client.total_outgoing ?? 0))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">{t("profitLabel")}</p>
                        <p className={`text-sm font-semibold flex items-center gap-1 mt-0.5 ${
                          client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                        }`}>
                          <DollarSign className="size-3" />
                          {formatCurrency(client.profit)}
                        </p>
                      </div>
                    </div>

                    {/* Expense budget — tap the line or piggy icon to open this client's
                        budget history & insights (set/edit live on that page). */}
                    {(() => {
                      const b = budgets.get(client.id)
                      if (b) {
                        return (
                          <button
                            type="button"
                            className="group/budget w-full flex items-start gap-2 text-left rounded-md -m-1 p-1 hover:bg-accent/50 transition-colors"
                            onClick={(e) => { e.stopPropagation(); navigate(`/budgets/${client.id}`) }}
                            aria-label={t("nav.budgets", { ns: "translation" })}
                          >
                            <PiggyBank className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                              <BudgetIndicator amount={b.amount} spent={b.spent ?? 0} period={b.period} currency={currency} />
                            </div>
                            {/* Chevron signals the line navigates into the budget page. */}
                            <ChevronRight className="size-3.5 shrink-0 mt-0.5 text-muted-foreground/60 group-hover/budget:text-foreground transition-colors" />
                          </button>
                        )
                      }
                      if (!canWrite) return null
                      return (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={(e) => { e.stopPropagation(); navigate(`/budgets/${client.id}`) }}
                        >
                          <PiggyBank className="size-3" /> {t("budget.set", { ns: "translation" })}
                        </button>
                      )
                    })()}

                    {(client.email || client.phone) && (
                      <div className="hidden sm:block space-y-1 pt-1">
                        {client.email && (
                          <div className="flex items-center gap-1.5">
                            <Mail className="size-3 text-muted-foreground shrink-0" />
                            <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                          </div>
                        )}
                        {client.phone && (
                          <div className="flex items-center gap-1.5">
                            <Phone className="size-3 text-muted-foreground shrink-0" />
                            <p className="text-xs text-muted-foreground truncate">{client.phone}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                )
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {activeClients.map((client) => {
                const selectable = canDelete && !client.is_own
                return (
                <div
                  key={client.id}
                  className={`flex items-center gap-4 px-4 py-3 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors group ${sel.isSelected(client.id) ? "ring-2 ring-primary" : ""}`}
                  onClick={() => {
                    if (sel.selectionMode && selectable) { sel.toggle(client.id); return }
                    if (longPress.didLongPress()) return
                    navigate(`/clients/${client.id}`)
                  }}
                  {...(selectable ? longPress.bind(() => sel.enterSelection(client.id)) : {})}
                >
                  {sel.selectionMode && selectable && (
                    <Checkbox
                      checked={sel.isSelected(client.id)}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => sel.toggle(client.id)}
                      className="shrink-0"
                      aria-label={`Select ${client.name}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{client.name}</span>
                      {client.is_own && (
                        <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                          <Building2 className="size-3 mr-0.5" /> {t("ownCompany")}
                        </Badge>
                      )}
                      <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs">
                        {client.status}
                      </Badge>
                      <AttachmentBadge count={client.attachment_count} />
                    </div>
                    {client.company && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{client.company}</p>
                    )}
                  </div>
                  <div className="hidden sm:flex items-center gap-1.5 w-40 shrink-0">
                    <Mail className="size-3 text-muted-foreground shrink-0" />
                    <p className="text-xs text-muted-foreground truncate">{client.email || "—"}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="hidden md:block text-right">
                      <p className="text-xs text-muted-foreground">{t("incomeLabel")}</p>
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(Number(client.total_incoming ?? 0))}
                      </p>
                    </div>
                    <div className="hidden md:block text-right">
                      <p className="text-xs text-muted-foreground">{t("expenseLabel")}</p>
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                        {formatCurrency(Number(client.total_outgoing ?? 0))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{t("profitLabel")}</p>
                      <p className={`text-sm font-semibold ${
                        client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                      }`}>
                        {formatCurrency(client.profit)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
                </div>
                )
              })}
            </div>
          )}

          {remaining > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? t("loading") : t("loadMore", { remaining })}
              </Button>
            </div>
          )}
        </>
      )}

      {/* When searching, closed matches are shown here (active ones above). The
          full closed list lives on its own screen via the "Closed" button. */}
      {!loading && searching && closedMatches.length > 0 && (
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {t("closed.clientsSection")} <span className="text-xs">({closedMatches.length})</span>
          </p>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {closedMatches.map((client) => (
              <Card key={client.id} className="py-0 opacity-90 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/clients/${client.id}`)}>
                <CardContent className="p-3.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{client.name}</p>
                      {client.company && <p className="text-xs text-muted-foreground truncate">{client.company}</p>}
                    </div>
                    <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-300">{t("closed.closedBadge")}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) clearAll() }}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createNewClientTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t("nameField")} *</Label>
              <Input
                id="name"
                placeholder={t("namePlaceholder")}
                value={form.name}
                aria-invalid={!!errors.name}
                onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); clearField("name") }}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">{t("companyField")}</Label>
              <Input
                id="company"
                placeholder={t("companyPlaceholder")}
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("emailField")}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("phoneField")}</Label>
                <Input
                  id="phone"
                  placeholder={t("phonePlaceholder")}
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t("statusField")}</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as "active" | "inactive" }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("statusActive")}</SelectItem>
                  <SelectItem value="inactive">{t("statusInactive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Onboard date + Category side by side to keep the form compact. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="onboard_date">{t("onboardDateField")}</Label>
                <Input
                  id="onboard_date"
                  type="date"
                  value={form.onboard_date}
                  onChange={(e) => setForm((f) => ({ ...f, onboard_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("filters.category")}</Label>
                <CategoryPicker type="client" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t("notesField")}</Label>
              <Textarea
                id="notes"
                placeholder={t("notesPlaceholder")}
                className="resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            {/* Cancel = discard: clears the draft. ESC / click-outside just close
                and KEEP the draft (the New button doesn't reset), so an accidental
                dismiss never loses what was typed. */}
            <Button variant="outline" onClick={() => { setForm(defaultForm()); clearAll(); setDialogOpen(false) }}>{t("cancelButton")}</Button>
            <Button onClick={handleCreate}>
              {t("createClientButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <ClientDetailSheet
        client={viewClient}
        open={viewClient !== null}
        onOpenChange={(o) => { if (!o) setViewClient(null) }}
      />

    </div>
  )
}
