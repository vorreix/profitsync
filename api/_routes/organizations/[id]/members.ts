import type { VercelRequest, VercelResponse } from "@vercel/node"
import { randomBytes } from "crypto"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import {
  organizationInvitations,
  organizationMembers,
  organizations,
  userProfiles,
} from "../../../../src/lib/db/schema.js"
import { getUserId } from "../../../_lib/auth.js"
import { sendInvitationEmail } from "../../../_lib/email.js"

const VALID_ROLES = ["owner", "admin", "editor", "viewer"]

async function getMembership(orgId: string, userId: string) {
  const [row] = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)))
  return row ?? null
}

function generateToken(): string {
  return randomBytes(24).toString("base64url")
}

// Derive the app origin from the request so invite links point at the same host
// the inviter is on (works across local dev, preview and production). Falls back
// to the production domain when no host header is present (e.g. a cron context).
function baseUrl(req: VercelRequest): string {
  const origin = req.headers.origin
  if (typeof origin === "string" && origin) return origin.replace(/\/+$/, "")
  const proto = (req.headers["x-forwarded-proto"] as string) || "https"
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "www.profitsync.net"
  return `${proto}://${host}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const userId = await getUserId(req)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })
  const { id } = req.query as { id: string }

  const requesterMembership = await getMembership(id, userId)
  if (!requesterMembership) return res.status(404).json({ error: "Not found" })

  // Personal-account orgs are single-user — member management is business-only.
  if (req.method !== "GET") {
    const [org] = await db
      .select({ accountType: organizations.accountType })
      .from(organizations)
      .where(eq(organizations.id, id))
    if (org?.accountType === "personal") {
      return res.status(403).json({
        error: "Member management isn't available on a personal account.",
        code: "personal_account_restricted",
        feature: "members",
      })
    }
  }

  if (req.method === "GET") {
    const members = await db
      .select({
        id: organizationMembers.id,
        userId: organizationMembers.userId,
        role: organizationMembers.role,
        createdAt: organizationMembers.createdAt,
        email: userProfiles.email,
        fullName: userProfiles.fullName,
      })
      .from(organizationMembers)
      .leftJoin(userProfiles, eq(userProfiles.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, id))
      .orderBy(desc(organizationMembers.createdAt))

    const pendingInvites = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, id),
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.declinedAt),
        ),
      )
      .orderBy(desc(organizationInvitations.createdAt))

    return res.json({
      members: members.map(serialize),
      invitations: pendingInvites.map(serialize),
      current_role: requesterMembership.role,
    })
  }

  if (req.method === "POST") {
    if (requesterMembership.role !== "owner" && requesterMembership.role !== "admin") {
      return res.status(403).json({ error: "Only owners and admins can invite members" })
    }
    const { email, role } = req.body as { email?: string; role?: string }
    if (!email?.trim()) return res.status(400).json({ error: "email is required" })
    const normalizedRole = role ?? "editor"
    if (!VALID_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ error: "Invalid role" })
    }
    if (normalizedRole === "owner") {
      return res.status(400).json({ error: "Cannot invite as owner — use transfer-ownership flow" })
    }
    const normalizedEmail = email.trim().toLowerCase()

    // Don't allow re-inviting an existing active member
    const [existingMember] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .innerJoin(userProfiles, eq(userProfiles.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, id),
          sql`lower(${userProfiles.email}) = ${normalizedEmail}`,
        ),
      )
    if (existingMember) {
      return res.status(409).json({ error: "User is already a member" })
    }

    // Don't allow re-inviting pending invite — overwrite expiration
    const [existingInvite] = await db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, id),
          sql`lower(${organizationInvitations.email}) = ${normalizedEmail}`,
          isNull(organizationInvitations.acceptedAt),
          isNull(organizationInvitations.declinedAt),
        ),
      )

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 14)

    let invite
    let statusCode = 201
    if (existingInvite) {
      // Re-inviting: refresh role + expiry but keep the existing token so any
      // link already shared stays valid.
      const [updated] = await db
        .update(organizationInvitations)
        .set({ role: normalizedRole, expiresAt })
        .where(eq(organizationInvitations.id, existingInvite.id))
        .returning()
      invite = updated
      statusCode = 200
    } else {
      const [created] = await db
        .insert(organizationInvitations)
        .values({
          organizationId: id,
          email: normalizedEmail,
          role: normalizedRole,
          token: generateToken(),
          invitedByUserId: userId,
          expiresAt,
        })
        .returning()
      invite = created
    }

    // Always return a shareable link; additionally try to email the invitee.
    // Email is best-effort — a missing RESEND_API_KEY (e.g. local dev) just means
    // `emailed: false` and the inviter shares the link manually.
    const link = `${baseUrl(req)}/invitations/${invite.token}`
    let emailed = false
    try {
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, id))
      const [inviter] = await db
        .select({ fullName: userProfiles.fullName })
        .from(userProfiles)
        .where(eq(userProfiles.id, userId))
      const result = await sendInvitationEmail({
        to: invite.email,
        orgName: org?.name ?? "your team",
        inviterName: inviter?.fullName,
        role: invite.role,
        link,
        expiresAt: invite.expiresAt,
      })
      emailed = result.ok
    } catch {
      emailed = false
    }

    return res.status(statusCode).json({ ...serialize(invite), link, emailed })
  }

  if (req.method === "PATCH") {
    if (requesterMembership.role !== "owner") {
      return res.status(403).json({ error: "Only owners can change roles" })
    }
    const { member_id, role } = req.body as { member_id?: string; role?: string }
    if (!member_id || !role) return res.status(400).json({ error: "member_id and role are required" })
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" })

    const [target] = await db.select().from(organizationMembers).where(eq(organizationMembers.id, member_id))
    if (!target || target.organizationId !== id) return res.status(404).json({ error: "Member not found" })

    // Block demoting the last owner
    if (target.role === "owner" && role !== "owner") {
      const [{ owners }] = await db
        .select({ owners: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, id), eq(organizationMembers.role, "owner")))
      if (owners <= 1) {
        return res.status(400).json({ error: "Cannot demote the last owner" })
      }
    }

    const [updated] = await db
      .update(organizationMembers)
      .set({ role })
      .where(eq(organizationMembers.id, member_id))
      .returning()
    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    const { member_id, invitation_id } = req.body as { member_id?: string; invitation_id?: string }

    if (invitation_id) {
      if (requesterMembership.role !== "owner" && requesterMembership.role !== "admin") {
        return res.status(403).json({ error: "Only owners/admins can revoke invitations" })
      }
      const result = await db
        .delete(organizationInvitations)
        .where(and(eq(organizationInvitations.id, invitation_id), eq(organizationInvitations.organizationId, id)))
        .returning({ id: organizationInvitations.id })
      if (!result.length) return res.status(404).json({ error: "Invitation not found" })
      return res.status(204).end()
    }

    if (!member_id) return res.status(400).json({ error: "member_id or invitation_id required" })
    const [target] = await db.select().from(organizationMembers).where(eq(organizationMembers.id, member_id))
    if (!target || target.organizationId !== id) return res.status(404).json({ error: "Member not found" })

    // Allow self-leave, otherwise require owner/admin
    if (target.userId !== userId && requesterMembership.role !== "owner" && requesterMembership.role !== "admin") {
      return res.status(403).json({ error: "Only owners/admins can remove other members" })
    }
    if (target.role === "owner") {
      const [{ owners }] = await db
        .select({ owners: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, id), eq(organizationMembers.role, "owner")))
      if (owners <= 1) return res.status(400).json({ error: "Cannot remove the last owner" })
    }

    // If the leaving user has this as current org, redirect to personal
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.id, target.userId))
    if (profile?.currentOrganizationId === id) {
      const [personal] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.ownerUserId, target.userId), eq(organizations.isPersonal, true)))
      await db
        .update(userProfiles)
        .set({ currentOrganizationId: personal?.id ?? null, updatedAt: new Date() })
        .where(eq(userProfiles.id, target.userId))
    }

    await db.delete(organizationMembers).where(eq(organizationMembers.id, member_id))
    return res.status(204).end()
  }

  return res.status(405).json({ error: "Method not allowed" })
}
