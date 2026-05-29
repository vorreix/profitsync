import { useEffect, useState } from "react"
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom"
import { useAuth, useUser, useClerk } from "@clerk/clerk-react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ModeToggle } from "@/components/mode-toggle"
import { CurrencyProvider } from "@/lib/currency-context"
import { OrgProvider, useOrg } from "@/lib/org-context"
import { AdminProvider, useAdmin } from "@/lib/admin-context"
import { OrgSwitcher } from "@/components/OrgSwitcher"
import { MobileAppLayout } from "@/components/MobileAppLayout"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  LayoutDashboard,
  Users,
  UserPlus,
  TrendingUp,
  User,
  LogOut,
  ArrowLeftRight,
  FileText,
  Trash2,
  Plus,
  X,
  Building2,
  ShieldCheck,
  ScrollText,
  CreditCard,
  Loader as Loader2,
} from "lucide-react"

const quickActions = [
  { label: "Add Client", icon: Users, href: "/clients?new=1" },
  { label: "Add Transaction", icon: ArrowLeftRight, href: "/transactions?new=1" },
  { label: "Create Quotation", icon: FileText, href: "/quotations?new=1" },
]

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard }

function buildNavItems(activeOrgId: string | undefined): NavItem[] {
  const usersHref = activeOrgId ? `/organizations/${activeOrgId}/members` : "/organizations"
  return [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Clients", href: "/clients", icon: Users },
    { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
    { label: "Quotations", href: "/quotations", icon: FileText },
    { label: "Users", href: usersHref, icon: UserPlus },
    { label: "Organizations", href: "/organizations", icon: Building2 },
    { label: "Subscription", href: "/subscription", icon: CreditCard },
    { label: "Trash", href: "/trash", icon: Trash2 },
  ]
}

function AppLayoutInner() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { activeOrg, loading: orgLoading } = useOrg()
  const { isAdmin } = useAdmin()
  const [fabOpen, setFabOpen] = useState(false)

  if (isMobile) {
    return <MobileAppLayout />
  }

  const navItems = buildNavItems(activeOrg?.id)
  // Pick the most specific (longest) matching item so /organizations/:id/members
  // highlights "Users" rather than its "Organizations" ancestor.
  const activeNavHref =
    [...navItems]
      .sort((a, b) => b.href.length - a.href.length)
      .find((n) => location.pathname === n.href || location.pathname.startsWith(n.href + "/"))?.href ?? null

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0 gap-2">
          <div className="flex items-center gap-2 px-2 py-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">
              ProfitSync
            </span>
          </div>
          <div className="px-1">
            <OrgSwitcher />
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
                      <NavLink to={item.href}>
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
          <div className="flex flex-col gap-1 px-1 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
            <NavLink to="/privacy-policy" className="hover:text-foreground inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3" /> Privacy Policy
            </NavLink>
            <NavLink to="/terms-of-service" className="hover:text-foreground inline-flex items-center gap-1.5">
              <ScrollText className="size-3" /> Terms of Service
            </NavLink>
          </div>
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
                  <span>Account</span>
                  {userEmail && <span className="text-xs font-normal text-muted-foreground">{userEmail}</span>}
                  {activeOrg && (
                    <span className="text-xs font-normal text-muted-foreground">
                      Org: {activeOrg.name}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <User className="size-4 mr-2" />
                  Profile Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/organizations")}>
                  <Building2 className="size-4 mr-2" />
                  Organizations
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <ShieldCheck className="size-4 mr-2" />
                    Admin console
                  </DropdownMenuItem>
                )}
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
          <span className="text-sm font-medium text-muted-foreground">
            {navItems.find((n) => n.href === activeNavHref)?.label ?? ""}
          </span>
          {activeOrg && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3" />
              {activeOrg.name}
            </span>
          )}
        </header>

        <div className="flex-1 overflow-auto">
          {orgLoading ? (
            <div className="flex h-[60vh] items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Outlet key={activeOrg?.id ?? "no-org"} />
          )}
        </div>
      </SidebarInset>
      {fabOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setFabOpen(false)} />
      )}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {fabOpen && quickActions.map((action) => (
          <div
            key={action.href}
            className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150"
          >
            <span className="text-sm font-medium bg-background border shadow-sm rounded-md px-2.5 py-1 whitespace-nowrap">
              {action.label}
            </span>
            <Button
              size="icon"
              variant="secondary"
              className="size-10 rounded-full shadow-md shrink-0"
              onClick={() => { navigate(action.href); setFabOpen(false) }}
            >
              <action.icon className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          size="icon"
          className="size-14 rounded-full shadow-lg"
          onClick={() => setFabOpen((o) => !o)}
        >
          {fabOpen
            ? <X className="size-5 transition-transform duration-200" />
            : <Plus className="size-5 transition-transform duration-200" />}
        </Button>
      </div>
    </SidebarProvider>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate("/login")
    }
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded || !isSignedIn) return null

  return (
    <OrgProvider>
      <AdminProvider>
        <CurrencyProvider>
          <AppLayoutInner />
        </CurrencyProvider>
      </AdminProvider>
    </OrgProvider>
  )
}
