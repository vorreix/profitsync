import {
  Users,
  Building2,
  CreditCard,
  ReceiptText,
  Layers,
  GaugeCircle,
  UserCog,
  Gift,
  Newspaper,
  Activity,
  ServerCog,
  UsersRound,
  Megaphone,
  type LucideIcon,
} from "lucide-react"
import type { AdminCapability } from "@/lib/admin-roles"

export type AdminNavItem = {
  label: string
  href: string
  icon: LucideIcon
  end?: boolean
  // Capability required to see this section and reach its route.
  cap: AdminCapability
}

// Single source of truth for the admin sidebar + per-route capability gating.
export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: GaugeCircle, end: true, cap: "read" },
  { label: "Users", href: "/admin/users", icon: Users, cap: "read" },
  { label: "Organizations", href: "/admin/organizations", icon: Building2, cap: "read" },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard, cap: "read" },
  { label: "Invoices", href: "/admin/invoices", icon: ReceiptText, cap: "read" },
  { label: "Billing attempts", href: "/admin/billing-attempts", icon: Activity, cap: "read" },
  { label: "Plans", href: "/admin/plans", icon: Layers, cap: "settings" },
  { label: "Blog", href: "/admin/blog", icon: Newspaper, cap: "blog" },
  { label: "Referrals", href: "/admin/referrals", icon: Gift, cap: "read" },
  { label: "Worker", href: "/admin/worker", icon: ServerCog, cap: "read" },
  { label: "Broadcasts", href: "/admin/broadcasts", icon: Megaphone, cap: "broadcast" },
  { label: "User groups", href: "/admin/user-groups", icon: UsersRound, cap: "broadcast" },
  { label: "Admins", href: "/admin/admins", icon: UserCog, cap: "manage_admins" },
]

// The first admin route the given capabilities can reach — used to redirect an
// admin who lands on a section they can't access (e.g. a blog_writer at /admin).
export function firstAllowedAdminPath(can: (c: AdminCapability) => boolean): string {
  const item = ADMIN_NAV.find((n) => can(n.cap))
  return item?.href ?? "/dashboard"
}
