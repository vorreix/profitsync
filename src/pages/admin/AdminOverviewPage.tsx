import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { apiGet } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ArrowLeftRight,
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
  transactionsTotal: number
}

type Tile = {
  key: keyof Stats
  label: string
  icon: typeof Users
  accent: string
  to: string
}

const tiles: Tile[] = [
  { key: "users", label: "Total Users", icon: Users, accent: "text-sky-600 dark:text-sky-400", to: "/admin/users" },
  { key: "activeUsers", label: "Active Users", icon: UserCheck, accent: "text-emerald-600 dark:text-emerald-400", to: "/admin/users?banned=false" },
  { key: "bannedUsers", label: "Banned Users", icon: ShieldAlert, accent: "text-red-600 dark:text-red-400", to: "/admin/users?banned=true" },
  { key: "organizations", label: "Organizations", icon: Building2, accent: "text-amber-600 dark:text-amber-400", to: "/admin/organizations" },
  { key: "teamOrganizations", label: "Team Orgs", icon: Users2, accent: "text-amber-700 dark:text-amber-300", to: "/admin/organizations?type=team" },
  { key: "personalOrganizations", label: "Personal Orgs", icon: Users, accent: "text-amber-700 dark:text-amber-200", to: "/admin/organizations?type=personal" },
  { key: "subscriptions", label: "Subscriptions", icon: CreditCard, accent: "text-violet-600 dark:text-violet-400", to: "/admin/subscriptions" },
  { key: "paidSubscriptions", label: "Premium Active", icon: Wallet, accent: "text-emerald-700 dark:text-emerald-300", to: "/admin/subscriptions?plan=premium&status=active" },
  { key: "paidInvoices", label: "Paid Invoices", icon: ReceiptText, accent: "text-emerald-600 dark:text-emerald-400", to: "/admin/invoices?status=paid" },
  { key: "clientsTotal", label: "Active Clients", icon: Building2, accent: "text-sky-700 dark:text-sky-300", to: "/admin/organizations" },
  { key: "transactionsTotal", label: "Transactions", icon: ArrowLeftRight, accent: "text-violet-700 dark:text-violet-300", to: "/admin/organizations" },
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
        <p className="text-sm text-muted-foreground mt-1">Platform health at a glance. Click a card to drill down.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <Link
            key={t.key}
            to={t.to}
            className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
          >
            <Card className="p-4 transition-colors group-hover:bg-accent/40 group-hover:border-accent-foreground/20 cursor-pointer h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{t.label}</span>
                <t.icon className={`size-3.5 ${t.accent}`} />
              </div>
              {loading || !stats ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums">{stats[t.key]}</p>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
