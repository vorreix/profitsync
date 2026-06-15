import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { CURRENCY_LIST } from "../../src/lib/currencies.js"
import { db, serialize } from "../../src/lib/db/index.js"
import {
  organizations,
  organizationMembers,
  userProfiles,
  wealthAccounts,
} from "../../src/lib/db/schema.js"
import { createOrgForUser, ensurePersonalOrg, getUserFamilyOrgId, getUserId, requireAuth } from "../_lib/auth.js"
import { imageSrc } from "../_lib/image-upload.js"
import { familyRoleFromOrgRole, isHead } from "../../src/lib/family.js"

const VALID_CURRENCIES = new Set(CURRENCY_LIST.map((c) => c.code))

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "family"
  )
}

async function uniqueSlug(userId: string, base: string): Promise<string> {
  let candidate = base
  let suffix = 1
  while (true) {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.ownerUserId, userId), eq(organizations.slug, candidate)))
    if (!existing) return candidate
    suffix += 1
    candidate = `${base}-${suffix}`
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // POST = create a family (no active-family context required yet).
  if (req.method === "POST") {
    const userId = await getUserId(req)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    // One family per user — structural guard before we create anything.
    const existingFamily = await getUserFamilyOrgId(userId)
    if (existingFamily) {
      return res.status(409).json({
        error: "You already belong to a family. Leave it before starting a new one.",
        code: "already_in_family",
      })
    }

    const { name, currency } = req.body as { name?: string; currency?: string }
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    if (currency !== undefined && !VALID_CURRENCIES.has(currency.toUpperCase())) {
      return res.status(400).json({ error: "Invalid currency code" })
    }

    // Make sure the creator keeps a private personal account to contribute FROM.
    await ensurePersonalOrg(userId)

    let resolvedCurrency = currency?.toUpperCase()
    if (!resolvedCurrency) {
      const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, userId))
      resolvedCurrency = profile?.currency ?? "USD"
    }

    const slug = await uniqueSlug(userId, slugify(name))
    const { id: familyOrgId } = await createOrgForUser({
      userId,
      name: name.trim(),
      slug,
      isPersonal: false,
      accountType: "family",
      currency: resolvedCurrency,
    })

    // Point the creator's profile at the new family + switch into it.
    await db
      .update(userProfiles)
      .set({ familyOrgId, currentOrganizationId: familyOrgId, updatedAt: new Date() })
      .where(eq(userProfiles.id, userId))

    const [created] = await db
      .select({
        id: organizations.id,
        ownerUserId: organizations.ownerUserId,
        name: organizations.name,
        slug: organizations.slug,
        isPersonal: organizations.isPersonal,
        accountType: organizations.accountType,
        currency: organizations.currency,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        role: sql<string>`'owner'`,
        planKey: sql<string>`'free'`,
        planStatus: sql<string>`'active'`,
      })
      .from(organizations)
      .where(eq(organizations.id, familyOrgId))

    return res.status(201).json(serialize(created))
  }

  // GET = the active family workspace's hub data.
  if (req.method === "GET") {
    const ctx = await requireAuth(req, res)
    if (!ctx) return
    if (ctx.accountType !== "family") {
      return res.status(403).json({ error: "Not a family workspace", code: "not_a_family" })
    }
    const familyOrgId = ctx.orgId

    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        currency: organizations.currency,
        logoData: organizations.logoData,
        logoMime: organizations.logoMime,
      })
      .from(organizations)
      .where(eq(organizations.id, familyOrgId))

    const memberRows = await db
      .select({
        id: organizationMembers.id,
        userId: organizationMembers.userId,
        role: organizationMembers.role,
        email: userProfiles.email,
        fullName: userProfiles.fullName,
        avatarData: userProfiles.avatarData,
        avatarMime: userProfiles.avatarMime,
        createdAt: organizationMembers.createdAt,
      })
      .from(organizationMembers)
      .leftJoin(userProfiles, eq(userProfiles.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, familyOrgId))
      .orderBy(desc(organizationMembers.role), desc(organizationMembers.createdAt))

    const members = memberRows.map(({ avatarData, avatarMime, role, ...rest }) =>
      serialize({
        ...rest,
        role,
        familyRole: familyRoleFromOrgRole(role),
        avatarSrc: imageSrc(avatarData ?? "", avatarMime ?? ""),
      }),
    )

    // Shared household balances. Banks+cash are spendable ("available"); spaces
    // hold money set aside (still household money → counted in net worth).
    const accounts = await db
      .select({ type: wealthAccounts.type, balance: wealthAccounts.currentBalance })
      .from(wealthAccounts)
      .where(and(eq(wealthAccounts.organizationId, familyOrgId), isNull(wealthAccounts.archivedAt)))

    let available = 0
    let saved = 0
    let bankCount = 0
    let spaceCount = 0
    for (const a of accounts) {
      const bal = Number(a.balance) || 0
      if (a.type === "space") {
        saved += bal
        spaceCount += 1
      } else {
        available += bal
        bankCount += 1
      }
    }

    return res.json({
      family: serialize({ ...org, logoSrc: imageSrc(org?.logoData ?? "", org?.logoMime ?? ""), role: ctx.role }),
      is_head: isHead(ctx.role),
      members,
      summary: {
        available,
        saved,
        net_worth: available + saved,
        bank_count: bankCount,
        space_count: spaceCount,
        member_count: members.length,
      },
    })
  }

  // DELETE = leave the active family (self-service). Head must transfer head or
  // delete the family instead (last-owner guard mirrors organizations members).
  if (req.method === "DELETE") {
    const ctx = await requireAuth(req, res)
    if (!ctx) return
    if (ctx.accountType !== "family") {
      return res.status(403).json({ error: "Not a family workspace", code: "not_a_family" })
    }
    const familyOrgId = ctx.orgId

    if (isHead(ctx.role)) {
      const [{ heads }] = await db
        .select({ heads: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, familyOrgId), eq(organizationMembers.role, "owner")))
      if (heads <= 1) {
        return res.status(400).json({
          error: "Transfer the head role to another member, or delete the family, before leaving.",
          code: "last_head",
        })
      }
    }

    await db
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, familyOrgId), eq(organizationMembers.userId, ctx.userId)))

    // Clear the family pointer and switch the leaver back to their personal org.
    const personalOrgId = await ensurePersonalOrg(ctx.userId)
    await db
      .update(userProfiles)
      .set({ familyOrgId: null, currentOrganizationId: personalOrgId, updatedAt: new Date() })
      .where(eq(userProfiles.id, ctx.userId))

    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
