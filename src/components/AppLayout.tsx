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
import { LayoutDashboard, Users, TrendingUp, User, LogOut, ArrowLeftRight, FileText, Trash2, Plus, X } from "lucide-react"

const quickActions = [
  { label: "Add Client", icon: Users, href: "/clients?new=1" },
  { label: "Add Transaction", icon: ArrowLeftRight, href: "/transactions?new=1" },
  { label: "Create Quotation", icon: FileText, href: "/quotations?new=1" },
]

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Quotations", href: "/quotations", icon: FileText },
  { label: "Trash", href: "/trash", icon: Trash2 },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const [fabOpen, setFabOpen] = useState(false)

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      navigate("/login")
    }
  }, [isLoaded, isSignedIn, navigate])

  if (!isLoaded || !isSignedIn) return null

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="pb-0">
          <div className="flex items-center gap-2 px-2 py-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-4" />
            </div>
            <span className="font-semibold text-sm tracking-tight group-data-[collapsible=icon]:hidden">
              ProfitSync
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === item.href || location.pathname.startsWith(item.href + "/")}
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
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <User className="size-4 mr-2" />
                  Profile Settings
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
          <span className="text-sm font-medium text-muted-foreground">
            {navItems.find((n) => location.pathname === n.href || location.pathname.startsWith(n.href + "/"))?.label ?? ""}
          </span>
        </header>

        <div className="flex-1 overflow-auto">
          <CurrencyProvider>
            <Outlet />
          </CurrencyProvider>
        </div>
      </SidebarInset>
      {/* Quick-add FAB */}
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
