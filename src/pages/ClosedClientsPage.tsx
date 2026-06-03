import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, Building2, ArchiveRestore } from "lucide-react"
import { apiGet, apiPatch } from "@/lib/api"
import type { Client } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExpandableSearch } from "@/components/ExpandableSearch"
import { FilterSheet, FilterSection } from "@/components/filters/FilterSheet"

/** Dedicated screen for closed clients (reached via the "Closed" button on /clients). */
export function ClosedClientsPage() {
  const { t } = useTranslation("clients")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

  const [clients, setClients] = useState<Client[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("date_desc")
  const searchRef = useRef(search)
  const sortRef = useRef(sort)
  searchRef.current = search
  sortRef.current = sort

  const buildParams = (p: number) => {
    const params = new URLSearchParams({ closed: "1", page: String(p) })
    if (searchRef.current.trim()) params.set("search", searchRef.current.trim())
    if (sortRef.current) params.set("sort", sortRef.current)
    return params
  }

  const fetchPage1 = useCallback(async () => {
    setLoading(true)
    setPage(1)
    try {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<{ data: Client[]; total: number }>(`/api/clients?${buildParams(1)}`, token)
      setClients(data.data)
      setTotal(data.total)
    } catch {
      toast.error(t("loadClientsFailed"))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken])

  useEffect(() => {
    const timer = setTimeout(fetchPage1, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort])

  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      const token = await getToken()
      if (!token) return
      const nextPage = page + 1
      const data = await apiGet<{ data: Client[]; total: number }>(`/api/clients?${buildParams(nextPage)}`, token)
      setClients((prev) => [...prev, ...data.data])
      setTotal(data.total)
      setPage(nextPage)
    } catch {
      toast.error(t("loadMoreClientsFailed"))
    } finally {
      setLoadingMore(false)
    }
  }

  async function reopen(clientId: string) {
    try {
      const token = await getToken()
      if (!token) return
      await apiPatch(`/api/clients/${clientId}`, token, { closed: false })
      toast.success(t("closed.clientReopened"))
      setClients((prev) => prev.filter((c) => c.id !== clientId))
      setTotal((n) => Math.max(0, n - 1))
    } catch {
      toast.error(t("closed.actionFailed"))
    }
  }

  const remaining = total - clients.length

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => navigate("/clients")} className="-ml-2 shrink-0">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{t("closed.clientsSection")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{loading ? t("loading") : t("clientCount", { count: total })}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <ExpandableSearch value={search} onChange={setSearch} placeholder={t("searchPlaceholder")} expandedClassName="w-36 sm:w-64" />
          <FilterSheet count={0} onClear={() => setSort("date_desc")} registerFloating={false}>
            <FilterSection label={t("filters.sortBy")}>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="name_asc">{t("nameAscending")}</SelectItem>
                  <SelectItem value="name_desc">{t("nameDescending")}</SelectItem>
                  <SelectItem value="date_asc">{t("dateOldest")}</SelectItem>
                  <SelectItem value="date_desc">{t("dateNewest")}</SelectItem>
                </SelectContent>
              </Select>
            </FilterSection>
          </FilterSheet>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : clients.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-muted-foreground font-medium">{search ? t("noClientsMatch") : t("closed.noClosedClients")}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => {
              const incoming = Number(client.total_incoming ?? 0)
              const outgoing = Number(client.total_outgoing ?? 0)
              return (
                <Card key={client.id} className="py-0 opacity-95 cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(`/clients/${client.id}`)}>
                  <CardContent className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{client.name}</p>
                        {client.company && (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Building2 className="size-3 text-muted-foreground shrink-0" />
                            <p className="text-xs text-muted-foreground truncate">{client.company}</p>
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-300">{t("closed.closedBadge")}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400 tabular-nums truncate">{fmt(incoming)}</span>
                      <span className="text-red-600 dark:text-red-400 tabular-nums truncate text-right">{fmt(outgoing)}</span>
                    </div>
                    {canWrite && (
                      <Button variant="outline" size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); reopen(client.id) }}>
                        <ArchiveRestore className="size-3.5" /> {t("closed.reopen")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {remaining > 0 && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? t("loading") : t("loadMore", { remaining })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
