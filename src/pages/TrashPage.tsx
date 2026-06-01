import { useEffect, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { apiGet, apiPost } from "@/lib/api"
import type { Client, Quotation, Transaction } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Trash2, RotateCcw, Building2, Mail, FileText, ArrowUpRight, ArrowDownRight, ArrowLeftRight } from "lucide-react"

type TrashItemType = "client" | "quotation" | "transaction"

type TrashResponse = {
  clients: Client[]
  quotations: Quotation[]
  transactions: Transaction[]
}

type PurgeTarget = { type: TrashItemType; id: string; name: string }

export function TrashPage() {
  const { t } = useTranslation("trash")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  const fmtAmount = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [clients, setClients] = useState<Client[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [purgeTarget, setPurgeTarget] = useState<PurgeTarget | null>(null)
  const [working, setWorking] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<TrashResponse>("/api/trash", token)
      setClients(data.clients)
      setQuotations(data.quotations)
      setTransactions(data.transactions ?? [])
    } catch (err) {
      console.error("Failed to load trash:", err)
      toast.error(t("loadFailed"))
    } finally {
      setLoading(false)
    }
  }, [getToken, t])

  useEffect(() => { loadData() }, [loadData])

  async function handleRestore(type: TrashItemType, id: string) {
    setWorking(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost(`/api/trash/restore`, token, { type, id })
      toast.success(t(`${type}Restored`))
      loadData()
      if (type === "client") navigate(`/clients/${id}`)
    } catch {
      toast.error(t("restoreFailed"))
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: purgeTarget.type, id: purgeTarget.id }),
      })
      if (!res.ok) throw new Error()
      toast.success(t("deletedForever"))
      setPurgeTarget(null)
      loadData()
    } catch {
      toast.error(t("deleteFailed"))
    } finally {
      setWorking(false)
    }
  }

  const ItemActions = ({ type, id, name }: PurgeTarget) => (
    <div className="flex gap-2 shrink-0">
      <Button size="sm" variant="outline" disabled={working} onClick={() => handleRestore(type, id)}>
        <RotateCcw className="size-3.5" />
        {t("restore")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        disabled={working}
        onClick={() => setPurgeTarget({ type, id, name })}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )

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
          <p className="text-xs text-muted-foreground mt-0.5">{t("deletedOn", { date: formatDate(client.deleted_at) })}</p>
        )}
      </div>
      <Badge variant="secondary" className="shrink-0">{client.status}</Badge>
      <ItemActions type="client" id={client.id} name={client.name} />
    </div>
  )

  const QuotationRow = ({ quotation }: { quotation: Quotation }) => (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 px-4 py-3 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{quotation.title}</p>
        <p className="text-xs text-muted-foreground truncate">{quotation.prospect_name}{quotation.company ? ` — ${quotation.company}` : ""}</p>
        {quotation.deleted_at && (
          <p className="text-xs text-muted-foreground mt-0.5">{t("deletedOn", { date: formatDate(quotation.deleted_at) })}</p>
        )}
      </div>
      <Badge variant="secondary" className="shrink-0">{quotation.status}</Badge>
      <ItemActions type="quotation" id={quotation.id} name={quotation.title} />
    </div>
  )

  const TransactionRow = ({ tx }: { tx: Transaction }) => {
    const incoming = tx.type === "incoming"
    const title = tx.description?.trim() || (incoming ? t("income") : t("expense"))
    const sub = [!isPersonal ? tx.client_name : null, tx.category?.trim() || null].filter(Boolean).join(" · ")
    return (
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${incoming ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
          {incoming ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {sub ? `${sub} · ` : ""}{formatDate(tx.date)}
          </p>
        </div>
        <p className={`text-sm font-semibold tabular-nums shrink-0 ${incoming ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {incoming ? "+" : "−"}{fmtAmount(Number(tx.amount))}
        </p>
        <ItemActions type="transaction" id={tx.id} name={title} />
      </div>
    )
  }

  const EmptyState = ({ icon: Icon, label }: { icon: typeof Trash2; label: string }) => (
    <div className="py-16 text-center border rounded-xl">
      <Icon className="size-10 mx-auto text-muted-foreground/50 mb-3" />
      <p className="text-muted-foreground font-medium">{label}</p>
    </div>
  )

  const ListSkeleton = () => (
    <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}</div>
  )

  const totalCount = isPersonal
    ? transactions.length
    : clients.length + quotations.length + transactions.length

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{t("title")}</h1>
        {!loading && (
          <p className="text-sm text-muted-foreground mt-1">{t("itemsInTrash", { count: totalCount })}</p>
        )}
      </div>

      <Tabs defaultValue={isPersonal ? "transactions" : "clients"}>
        <TabsList>
          {!isPersonal && <TabsTrigger value="clients">{t("tabClients", { count: clients.length })}</TabsTrigger>}
          {!isPersonal && <TabsTrigger value="quotations">{t("tabQuotations", { count: quotations.length })}</TabsTrigger>}
          <TabsTrigger value="transactions">{t("tabTransactions", { count: transactions.length })}</TabsTrigger>
        </TabsList>

        {!isPersonal && (
          <TabsContent value="clients" className="mt-4">
            {loading ? <ListSkeleton /> : clients.length === 0 ? (
              <EmptyState icon={Trash2} label={t("noDeletedClients")} />
            ) : (
              <div className="border rounded-xl overflow-hidden divide-y">
                {clients.map((c) => <ClientRow key={c.id} client={c} />)}
              </div>
            )}
          </TabsContent>
        )}

        {!isPersonal && (
          <TabsContent value="quotations" className="mt-4">
            {loading ? <ListSkeleton /> : quotations.length === 0 ? (
              <EmptyState icon={FileText} label={t("noDeletedQuotations")} />
            ) : (
              <div className="border rounded-xl overflow-hidden divide-y">
                {quotations.map((q) => <QuotationRow key={q.id} quotation={q} />)}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="transactions" className="mt-4">
          {loading ? <ListSkeleton /> : transactions.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} label={t("noDeletedTransactions")} />
          ) : (
            <div className="border rounded-xl overflow-hidden divide-y">
              {transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={purgeTarget !== null} onOpenChange={(open) => { if (!open) setPurgeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteForeverTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteForeverDesc", { name: purgeTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurge}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? t("deleting") : t("deleteForever")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
