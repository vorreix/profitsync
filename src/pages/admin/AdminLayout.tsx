import { useEffect } from "react"
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom"
import { useAuth, useClerk, useUser } from "@clerk/clerk-react"
import { AdminProvider, useAdmin } from "@/lib/admin-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ModeToggle } from "@/components/mode-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  User,
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
    if (!loading && !isAdmin) navigate("/dashboard", { replace: true })
  }, [isAdmin, loading, navigate])

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground grid place-items-center">
        <div className="space-y-3 w-72">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }
  if (!isAdmin) return null
  return <>{children}</>
}

function AdminShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useClerk()
  const { user } = useUser()

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null
  const activeNavHref =
    [...navItems]
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => (n.end ? location.pathname === n.href : location.pathname === n.href || location.pathname.startsWith(n.href + "/")))?.href ?? null

  const activeLabel = navItems.find((n) => n.href === activeNavHref)?.label ?? "Admin"

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0 gap-2">
          <div className="flex items-center gap-2 px-2 py-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 border border-amber-500/30 dark:text-amber-300">
              <ShieldCheck className="size-4" />
            </div>
            <div className="leading-tight group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-semibold tracking-tight">ProfitSync Admin</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Internal · privileged
              </p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.href === activeNavHref}
                      tooltip={item.label}
                    >
                      <NavLink to={item.href} end={item.end}>
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => navigate("/dashboard")}
                tooltip="Back to app"
              >
                <ArrowLeft />
                <span>Back to app</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="flex items-center gap-2">
            <div className="px-2 py-2 group-data-[collapsible=icon]:px-0">
              <ModeToggle />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="group-data-[collapsible=icon]:size-10">
                  <User className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col space-y-1">
                  <span>Admin account</span>
                  {userEmail && (
                    <span className="text-xs font-normal text-muted-foreground">{userEmail}</span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <User className="size-4 mr-2" />
                  Profile settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/dashboard")}>
                  <ArrowLeft className="size-4 mr-2" />
                  Back to app
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                  <LogOut className="size-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium text-muted-foreground">{activeLabel}</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-300">
            <ShieldCheck className="size-3" />
            Internal admin
          </span>
        </header>

        <div className="flex-1 overflow-auto">
          <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
            <Outlet />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AdminLayout() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (isLoaded && !isSignedIn) navigate("/login", { replace: true })
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
