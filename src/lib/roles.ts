import type { OrgRole } from "@/lib/types"

// Client-side mirrors of the server role checks in api/_lib/auth.ts. The server
// always re-enforces these; these only drive UI affordances (show/hide buttons).
export function canWriteRole(role: OrgRole | string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "editor"
}

export function canDeleteRole(role: OrgRole | string | null | undefined): boolean {
  return role === "owner" || role === "admin"
}
