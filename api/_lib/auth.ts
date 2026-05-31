import type { VercelRequest, VercelResponse } from "@vercel/node"
import { verifyToken } from "@clerk/backend"
import { and, eq, isNull } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, organizations, organizationMembers, subscriptions, userProfiles } from "../../src/lib/db/schema.js"
import type { AccountType } from "../../src/lib/types.js"

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

export type OrgAuth = { userId: string; orgId: string; role: string; accountType: AccountType | null }

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
  accountType?: AccountType
  currency?: string
}): Promise<{ id: string; currency: string }> {
  const currency = (input.currency ?? "USD").toUpperCase()
  // Default the feature tier from the org kind: the auto personal workspace is a
  // personal account; any explicitly created (named) org is a business account.
  const accountType: AccountType = input.accountType ?? (input.isPersonal ? "personal" : "business")
  const [org] = await db
    .insert(organizations)
    .values({
      ownerUserId: input.userId,
      name: input.name,
      slug: input.slug,
      isPersonal: input.isPersonal,
      accountType,
      currency,
    })
    .returning()
  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: input.userId,
    role: "owner",
  })
  await ensureFreeSubscription(org.id)
  // Personal accounts have no Clients section, but transactions are FK'd to a
  // client. Provision a single hidden default client so the personal finance
  // experience works without exposing client management.
  if (accountType === "personal") {
    await ensureDefaultClient(org.id, input.userId)
  }
  return { id: org.id, currency: org.currency }
}

/**
 * Ensure a personal-account org has its single default client (used to anchor
 * transactions). Idempotent: returns the existing client if one is present.
 */
export async function ensureDefaultClient(orgId: string, userId: string): Promise<string> {
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
    .limit(1)
  if (existing) return existing.id
  const [created] = await db
    .insert(clients)
    .values({ userId, organizationId: orgId, name: "Personal", status: "active" })
    .returning({ id: clients.id })
  return created.id
}

export async function ensurePersonalOrg(userId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.ownerUserId, userId), eq(organizations.isPersonal, true)))
  if (existing) {
    await ensureFreeSubscription(existing.id)
    // Backfill account type for legacy personal orgs created before the field existed.
    if (!existing.accountType) {
      await db.update(organizations).set({ accountType: "personal" }).where(eq(organizations.id, existing.id))
    }
    // Legacy personal orgs predate the default-client invariant; ensure it here so
    // transactions (which require a client FK) always have one to anchor to.
    await ensureDefaultClient(existing.id, userId)
    return existing.id
  }

  // Pull profile currency to inherit (if profile exists yet)
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  const { id } = await createOrgForUser({
    userId,
    name: "Personal",
    slug: "personal",
    isPersonal: true,
    accountType: "personal",
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

// Resolve membership for (org, user) joined with the org's account type, so a
// single round-trip yields both the role and the feature tier.
async function membershipWithAccountType(orgId: string, userId: string) {
  const [row] = await db
    .select({ role: organizationMembers.role, accountType: organizations.accountType })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
  return row ?? null
}

async function resolveActiveOrg(
  req: VercelRequest,
  userId: string,
  headerOrgId: string | undefined,
): Promise<OrgAuth | null> {
  if (headerOrgId) {
    const member = await membershipWithAccountType(headerOrgId, userId)
    if (member) {
      return { userId, orgId: headerOrgId, role: member.role, accountType: member.accountType as AccountType | null }
    }
  }

  // Look at profile
  const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
  if (profile?.currentOrganizationId) {
    const member = await membershipWithAccountType(profile.currentOrganizationId, userId)
    if (member) {
      return {
        userId,
        orgId: profile.currentOrganizationId,
        role: member.role,
        accountType: member.accountType as AccountType | null,
      }
    }
  }

  // Fallback: personal org
  const personalOrgId = await ensurePersonalOrg(userId)
  return { userId, orgId: personalOrgId, role: "owner", accountType: "personal" }
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

/** A personal-account org cannot use business-only sections (clients, quotations, members). */
export function isPersonalAccount(ctx: OrgAuth): boolean {
  return ctx.accountType === "personal"
}

/**
 * Guard a business-only feature. If the active org is a personal account, write
 * a 403 and return false (the caller should `return`). Otherwise return true.
 */
export function requireBusinessFeature(
  res: VercelResponse,
  ctx: OrgAuth,
  feature: "clients" | "quotations" | "members",
): boolean {
  if (isPersonalAccount(ctx)) {
    res.status(403).json({
      error: `This feature isn't available on a personal account. Switch to a business workspace to use ${feature}.`,
      code: "personal_account_restricted",
      feature,
    })
    return false
  }
  return true
}
