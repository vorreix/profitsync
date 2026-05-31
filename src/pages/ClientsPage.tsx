import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import type { Client } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
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
import {
  Plus, Search, Users, Building2, Mail, Phone, ChevronRight,
  TrendingUp, TrendingDown, DollarSign, LayoutGrid, LayoutList,
} from "lucide-react"

type NewClient = {
  name: string
  company: string
  email: string
  phone: string
  status: "active" | "inactive"
  notes: string
  onboard_date: string
}

type ClientWithStats = Client & { profit: number }

const defaultForm: NewClient = {
  name: "",
  company: "",
  email: "",
  phone: "",
  status: "active",
  notes: "",
  onboard_date: "",
}

function toWithStats(c: Client): ClientWithStats {
  const incoming = Number(c.total_incoming ?? 0)
  const outgoing = Number(c.total_outgoing ?? 0)
  return { ...c, total_incoming: incoming, total_outgoing: outgoing, profit: incoming - outgoing }
}

export function ClientsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("date_desc")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<NewClient>(defaultForm)
  const [saving, setSaving] = useState(false)

  const searchRef = useRef(search)
  const sortRef = useRef(sort)
  searchRef.current = search
  sortRef.current = sort

  async function fetchPage1() {
    setLoading(true)
    setPage(1)
    try {
      const token = await getToken()
      if (!token) return
      const params = new URLSearchParams({ page: "1" })
      if (searchRef.current.trim()) params.set("search", searchRef.current.trim())
      if (sortRef.current) params.set("sort", sortRef.current)
      const data = await apiGet<{ data: Client[]; total: number }>(`/api/clients?${params}`, token)
      setClients(data.data.map(toWithStats))
      setTotal(data.total)
    } catch (err) {
      console.error("Failed to load clients:", err)
      toast.error("Failed to load clients")
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
      if (sortRef.current) params.set("sort", sortRef.current)
      const data = await apiGet<{ data: Client[]; total: number }>(`/api/clients?${params}`, token)
      setClients((prev) => [...prev, ...data.data.map(toWithStats)])
      setTotal(data.total)
      setPage(nextPage)
    } catch (err) {
      console.error("Failed to load more clients:", err)
      toast.error("Failed to load more clients")
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(fetchPage1, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced refetch keyed on search/sort; fetchPage1 reads the latest values via refs
  }, [search, sort])

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setDialogOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  async function handleCreate() {
    if (!form.name.trim()) { toast.error("Client name is required"); return }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const body: Record<string, unknown> = {
        name: form.name,
        company: form.company,
        email: form.email,
        phone: form.phone,
        status: form.status,
        notes: form.notes,
      }
      if (form.onboard_date) body.onboard_date = form.onboard_date
      await apiPost<Client>("/api/clients", token, body)
      toast.success("Client created")
      setDialogOpen(false)
      setForm(defaultForm)
      fetchPage1()
    } catch {
      toast.error("Failed to create client")
    } finally {
      setSaving(false)
    }
  }

  const remaining = total - clients.length

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5 sm:mt-1">
            {loading ? "Loading..." : `${total} client${total !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="shrink-0">
          <Plus className="size-4" />
          <span className="hidden sm:inline">New Client</span>
          <span className="sm:hidden">New</span>
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-32 sm:w-44 shrink-0">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name_asc">Name A → Z</SelectItem>
            <SelectItem value="name_desc">Name Z → A</SelectItem>
            <SelectItem value="date_asc">Date (oldest)</SelectItem>
            <SelectItem value="date_desc">Date (newest)</SelectItem>
          </SelectContent>
        </Select>
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
      </div>

      {/* Content */}
      {loading ? (
        <div className={viewMode === "grid" ? "grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2"}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className={viewMode === "grid" ? "h-36 w-full rounded-xl" : "h-16 w-full rounded-lg"} />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="py-20 text-center">
          <Users className="size-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground font-medium">
            {search ? "No clients match your search" : "No clients yet"}
          </p>
          {!search && (
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              Create your first client
            </Button>
          )}
        </div>
      ) : (
        <>
          {viewMode === "grid" ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {clients.map((client) => (
                <Card
                  key={client.id}
                  className="cursor-pointer hover:shadow-md transition-shadow group py-0"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  <CardContent className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm truncate">{client.name}</p>
                          <Badge
                            variant={client.status === "active" ? "default" : "secondary"}
                            className="text-xs shrink-0"
                          >
                            {client.status}
                          </Badge>
                        </div>
                        {client.company && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Building2 className="size-3 text-muted-foreground shrink-0" />
                            <p className="text-xs text-muted-foreground truncate">{client.company}</p>
                          </div>
                        )}
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground shrink-0 mt-0.5 group-hover:text-foreground transition-colors" />
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">Income</p>
                        <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                          <TrendingUp className="size-3" />
                          {formatCurrency(Number(client.total_incoming ?? 0))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">Expense</p>
                        <p className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
                          <TrendingDown className="size-3" />
                          {formatCurrency(Number(client.total_outgoing ?? 0))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">Profit</p>
                        <p className={`text-sm font-semibold flex items-center gap-1 mt-0.5 ${
                          client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                        }`}>
                          <DollarSign className="size-3" />
                          {formatCurrency(client.profit)}
                        </p>
                      </div>
                    </div>

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
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {clients.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg border bg-card cursor-pointer hover:bg-accent/50 transition-colors group"
                  onClick={() => navigate(`/clients/${client.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{client.name}</span>
                      <Badge variant={client.status === "active" ? "default" : "secondary"} className="text-xs">
                        {client.status}
                      </Badge>
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
                      <p className="text-xs text-muted-foreground">Income</p>
                      <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(Number(client.total_incoming ?? 0))}
                      </p>
                    </div>
                    <div className="hidden md:block text-right">
                      <p className="text-xs text-muted-foreground">Expense</p>
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                        {formatCurrency(Number(client.total_outgoing ?? 0))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Profit</p>
                      <p className={`text-sm font-semibold ${
                        client.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                      }`}>
                        {formatCurrency(client.profit)}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
                </div>
              ))}
            </div>
          )}

          {remaining > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? "Loading..." : `Load More (${remaining} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[92vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="John Doe"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                placeholder="Acme Corp"
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  placeholder="+1 555 0000"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as "active" | "inactive" }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="onboard_date">Onboard Date</Label>
                <Input
                  id="onboard_date"
                  type="date"
                  value={form.onboard_date}
                  onChange={(e) => setForm((f) => ({ ...f, onboard_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Any notes about this client..."
                className="resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
