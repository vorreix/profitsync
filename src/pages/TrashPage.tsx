import { useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet, apiPost } from "@/lib/api"
import type { Client, Quotation } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Trash2, RotateCcw, Building2, Mail, FileText } from "lucide-react"

type TrashResponse = {
  clients: Client[]
  quotations: Quotation[]
}

type PurgeTarget = { type: "client" | "quotation"; id: string; name: string }

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

export function TrashPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [clients, setClients] = useState<Client[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null)
  const [working, setWorking] = useState(false)

  const loadData = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const data = await apiGet<TrashResponse>("/api/trash", token)
    setClients(data.clients)
    setQuotations(data.quotations)
    setLoading(false)
  }, [getToken])

  useEffect(() => { loadData() }, [loadData])

  async function handleRestore(type: "client" | "quotation", id: string) {
    setWorking(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost(`/api/trash/restore`, token, { type, id })
      toast.success(`${type === "client" ? "Client" : "Quotation"} restored`)
      loadData()
      if (type === "client") navigate(`/clients/${id}`)
    } catch {
      toast.error("Failed to restore")
    } finally {
      setWorking(false)
    }
  }

  async function handlePurge() {
    if (!purgeTarget) return
    setWorking(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const res = await fetch("/api/trash/purge", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: purgeTarget.type, id: purgeTarget.id }),
      })
      if (!res.ok) throw new Error()
      toast.success("Permanently deleted")
      setPurgeTarget(null)
      loadData()
    } catch {
      toast.error("Failed to delete permanently")
    } finally {
      setWorking(false)
    }
  }

  const ClientRow = ({ client }: { client: Client }) => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{client.name}</p>
        <div className="flex items-center gap-3 mt-0.5">
          {client.company && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Building2 className="size-3" />{client.company}
            </span>
          )}
          {client.email && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Mail className="size-3" />{client.email}
            </span>
          )}
        </div>
        {client.deleted_at && (
          <p className="text-xs text-muted-foreground mt-0.5">Deleted {formatDate(client.deleted_at)}</p>
        )}
      </div>
      <Badge variant="secondary" className="shrink-0">{client.status}</Badge>
      <div className="flex gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          disabled={working}
          onClick={() => handleRestore("client", client.id)}
        >
          <RotateCcw className="size-3.5" />
          Restore
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={working}
          onClick={() => setPurgeTarget({ type: "client", id: client.id, name: client.name })}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )

  const QuotationRow = ({ quotation }: { quotation: Quotation }) => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{quotation.title}</p>
        <p className="text-xs text-muted-foreground truncate">{quotation.prospect_name}{quotation.company ? ` — ${quotation.company}` : ""}</p>
        {quotation.deleted_at && (
          <p className="text-xs text-muted-foreground mt-0.5">Deleted {formatDate(quotation.deleted_at)}</p>
        )}
      </div>
      <Badge variant="secondary" className="shrink-0">{quotation.status}</Badge>
      <div className="flex gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          disabled={working}
          onClick={() => handleRestore("quotation", quotation.id)}
        >
          <RotateCcw className="size-3.5" />
          Restore
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={working}
          onClick={() => setPurgeTarget({ type: "quotation", id: quotation.id, name: quotation.title })}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )

  const totalCount = clients.length + quotations.length

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        {!loading && (
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount} item{totalCount !== 1 ? "s" : ""} in trash
          </p>
        )}
      </div>

      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients">Clients ({clients.length})</TabsTrigger>
          <TabsTrigger value="quotations">Quotations ({quotations.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="clients" className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : clients.length === 0 ? (
            <div className="py-16 text-center border rounded-xl">
              <Trash2 className="size-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground font-medium">No deleted clients</p>
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden divide-y">
              {clients.map((c) => <ClientRow key={c.id} client={c} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="quotations" className="mt-4">
          {loading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
            </div>
          ) : quotations.length === 0 ? (
            <div className="py-16 text-center border rounded-xl">
              <FileText className="size-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground font-medium">No deleted quotations</p>
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden divide-y">
              {quotations.map((q) => <QuotationRow key={q.id} quotation={q} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Permanent Delete Confirmation */}
      <AlertDialog open={purgeTarget !== null} onOpenChange={(open) => { if (!open) setPurgeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Forever?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{purgeTarget?.name}</strong> will be permanently deleted and cannot be recovered. All associated data will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? "Deleting..." : "Delete Forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
