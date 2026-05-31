import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { and, eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { organizations, organizationMembers, subscriptions, userProfiles } from "../../src/lib/db/schema.js"

export async function getUserId(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) return null
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! })
    return payload.sub
  } catch {
    return null
  }
}

export type OrgAuth = { userId: string; orgId: string; role: string }

export async function ensureFreeSubscription(orgId: string): Promise<void> {
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, orgId))
  if (existing) return
  await db.insert(subscriptions).values({
    organizationId: orgId,
    planKey: "free",
    status: "active",
  })
}

export async function createOrgForUser(input: {
  userId: string
  name: string
  slug: string
  isPersonal: boolean
  currency?: string
}): Promise<{ id: string; currency: string }> {
  const currency = (input.currency ?? "USD").toUpperCase()
  const [org] = await db
    .insert(organizations)
    .values({
      ownerUserId: input.userId,
      name: input.name,
      slug: input.slug,
      isPersonal: input.isPersonal,
      currency,
    })
    .returning()
  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: input.userId,
    role: "owner",
  })
  await ensureFreeSubscription(org.id)
  return { id: org.id, currency: org.currency }
}

export async function ensurePersonalOrg(userId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.ownerUserId, userId), eq(organizations.isPersonal, true)))
  if (existing) {
    await ensureFreeSubscription(existing.id)
    return existing.id
  }

  // Pull profile currency to inherit (if profile exists yet)
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  const { id } = await createOrgForUser({
    userId,
    name: "Personal",
    slug: "personal",
    isPersonal: true,
    currency: profile?.currency ?? "USD",
  })
  return id
}

// Short-lived in-process cache for org resolution. requireAuth runs on every API
// call, and resolving the org otherwise costs a membership round-trip to the DB
// (in eu-central-1) each time. Membership/role rarely changes within a session,
// so a brief TTL keyed by (userId, headerOrgId) safely removes that round-trip.
// Switching org changes the header → a different key, so switches are picked up
// immediately. The cache lives for the lifetime of the warm function instance.
type CachedOrg = { value: OrgAuth; ts: number }
const orgAuthCache = new Map<string, CachedOrg>()
const ORG_AUTH_TTL_MS = 60_000

export async function getActiveOrg(req: VercelRequest, userId: string): Promise<OrgAuth | null> {
  const headerOrgId = (req.headers["x-org-id"] as string | undefined)?.trim() || undefined

  const cacheKey = `${userId}::${headerOrgId ?? ""}`
  const cached = orgAuthCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < ORG_AUTH_TTL_MS) return cached.value

  const resolved = await resolveActiveOrg(req, userId, headerOrgId)
  if (resolved) orgAuthCache.set(cacheKey, { value: resolved, ts: Date.now() })
  return resolved
}

async function resolveActiveOrg(
  req: VercelRequest,
  userId: string,
  headerOrgId: string | undefined,
): Promise<OrgAuth | null> {
  if (headerOrgId) {
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, headerOrgId), eq(organizationMembers.userId, userId)))
    if (member) {
      return { userId, orgId: headerOrgId, role: member.role }
    }
  }

  // Look at profile
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  if (profile?.currentOrganizationId) {
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, profile.currentOrganizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
    if (member) {
      return { userId, orgId: profile.currentOrganizationId, role: member.role }
    }
  }

  // Fallback: personal org
  const personalOrgId = await ensurePersonalOrg(userId)
  return { userId, orgId: personalOrgId, role: "owner" }
}

export async function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
): Promise<OrgAuth | null> {
  const userId = await getUserId(req)
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }
  const ctx = await getActiveOrg(req, userId)
  if (!ctx) {
    res.status(403).json({ error: "No organization context" })
    return null
  }
  return ctx
}

export function canWrite(role: string): boolean {
  return role === "owner" || role === "admin" || role === "editor"
}

export function canDelete(role: string): boolean {
  return role === "owner" || role === "admin"
}
