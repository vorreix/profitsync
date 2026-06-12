// Locks the RBAC security core: super-only capabilities can NEVER leak into
// grantable/custom roles, and the role-key slugging can't collide with the
// built-in roles by accident.
import { describe, expect, it } from "vitest"
import {
  ADMIN_ROLE_CAPS,
  ADMIN_ROLES,
  GRANTABLE_ADMIN_CAPS,
  adminCan,
  isAdminRole,
  roleKeyFromName,
  sanitizeGrantableCaps,
} from "./admin-roles"

const SUPER_ONLY = ["org_transactions", "manage_super_admins", "manage_roles"] as const

describe("super-only capabilities", () => {
  it("belong to super_admin and to NO other system role", () => {
    for (const cap of SUPER_ONLY) {
      expect(ADMIN_ROLE_CAPS.super_admin).toContain(cap)
      for (const role of ADMIN_ROLES.filter((r) => r !== "super_admin")) {
        expect(ADMIN_ROLE_CAPS[role]).not.toContain(cap)
      }
    }
  })

  it("are excluded from the grantable set (custom roles can never receive them)", () => {
    for (const cap of SUPER_ONLY) {
      expect(GRANTABLE_ADMIN_CAPS).not.toContain(cap)
    }
  })
})

describe("sanitizeGrantableCaps — the custom-role write/read filter", () => {
  it("keeps only grantable capabilities", () => {
    expect(sanitizeGrantableCaps(["read", "write"])).toEqual(["read", "write"])
  })

  it("strips super-only capabilities even from a tampered DB row", () => {
    expect(sanitizeGrantableCaps(["read", "org_transactions", "manage_super_admins", "manage_roles"])).toEqual(["read"])
  })

  it("strips unknown values, dupes and non-arrays", () => {
    expect(sanitizeGrantableCaps(["read", "read", "root", 42, null])).toEqual(["read"])
    expect(sanitizeGrantableCaps("read")).toEqual([])
    expect(sanitizeGrantableCaps(null)).toEqual([])
  })
})

describe("roleKeyFromName", () => {
  it("slugs names deterministically", () => {
    expect(roleKeyFromName("Support Team")).toBe("support_team")
    expect(roleKeyFromName("  Billing & Ops!  ")).toBe("billing_ops")
  })

  it("returns null when nothing usable remains", () => {
    expect(roleKeyFromName("!!!")).toBeNull()
    expect(roleKeyFromName("   ")).toBeNull()
  })

  it("can produce system-role collisions — which the API must reject via isAdminRole", () => {
    const key = roleKeyFromName("Super Admin")
    expect(key).toBe("super_admin")
    expect(isAdminRole(key)).toBe(true) // → roles.ts returns 400 "reserved"
  })
})

describe("adminCan (static map — system roles only)", () => {
  it("grants org_transactions to super_admin only", () => {
    expect(adminCan("super_admin", "org_transactions")).toBe(true)
    expect(adminCan("editor", "org_transactions")).toBe(false)
    expect(adminCan("viewer", "org_transactions")).toBe(false)
    expect(adminCan("blog_writer", "org_transactions")).toBe(false)
  })
})
