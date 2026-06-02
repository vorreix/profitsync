import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom"
import { useUser, useClerk } from "@clerk/clerk-react"
import {
  LayoutDashboard,
  Users,
  UserPlus,
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
  Sparkles,
  Loader,
  SlidersHorizontal,
  Tag,
} from "lucide-react"
import { useOrg } from "@/lib/org-context"
import { useAdmin } from "@/lib/admin-context"
import { usePageFilterState } from "@/lib/page-filter-context"
import { accountTypeAllows, isPaidPlanKey, type AccountType } from "@/lib/types"
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
import { LanguageSwitcher } from "@/components/LanguageSwitcher"
import { InstallAppBanner } from "@/components/InstallAppBanner"
import { InstallButton } from "@/components/InstallButton"

type TabItem = { labelKey: string; href: string; icon: typeof LayoutDashboard }

// Bottom-bar tabs adapt to the account type: personal accounts have no Clients
// or Quotes, so they get a leaner, focused set.
function buildPrimaryTabs(accountType: AccountType | null | undefined): TabItem[] {
  const items: (TabItem | false)[] = [
    { labelKey: "nav.home", href: "/dashboard", icon: LayoutDashboard },
    accountTypeAllows(accountType, "clients") && { labelKey: "nav.clients", href: "/clients", icon: Users },
    { labelKey: "nav.transactions", href: "/transactions", icon: ArrowLeftRight },
    accountTypeAllows(accountType, "quotations") && { labelKey: "nav.quotes", href: "/quotations", icon: FileText },
  ]
  return items.filter((i): i is TabItem => i !== false)
}

type MoreItem = { labelKey: string; href: string; icon: typeof Building2 }

function buildMoreItems(activeOrgId: string | undefined, accountType: AccountType | null | undefined): MoreItem[] {
  const usersHref = activeOrgId ? `/organizations/${activeOrgId}/members` : "/organizations"
  const items: (MoreItem | false)[] = [
    accountTypeAllows(accountType, "members") && { labelKey: "nav.users", href: usersHref, icon: UserPlus },
    { labelKey: "nav.categories", href: "/categories", icon: Tag },
    { labelKey: "nav.organizations", href: "/organizations", icon: Building2 },
    { labelKey: "nav.subscription", href: "/subscription", icon: CreditCard },
    { labelKey: "nav.trash", href: "/trash", icon: Trash2 },
    { labelKey: "nav.profile", href: "/profile", icon: User },
    { labelKey: "nav.privacyPolicy", href: "/privacy-policy", icon: ShieldCheck },
    { labelKey: "nav.termsOfService", href: "/terms-of-service", icon: ScrollText },
  ]
  return items.filter((i): i is MoreItem => i !== false)
}

type QuickAction = { labelKey: string; icon: typeof Users; href: string; feature?: "clients" | "quotations" }

// Quick-actions menu, ordered top-to-bottom as it stacks above the FAB.
const allQuickActions: QuickAction[] = [
  { labelKey: "actions.createQuotation", icon: FileText, href: "/quotations?new=1", feature: "quotations" },
  { labelKey: "actions.addClient", icon: Users, href: "/clients?new=1", feature: "clients" },
  { labelKey: "actions.addTransaction", icon: ArrowLeftRight, href: "/transactions?new=1" },
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
  if (clientMatch) {
    return { labelKey: "actions.addTransaction", icon: ArrowLeftRight, href: `/clients/${clientMatch[1]}?newTx=1` }
  }
  const match = SECTION_FAB.find(
    (s) => pathname === s.prefix || pathname.startsWith(s.prefix + "/"),
  )
  return match ? actions.find((a) => a.href === match.href) ?? null : null
}

export function MobileAppLayout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useUser()
  const { signOut } = useClerk()
  const { activeOrg, orgs, switchOrg, refresh, loading: orgLoading } = useOrg()
  const { isAdmin } = useAdmin()
  const [orgSheetOpen, setOrgSheetOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [fabOpen, setFabOpen] = useState(false)
  const pageFilter = usePageFilterState()

  // Close the quick-actions menu on any navigation.
  useEffect(() => {
    setFabOpen(false)
  }, [location.pathname])

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null

  const handleSwitch = async (id: string) => {
    // Close the sheet immediately so switching feels instant on mobile; the
    // org refresh continues in the background.
    setOrgSheetOpen(false)
    await switchOrg(id)
    await refresh()
  }

  const handleLogout = async () => {
    await signOut()
    navigate("/login")
  }

  const accountType = activeOrg?.account_type
  const primaryTabs = buildPrimaryTabs(accountType)
  const moreItems = buildMoreItems(activeOrg?.id, accountType)
  const quickActions = allQuickActions.filter((a) => !a.feature || accountTypeAllows(accountType, a.feature))
  // On a section's own page, the FAB is a single direct-add button; elsewhere
  // it opens the quick-actions menu.
  const pageAction = pageFabAction(location.pathname, quickActions)
  const isPaid = isPaidPlanKey(activeOrg?.plan_key)
  const onMorePage = !primaryTabs.some((t) =>
    location.pathname === t.href || location.pathname.startsWith(t.href + "/"),
  )

  return (
    <div className="min-h-screen flex flex-col bg-background ios-tap">
      <header className="safe-pt sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center gap-2 px-4 h-12">
          <button
            onClick={() => navigate("/dashboard")}
            className="pressable flex items-center gap-1.5 shrink-0"
            aria-label="Home"
          >
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <TrendingUp className="size-3.5" />
            </div>
            <span className="font-semibold text-sm tracking-tight">ProfitSync</span>
          </button>

          <Sheet open={orgSheetOpen} onOpenChange={setOrgSheetOpen}>
            <SheetTrigger asChild>
              <button className="pressable flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-muted text-sm font-medium max-w-[50%] ml-auto">
                <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Building2 className="size-3" />
                </div>
                <span className="truncate text-xs">{activeOrg?.name ?? t("org.personal")}</span>
                {activeOrg && (
                  <span
                    className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0 ${
                      isPaid
                        ? "border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-300"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {isPaid ? t("org.pro") : t("org.free")}
                  </span>
                )}
                <ChevronDown className="size-3 text-muted-foreground shrink-0" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85%] max-w-sm p-0 flex flex-col">
              <SheetHeader className="p-4 border-b">
                <SheetTitle>{t("nav.organizations")}</SheetTitle>
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
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{org.name}</p>
                          <span
                            className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border shrink-0 ${
                              isPaidPlanKey(org.plan_key)
                                ? "border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-300"
                                : "border-border text-muted-foreground"
                            }`}
                          >
                            {isPaidPlanKey(org.plan_key) ? t("org.pro") : t("org.free")}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{org.role}</p>
                      </div>
                      {org.id === activeOrg?.id && <span className="size-2 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
                <div className="p-2 border-t space-y-1">
                  {activeOrg && !isPaid && (
                    <button
                      onClick={() => { setOrgSheetOpen(false); navigate("/subscription") }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg pressable text-left bg-amber-500 text-amber-950 hover:bg-amber-400 dark:bg-amber-500/20 dark:text-amber-200 dark:hover:bg-amber-500/30"
                    >
                      <Sparkles className="size-4" />
                      <div className="flex-1">
                        <span className="text-sm font-medium block">{t("org.upgradeTitle")}</span>
                        <span className="text-[11px] opacity-80">{t("org.upgradeSubtitle")}</span>
                      </div>
                    </button>
                  )}
                  <button
                    onClick={() => { setOrgSheetOpen(false); navigate("/organizations") }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg pressable hover:bg-accent text-left"
                  >
                    <Plus className="size-4" />
                    <span className="text-sm">{t("org.createOrganization")}</span>
                  </button>
                  <button
                    onClick={() => { setOrgSheetOpen(false); navigate("/organizations") }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg pressable hover:bg-accent text-left"
                  >
                    <Building2 className="size-4" />
                    <span className="text-sm">{t("org.manageOrganizations")}</span>
                  </button>
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>

          <InstallButton
            label={null}
            ariaLabel={t("pwa.installButton")}
            iosTitle={t("pwa.iosTitle")}
            iosBody={t("pwa.iosBody")}
            closeLabel={t("common.done")}
            variant="outline"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="pressable size-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Menu className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="flex flex-col space-y-1">
                <span>{t("account.title")}</span>
                {userEmail && <span className="text-xs font-normal text-muted-foreground">{userEmail}</span>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/profile")}>
                <User className="size-4 mr-2" /> {t("nav.profile")}
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <ShieldCheck className="size-4 mr-2" /> {t("nav.adminConsole")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate("/subscription")}>
                <CreditCard className="size-4 mr-2" /> {t("nav.subscription")}
              </DropdownMenuItem>
              <div className="px-1 py-1 flex items-center gap-2">
                <ModeToggle />
                <span className="text-xs text-muted-foreground">{t("account.theme")}</span>
                <div className="ml-auto"><LanguageSwitcher variant="icon" align="end" /></div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive">
                <LogOut className="size-4 mr-2" /> {t("account.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-32 page-enter" key={location.pathname + (activeOrg?.id ?? "")}>
        <InstallAppBanner className="mx-4 mt-3" />
        {orgLoading ? (
          <div className="flex h-[60vh] items-center justify-center">
            <Loader className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      {/* Floating action button */}
      {!pageAction && fabOpen && (
        <div className="fixed inset-0 z-40 bg-background/50 backdrop-blur-sm" onClick={() => setFabOpen(false)} />
      )}
      <div className="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2 safe-pb">
        {/* Floating filter shortcut: appears just above the FAB when the current
            page has active filters, so they're reachable without scrolling back
            to the toolbar. Hidden while the quick-actions menu is open. */}
        {pageFilter.onOpen && pageFilter.count > 0 && !(!pageAction && fabOpen) && (
          <button
            type="button"
            onClick={() => pageFilter.onOpen?.()}
            aria-label={t("filters.filters")}
            className="pressable relative flex size-12 items-center justify-center rounded-full border bg-background shadow-md animate-in fade-in slide-in-from-bottom-1 duration-150"
          >
            <SlidersHorizontal className="size-5" />
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
              {pageFilter.count}
            </span>
          </button>
        )}
        {!pageAction && fabOpen && quickActions.map((action) => (
          <div
            key={action.href}
            className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-150 cursor-pointer group/action"
            onClick={() => { navigate(action.href); setFabOpen(false) }}
          >
            <span className="text-xs font-medium bg-background border shadow-sm rounded-full px-2.5 py-1 whitespace-nowrap group-hover/action:bg-accent transition-colors">
              {t(action.labelKey)}
            </span>
            <Button
              size="icon"
              variant="secondary"
              className="size-11 rounded-full shadow-md shrink-0 pointer-events-none"
            >
              <action.icon className="size-4" />
            </Button>
          </div>
        ))}
        <Button
          size="icon"
          className="size-14 rounded-full shadow-lg pressable"
          aria-label={pageAction ? t(pageAction.labelKey) : undefined}
          onClick={() => { if (pageAction) navigate(pageAction.href); else setFabOpen((o) => !o) }}
        >
          {!pageAction && fabOpen ? <X className="size-5" /> : <Plus className="size-5" />}
        </Button>
      </div>

      {/* Bottom tab bar — columns adapt to the (account-type-filtered) tab count. */}
      <nav className="safe-pb fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t">
        <div
          className="grid px-1 py-1"
          style={{ gridTemplateColumns: `repeat(${primaryTabs.length + 1}, minmax(0, 1fr))` }}
        >
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
                <span className="text-[10px] font-medium leading-none">{t(tab.labelKey)}</span>
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
                <span className="text-[10px] font-medium leading-none">{t("nav.more")}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl h-[60vh]">
              <SheetHeader className="text-left mb-2">
                <SheetTitle>{t("nav.more")}</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-3">
                {moreItems.map((item) => (
                  <button
                    key={item.labelKey}
                    onClick={() => { setMoreOpen(false); navigate(item.href) }}
                    className="pressable flex flex-col items-center gap-2 p-3 rounded-xl bg-muted/50 border"
                  >
                    <item.icon className="size-5" />
                    <span className="text-xs font-medium text-center leading-tight">{t(item.labelKey)}</span>
                  </button>
                ))}
                {isAdmin && (
                  <button
                    onClick={() => { setMoreOpen(false); navigate("/admin") }}
                    className="pressable flex flex-col items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300"
                  >
                    <ShieldCheck className="size-5" />
                    <span className="text-xs font-medium text-center leading-tight">{t("nav.admin")}</span>
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
