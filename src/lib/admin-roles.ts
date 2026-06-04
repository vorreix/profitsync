// Shared platform-admin role & capability model.
//
// Imported by BOTH the browser (admin console nav/route gating) and the API
// (route guards — imported there with a `.js` extension, like the rest of
// `src/lib/**` used from `api/**`). Mirrors the org-member role pattern but for
// the internal `/admin` console.
//
// A platform admin is a row in `app_admins`; its `role` column selects a set of
// capabilities. Root-email admins (ROOT_ADMIN_EMAILS) are always `super_admin`.

export type AdminRole = "super_admin" | "editor" | "viewer" | "blog_writer"

export type AdminCapability = "read" | "write" | "blog" | "settings" | "manage_admins"

// Capabilities granted by each role.
// - read         → view read-only admin data (stats, users, orgs, subs, invoices, referrals)
// - write        → mutate that data (edit orgs/subscriptions/invoices/users, manage invitations)
// - blog         → create / edit / publish blog posts
// - settings     → sensitive config: plans, referral settings, payout approvals
// - manage_admins→ add / remove admins and change their roles
//
// `super_admin` is the default for every EXISTING admin (the migration defaults
// the new column to it) and for root-email admins, so nobody loses access.
export const ADMIN_ROLE_CAPS: Record<AdminRole, AdminCapability[]> = {
  super_admin: ["read", "write", "blog", "settings", "manage_admins"],
  editor: ["read", "write", "blog"],
  viewer: ["read"],
  blog_writer: ["blog"],
}

// Order matters: used for the role picker and as the "first allowed nav" search order.
export const ADMIN_ROLES: AdminRole[] = ["super_admin", "editor", "viewer", "blog_writer"]

export function isAdminRole(v: unknown): v is AdminRole {
  return typeof v === "string" && (ADMIN_ROLES as string[]).includes(v)
}

export function adminCan(role: AdminRole | null | undefined, cap: AdminCapability): boolean {
  if (!role) return false
  return ADMIN_ROLE_CAPS[role]?.includes(cap) ?? false
}

export function adminCaps(role: AdminRole | null | undefined): AdminCapability[] {
  if (!role) return []
  return ADMIN_ROLE_CAPS[role] ?? []
}

// Human-readable metadata for the admin UI. English-only on purpose — the whole
// `/admin` console is an internal, English-only tool (no i18n), consistent with
// the rest of the admin pages.
export const ADMIN_ROLE_META: Record<AdminRole, { label: string; description: string }> = {
  super_admin: {
    label: "Super admin",
    description: "Full access — including plans, settings and managing other admins.",
  },
  editor: {
    label: "Editor",
    description: "View and edit users, organizations, subscriptions, invoices and blog. No settings or admin management.",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to the admin console.",
  },
  blog_writer: {
    label: "Blog writer",
    description: "Can only create and manage blog posts.",
  },
}
