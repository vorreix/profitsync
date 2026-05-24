import { useEffect } from "react"
import { Outlet, NavLink, useNavigate } from "react-router-dom"
import { useAuth, useClerk, useUser } from "@clerk/clerk-react"
import { AdminProvider, useAdmin } from "@/lib/admin-context"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ShieldCheck,
  Users,
  Building2,
  CreditCard,
  ReceiptText,
  Layers,
  GaugeCircle,
  LogOut,
  ArrowLeft,
} from "lucide-react"

const navItems = [
  { label: "Overview", href: "/admin", icon: GaugeCircle, end: true },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Organizations", href: "/admin/organizations", icon: Building2 },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
  { label: "Invoices", href: "/admin/invoices", icon: ReceiptText },
  { label: "Plans", href: "/admin/plans", icon: Layers },
]

function AdminGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const { isAdmin, loading } = useAdmin()

  useEffect(() => {
    if (!loading && !isAdmin) navigate("/dashboard")
  }, [isAdmin, loading, navigate])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center">
        <div className="space-y-3 w-72">
          <Skeleton className="h-6 w-full bg-slate-800" />
          <Skeleton className="h-4 w-1/2 bg-slate-800" />
        </div>
      </div>
    )
  }
  if (!isAdmin) return null
  return <>{children}</>
}

function AdminShell() {
  const navigate = useNavigate()
  const { signOut } = useClerk()
  const { user } = useUser()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldCheck className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">ProfitSync Admin</p>
              <p className="text-[10px] uppercase tracking-widest text-slate-400">Internal · privileged</p>
            </div>
          </div>
          <nav className="ml-6 hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                    isActive
                      ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                      : "text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
                  }`
                }
              >
                <item.icon className="size-3.5" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400 hidden sm:inline">
              {user?.primaryEmailAddress?.emailAddress}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft className="size-3.5 mr-1.5" />
              Back to app
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-300 hover:text-red-300 hover:bg-red-500/10"
              onClick={async () => {
                await signOut()
                navigate("/login")
              }}
            >
              <LogOut className="size-3.5 mr-1.5" />
              Logout
            </Button>
          </div>
        </div>
        <nav className="md:hidden mx-auto max-w-7xl px-6 pb-3 flex items-center gap-1 overflow-x-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                  isActive
                    ? "bg-amber-500/10 text-amber-300 border border-amber-500/30"
                    : "text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
                }`
              }
            >
              <item.icon className="size-3.5" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export function AdminLayout() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (isLoaded && !isSignedIn) navigate("/login")
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded || !isSignedIn) return null

  return (
    <AdminProvider>
      <AdminGuard>
        <AdminShell />
      </AdminGuard>
    </AdminProvider>
  )
}
