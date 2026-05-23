import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import type { Client, Transaction } from "@/lib/types"
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
import { Plus, Search, Users, Building2, Mail, Phone, ChevronRight, TrendingUp, TrendingDown, DollarSign } from "lucide-react"

type NewClient = {
  name: string
  company: string
  email: string
  phone: string
  status: "active" | "inactive"
  notes: string
}

type ClientWithStats = Client & {
  totalIncoming: number
  totalOutgoing: number
  profit: number
}

const defaultForm: NewClient = {
  name: "",
  company: "",
  email: "",
  phone: "",
  status: "active",
  notes: "",
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function ClientsPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [clientsWithStats, setClientsWithStats] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<NewClient>(defaultForm)
  const [saving, setSaving] = useState(false)

  async function loadClients() {
    const token = await getToken()
    if (!token) return
    const [clients, transactions] = await Promise.all([
      apiGet<Client[]>("/api/clients", token),
      apiGet<Transaction[]>("/api/transactions", token),
    ])

    const withStats: ClientWithStats[] = clients.map((c) => {
      const clientTx = transactions.filter((t) => t.client_id === c.id)
      const incoming = clientTx
        .filter((t) => t.type === "incoming")
        .reduce((s, t) => s + Number(t.amount), 0)
      const outgoing = clientTx
        .filter((t) => t.type === "outgoing")
        .reduce((s, t) => s + Number(t.amount), 0)
      return { ...c, totalIncoming: incoming, totalOutgoing: outgoing, profit: incoming - outgoing }
    })

    setClientsWithStats(withStats)
    setLoading(false)
  }

  useEffect(() => {
    loadClients()
  }, [])

  const filtered = clientsWithStats.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company.toLowerCase().includes(search.toLowerCase()) ||
      c.email.toLowerCase().includes(search.toLowerCase())
  )

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("Client name is required")
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost<Client>("/api/clients", token, form)
      toast.success("Client created")
      setDialogOpen(false)
      setForm(defaultForm)
      loadClients()
    } catch {
      toast.error("Failed to create client")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {clientsWithStats.length} client{clientsWithStats.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
          New Client
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search clients..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((client) => (
            <Card
              key={client.id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => navigate(`/clients/${client.id}`)}
            >
              <CardContent className="p-4 space-y-3">
                {/* Header */}
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

                {/* Financial Stats */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Income</p>
                    <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
                      <TrendingUp className="size-3" />
                      {formatCurrency(client.totalIncoming)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Expense</p>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-1 mt-0.5">
                      <TrendingDown className="size-3" />
                      {formatCurrency(client.totalOutgoing)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Profit</p>
                    <p className={`text-sm font-semibold flex items-center gap-1 mt-0.5 ${
                      client.profit >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    }`}>
                      <DollarSign className="size-3" />
                      {formatCurrency(client.profit)}
                    </p>
                  </div>
                </div>

                {/* Contact info */}
                {(client.email || client.phone) && (
                  <div className="space-y-1 pt-1">
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
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
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
            <div className="grid grid-cols-2 gap-3">
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
