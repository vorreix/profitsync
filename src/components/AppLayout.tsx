import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Outlet, NavLink, Navigate, useLocation, useNavigate } from "react-router-dom"
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
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { useSyncProfileLanguage } from "@/lib/i18n/use-language"
import { CurrencyProvider, useCurrency } from "@/lib/currency-context"
import { OrgProvider, useOrg } from "@/lib/org-context"
import { AdminProvider, useAdmin } from "@/lib/admin-context"
import { PageFilterProvider } from "@/lib/page-filter-context"
import { DataRefreshProvider, useDataRefresh } from "@/lib/data-refresh-context"
import { accountTypeAllows, type AccountType } from "@/lib/types"
import { OrgSwitcher } from "@/components/OrgSwitcher"
import { MobileAppLayout } from "@/components/MobileAppLayout"
import { useIsMobile } from "@/hooks/use-mobile"
import { InstallAppBanner } from "@/components/InstallAppBanner"
import { InstallButton } from "@/components/InstallButton"
import { ReferralBanner } from "@/components/ReferralBanner"
import { QuickAddModal, type QuickAddEntity } from "@/components/QuickAddModal"
import { AddTransactionDialog, type CreatedTxInfo } from "@/components/transactions/AddTransactionDialog"
import { formatMoney } from "@/lib/wealth"
import { toast } from "sonner"
import { initPwa } from "@/lib/pwa/register-sw"
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
  CreditCard,
  PiggyBank,
  Tag,
  ChartColumn,
  Gift,
  Landmark,
  Loader as Loader2,
  Repeat,
  CalendarDays,
  Network,
} from "lucide-react"

type QuickAction = {
  labelKey: string
  icon: typeof Users
  href: string
  // What the FAB action does, in place over the current page. "transaction" opens
  // the SHARED real Add-Transaction modal; client/quotation open the quick-add form.
  kind: QuickAddEntity | "transaction"
  feature?: "clients" | "quotations"
}

// Quick-actions menu, ordered top-to-bottom as it stacks above the FAB.
const quickActions: QuickAction[] = [
  { labelKey: "actions.createQuotation", icon: FileText, href: "/quotations?new=1", kind: "quotation", feature: "quotations" },
  { labelKey: "actions.addClient", icon: Users, href: "/clients?new=1", kind: "client", feature: "clients" },
  { labelKey: "actions.addTransaction", icon: ArrowLeftRight, href: "/transactions?new=1", kind: "transaction" },
]

// Within one of these sections, the FAB performs that section's "add" directly
// instead of opening the menu (e.g. the Clients page → Add Client). Prefixes
// mirror the nav's active-section logic, so nested routes like /clients/:id
// count as being in the section too. Everywhere else (Home, etc.) the FAB keeps
// the full quick-actions menu.
const SECTION_FAB: { prefix: string; href: string }[] = [
  { prefix: "/clients", href: "/clients?new=1" },
  { prefix: "/transactions", href: "/transactions?new=1" },
  { prefix: "/quotations", href: "/quotations?new=1" },
]

function pageFabAction(pathname: string, actions: QuickAction[]): QuickAction | null {
  // Anywhere inside a specific client (detail or its /files view) → add a
  // transaction for THIS client (the dialog opens on ?newTx=1).
  const clientMatch = pathname.match(/^\/clients\/([^/]+)(?:\/|$)/)
  if (clientMatch && clientMatch[1] !== "closed") {
    return { labelKey: "actions.addTransaction", icon: ArrowLeftRight, href: `/clients/${clientMatch[1]}?newTx=1`, kind: "transaction" }
  }
  const match = SECTION_FAB.find(
    (s) => pathname === s.prefix || pathname.startsWith(s.prefix + "/"),
  )
  return match ? actions.find((a) => a.href === match.href) ?? null : null
}

type NavItem = { labelKey: string; href: string; icon: typeof LayoutDashboard }

function buildNavItems(activeOrgId: string | undefined, accountType: AccountType | null | undefined): NavItem[] {
  const usersHref = activeOrgId ? `/organizations/${activeOrgId}/members` : "/organizations"
  const items: (NavItem | false)[] = [
    { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
    accountTypeAllows(accountType, "clients") && { labelKey: "nav.clients", href: "/clients", icon: Users },
    { labelKey: "nav.transactions", href: "/transactions", icon: ArrowLeftRight },
    { labelKey: "nav.wealth", href: "/wealth", icon: Landmark },
    { labelKey: "nav.recurring", href: "/recurring", icon: Repeat },
    { labelKey: "nav.calendar", href: "/calendar", icon: CalendarDays },
    { labelKey: "nav.flow", href: "/flow", icon: Network },
    { labelKey: "nav.analytics", href: "/analytics", icon: ChartColumn },
    accountTypeAllows(accountType, "quotations") && { labelKey: "nav.quotations", href: "/quotations", icon: FileText },
    accountTypeAllows(accountType, "members") && { labelKey: "nav.users", href: usersHref, icon: UserPlus },
    { labelKey: "nav.categories", href: "/categories", icon: Tag },
    { labelKey: "nav.budgets", href: "/budgets", icon: PiggyBank },
    { labelKey: "nav.referrals", href: "/referrals", icon: Gift },
    { labelKey: "nav.organizations", href: "/organizations", icon: Building2 },
    { labelKey: "nav.subscription", href: "/subscription", icon: CreditCard },
    { labelKey: "nav.trash", href: "/trash", icon: Trash2 },
  ]
  return items.filter((i): i is NavItem => i !== false)
}

function AppLayoutInner() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const location = useLocation()
  const navigate = useNavigate()
  useSyncProfileLanguage()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { activeOrg, profile, needsOnboarding, loading: orgLoading } = useOrg()
  const { isAdmin } = useAdmin()
  const { currency } = useCurrency()
  const { bump } = useDataRefresh()
  const [fabOpen, setFabOpen] = useState(false)
  // Quick-add opens the create form IN PLACE over the current page (no navigation),
  // so "add from any screen" keeps you where you are; a success toast deep-links.
  const [quickAdd, setQuickAdd] = useState<QuickAddEntity | null>(null)
  // The + FAB's "Add transaction" opens the SAME real modal as the Transactions page.
  const [addTxOpen, setAddTxOpen] = useState(false)

  // Success feedback for an in-place FAB transaction add: toast + deep link to it.
  // bump() lets the current page (dashboard/analytics) refresh its figures in place.
  const onTxCreated = (info: CreatedTxInfo) => {
    bump()
    const label = info.type === "incoming" ? t("transactions.income") : t("transactions.expense")
    toast.success(
      t("quickAdd.transactionCreated", { label, amount: formatMoney(info.amount, currency) }),
      info.id
        ? { action: { label: t("quickAdd.viewAction"), onClick: () => navigate(`/transactions?view=${info.id}`) } }
        : undefined,
    )
  }

  // Close the quick-actions menu on any navigation.
  useEffect(() => {
    setFabOpen(false)
  }, [location.pathname])

  // New (or not-yet-chosen) users must pick an account type first.
  if (!orgLoading && needsOnboarding) {
    return <Navigate to="/onboarding" replace />
  }

  if (isMobile) {
    return <MobileAppLayout />
  }

  const navItems = buildNavItems(activeOrg?.id, activeOrg?.account_type)
  const actions = quickActions.filter((a) => !a.feature || accountTypeAllows(activeOrg?.account_type, a.feature))
  // On a section's own page, the FAB is a single direct-add button; elsewhere
  // it opens the quick-actions menu.
  const pageAction = pageFabAction(location.pathname, actions)
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
                  <SidebarMenuItem key={item.labelKey}>
                    <SidebarMenuButton
                      asChild
                      isActive={item.href === activeNavHref}
                      tooltip={t(item.labelKey)}
                    >
                      <NavLink to={item.href}>
                        <item.icon />
                        <span>{t(item.labelKey)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {/* Legal links live on the Profile page now (see ProfilePage "Legal &
              Policies"), keeping the sidebar footer focused on app controls. */}
          <div className="flex items-center gap-2">
            <div className="px-2 py-2 group-data-[collapsible=icon]:px-0">
              <ModeToggle />
            </div>
            <LanguageSwitcher variant="icon" align="start" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="overflow-hidden p-0 group-data-[collapsible=icon]:size-10">
                  {profile?.avatar_src ? (
                    <img src={profile.avatar_src} alt="" className="size-full object-cover" />
                  ) : (
                    <User className="size-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="flex flex-col space-y-1">
                  <span>{t("account.title")}</span>
                  {userEmail && <span className="text-xs font-normal text-muted-foreground">{userEmail}</span>}
                  {activeOrg && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("account.org")}: {activeOrg.name}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <User className="size-4 mr-2" />
                  {t("account.profileSettings")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/organizations")}>
                  <Building2 className="size-4 mr-2" />
                  {t("account.organizations")}
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin")}>
                    <ShieldCheck className="size-4 mr-2" />
                    {t("nav.adminConsole")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                  <LogOut className="size-4 mr-2" />
                  {t("account.logout")}
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
            {(() => {
              const key = navItems.find((n) => n.href === activeNavHref)?.labelKey
              return key ? t(key) : ""
            })()}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <InstallButton
              label={t("pwa.installButton")}
              iosTitle={t("pwa.iosTitle")}
              iosBody={t("pwa.iosBody")}
              closeLabel={t("common.done")}
              variant="outline"
            />
            {activeOrg && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="size-3" />
                {activeOrg.name}
              </span>
            )}
          </div>
        </header>

        <InstallAppBanner className="mx-4 mt-4" />
        <ReferralBanner className="mx-4 mt-4" />
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
      {!pageAction && fabOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setFabOpen(false)} />
      )}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {!pageAction && fabOpen && actions.map((action) => (
          <div
            key={action.href}
            className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150 cursor-pointer group/action"
            onClick={() => {
              if (action.kind === "transaction") setAddTxOpen(true)
              else setQuickAdd(action.kind)
              setFabOpen(false)
            }}
          >
            <span className="text-sm font-medium bg-background border shadow-sm rounded-md px-2.5 py-1 whitespace-nowrap group-hover/action:bg-accent transition-colors">
              {t(action.labelKey)}
            </span>
            <Button
              size="icon"
              variant="secondary"
              className="size-10 rounded-full shadow-md shrink-0 pointer-events-none"
            >
              <action.icon className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          size="icon"
          className="size-14 rounded-full shadow-lg"
          aria-label={pageAction ? t(pageAction.labelKey) : undefined}
          onClick={() => { if (pageAction) navigate(pageAction.href); else setFabOpen((o) => !o) }}
        >
          {!pageAction && fabOpen
            ? <X className="size-5 transition-transform duration-200" />
            : <Plus className="size-5 transition-transform duration-200" />}
        </Button>
      </div>
      <QuickAddModal entity={quickAdd} onClose={() => setQuickAdd(null)} />
      <AddTransactionDialog open={addTxOpen} onOpenChange={setAddTxOpen} onCreated={onTxCreated} />
    </SidebarProvider>
  )
}

export function AppLayout() {
  const navigate = useNavigate()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    initPwa()
  }, [])

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
          <DataRefreshProvider>
            <PageFilterProvider>
              <AppLayoutInner />
            </PageFilterProvider>
          </DataRefreshProvider>
        </CurrencyProvider>
      </AdminProvider>
    </OrgProvider>
  )
}
