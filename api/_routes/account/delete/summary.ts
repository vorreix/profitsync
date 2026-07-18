import type { VercelRequest, VercelResponse } from "@vercel/node"
import { count, eq, inArray } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { organizationMembers, organizations, subscriptions } from "../../../../src/lib/db/schema.js"
import { requireAuth } from "../../../_lib/auth.js"

// What deleting this account will destroy — drives the consequences step of the
// delete-account dialog. DB-only (no Clerk round-trip).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAuth(req, res)
  if (!ctx) return
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })
  const { userId } = ctx

  const owned = await db
    .select({ id: organizations.id, name: organizations.name, isPersonal: organizations.isPersonal })
    .from(organizations)
    .where(eq(organizations.ownerUserId, userId))
  const ownedIds = owned.map((o) => o.id)

  const memberCounts = ownedIds.length
    ? await db
        .select({ orgId: organizationMembers.organizationId, n: count() })
        .from(organizationMembers)
        .where(inArray(organizationMembers.organizationId, ownedIds))
        .groupBy(organizationMembers.organizationId)
    : []
  const countByOrg = new Map(memberCounts.map((m) => [m.orgId, Number(m.n)]))

  const subs = ownedIds.length
    ? await db
        .select({ orgId: subscriptions.organizationId, planKey: subscriptions.planKey, status: subscriptions.status })
        .from(subscriptions)
        .where(inArray(subscriptions.organizationId, ownedIds))
    : []
  const premiumOrgs = new Set(subs.filter((s) => s.planKey !== "free" && s.status !== "cancelled").map((s) => s.orgId))

  const memberships = await db
    .select({ orgId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
  const ownedSet = new Set(ownedIds)
  const otherMemberships = memberships.filter((m) => !ownedSet.has(m.orgId)).length

  return res.json({
    organizations: owned.map((o) => ({
      id: o.id,
      name: o.name,
      is_personal: o.isPersonal,
      member_count: countByOrg.get(o.id) ?? 0,
      has_active_premium: premiumOrgs.has(o.id),
    })),
    other_memberships: otherMemberships,
  })
}
