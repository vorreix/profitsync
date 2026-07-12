import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { BudgetDialog } from "@/components/budget/BudgetDialog"
import { useMultiSelect } from "@/lib/use-multi-select"
import { useLongPress } from "@/lib/use-long-press"
import { BulkActionBar } from "@/components/BulkActionBar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Plus, Users, CheckSquare, Archive } from "lucide-react"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"
import { ClientDetailSheet } from "@/components/ClientDetailSheet"
import { CategoryPicker } from "@/components/CategoryPicker"
import { ViewToggle } from "@/components/ViewToggle"
import { useViewMode } from "@/lib/use-view-mode"
import { useInfiniteScroll } from "@/lib/use-infinite-scroll"
import {
  ClientCard, ClientListRow, ClientTable,
  type ClientActions, type ClientColumn, type ClientWithStats,
} from "@/components/clients/client-views"

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
  const [view, setView] = useViewMode("clients")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<NewClient>(defaultForm)
  const clientSchema = z.object({ name: z.string().trim().min(1, t("clientNameRequired")) })
  const { errors, validate, clearField, clearAll } = useFieldErrors(clientSchema)
  const [viewClient, setViewClient] = useState<ClientWithStats | null>(null)
  // Per-client expense budgets (client_id → budget, with current-period spend) +
  // the org default (template). Drives the card indicator + the set/edit dialog.
  const [budgets, setBudgets] = useState<Map<string, Budget>>(new Map())
  const [defaultBudget, setDefaultBudget] = useState<Budget | null>(null)
  const [budgetClient, setBudgetClient] = useState<ClientWithStats | null>(null)

  const loadBudgets = async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      const map = new Map<string, Budget>()
      let def: Budget | null = null
      for (const b of res.budgets) {
        if (b.client_id) map.set(b.client_id, b)
        else def = b // org-level (business default)
      }
      setBudgets(map)
      setDefaultBudget(def)
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

  // Keep the onboard date defaulting to *today* on every open. The form state
  // survives outside-click closes (intentional draft behavior), so a pristine
  // form opened the next day would otherwise still carry yesterday's date —
  // refresh it only when the user hasn't typed anything yet.
  useEffect(() => {
    if (!dialogOpen) return
    setForm((f) =>
      f.name.trim() || f.company.trim() || f.email.trim() || f.phone.trim() || f.notes.trim()
        ? f
        : { ...f, onboard_date: new Date().toISOString().split("T")[0] },
    )
  }, [dialogOpen])

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

  // O(1) per-client budget lookup for the memoized rows (was a Map read per card).
  const budgetFor = useCallback((id: string) => budgets.get(id), [budgets])

  // Table column header click: toggle asc/desc on the active column, else start a
  // sensible default (money columns biggest-first, text A→Z, date newest-first).
  const handleSort = useCallback((key: ClientColumn["key"]) => {
    setSort((prev) => {
      const [prevKey, prevDir] = prev.split("_")
      if (prevKey === key) return `${key}_${prevDir === "asc" ? "desc" : "asc"}`
      return `${key}_${key === "name" || key === "company" ? "asc" : "desc"}`
    })
  }, [])

  // Auto infinite scroll — loads the next page as the sentinel nears the viewport;
  // the visible "Load More" button stays as the manual / no-observer fallback.
  const { sentinelRef } = useInfiniteScroll({
    hasMore: remaining > 0,
    loading: loadingMore,
    onLoadMore: handleLoadMore,
    enabled: !loading,
  })

  // Stable action bundle for the memoized Card/List/Table rows. Handler bodies close
  // over changing state, so we keep the latest set in a ref and hand the rows fixed
  // wrappers — a row re-renders only when its own data/selection/budget changes,
  // never because a parent closure was recreated (e.g. on every search keystroke).
  const latestActions = {
    onOpen: (id: string) => navigate(`/clients/${id}`),
    onQuickView: (client: ClientWithStats) => setViewClient(client),
    onEditBudget: (client: ClientWithStats) => setBudgetClient(client),
    onOpenBudget: (id: string) => navigate(`/budgets/${id}`),
    onToggleSelect: sel.toggle,
    onEnterSelection: sel.enterSelection,
    formatAmount: formatCurrency,
    bindLongPress: longPress.bind,
    didLongPress: longPress.didLongPress,
  }
  const latestActionsRef = useRef(latestActions)
  latestActionsRef.current = latestActions
  const actions = useMemo<ClientActions>(() => ({
    onOpen: (id) => latestActionsRef.current.onOpen(id),
    onQuickView: (c) => latestActionsRef.current.onQuickView(c),
    onEditBudget: (c) => latestActionsRef.current.onEditBudget(c),
    onOpenBudget: (id) => latestActionsRef.current.onOpenBudget(id),
    onToggleSelect: (id) => latestActionsRef.current.onToggleSelect(id),
    onEnterSelection: (id) => latestActionsRef.current.onEnterSelection(id),
    formatAmount: (n) => latestActionsRef.current.formatAmount(n),
    bindLongPress: (cb) => latestActionsRef.current.bindLongPress(cb),
    didLongPress: () => latestActionsRef.current.didLongPress(),
  }), [])

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header — on mobile the search + filter sit right next to "+ New"
          (sort lives inside the filter); the view toggle joins them. The row
          WRAPS (flex-wrap + ml-auto): when the search expands on a narrow phone
          the toggle/actions drop to a second right-aligned line instead of
          overflowing the viewport (no horizontal scroll — a11y CRITICAL). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {loading ? t("loading") : t("clientCount", { count: total })}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 ml-auto">
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
                  <SelectItem value="income_desc">{t("sortIncomeDesc")}</SelectItem>
                  <SelectItem value="income_asc">{t("sortIncomeAsc")}</SelectItem>
                  <SelectItem value="expense_desc">{t("sortExpenseDesc")}</SelectItem>
                  <SelectItem value="expense_asc">{t("sortExpenseAsc")}</SelectItem>
                  <SelectItem value="profit_desc">{t("sortProfitDesc")}</SelectItem>
                  <SelectItem value="profit_asc">{t("sortProfitAsc")}</SelectItem>
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
          <ViewToggle value={view} onChange={setView} />
          <Button onClick={() => setDialogOpen(true)} className="shrink-0">
            <Plus className="size-4" />
            <span className="hidden sm:inline">{t("newClientButton")}</span>
            <span className="sm:hidden">{t("newButton")}</span>
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className={view === "card" ? "grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2"}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className={view === "card" ? "h-44 w-full rounded-xl" : "h-16 w-full rounded-lg"} />
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
          {view === "table" ? (
            <ClientTable
              clients={activeClients}
              budgetFor={budgetFor}
              isSelected={sel.isSelected}
              selectionMode={sel.selectionMode}
              canDelete={canDelete}
              canWrite={canWrite}
              currency={currency}
              actions={actions}
              sort={sort}
              onSort={handleSort}
            />
          ) : view === "list" ? (
            <div className="space-y-2">
              {activeClients.map((client) => (
                <ClientListRow
                  key={client.id}
                  client={client}
                  selected={sel.isSelected(client.id)}
                  selectionMode={sel.selectionMode}
                  canDelete={canDelete}
                  canWrite={canWrite}
                  currency={currency}
                  budget={budgetFor(client.id)}
                  actions={actions}
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {activeClients.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  selected={sel.isSelected(client.id)}
                  selectionMode={sel.selectionMode}
                  canDelete={canDelete}
                  canWrite={canWrite}
                  currency={currency}
                  budget={budgetFor(client.id)}
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

      <BudgetDialog
        open={budgetClient !== null}
        onOpenChange={(o) => { if (!o) setBudgetClient(null) }}
        clientId={budgetClient?.id ?? null}
        label={budgetClient?.name ?? ""}
        current={budgetClient ? budgets.get(budgetClient.id) ?? null : null}
        prefill={defaultBudget ? { amount: defaultBudget.amount, period: defaultBudget.period } : null}
        onSaved={() => { void loadBudgets() }}
      />

    </div>
  )
}
