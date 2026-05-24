import { useState } from "react"
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom"
import { useUser, useClerk } from "@clerk/clerk-react"
import {
  LayoutDashboard,
  Users,
  ArrowLeftRight,
  FileText,
  Plus,
  X,
  Building2,
  ShieldCheck,
  ScrollText,
  CreditCard,
  Trash2,
  User,
  LogOut,
  Menu,
  TrendingUp,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react"
import { useOrg } from "@/lib/org-context"
import { useAdmin } from "@/lib/admin-context"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ModeToggle } from "@/components/mode-toggle"

const primaryTabs = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Quotes", href: "/quotations", icon: FileText },
]

const moreItems = [
  { label: "Organizations", href: "/organizations", icon: Building2 },
  { label: "Subscription", href: "/subscription", icon: CreditCard },
  { label: "Trash", href: "/trash", icon: Trash2 },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Privacy Policy", href: "/privacy-policy", icon: ShieldCheck },
  { label: "Terms of Service", href: "/terms-of-service", icon: ScrollText },
]

const quickActions = [
  { label: "Add Client", icon: Users, href: "/clients?new=1" },
  { label: "Add Transaction", icon: ArrowLeftRight, href: "/transactions?new=1" },
  { label: "Create Quotation", icon: FileText, href: "/quotations?new=1" },
]

export function MobileAppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { activeOrg, orgs, switchOrg, refresh } = useOrg()
  const { isAdmin } = useAdmin()
  const [orgSheetOpen, setOrgSheetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null

  const handleSwitch = async (id: string) => {
    await switchOrg(id)
    await refresh()
    setOrgSheetOpen(false)
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  const onMorePage = !primaryTabs.some((t) =>
    location.pathname === t.href || location.pathname.startsWith(t.href + "/"),
  )

  return (
    <div className="min-h-screen flex flex-col bg-background ios-tap">
      <header className="safe-pt sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-2 px-4 h-12">
          <Sheet open={orgSheetOpen} onOpenChange={setOrgSheetOpen}>
            <SheetTrigger asChild>
              <button className="pressable flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-muted text-sm font-medium max-w-[55%]">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Building2 className="size-3" />
                </div>
                <span className="truncate text-xs">{activeOrg?.name ?? "Personal"}</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85%] max-w-sm p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle>Organizations</SheetTitle>
              </SheetHeader>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {orgs.map((org) => (
                    <button
                      key={org.id}
                      onClick={() => handleSwitch(org.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg pressable text-left ${
                        org.id === activeOrg?.id ? "bg-primary/10 text-primary" : "hover:bg-accent"
                      }`}
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background border">
                        <Building2 className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{org.name}</p>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{org.role}</p>
                      </div>
                      {org.id === activeOrg?.id && <span className="size-2 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
                <div className="p-2 border-t space-y-1">
                  <button
                    onClick={() => { setOrgSheetOpen(false); navigate("/organizations") }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg pressable hover:bg-accent text-left"
                  >
                    <Plus className="size-4" />
                    <span className="text-sm">Create organization</span>
                  </button>
                  <button
                    onClick={() => { setOrgSheetOpen(false); navigate("/organizations") }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg pressable hover:bg-accent text-left"
                  >
                    <Building2 className="size-4" />
                    <span className="text-sm">Manage organizations</span>
                  </button>
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>

          <div className="flex items-center gap-1.5 mx-auto">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <TrendingUp className="size-3.5" />
            </div>
            <span className="font-semibold text-sm tracking-tight">ProfitSync</span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="pressable size-9 rounded-full bg-muted flex items-center justify-center">
                <Menu className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex flex-col space-y-1">
                <span>Account</span>
                {userEmail && <span className="text-xs font-normal text-muted-foreground">{userEmail}</span>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/profile")}>
                <User className="size-4 mr-2" /> Profile
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <ShieldCheck className="size-4 mr-2" /> Admin console
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate("/subscription")}>
                <CreditCard className="size-4 mr-2" /> Subscription
              </DropdownMenuItem>
              <div className="px-1 py-1 flex items-center gap-2">
                <ModeToggle />
                <span className="text-xs text-muted-foreground">Theme</span>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="size-4 mr-2" /> Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 overflow-auto pb-32 page-enter" key={location.pathname + (activeOrg?.id ?? "")}>
        <Outlet />
      </main>

      {/* Floating action button */}
      {fabOpen && (
        <div className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm" onClick={() => setFabOpen(false)} />
      )}
      <div className="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 safe-pb">
        {fabOpen && quickActions.map((action) => (
          <div
            key={action.href}
            className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150"
          >
            <span className="text-xs font-medium bg-background border shadow-sm rounded-full px-2.5 py-1 whitespace-nowrap">
              {action.label}
            </span>
            <Button
              size="icon"
              variant="secondary"
              className="size-11 rounded-full shadow-md shrink-0"
              onClick={() => { navigate(action.href); setFabOpen(false) }}
            >
              <action.icon className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          size="icon"
          className="size-14 rounded-full shadow-lg pressable"
          onClick={() => setFabOpen((o) => !o)}
        >
          {fabOpen ? <X className="size-5" /> : <Plus className="size-5" />}
        </Button>
      </div>

      {/* Bottom tab bar */}
      <nav className="safe-pb fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t">
        <div className="grid grid-cols-5 px-1 py-1">
          {primaryTabs.map((tab) => {
            const active = location.pathname === tab.href || location.pathname.startsWith(tab.href + "/")
            return (
              <NavLink
                key={tab.href}
                to={tab.href}
                className={`pressable flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-md ios-tap ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <tab.icon className="size-5" />
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              </NavLink>
            )
          })}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={`pressable flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-md ios-tap ${
                  onMorePage ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <MoreHorizontal className="size-5" />
                <span className="text-[10px] font-medium leading-none">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl h-[60vh]">
              <SheetHeader className="text-left mb-2">
                <SheetTitle>More</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-3">
                {moreItems.map((item) => (
                  <button
                    key={item.href}
                    onClick={() => { setMoreOpen(false); navigate(item.href) }}
                    className="pressable flex flex-col items-center gap-2 p-3 rounded-xl bg-muted/50 border"
                  >
                    <item.icon className="size-5" />
                    <span className="text-xs font-medium text-center leading-tight">{item.label}</span>
                  </button>
                ))}
                {isAdmin && (
                  <button
                    onClick={() => { setMoreOpen(false); navigate("/admin") }}
                    className="pressable flex flex-col items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
                  >
                    <ShieldCheck className="size-5" />
                    <span className="text-xs font-medium text-center leading-tight">Admin</span>
                  </button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  )
}
