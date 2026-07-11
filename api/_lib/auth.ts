import type { VercelRequest, VercelResponse } from "@vercel/node"
import { timingSafeEqual } from "node:crypto"
import { verifyToken } from "@clerk/backend"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { clients, organizations, organizationMembers, subscriptions, userProfiles } from "../../src/lib/db/schema.js"
import type { AccountType } from "../../src/lib/types.js"

type AuthDebugEvent = "missing-token" | "verify-token-success" | "verify-token-failure"

function secretFamily(secret: string | undefined): "live" | "test" | "missing" | "unknown" {
  if (!secret) return "missing"
  if (secret.startsWith("sk_live_")) return "live"
  if (secret.startsWith("sk_test_")) return "test"
  return "unknown"
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1]
    if (!part) return null
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>
  } catch {
    return null
  }
}

// Verbose auth diagnostics for debugging native (Capacitor) token flows.
// OPT-IN via AUTH_DEBUG=1: it fires on EVERY request (including successes), so
// leaving it unconditional would flood prod function logs.
const AUTH_DEBUG = process.env.AUTH_DEBUG === "1"

function authDebug(req: VercelRequest, event: AuthDebugEvent, token?: string, error?: unknown) {
  if (!AUTH_DEBUG) return
  const payload = token ? decodeJwtPayload(token) : null
  const issuer = typeof payload?.iss === "string" ? payload.iss : null
  const audience = typeof payload?.aud === "string" ? payload.aud : Array.isArray(payload?.aud) ? "array" : null
  const subjectPresent = typeof payload?.sub === "string" && payload.sub.length > 0

  console.info(
    "[ProfitSync Backend Auth Debug]",
    JSON.stringify({
      event,
      method: req.method,
      path: req.url ?? null,
      hasAuthorizationHeader: !!req.headers.authorization,
      authorizationPrefix: req.headers.authorization?.split(/\s+/, 1)[0] ?? null,
      hasOrgIdHeader: !!req.headers["x-org-id"],
      tokenIssuer: issuer,
      tokenAudience: audience,
      tokenSubjectPresent: subjectPresent,
      clerkSecretFamily: secretFamily(process.env.CLERK_SECRET_KEY),
      errorMessage: error instanceof Error ? error.message : error ? String(error) : null,
    }),
  )
}

export async function getUserId(req: VercelRequest): Promise<string | null> {
  const token = req.headers.authorization?.replace("Bearer ", "")
  if (!token) {
    authDebug(req, "missing-token")
    return null
  }
  try {
    const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! })
    authDebug(req, "verify-token-success", token)
    return payload.sub
  } catch (error) {
    authDebug(req, "verify-token-failure", token, error)
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
  // Every workspace gets a single "own" client: for personal accounts it's the
  // hidden anchor every transaction FKs to; for business accounts it's the
  // company's own/internal expense client (rent, utilities, salaries).
  await ensureDefaultClient(org.id, input.userId)
  return { id: org.id, currency: org.currency }
}

/**
 * Ensure a workspace has its single "own"/internal client. This is the personal
 * account's hidden anchor client, and the business account's own-company client.
 * Idempotent: returns the existing own client (promoting a legacy default for
 * personal orgs created before the `is_own` flag existed).
 */
export async function ensureDefaultClient(orgId: string, userId: string): Promise<string> {
  const [own] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), eq(clients.isOwn, true), isNull(clients.deletedAt)))
    .limit(1)
  if (own) return own.id

  const [org] = await db
    .select({ name: organizations.name, isPersonal: organizations.isPersonal })
    .from(organizations)
    .where(eq(organizations.id, orgId))

  // Legacy personal orgs have a single un-flagged client — promote it in place.
  if (org?.isPersonal) {
    const [legacy] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.organizationId, orgId), isNull(clients.deletedAt)))
      .orderBy(asc(clients.createdAt))
      .limit(1)
    if (legacy) {
      await db.update(clients).set({ isOwn: true }).where(eq(clients.id, legacy.id))
      return legacy.id
    }
  }

  const name = org?.isPersonal ? "Personal" : (org?.name?.trim() || "My Company")
  const [created] = await db
    .insert(clients)
    .values({ userId, organizationId: orgId, name, status: "active", isOwn: true })
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

/**
 * Guard for server-to-server (worker / scheduler) endpoints. Verifies the
 * `Authorization: Bearer <token>` matches `PROFITSYNC_SERVICE_TOKEN` — or
 * `CRON_FALLBACK_TOKEN`, a second accepted token so an external pinger (the
 * GitHub Actions fallback cron) can drive /api/cron/* without sharing or
 * rotating the worker's token — using a constant-time compare (no early-out on
 * length/content, to avoid leaking the secret via timing). The browser never
 * holds these tokens. Returns true on success, otherwise writes a 401/503 and
 * returns false.
 */
export function requireServiceToken(req: VercelRequest, res: VercelResponse): boolean {
  const expected = [process.env.PROFITSYNC_SERVICE_TOKEN, process.env.CRON_FALLBACK_TOKEN].filter(
    (t): t is string => !!t,
  )
  if (expected.length === 0) {
    res.status(503).json({ error: "Service token not configured" })
    return false
  }
  const provided = req.headers.authorization?.replace("Bearer ", "") ?? ""
  const a = Buffer.from(provided)
  // timingSafeEqual throws on length mismatch — guard it, but still do the compare
  // on equal-length inputs so the timing doesn't reveal whether the length matched.
  // `some` compares every candidate the same way (at most two).
  const ok = expected.some((token) => {
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  })
  if (!ok) {
    res.status(401).json({ error: "Unauthorized" })
    return false
  }
  return true
}
