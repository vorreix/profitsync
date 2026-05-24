import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Building2,
  CreditCard,
  ReceiptText,
  ShieldAlert,
  Users,
  UserCheck,
  Users2,
  Wallet,
} from "lucide-react"

type Stats = {
  users: number
  bannedUsers: number
  activeUsers: number
  organizations: number
  personalOrganizations: number
  teamOrganizations: number
  subscriptions: number
  paidSubscriptions: number
  paidInvoices: number
  clientsTotal: number
}

const tiles: Array<{
  key: keyof Stats
  label: string
  icon: typeof Users
  accent: string
}> = [
  { key: "users", label: "Total Users", icon: Users, accent: "text-sky-400" },
  { key: "activeUsers", label: "Active Users", icon: UserCheck, accent: "text-emerald-400" },
  { key: "bannedUsers", label: "Banned Users", icon: ShieldAlert, accent: "text-red-400" },
  { key: "organizations", label: "Organizations", icon: Building2, accent: "text-amber-400" },
  { key: "teamOrganizations", label: "Team Orgs", icon: Users2, accent: "text-amber-300" },
  { key: "personalOrganizations", label: "Personal Orgs", icon: Users, accent: "text-amber-200" },
  { key: "subscriptions", label: "Subscriptions", icon: CreditCard, accent: "text-violet-400" },
  { key: "paidSubscriptions", label: "Premium Active", icon: Wallet, accent: "text-emerald-300" },
  { key: "paidInvoices", label: "Paid Invoices", icon: ReceiptText, accent: "text-emerald-400" },
  { key: "clientsTotal", label: "Active Clients", icon: Building2, accent: "text-sky-300" },
]

export function AdminOverviewPage() {
  const { getToken } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const token = await getToken()
      if (!token) return
      const data = await apiGet<Stats>("/api/admin/stats", token)
      setStats(data)
      setLoading(false)
    }
    load()
  }, [getToken])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin overview</h1>
        <p className="text-sm text-slate-400 mt-1">Platform health at a glance.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <Card key={t.key} className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-400">{t.label}</span>
              <t.icon className={`size-3.5 ${t.accent}`} />
            </div>
            {loading || !stats ? (
              <Skeleton className="h-7 w-16 bg-slate-800" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums">{stats[t.key]}</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
