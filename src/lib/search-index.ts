/**
 * Static registry behind the global search: every navigable page and quick
 * action, filtered the same way the sidebar / mobile tabs / FAB are. Reuses the
 * existing `nav.*` / `actions.*` i18n keys so no new translations are needed.
 */
import type { ComponentType } from "react"
import {
  ArrowLeftRight,
  Building2,
  CalendarDays,
  ChartColumn,
  CreditCard,
  FileText,
  Gift,
  Landmark,
  LayoutDashboard,
  Network,
  PiggyBank,
  Repeat,
  Shield,
  Tag,
  Trash2,
  User,
  UserPlus,
  Users,
} from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { accountTypeAllows, type AccountType } from "@/lib/types"

export type SearchIcon = ComponentType<{ className?: string }>

export type SearchNavItem = {
  labelKey: string
  href: string
  icon: SearchIcon
}

export function searchablePages(
  accountType: AccountType | null | undefined,
  isAdmin: boolean,
  membersHref = "/organizations",
): SearchNavItem[] {
  const pages: Array<SearchNavItem | false> = [
    { labelKey: "nav.dashboard", href: "/dashboard", icon: LayoutDashboard },
    accountTypeAllows(accountType, "clients") && { labelKey: "nav.clients", href: "/clients", icon: Users },
    { labelKey: "nav.transactions", href: "/transactions", icon: ArrowLeftRight },
    { labelKey: "nav.wealth", href: "/wealth", icon: Landmark },
    accountTypeAllows(accountType, "spaces") && { labelKey: "nav.spaces", href: "/spaces", icon: PiggyBank },
    { labelKey: "nav.recurring", href: "/recurring", icon: Repeat },
    { labelKey: "nav.calendar", href: "/calendar", icon: CalendarDays },
    { labelKey: "nav.flow", href: "/flow", icon: Network },
    { labelKey: "nav.analytics", href: "/analytics", icon: ChartColumn },
    accountTypeAllows(accountType, "quotations") && { labelKey: "nav.quotations", href: "/quotations", icon: FileText },
    accountTypeAllows(accountType, "members") && { labelKey: "nav.users", href: membersHref, icon: UserPlus },
    { labelKey: "nav.categoryTags", href: "/categories", icon: Tag },
    { labelKey: "nav.budgets", href: "/budgets", icon: MoneyBag },
    { labelKey: "nav.referrals", href: "/referrals", icon: Gift },
    { labelKey: "nav.organizations", href: "/organizations", icon: Building2 },
    { labelKey: "nav.subscription", href: "/subscription", icon: CreditCard },
    { labelKey: "nav.trash", href: "/trash", icon: Trash2 },
    { labelKey: "nav.profile", href: "/profile", icon: User },
    isAdmin && { labelKey: "nav.admin", href: "/admin", icon: Shield },
  ]
  return pages.filter((p): p is SearchNavItem => Boolean(p))
}

export function quickActions(accountType: AccountType | null | undefined): SearchNavItem[] {
  const actions: Array<SearchNavItem | false> = [
    accountTypeAllows(accountType, "clients") &&
      { labelKey: "actions.addClient", href: "/clients?new=1", icon: Users },
    { labelKey: "actions.addTransaction", href: "/transactions?new=1", icon: ArrowLeftRight },
    accountTypeAllows(accountType, "quotations") &&
      { labelKey: "actions.createQuotation", href: "/quotations?new=1", icon: FileText },
  ]
  return actions.filter((a): a is SearchNavItem => Boolean(a))
}

/** Case-insensitive substring match on the *translated* label (locale-aware). */
export function filterLocal<T extends { labelKey: string }>(
  items: T[],
  query: string,
  translate: (key: string) => string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => translate(item.labelKey).toLowerCase().includes(q))
}
