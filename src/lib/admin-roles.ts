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

export type AdminCapability =
  | "read"
  | "write"
  | "blog"
  | "broadcast" // compose/send push broadcasts + manage saved user groups
  | "settings"
  | "manage_admins"
  // ── super-admin-EXCLUSIVE capabilities (never grantable to other roles) ──
  | "org_transactions" // the org-detail Transactions tab + /api/admin/transactions
  | "manage_super_admins" // grant/edit/remove super_admin rows; SEE that the role exists
  | "manage_roles" // create/edit/delete custom admin roles

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
  super_admin: ["read", "write", "blog", "broadcast", "settings", "manage_admins", "org_transactions", "manage_super_admins", "manage_roles"],
  editor: ["read", "write", "blog", "broadcast"],
  viewer: ["read"],
  blog_writer: ["blog"],
}

/**
 * The only capabilities a CUSTOM role may hold. Validated at create/edit AND
 * re-filtered at resolution time, so even a tampered DB row can't smuggle a
 * super-only capability into a custom role. org_transactions /
 * manage_super_admins / manage_roles stay super_admin-exclusive by design:
 * non-supers must not even see those surfaces exist.
 */
export const GRANTABLE_ADMIN_CAPS: readonly AdminCapability[] = ["read", "write", "blog", "broadcast", "settings", "manage_admins"]

/** Keep only grantable capabilities (resolution-time defense for custom roles). */
export function sanitizeGrantableCaps(raw: unknown): AdminCapability[] {
  if (!Array.isArray(raw)) return []
  const out: AdminCapability[] = []
  for (const c of raw) {
    if (typeof c === "string" && (GRANTABLE_ADMIN_CAPS as string[]).includes(c) && !out.includes(c as AdminCapability)) {
      out.push(c as AdminCapability)
    }
  }
  return out
}

/** UI metadata for the custom-role permission checkboxes (grantable set only). */
export const ADMIN_CAP_META: Record<string, { label: string; description: string }> = {
  read: { label: "View data", description: "See stats, users, organizations, subscriptions, invoices, billing attempts and referrals." },
  write: { label: "Edit data", description: "Edit organizations, subscriptions, invoices, users, invitations and billing follow-ups." },
  blog: { label: "Blog", description: "Create, edit and publish blog posts." },
  broadcast: { label: "Broadcasts", description: "Compose and send push notifications to users, and manage saved user groups." },
  settings: { label: "Settings", description: "Plans, referral settings and payout approvals." },
  manage_admins: { label: "Manage admins", description: "Add or remove admins and change their roles (never super admins)." },
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

/** Maximum custom-role name length (UI + API agree). */
export const ROLE_NAME_MAX = 40

/** Slug a custom-role name into a storage key; null when nothing usable remains. */
export function roleKeyFromName(name: string): string | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return key || null
}
