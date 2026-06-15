// Pure, import-free helpers for the Family feature — safe to use from the API,
// the frontend, and unit tests (no DB, no env, deterministic).
//
// Family membership REUSES the organization role column so all existing
// invite/switch/auth/role machinery applies unchanged:
//   head   = owner   (manages members + billing + disbursements + deletion)
//   member = editor  (contributes, manages the shared household, self-withdraws)
//   viewer = viewer  (reserved for a future view-only / kid tier)

import type { OrgRole } from "./types"

export type FamilyRole = "head" | "member" | "viewer"

/** Map an organization member role to its family-facing role. */
export function familyRoleFromOrgRole(role: string): FamilyRole {
  if (role === "owner" || role === "admin") return "head"
  if (role === "viewer") return "viewer"
  return "member"
}

/** Map a family role to the organization member role to persist. */
export function orgRoleForFamilyRole(role: FamilyRole): OrgRole {
  if (role === "head") return "owner"
  if (role === "viewer") return "viewer"
  return "editor"
}

/** True if the org role is the family head (manages members + billing). */
export function isHead(role: string): boolean {
  return role === "owner" || role === "admin"
}

export type ContributionLeg = {
  familyPartyUserId: string | null
  type: string // "incoming" (contributed into household) | "outgoing" (disbursed to member)
  amount: number | string
}

export type MemberContribution = {
  userId: string
  /** Money this member moved INTO the household (sum of incoming family legs). */
  contributed: number
  /** Money disbursed OUT to this member (sum of outgoing family legs). */
  received: number
  /** contributed − received. */
  net: number
}

/**
 * Aggregate family contribution/disbursement legs (read from the FAMILY org) by
 * member. From the household's perspective an `incoming` family-transfer leg is a
 * contribution by `familyPartyUserId`; an `outgoing` one is a disbursement to
 * that member. Legs without an attributed member are ignored. Pure + sorted by
 * most contributed (stable) so the math is unit-tested independent of the DB.
 */
export function sumContributionsByMember(legs: ContributionLeg[]): MemberContribution[] {
  const map = new Map<string, MemberContribution>()
  for (const leg of legs) {
    if (!leg.familyPartyUserId) continue
    const cur =
      map.get(leg.familyPartyUserId) ??
      { userId: leg.familyPartyUserId, contributed: 0, received: 0, net: 0 }
    const amt = Number(leg.amount) || 0
    if (leg.type === "incoming") cur.contributed += amt
    else cur.received += amt
    cur.net = cur.contributed - cur.received
    map.set(leg.familyPartyUserId, cur)
  }
  return [...map.values()].sort((a, b) => b.contributed - a.contributed)
}
